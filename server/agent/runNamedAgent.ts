/**
 * runNamedAgent — executes a named sub-agent for a user message.
 *
 * Flow:
 * 1. Load the agent record + validate active
 * 2. Build permission-filtered tool list via wrapToolsForAgent
 * 3. Retrieve relevant agent memories + optional global soul
 * 4. Build system prompt from persona + context
 * 5. Call runAgent() from harness
 * 6. Extract new memories and write them to the agent's namespace
 * 7. Return result
 *
 * Loop detection: if the same agent is invoked recursively > 3 levels deep,
 * throw AgentLoopError.
 */
import { runAgent } from "./harness";
import type { AgentRunResult } from "./harness";
import type { ToolContext } from "./types";
import { getAgentForChannel, getAgent } from "./agentManager";
import { wrapToolsForAgent } from "./agentPermissions";
import { readAgentMemories, writeAgentMemory } from "./agentMemory";
import { logAgentEvent } from "./agentLogger";
import { requiresApproval, requestApproval, awaitApproval } from "./agentApproval";
import type { DiscordAgent } from "@shared/schema";
import type OpenAI from "openai";

// ── Errors ─────────────────────────────────────────────────────────────────────

export class AgentLoopError extends Error {
  constructor(agentId: string, depth: number) {
    super(`Agent ${agentId} invoked recursively at depth ${depth} — loop detected`);
    this.name = "AgentLoopError";
  }
}

// ── Loop depth tracking (in-process, per userId+agentId chain) ─────────────────

const invocationDepths = new Map<string, number>();
const MAX_DEPTH = 3;

function depthKey(userId: string, agentId: string): string {
  return `${userId}:${agentId}`;
}

function incrementDepth(userId: string, agentId: string): number {
  const key = depthKey(userId, agentId);
  const current = invocationDepths.get(key) ?? 0;
  const next = current + 1;
  invocationDepths.set(key, next);
  return next;
}

function decrementDepth(userId: string, agentId: string): void {
  const key = depthKey(userId, agentId);
  const current = invocationDepths.get(key) ?? 1;
  const next = Math.max(0, current - 1);
  if (next === 0) invocationDepths.delete(key);
  else invocationDepths.set(key, next);
}

// Token count estimation (~4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── runNamedAgent ──────────────────────────────────────────────────────────────

export interface RunNamedAgentOptions {
  agentId: string;
  userId: string;
  userMessage: string;
  platform: string;
  channelId?: string;
  conversationHistory?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  onToken?: (chunk: string) => void;
  /** Who initiated this agent run — used to auto-approve Jarvis-to-Jarvis tool gates */
  initiatedBy?: 'user' | 'jarvis';
  /** Optional AbortSignal — when fired the agent loop exits cleanly with an AbortError */
  signal?: AbortSignal;
  /**
   * Optional callback fired when a tool fails due to an integration auth issue.
   * Threaded through to runAgent so the SSE route can emit a structured
   * integration_error event without polling or checking results after the fact.
   */
  onIntegrationError?: (integrationKey: string, message: string) => void;
  /**
   * Optional callback fired when a non-integration tool failure occurs.
   * Threaded through to runAgent so the SSE route can emit a `tool_error`
   * event and the mobile UI can show a distinct error state on the chat bubble.
   */
  onToolError?: (toolName: string, message: string) => void;
  /**
   * Per-request model override. Resolution order (first wins):
   *   1. opts.model (caller override)
   *   2. agent.preferredModel (per-agent DB setting)
   *   3. getModel(userId, "chat") (global user preference / system default)
   */
  model?: string;
  /**
   * SDK session ID for native session resumption.
   *
   * When provided the agent looks up the cached conversation state from the
   * DB/in-process cache and resumes from there instead of re-injecting the
   * full message history. On the first message this field is absent; the
   * harness initialises a new session and the caller receives the new
   * `sdkSessionId` via `NamedAgentResult.sdkSessionId`.
   *
   * If the session has expired or cannot be found the harness falls back
   * gracefully to full history injection and starts a fresh session.
   */
  sdkSessionId?: string;
}

