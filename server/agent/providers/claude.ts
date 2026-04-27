/**
 * ClaudeProvider — implements BaseProvider using the Anthropic Messages API,
 * plus native session-resumption helpers for named agent chats.
 *
 * === Provider layer (BaseProvider) ===
 * Message format bridge:
 *   The harness works entirely in OpenAI ChatCompletionMessageParam format.
 *   This provider converts to Anthropic's format before each call and converts
 *   tool-use responses back to the canonical chunk format so the harness is
 *   unaware of the underlying SDK.
 *
 * Conversion rules (OpenAI → Anthropic):
 *   system   → extracted into `system` param (all system messages concatenated)
 *   user     → { role: "user", content: string }
 *   assistant (text) → { role: "assistant", content: string }
 *   assistant (tool_calls) → { role: "assistant", content: ContentBlockParam[] }
 *   tool (tool_call_id, content) → grouped into a single user message as
 *                                  ToolResultBlockParam[] (Anthropic requires
 *                                  tool results to be in user turns)
 *
 * Tool definition conversion (OpenAI → Anthropic):
 *   { type: "function", function: { name, description, parameters } }
 *   → { name, description, input_schema: parameters }
 *
 * toolChoice "none" handling:
 *   Anthropic has no direct "none" equivalent. When toolChoice is "none",
 *   we omit the tools array entirely so the model cannot call any tool.
 *
 * === Session layer ===
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

import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { randomUUID } from "crypto";
import { db } from "../../db";
import { eq, and, gt, asc, desc } from "drizzle-orm";
import { agentChatSessions, agentChatMessages } from "@shared/schema";
import type { AgentChatMessage } from "@shared/schema";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";

// ── Session types & helpers ────────────────────────────────────────────────────

const SESSION_TTL_HOURS = parseInt(process.env.AGENT_SESSION_TTL_HOURS ?? "24", 10);
const SESSION_TTL_MS = (isNaN(SESSION_TTL_HOURS) || SESSION_TTL_HOURS <= 0 ? 24 : SESSION_TTL_HOURS) * 60 * 60 * 1000;

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
  return base as unknown as OAIMessage;
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

// ── Session public API ─────────────────────────────────────────────────────────

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
 * Returns null when the session has expired or is not found — the caller
 * falls back to full history injection and should call `initSession`
 * afterwards to start a fresh session.
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

// ── Permanent chat message log ─────────────────────────────────────────────────

/**
 * Persist a user or assistant message to the permanent `agent_chat_messages`
 * table. Called after every chat turn so history survives session expiry.
 * Best-effort — errors are logged but never thrown to the caller.
 */
export async function persistChatMessages(
  agentId: string,
  userId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  if (messages.length === 0) return;
  // Insert messages sequentially (not in a single batch) so each row receives a
  // distinct NOW() timestamp, ensuring stable chronological ordering even when
  // user + assistant messages are stored in the same call.
  for (const m of messages) {
    try {
      await db.insert(agentChatMessages).values({
        agentId,
        userId,
        role: m.role,
        content: m.content,
      });
    } catch (err) {
      console.error("[ClaudeProvider] persistChatMessages DB error:", err);
    }
  }
}

/**
 * Fetch permanent chat history for an agent + user pair.
 *
 * Returns messages in ascending chronological order (oldest first) for display.
 * When a limit is specified the *most recent* `limit` messages are returned so
 * the user always sees the latest context rather than the oldest rows.
 * Pass limit=0 (or omit) to return all messages — appropriate for the initial
 * chat open where we want to show the full history.
 */
