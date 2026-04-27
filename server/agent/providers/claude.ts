/**
 * Claude session provider — native session resumption for named agent chats.
 *
 * Instead of re-injecting the full conversation history into the prompt on
 * every turn, this module maintains a server-side session cache keyed by a
 * `sdkSessionId`. The session stores the accumulated OpenAI-format message
 * list so subsequent turns can skip history reconstruction entirely.
 *
 * Pattern (mirrors the Claude Agent SDK session resumption concept):
 *   1. First turn  — build full context (system + any seed history),
 *                    write to `agent_chat_sessions`, return sdkSessionId.
 *   2. Next turns  — read cached messages from `agent_chat_sessions`,
 *                    append new user message; skip DB history re-fetch.
 *   3. Fallback    — if session not found or expired, log a warning and
 *                    resume with full history injection (unchanged behaviour).
 *
 * The in-process cache avoids repeated DB reads within the same server
 * instance. The DB row persists state across server restarts so sessions
 * survive process bounces within their TTL.
 */

import { randomUUID } from "crypto";
import { db } from "../../db";
import { eq, and, gt } from "drizzle-orm";
import { agentChatSessions } from "@shared/schema";
import type { AgentChatMessage } from "@shared/schema";
import type OpenAI from "openai";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toAgentMessage(m: OAIMessage): AgentChatMessage {
  return {
    role: m.role as AgentChatMessage["role"],
    content: typeof m.content === "string" ? m.content : null,
    tool_calls: (m as any).tool_calls,
    tool_call_id: (m as any).tool_call_id,
  };
}

function fromAgentMessage(m: AgentChatMessage): OAIMessage {
  const base: Record<string, unknown> = { role: m.role, content: m.content ?? null };
  if (m.tool_calls) base.tool_calls = m.tool_calls;
  if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
  return base as OAIMessage;
}

// ── In-process LRU-lite cache (avoids round-trips for active sessions) ─────────
// Simple map bounded to 500 entries; oldest entries evicted on overflow.

const MAX_CACHE_ENTRIES = 500;
const processCache = new Map<string, { messages: AgentChatMessage[]; expiresAt: number }>();

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

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ResumeResult {
  messages: OAIMessage[];
  sdkSessionId: string;
  resumed: boolean;
}

/**
 * Attempt to resume an existing session by ID.
 *
 * Returns `{ messages, sdkSessionId, resumed: true }` when the session is
 * found and still valid. The caller should pass `messages` directly to the
 * harness (they already include the full accumulated context).
 *
 * Returns `{ messages: [], sdkSessionId: existing, resumed: false }` when the
 * session has expired or is not found — the caller falls back to full history
 * injection and should call `initSession` afterwards to start a fresh session.
 */
export async function resumeSession(
  sdkSessionId: string,
  agentId: string,
  userId: string,
): Promise<ResumeResult | null> {
  // 1. Check in-process cache first (avoids DB round-trip for active sessions).
  const cached = cacheGet(sdkSessionId);
  if (cached) {
    return {
      messages: cached.map(fromAgentMessage),
      sdkSessionId,
      resumed: true,
    };
  }

  // 2. Fall through to DB.
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(agentChatSessions)
      .where(
        and(
          eq(agentChatSessions.sdkSessionId, sdkSessionId),
          eq(agentChatSessions.agentId, agentId),
          eq(agentChatSessions.userId, userId),
          gt(agentChatSessions.expiresAt, now),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      console.warn(
        `[ClaudeProvider] session not found or expired: sdkSessionId=${sdkSessionId}`,
      );
      return null;
    }

    const row = rows[0];
    const messages = (row.messages ?? []) as AgentChatMessage[];

    // Warm the process cache so subsequent turns skip the DB.
    cacheSet(sdkSessionId, messages, row.expiresAt.getTime());

    return {
      messages: messages.map(fromAgentMessage),
      sdkSessionId,
      resumed: true,
    };
  } catch (err) {
    console.error("[ClaudeProvider] resumeSession DB error:", err);
    return null;
  }
}

/**
 * Initialise a new session from the first-turn messages (full context already
 * built by the caller: system prompt + seed history + user message).
 *
 * Returns the new `sdkSessionId` (UUID) to be forwarded to the client so it
 * can resume on the next turn.
 *
 * This mirrors the "capture session_id from the system init event" pattern:
 * the first successful model response is the init event; we record the
 * session at that point so it always reflects at least one exchange.
 */
export async function initSession(
  agentId: string,
  userId: string,
  messages: OAIMessage[],
): Promise<string> {
  const sdkSessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const stored = messages.map(toAgentMessage);

  try {
    await db.insert(agentChatSessions).values({
      sdkSessionId,
      agentId,
      userId,
      messages: stored,
      expiresAt,
    });
    cacheSet(sdkSessionId, stored, expiresAt.getTime());
    console.log(
      `[ClaudeProvider] session initialised: sdkSessionId=${sdkSessionId} agentId=${agentId} messages=${stored.length}`,
    );
  } catch (err) {
    console.error("[ClaudeProvider] initSession DB error:", err);
  }

  return sdkSessionId;
}

/**
 * Append the latest exchange (new user message + assistant reply + any tool
 * messages) to an existing session's message list.
 *
 * Call this after the harness returns a successful result so the session
 * always reflects the most up-to-date conversation state.
 */
export async function appendToSession(
  sdkSessionId: string,
  agentId: string,
  userId: string,
  newMessages: OAIMessage[],
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    const existing = await resumeSession(sdkSessionId, agentId, userId);
    const base = existing?.messages ?? [];
    const merged = [...base, ...newMessages].map(toAgentMessage);

    await db
      .update(agentChatSessions)
      .set({
        messages: merged,
        updatedAt: new Date(),
        expiresAt,
      })
      .where(
        and(
          eq(agentChatSessions.sdkSessionId, sdkSessionId),
          eq(agentChatSessions.agentId, agentId),
          eq(agentChatSessions.userId, userId),
        ),
      );

    cacheSet(sdkSessionId, merged, expiresAt.getTime());
  } catch (err) {
    console.error("[ClaudeProvider] appendToSession DB error:", err);
  }
}

/**
 * Explicitly expire a session (e.g. when a fallback is triggered so the next
 * turn starts a clean session rather than re-attempting the broken one).
 */
export async function expireSession(sdkSessionId: string): Promise<void> {
  processCache.delete(sdkSessionId);
  try {
    await db
      .delete(agentChatSessions)
      .where(eq(agentChatSessions.sdkSessionId, sdkSessionId));
  } catch {
    // best-effort
  }
}