export interface NamedAgentResult {
  reply: string;
  turns: number;
  toolCalls: AgentRunResult["toolCalls"];
  agentName: string;
  agentId: string;
  /**
   * SDK session ID for the next turn.
   *
   * Always returned — either the newly created session (first turn) or the
   * existing session ID passed in by the caller (continuation turns). The
   * client should store this and send it back on the next message so the
   * agent can resume without re-injecting the full history.
   */
  sdkSessionId?: string;
}

export async function runNamedAgent(opts: RunNamedAgentOptions): Promise<NamedAgentResult> {
  const { agentId, userId, userMessage, platform, initiatedBy = 'user', signal } = opts;

  // ── Load agent ────────────────────────────────────────────────────────────
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (!agent.isActive) throw new Error(`Agent ${agentId} is disabled`);

  // ── Loop detection ────────────────────────────────────────────────────────
  const depth = incrementDepth(userId, agentId);
  if (depth > MAX_DEPTH) {
    decrementDepth(userId, agentId);
    throw new AgentLoopError(agentId, depth);
  }

  const start = Date.now();
  logAgentEvent({ event: "agent_invoked", agentId, userId, detail: `platform=${platform} depth=${depth}` });

  try {
    // ── Load tools with permission wrapping ──────────────────────────────────
    const { ALL_TOOLS } = await import("./tools/index");
    const permittedTools = wrapToolsForAgent(ALL_TOOLS, agent);

    // ── Build context ────────────────────────────────────────────────────────
    const ctx: ToolContext = {
      userId,
      channel: `${platform}/${agent.name}`,
      state: { pendingAttachments: [] },
      ...(platform === "discord" && opts.channelId ? { discordChannelId: opts.channelId } : {}),
    };

    // ── Native session resumption ─────────────────────────────────────────────
    // When the caller provides a sdkSessionId, attempt to resume the cached
    // conversation rather than rebuilding the full message history. This skips
    // the expensive history-injection path for all turns after the first.
    //
    // The resumeSession() call is the equivalent of passing `resume: sessionId`
    // to the Claude Agent SDK — it fetches the accumulated message list from the
    // server-side session store (in-process cache → DB) and returns it directly.
    //
    // On failure (expired or missing session) the code falls back to the
    // standard history-injection path and starts a fresh session.

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    let activeSessionId: string | undefined = opts.sdkSessionId;
    let sessionResumed = false;

    if (opts.sdkSessionId) {
      try {
        const { resumeSession } = await import("./providers/claude");
        const resumed = await resumeSession(opts.sdkSessionId, agentId, userId);
        if (resumed) {
          // Session found — append the new user message and skip full rebuild.
          messages = [...resumed.messages, { role: "user", content: userMessage }];
          sessionResumed = true;
          console.log(
            `[RunNamedAgent] session resumed: sdkSessionId=${opts.sdkSessionId} messages=${resumed.messages.length}`,
          );
        } else {
          // Session expired/missing — fall back and reset so we start fresh below.
          console.warn(
            `[RunNamedAgent] session not found, falling back to history injection: sdkSessionId=${opts.sdkSessionId}`,
          );
          activeSessionId = undefined;
          messages = [];
        }
      } catch (err) {
        console.warn("[RunNamedAgent] session resume error, falling back:", err);
        activeSessionId = undefined;
        messages = [];
      }
    } else {
      messages = [];
    }

    // ── Full history injection (first turn or fallback) ──────────────────────
    if (!sessionResumed) {
      // ── Retrieve agent memories ────────────────────────────────────────────
      let memoryBlock = "";
      try {
        const memories = await readAgentMemories(agentId, userId, userMessage, 8);
        if (memories.length > 0) {
          memoryBlock = `\n\n## My Memory (${agent.name})\n` +
            memories.map((m) => `- [${m.category}] ${m.content}`).join("\n");
        }
      } catch { /* non-blocking */ }

      // ── Optionally include global soul ───────────────────────────────────────
      let soulBlock = "";
      if (agent.accessGlobalMemory) {
        try {
          const { getSoulPromptBlock } = await import("../memory/soul");
          const soul = await getSoulPromptBlock(userId);
          if (soul) soulBlock = `\n\n## User Context (Global)\n${soul.trim()}`;
        } catch { /* non-blocking */ }
      }

      // ── Compose system prompt ──────────────────────────────────────────────
      const persona = agent.persona ?? `You are ${agent.name}, a ${agent.role} assistant.`;
      const systemPrompt = `${persona}${soulBlock}${memoryBlock}`;

      // ── Build messages from history ────────────────────────────────────────
      const history = opts.conversationHistory ?? [];
      let totalHistoryTokens = history.reduce((acc, m) => acc + estimateTokens(String((m as { content?: string }).content ?? "")), 0);

      // Trim history if it exceeds ~6000 tokens
      let trimmedHistory = history;
      if (totalHistoryTokens > 6000) {
        trimmedHistory = [];
        let accumTokens = 0;
        for (const msg of [...history].reverse()) {
          const t = estimateTokens(String((msg as { content?: string }).content ?? ""));
          if (accumTokens + t > 5000) break;
          trimmedHistory.unshift(msg);
          accumTokens += t;
        }
      }

      messages = [
        { role: "system", content: systemPrompt },
        ...trimmedHistory,
        { role: "user", content: userMessage },
      ];
    } else {
      // Session resumed — memories and soul are already in the cached system prompt.
      // We only need the new user message (already appended above).
    }

    // ── Resolve model (caller override → agent preferredModel → global pref) ──
    const { getModel, AVAILABLE_MODELS, ORCHESTRATOR_MODELS } = await import("../lib/modelPrefs");
    const model =
      opts.model ??
      agent.preferredModel ??
      (await getModel(userId, "chat"));

    // Non-blocking validation: warn if resolved model is not in the known-valid
    // set so misconfigurations surface in logs without breaking agent execution.
    const KNOWN_MODELS = new Set([
      ...AVAILABLE_MODELS.map((m) => m.value),
      ...ORCHESTRATOR_MODELS.map((m) => m.value),
    ]);
    if (!KNOWN_MODELS.has(model)) {
      console.warn(`[runNamedAgent] agent=${agentId} resolved unknown model "${model}" — continuing`);
    }

    // ── Approval gate hook ───────────────────────────────────────────────────
    // Before executing any high-risk tool, create a DB-persistent approval
    // gate, notify the user in-app, and suspend until they approve/reject.
    const onBeforeTool = async (
      toolName: string,
      toolArgs: Record<string, unknown>,
    ): Promise<{ allowed: boolean; reason?: string }> => {
      if (!requiresApproval(toolName)) return { allowed: true };

      try {
        // Create a persistent DB gate
        const gate = await requestApproval({
          agentId,
          userId,
          toolName,
          toolArgs,
          description: `Agent "${agent.name}" wants to run tool: ${toolName}`,
          ttlMs: 10 * 60 * 1000, // 10 minutes
          initiatedBy,
        });

        // Short-circuit: if gate was auto-approved (Jarvis-initiated, non-irreversible)
        // the status is already 'approved' in the returned gate — skip notification and wait.
        if (gate.status === "approved") {
          logAgentEvent({ event: "tool_approved", agentId, userId, toolName, detail: `gate=${gate.id} auto-approved` });
          return { allowed: true };
        }

        // Notify user in-app so they can approve/reject
        try {
          const { inAppChannel } = await import("../channels/inAppChannel");
          await inAppChannel.sendMessage(
            userId,
            `🔐 **Approval Required**\nAgent **${agent.name}** wants to run **${toolName}**.\nApprove or reject in the Agents → Approvals tab.\n\nGate ID: \`${gate.id}\``,
            { notificationType: "approval_request" },
          );
        } catch { /* non-blocking */ }

        logAgentEvent({ event: "tool_blocked", agentId, userId, toolName, detail: `gate=${gate.id}` });

        // Suspend until user approves/rejects (up to 10 min), or the run is cancelled
        const approved = await awaitApproval(gate.id, undefined, signal);

        if (approved) {
          logAgentEvent({ event: "tool_approved", agentId, userId, toolName, detail: `gate=${gate.id}` });
          return { allowed: true };
        } else {
          return { allowed: false, reason: `User rejected tool execution (gate ${gate.id})` };
        }
      } catch (err) {
        // If approval machinery fails, block the tool rather than allow silent execution
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[RunNamedAgent] approval gate error for ${toolName}:`, err);
        return { allowed: false, reason: `Approval gate error: ${msg}` };
      }
    };

    const result = await runAgent({
      model,
      messages,
      tools: permittedTools,
      context: ctx,
      maxTurns: 6,
      maxCompletionTokens: 2000,
      onToken: opts.onToken,
      onBeforeTool,
      signal,
      onIntegrationError: opts.onIntegrationError,
      onToolError: opts.onToolError,
    });

    // ── Session management — update or initialise after successful run ─────────
    // Mirror the Claude Agent SDK session pattern:
    //   • First turn (no sdkSessionId or fallback): init a new session from the
    //     full message list returned by the harness. This is the "system init"
    //     event — the session is recorded once the model has replied successfully.
    //   • Continuation turns (sessionResumed): append the new exchange (user
    //     message + assistant reply) to the existing session so the next turn
    //     can resume without re-injecting history.
    let finalSessionId: string | undefined = activeSessionId;
    try {
      const { initSession, appendToSession } = await import("./providers/claude");
      if (sessionResumed && activeSessionId) {
        // Append only the new exchange: the messages the harness added after the
        // resumption point (user message + assistant reply + any tool messages).
        const resumedBase = messages.slice(0, messages.length - 1); // exclude the user msg we just added
        const newMessages = result.messages.slice(resumedBase.length);
        if (newMessages.length > 0) {
          appendToSession(activeSessionId, agentId, userId, newMessages).catch(() => {});
        }
      } else {
        // First turn or fallback — init a fresh session from the complete message list.
        finalSessionId = await initSession(agentId, userId, result.messages);
      }
    } catch (err) {
      console.error("[RunNamedAgent] session update failed (non-blocking):", err);
    }

    // ── Write extracted memories ──────────────────────────────────────────────
    extractAndWriteMemories(agentId, userId, userMessage, result.reply).catch(() => {});

    logAgentEvent({
      event: "task_completed",
      agentId,
      userId,
      durationMs: Date.now() - start,
      detail: `turns=${result.turns} tools=${result.toolCalls.length} session=${finalSessionId ? "active" : "none"}`,
    });

    return {
      reply: result.reply,
      turns: result.turns,
      toolCalls: result.toolCalls,
      agentName: agent.name,
      agentId,
      sdkSessionId: finalSessionId,
    };
  } catch (err) {
    logAgentEvent({
      event: "task_failed",
      agentId,
      userId,
      durationMs: Date.now() - start,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    throw err;
  } finally {
    decrementDepth(userId, agentId);
  }
}

// ── extractAndWriteMemories ────────────────────────────────────────────────────

/**
 * Post-conversation: extract durable facts from the exchange and write them
 * to the agent's memory namespace. Best-effort, non-blocking.
 */
async function extractAndWriteMemories(
  agentId: string,
  userId: string,
  userMessage: string,
  agentReply: string,
): Promise<void> {
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract 0-3 durable facts or preferences from this conversation that would be useful to remember in future interactions.
Return ONLY a JSON array of {"content": "...", "category": "fact|preference|goal|relationship"} objects.
Return [] if nothing worth storing. Keep each content under 150 chars. No preamble.`,
        },
        {
          role: "user",
          content: `User: ${userMessage.slice(0, 500)}\nAgent: ${agentReply.slice(0, 500)}`,
        },
      ],
      max_completion_tokens: 300,
    });

    const text = resp.choices[0]?.message?.content?.trim() ?? "[]";
    let extracted: Array<{ content: string; category: string }> = [];
    try {
      extracted = JSON.parse(text);
    } catch { return; }

    for (const item of extracted.slice(0, 3)) {
      if (item.content && item.content.length > 5) {
        await writeAgentMemory(agentId, userId, item.content, item.category || "fact");
      }
    }
  } catch { /* best-effort */ }
}

// ── routeToNamedAgent ──────────────────────────────────────────────────────────

/**
 * Convenience: look up the agent for a given channel, run it, and return the result.
 * Returns null if no agent is assigned to that channel (caller should fall back to main agent).
 */
export async function routeToNamedAgent(
  userId: string,
  platform: string,
  channelId: string,
  userMessage: string,
  conversationHistory?: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  onToken?: (chunk: string) => void,
): Promise<NamedAgentResult | null> {
  const agent = await getAgentForChannel(userId, platform, channelId);
  if (!agent) return null;

  return runNamedAgent({
    agentId: agent.id,
    userId,
    userMessage,
    platform,
    channelId,
    conversationHistory,
    onToken,
  });
}