export async function getChatHistory(
  agentId: string,
  userId: string,
  limit = 0,
): Promise<Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>> {
  // Validate limit: must be a positive finite integer (0 = no limit / fetch all).
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;

  try {
    const where = and(
      eq(agentChatMessages.agentId, agentId),
      eq(agentChatMessages.userId, userId),
    );

    let rows;
    if (safeLimit > 0) {
      // DB-level limit: fetch the most recent N rows (DESC + LIMIT), then
      // reverse so the caller receives them in chronological (oldest-first) order.
      const newest = await db
        .select()
        .from(agentChatMessages)
        .where(where)
        .orderBy(desc(agentChatMessages.createdAt))
        .limit(safeLimit);
      rows = newest.reverse();
    } else {
      // No limit — return full history in chronological order.
      rows = await db
        .select()
        .from(agentChatMessages)
        .where(where)
        .orderBy(asc(agentChatMessages.createdAt));
    }

    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[ClaudeProvider] getChatHistory DB error:", err);
    return [];
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

// ── ClaudeProvider class ───────────────────────────────────────────────────────

export class ClaudeProvider extends BaseProvider {
  private client: Anthropic;

  constructor() {
    super();
    this.client = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }

  async initialize(): Promise<void> {
    // Client is created in the constructor; nothing async to do.
  }

  async cleanup(): Promise<void> {
    // No persistent resources to release.
  }

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    if (params.stream) {
      yield* this._streamTurn(params);
    } else {
      yield* this._completeTurn(params);
    }
  }

  // ── Format conversions ────────────────────────────────────────────────────

  /**
   * Extract the system prompt from the OpenAI messages array.
   * All system messages are concatenated with a newline separator.
   */
  private _extractSystem(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): string {
    return messages
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n\n");
  }

  /**
   * Convert OpenAI messages to Anthropic MessageParam[].
   *
   * Handles three tricky cases:
   *   1. system messages — skipped here (extracted separately via _extractSystem)
   *   2. assistant messages with tool_calls — converted to tool_use content blocks
   *   3. tool result messages — grouped into a single user turn per Anthropic's
   *      requirement that all tool_result blocks for a given assistant turn are
   *      in one user message.
   */
  private _convertMessages(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];

      // System messages are handled separately — skip.
      if (msg.role === "system") {
        i++;
        continue;
      }

      // Tool result messages: collect all consecutive ones into one user turn.
      if (msg.role === "tool") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        while (i < messages.length && messages[i].role === "tool") {
          const tm = messages[i] as OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
          toolResults.push({
            type: "tool_result",
            tool_use_id: tm.tool_call_id,
            content:
              typeof tm.content === "string"
                ? tm.content
                : JSON.stringify(tm.content),
          });
          i++;
        }
        result.push({ role: "user", content: toolResults });
        continue;
      }

      // Assistant message with tool calls.
      if (msg.role === "assistant") {
        const am = msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
        const functionToolCalls = (am.tool_calls ?? []).filter(
          (
            tc,
          ): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
            type: "function";
          } => tc.type === "function",
        );

        if (functionToolCalls.length > 0) {
          const content: Anthropic.ContentBlockParam[] = [];
          if (am.content) {
            content.push({
              type: "text",
              text: typeof am.content === "string" ? am.content : "",
            });
          }
          for (const tc of functionToolCalls) {
            let parsedInput: Record<string, unknown> = {};
            try {
              const raw = JSON.parse(tc.function.arguments || "{}");
              if (raw && typeof raw === "object")
                parsedInput = raw as Record<string, unknown>;
            } catch {
              /* leave as empty object */
            }
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: parsedInput,
            });
          }
          result.push({ role: "assistant", content });
          i++;
          continue;
        }

        // Plain text assistant message.
        result.push({
          role: "assistant",
          content: typeof am.content === "string" ? am.content : "",
        });
        i++;
        continue;
      }

      // User message.
      if (msg.role === "user") {
        const um =
          msg as OpenAI.Chat.Completions.ChatCompletionUserMessageParam;
        result.push({
          role: "user",
          content:
            typeof um.content === "string"
              ? um.content
              : JSON.stringify(um.content),
        });
        i++;
        continue;
      }

      i++;
    }

    return result;
  }

  /**
   * Convert OpenAI tool definitions to Anthropic tool format.
   * Only "function" type tools are supported; custom tools are skipped.
   */
  private _convertTools(
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): Anthropic.Tool[] {
    const result: Anthropic.Tool[] = [];
    for (const t of tools) {
      if (t.type !== "function") continue;
      result.push({
        name: t.function.name,
        description: t.function.description ?? "",
        input_schema: t.function.parameters as Anthropic.Tool["input_schema"],
      });
    }
    return result;
  }

  /**
   * Build Anthropic request params for tools and tool_choice.
   *
   * toolChoice "none" is handled by omitting tools entirely — Anthropic has
   * no equivalent "none" mode, but without any tools in the payload the model
   * cannot call any tool. This matches the OpenAI "none" semantic.
   */
  private _resolveToolParams(
    tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
    toolChoice: "auto" | "required" | "none",
  ): {
    tools: Anthropic.Tool[] | undefined;
    toolChoice: Anthropic.MessageCreateParams["tool_choice"] | undefined;
  } {
    if (!tools || tools.length === 0 || toolChoice === "none") {
      // "none" → omit tools entirely so the model cannot call any function.
      return { tools: undefined, toolChoice: undefined };
    }
    const converted = this._convertTools(tools);
    const choice: Anthropic.MessageCreateParams["tool_choice"] =
      toolChoice === "required" ? { type: "any" } : { type: "auto" };
    return { tools: converted, toolChoice: choice };
  }

  // ── Non-streaming path ────────────────────────────────────────────────────

  private async *_completeTurn(
    params: ProviderQueryParams,
  ): AsyncGenerator<ProviderChunk> {
    const system = this._extractSystem(params.messages);
    const messages = this._convertMessages(params.messages);
    const { tools, toolChoice } = this._resolveToolParams(
      params.tools,
      params.toolChoice,
    );

    const response = await this.client.messages.create(
      {
        model: params.model,
        system: system || undefined,
        messages,
        tools,
        tool_choice: toolChoice,
        max_tokens: params.maxCompletionTokens,
      },
      { signal: params.signal ?? undefined },
    );

    for (const block of response.content) {
      if (block.type === "text") {
        yield { type: "text", delta: block.text };
      } else if (block.type === "tool_use") {
        const idx = response.content.indexOf(block);
        yield { type: "tool_call_start", index: idx, id: block.id, name: block.name };
        yield {
          type: "tool_call_args",
          index: idx,
          args: JSON.stringify(block.input),
        };
      }
    }

    const finishReason =
      response.stop_reason === "tool_use"
        ? "tool_calls"
        : response.stop_reason ?? null;
    yield { type: "finish", reason: finishReason };
  }

  // ── Streaming path ────────────────────────────────────────────────────────

  private async *_streamTurn(
    params: ProviderQueryParams,
  ): AsyncGenerator<ProviderChunk> {
    const system = this._extractSystem(params.messages);
    const messages = this._convertMessages(params.messages);
    const { tools, toolChoice } = this._resolveToolParams(
      params.tools,
      params.toolChoice,
    );

    // Anthropic's streaming API returns an AsyncIterable of events.
    // We pass signal via the request options second argument.
    const stream = await this.client.messages.create(
      {
        model: params.model,
        system: system || undefined,
        messages,
        tools,
        tool_choice: toolChoice,
        max_tokens: params.maxCompletionTokens,
        stream: true,
      },
      { signal: params.signal ?? undefined },
    );

    // Per-block tracking: tool_use blocks need a stable index.
    const blockIndexById = new Map<string, number>();
    let nextBlockIndex = 0;
    let currentBlockId: string | null = null;
    let finishReason: string | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          const idx = nextBlockIndex++;
          blockIndexById.set(block.id, idx);
          currentBlockId = block.id;
          yield {
            type: "tool_call_start",
            index: idx,
            id: block.id,
            name: block.name,
          };
        } else if (block.type === "text") {
          currentBlockId = null;
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text", delta: delta.text };
        } else if (delta.type === "input_json_delta") {
          const id = currentBlockId;
          if (id !== null) {
            const idx = blockIndexById.get(id);
            if (idx !== undefined) {
              yield { type: "tool_call_args", index: idx, args: delta.partial_json };
            }
          }
        }
      } else if (event.type === "message_delta") {
        if (event.delta.stop_reason) {
          finishReason =
            event.delta.stop_reason === "tool_use"
              ? "tool_calls"
              : event.delta.stop_reason;
        }
      }
    }

    yield { type: "finish", reason: finishReason };
  }
}
