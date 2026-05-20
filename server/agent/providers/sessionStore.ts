/**
 * Provider-agnostic chat session store.
 *
 * Keeps accumulated OpenAI-format message history behind an sdkSessionId so
 * follow-up turns can resume without rebuilding the full prompt each time.
 */

import type OpenAI from "openai";
import { randomUUID } from "crypto";
import { eq, and, gt, asc, desc } from "drizzle-orm";
import { agentChatSessions, agentChatMessages } from "@shared/schema";
import type { AgentChatMessage } from "@shared/schema";

const SESSION_TTL_HOURS = parseInt(process.env.AGENT_SESSION_TTL_HOURS ?? "24", 10);
const SESSION_TTL_MS = (isNaN(SESSION_TTL_HOURS) || SESSION_TTL_HOURS <= 0 ? 24 : SESSION_TTL_HOURS) * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const processCache = new Map<string, { messages: AgentChatMessage[]; expiresAt: number }>();

export interface ResumeResult {
  messages: OAIMessage[];
  sdkSessionId: string;
  resumed: boolean;
}

async function getDb() {
  const mod = await import("../../db");
  return mod.db;
}

function toAgentMessage(m: OAIMessage): AgentChatMessage {
  return {
    role: m.role as AgentChatMessage["role"],
    content: typeof m.content === "string" ? m.content : null,
    tool_calls: "tool_calls" in m ? (m as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam).tool_calls as AgentChatMessage["tool_calls"] : undefined,
    tool_call_id: "tool_call_id" in m ? (m as OpenAI.Chat.Completions.ChatCompletionToolMessageParam).tool_call_id : undefined,
  };
}

function fromAgentMessage(m: AgentChatMessage): OAIMessage {
  const base: Record<string, unknown> = { role: m.role, content: m.content ?? null };
  if (m.tool_calls) base.tool_calls = m.tool_calls;
  if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
  return base as unknown as OAIMessage;
}

function cacheSet(sessionId: string, messages: AgentChatMessage[], expiresAt: number): void {
  if (processCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = processCache.keys().next().value;
    if (firstKey !== undefined) processCache.delete(firstKey);
  }
  processCache.set(sessionId, { messages, expiresAt });
}

function cacheGet(sessionId: string): AgentChatMessage[] | null {
  const entry = processCache.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    processCache.delete(sessionId);
    return null;
  }
  return entry.messages;
}

export async function resumeSession(
  sdkSessionId: string,
  agentId: string,
  userId: string,
): Promise<ResumeResult | null> {
  const cached = cacheGet(sdkSessionId);
  if (cached) {
    return { messages: cached.map(fromAgentMessage), sdkSessionId, resumed: true };
  }

  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(agentChatSessions)
      .where(
        and(
          eq(agentChatSessions.sdkSessionId, sdkSessionId),
          eq(agentChatSessions.agentId, agentId),
          eq(agentChatSessions.userId, userId),
          gt(agentChatSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      console.warn(`[SessionStore] session not found or expired: sdkSessionId=${sdkSessionId}`);
      return null;
    }

    const row = rows[0];
    const messages = (row.messages ?? []) as AgentChatMessage[];
    cacheSet(sdkSessionId, messages, row.expiresAt.getTime());
    return { messages: messages.map(fromAgentMessage), sdkSessionId, resumed: true };
  } catch (err) {
    console.error("[SessionStore] resumeSession DB error:", err);
    return null;
  }
}

export async function initSession(
  agentId: string,
  userId: string,
  messages: OAIMessage[],
): Promise<string> {
  const sdkSessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const stored = messages.map(toAgentMessage);

  try {
    const db = await getDb();
    await db.insert(agentChatSessions).values({
      sdkSessionId,
      agentId,
      userId,
      messages: stored,
      expiresAt,
    });
    cacheSet(sdkSessionId, stored, expiresAt.getTime());
    console.log(`[SessionStore] session initialised: sdkSessionId=${sdkSessionId} agentId=${agentId} messages=${stored.length}`);
  } catch (err) {
    console.error("[SessionStore] initSession DB error:", err);
  }

  return sdkSessionId;
}

export async function appendToSession(
  sdkSessionId: string,
  agentId: string,
  userId: string,
  newMessages: OAIMessage[],
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    const db = await getDb();
    const existing = await resumeSession(sdkSessionId, agentId, userId);
    const merged = [...(existing?.messages ?? []), ...newMessages].map(toAgentMessage);

    await db
      .update(agentChatSessions)
      .set({ messages: merged, updatedAt: new Date(), expiresAt })
      .where(
        and(
          eq(agentChatSessions.sdkSessionId, sdkSessionId),
          eq(agentChatSessions.agentId, agentId),
          eq(agentChatSessions.userId, userId),
        ),
      );

    cacheSet(sdkSessionId, merged, expiresAt.getTime());
  } catch (err) {
    console.error("[SessionStore] appendToSession DB error:", err);
  }
}

export async function persistChatMessages(
  agentId: string,
  userId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  if (messages.length === 0) return;
  const db = await getDb();
  for (const m of messages) {
    try {
      await db.insert(agentChatMessages).values({
        agentId,
        userId,
        role: m.role,
        content: m.content,
      });
    } catch (err) {
      console.error("[SessionStore] persistChatMessages DB error:", err);
    }
  }
}

export async function getChatHistory(
  agentId: string,
  userId: string,
  limit = 0,
): Promise<Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;

  try {
    const db = await getDb();
    const where = and(
      eq(agentChatMessages.agentId, agentId),
      eq(agentChatMessages.userId, userId),
    );

    const rows = safeLimit > 0
      ? (await db
          .select()
          .from(agentChatMessages)
          .where(where)
          .orderBy(desc(agentChatMessages.createdAt))
          .limit(safeLimit)).reverse()
      : await db
          .select()
          .from(agentChatMessages)
          .where(where)
          .orderBy(asc(agentChatMessages.createdAt));

    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[SessionStore] getChatHistory DB error:", err);
    return [];
  }
}

export async function expireSession(sdkSessionId: string): Promise<void> {
  processCache.delete(sdkSessionId);
  try {
    const db = await getDb();
    await db
      .delete(agentChatSessions)
      .where(eq(agentChatSessions.sdkSessionId, sdkSessionId));
  } catch {
    // best-effort
  }
}
