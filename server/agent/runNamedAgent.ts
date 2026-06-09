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
import { toolCallHooks } from "./toolCallHooks";
// Side-effect import: ensures the built-in approval hook is registered before
// any agent run. agentApproval registers itself into toolCallHooks at module load.
import "./agentApproval";
import { checkResponseQuality, APOLOGY_PHRASES } from "./responseQuality";
import { contextRegistry } from "./contextRegistry";
import { db } from "../db";
import { userPreferences, capabilityGaps } from "@shared/schema";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
// Side-effect import: registers workspace topic context provider.
import "./providers/topicContext";
import { createRoutedOpenAIChatShim } from "./routedChatCompletion";
import type { DiscordAgent } from "@shared/schema";
import type { ChannelAttachment } from "../channels/types";
import type OpenAI from "openai";
import type { ApprovalReceipt } from "./approvalReceipt";

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

// ── Crew specialist reinforcement loader ────────────────────────────────────
// Loads operational protocol markdown from agents/crew/<crewRole>.md on first
// use and caches in-process. Falls back to empty string when the file is absent.

const _reinforcementCache = new Map<string, string>();
const CREW_DIR = path.resolve(process.cwd(), "agents/crew");

// ── Crew specialist tool allowlist ──────────────────────────────────────────
// Loaded once from agents/crew/tools.json. Maps crewRole → Set of allowed
// tool names. Absent role = no filtering (full manifest kept).
//
// Note: tool names in tools.json use canonical runtime names (the `name` field
// on each AgentTool object, e.g. "create_gmail_draft", "create_calendar_event",
// "export_document_pdf") — these differ from the human-readable role descriptions
// in the task spec which used shorthand placeholders ("gmail_draft", "calendar_create",
// "export_pdf"). Non-existent names in the allowlist are silently skipped.

let _crewToolAllowlists: Record<string, Set<string>> | null = null;

function getCrewToolAllowlists(): Record<string, Set<string>> {
  if (_crewToolAllowlists) return _crewToolAllowlists;
  const filePath = path.join(CREW_DIR, "tools.json");
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string[]>;
    _crewToolAllowlists = Object.fromEntries(
      Object.entries(raw).map(([role, names]) => [role, new Set(names)])
    );
    return _crewToolAllowlists;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[runNamedAgent] crew tools.json unavailable: ${filePath} — ${reason} — tool filtering disabled`);
    _crewToolAllowlists = {};
    return _crewToolAllowlists;
  }
}

function loadCrewReinforcement(crewRole: string): string {
  if (_reinforcementCache.has(crewRole)) return _reinforcementCache.get(crewRole)!;
  const filePath = path.join(CREW_DIR, `${crewRole}.md`);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    _reinforcementCache.set(crewRole, content);
    return content;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[runNamedAgent] crew reinforcement file unavailable: ${filePath} — ${reason} — using empty string`);
    _reinforcementCache.set(crewRole, "");
    return "";
  }
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
   * Optional heartbeat callback fired mid-run when an Android task is still
   * in progress after turn 15. Threaded through to runAgent. Callers (e.g.
   * the SSE route / Discord channel handler) can forward this message to the
   * user so they know the task is still running rather than stuck.
   */
  onProgressMessage?: (message: string) => void;
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
  /**
   * Internal flag set to `true` when this call is a quality-check revision pass.
   * Prevents infinite recursion — the quality checker is skipped on revision passes.
   */
  isRevisionPass?: boolean;
  /** Scoped receipt from a previously-approved top-level action. */
  approvalReceipt?: ApprovalReceipt;
  /** Background worker job ID when this named-agent run belongs to agent_jobs. */
  jobId?: string;
}

export interface NamedAgentResult {
  reply: string;
  turns: number;
  toolCalls: AgentRunResult["toolCalls"];
  agentName: string;
  agentId: string;
  /** Attachments (images, files, markdown) produced by MCP tool calls during the run. */
  attachments: ChannelAttachment[];
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

/**
 * Fire-and-forget capability gap recorder.
 * Wraps in setImmediate + try/catch so it never blocks or throws in the
 * critical response path. Called when Jarvis persistently fails quality or
 * produces an apology-only reply, signalling a genuine capability gap.
 */
function recordCapabilityGap(
  userId: string,
  userMessage: string,
  replySnippet: string,
  reason: 'deflection' | 'apology_only' | 'no_tool_for_request',
  channel: string,
): void {
  setImmediate(() => {
    try {
      db.insert(capabilityGaps).values({
        userId,
        userMessage: userMessage.slice(0, 500),
        agentReplySnippet: replySnippet.slice(0, 300),
        detectedReason: reason,
        channel,
      }).catch((err: unknown) => {
        console.error('[RunNamedAgent] capabilityGap insert failed (non-blocking):', err);
      });
    } catch {
      // Never let this block the response path
    }
  });
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
    let permittedTools = wrapToolsForAgent(ALL_TOOLS, agent);

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
        const { resumeSession } = await import("./providers/sessionStore");
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
          const { buildBudgetedContextBlock, BUDGET_PRESETS } = await import("../memory/contextBuilder");
          memoryBlock = buildBudgetedContextBlock({
            title: `My Memory (${agent.name})`,
            items: memories.map((m) => ({ label: m.category, text: m.content })),
            budget: BUDGET_PRESETS.agentTurn.memory,
          });
        }
      } catch { /* non-blocking */ }

      // ── Optionally include global soul ───────────────────────────────────────
      let soulBlock = "";
      let globalMemoryBlock = "";
      if (agent.accessGlobalMemory) {
        try {
          const { getSoulPromptBlock } = await import("../memory/soul");
          const { buildBudgetedContextBlock, BUDGET_PRESETS } = await import("../memory/contextBuilder");
          const soul = await getSoulPromptBlock(userId);
          if (soul) {
            soulBlock = buildBudgetedContextBlock({
              title: "User Context (Global)",
              items: [{ text: soul.trim() }],
              budget: BUDGET_PRESETS.agentTurn.soul,
            });
          }
        } catch { /* non-blocking */ }

        try {
          const { retrieveMemoryContext } = await import("../memory/memoryOs");
          const { buildBudgetedContextBlock, BUDGET_PRESETS } = await import("../memory/contextBuilder");
          const memoryContext = await retrieveMemoryContext({
            userId,
            query: userMessage,
            limit: 6,
            caller: "agent_sdk_context",
          });
          if (memoryContext.items.length > 0) {
            globalMemoryBlock = buildBudgetedContextBlock({
              title: "Relevant User Memories (Global)",
              items: memoryContext.items.map((item) => ({
                label: item.memory.category,
                text: item.memory.content,
              })),
              budget: BUDGET_PRESETS.agentTurn.memory,
            });
          }
        } catch { /* non-blocking */ }
      }

      // ── Compose system prompt ──────────────────────────────────────────────
      const persona = agent.persona ?? `You are ${agent.name}, a ${agent.role} assistant.`;

      // ── Specialist reinforcement block ────────────────────────────────────
      // Each crew specialist gets a concise runtime reminder of their mandatory
      // first tool calls and output contract. This runs in addition to the
      // detailed operational protocol already baked into their persona so the
      // model can't "forget" the most important behaviour constraints mid-run.
      const configJsonForPrompt = (agent.configJson ?? {}) as Record<string, unknown>;
      const crewRoleForPrompt = typeof configJsonForPrompt.crewRole === "string" ? configJsonForPrompt.crewRole : null;
      const isCrewMemberForPrompt = configJsonForPrompt.isCrewMember === true;
      const reinforcementBlock = (isCrewMemberForPrompt && crewRoleForPrompt)
        ? loadCrewReinforcement(crewRoleForPrompt)
        : "";

      const systemPromptBase = `${persona}${reinforcementBlock}${soulBlock}${globalMemoryBlock}${memoryBlock}`;

      // ── Context registry: inject registered provider context ───────────────
      const registryCtx = await contextRegistry.build({
        userId,
        platform,
        channelId: opts.channelId,
        agentId,
        userMessage,
      });
      const systemPrompt = registryCtx.systemContext
        ? `${systemPromptBase}\n\n${registryCtx.systemContext}`
        : systemPromptBase;
      const effectiveUserMessage = [
        registryCtx.prependContext,
        userMessage,
        registryCtx.appendContext,
      ].filter(Boolean).join("\n");

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
        { role: "user", content: effectiveUserMessage },
      ];
    } else {
      // Session resumed — memories and soul are already in the cached system prompt.
      // We only need the new user message (already appended above).
    }

    // ── Resolve model (caller override → agent preferredModel → global pref) ──
    const { getModel, AVAILABLE_MODELS, ORCHESTRATOR_MODELS } = await import("../lib/modelPrefs");
    let model =
      opts.model ??
      agent.preferredModel ??
      (await getModel(userId, "chat"));

    // Non-blocking validation: warn if resolved model is not in the known-valid
    // set so misconfigurations surface in logs without breaking agent execution.
    const KNOWN_MODELS = new Set<string>([
      ...AVAILABLE_MODELS.map((m) => m.value),
      ...ORCHESTRATOR_MODELS.map((m) => m.value),
    ]);
    if (model && !KNOWN_MODELS.has(model)) {
      console.warn(`[runNamedAgent] agent=${agentId} resolved unknown model "${model}" — continuing`);
    }

    // ── Model enforcement: crew specialists must use approved OpenAI models ──
    // Crew specialists (crewRole set, isCrewMember=true) MUST run on gpt-4o-mini
    // or gpt-4.1-mini. Gemini models are strictly forbidden in this path.
    // If an invalid model is detected, clamp to gpt-4o-mini and warn.
    const configJson = (agent.configJson ?? {}) as Record<string, unknown>;
    const isCrewMember = configJson.isCrewMember === true;
    const crewRole = typeof configJson.crewRole === "string" ? configJson.crewRole : null;
    if (isCrewMember && crewRole && crewRole !== "orchestrator") {
      const CREW_APPROVED_MODELS = new Set(["gpt-4o-mini", "gpt-4.1-mini"]);
      const isGemini = typeof model === "string" && model.toLowerCase().startsWith("gemini");
      const isApproved = typeof model === "string" && CREW_APPROVED_MODELS.has(model);
      if (isGemini || !isApproved) {
        console.warn(
          `[runNamedAgent] crew specialist ${agent.name} has disallowed model "${model}" — clamping to gpt-4o-mini. ` +
          `Crew specialists must use gpt-4o-mini or gpt-4.1-mini. Gemini is not permitted in this path.`,
        );
        model = "gpt-4o-mini";
      }
    }

    // ── Crew specialist tool scoping ─────────────────────────────────────────
    // When the agent is a non-orchestrator crew specialist, filter permittedTools
    // to only the tools listed in agents/crew/tools.json for its role. This keeps
    // each specialist focused on the tools it actually needs and reduces model
    // confusion from seeing irrelevant options. Unknown roles (no entry in the
    // JSON) fall through unchanged. PRIME (orchestrator) is never filtered.
    if (isCrewMember && crewRole && crewRole !== "orchestrator") {
      const allowlists = getCrewToolAllowlists();
      const allowSet = allowlists[crewRole];
      if (allowSet && allowSet.size > 0) {
        const before = permittedTools.length;
        permittedTools = permittedTools.filter((t) => allowSet.has(t.name));
        console.log(
          `[runNamedAgent] crew tool scope applied: ${agent.name} (${crewRole}) ` +
          `${before} → ${permittedTools.length} tools`
        );
      }
    }

    // ── Tool-call hook gate ──────────────────────────────────────────────────
    // Runs the composable toolCallHooks registry before each tool execution.
    // Registered handlers (in priority order) can block, require approval,
    // or silently rewrite parameters. Built-in hook priorities:
    //   200 — permission check (agentPermissions.ts) — always runs first
    //   100 — approval gate (agentApproval.ts) — only for HIGH_RISK_TOOLS
    const onBeforeTool = async (
      toolName: string,
      toolArgs: Record<string, unknown>,
    ): Promise<{ allowed: boolean; reason?: string; params?: Record<string, unknown> }> => {
      const result = await toolCallHooks.run({
        toolName,
        params: toolArgs,
        agentId,
        agentName: agent.name,
        userId,
        platform,
        channelId: opts.channelId,
        workerJobId: opts.jobId,
        initiatedBy,
        signal,
        approvalReceipt: opts.approvalReceipt,
      });
      return { allowed: result.allowed, reason: result.reason, params: result.params };
    };

    // Crew specialists need more turns: they must call at least 2 tools before
    // composing a response (fetch_calendar + manage_tasks, or two search_web
    // calls, etc.). Allow up to 12 turns for specialists, 6 for regular agents.
    const isCrewSpecialist = isCrewMember && crewRole && crewRole !== "orchestrator";
    const effectiveMaxTurns = isCrewSpecialist ? 12 : 6;
    // Specialists also need more output tokens to produce complete documents,
    // full research reports, and properly structured plans.
    const effectiveMaxTokens = isCrewSpecialist ? 4000 : 2000;

    const result = await runAgent({
      model,
      messages,
      tools: permittedTools,
      context: ctx,
      maxTurns: effectiveMaxTurns,
      maxCompletionTokens: effectiveMaxTokens,
      onToken: opts.onToken,
      onBeforeTool,
      signal,
      onIntegrationError: opts.onIntegrationError,
      onToolError: opts.onToolError,
      onProgressMessage: opts.onProgressMessage,
      // Named agents handle their own gap detection at runNamedAgent level
      // (covering both revision-pass persistent failures and apology replies).
      // This flag prevents harness from double-recording the same interaction.
      _skipCapabilityGapDetection: true,
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
      const { initSession, appendToSession } = await import("./providers/sessionStore");
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

    // ── Response quality check (one revision pass max) ────────────────────────
    // Skip the check on revision passes to prevent infinite recursion.
    // Also honour the user's opt-out preference (responseQualityCheck === false).
    let qualityCheckEnabled = true;
    if (!opts.isRevisionPass && userId) {
      try {
        const prefRows = await db.select({ data: userPreferences.data })
          .from(userPreferences)
          .where(eq(userPreferences.userId, userId))
          .limit(1);
        const prefs = (prefRows[0]?.data ?? {}) as Record<string, unknown>;
        if (prefs.responseQualityCheck === false) qualityCheckEnabled = false;
      } catch { /* non-blocking — default to enabled */ }
    }

    if (!opts.isRevisionPass && qualityCheckEnabled) {
      const toolNames = result.toolCalls.map((tc) => tc.name);
      const androidToolsAvailable = permittedTools.some(
        (t) => t.name.startsWith("android_") || t.name === "run_daemon_shell" || t.name === "daemon_action",
      );
      const qc = checkResponseQuality({
        userMessage,
        agentReply: result.reply,
        toolsUsed: toolNames,
        androidToolsAvailable,
        agentId,
        userId,
      });

      if (qc.action === "revise") {
        const revisionStart = Date.now();
        logAgentEvent({
          event: "quality_revision_triggered",
          agentId,
          userId,
          detail: qc.reason.slice(0, 200),
        });
        try {
          const revised = await runNamedAgent({
            ...opts,
            isRevisionPass: true,
            userMessage: `${userMessage}\n\n[QUALITY NOTE: ${qc.reason}]`,
          });
          logAgentEvent({
            event: "quality_revision_completed",
            agentId,
            userId,
            durationMs: Date.now() - revisionStart,
            detail: `reply_words=${revised.reply.trim().split(/\s+/).length}`,
          });

          // Condition 1: persistent failure — revision pass also triggers a quality
          // flag. This means Jarvis genuinely lacks the capability, not a one-off stumble.
          // Also run Condition 2 on the revised reply here, because the function
          // returns revised immediately after this block (so the outer apology check
          // on result.reply never runs for this path).
          if (userId) {
            const qc2 = checkResponseQuality({
              userMessage,
              agentReply: revised.reply,
              toolsUsed: revised.toolCalls.map((tc) => tc.name),
              androidToolsAvailable,
            });
            if (qc2.action === 'revise') {
              // Persistent failure — both first pass and revision triggered quality flag
              recordCapabilityGap(userId, userMessage, revised.reply, 'deflection', platform);
            } else {
              // Revision passed quality but may still be an apology-only reply
              const revisedLower = revised.reply.toLowerCase();
              if (APOLOGY_PHRASES.some((p) => revisedLower.includes(p))) {
                recordCapabilityGap(userId, userMessage, revised.reply, 'apology_only', platform);
              }
            }
          }

          return revised;
        } catch (revErr) {
          // If the revision pass fails, fall through and return the original reply.
          console.warn("[RunNamedAgent] quality revision pass failed, using original reply:", revErr);
        }
      }

    }

    // Condition 2 (ungated from qualityCheckEnabled): if the final reply on the
    // non-revision path contains apology phrases, record a capability gap. This
    // runs even when the user has disabled response quality checks so that
    // capability telemetry is always collected independently of quality prefs.
    // Skip on revision passes (isRevisionPass) — the revised reply is checked
    // inside the revision block above (before `return revised`).
    if (!opts.isRevisionPass && userId) {
      const finalLower = result.reply.toLowerCase();
      if (APOLOGY_PHRASES.some((p) => finalLower.includes(p))) {
        recordCapabilityGap(userId, userMessage, result.reply, 'apology_only', platform);
      }
    }

    logAgentEvent({
      event: "task_completed",
      agentId,
      userId,
      durationMs: Date.now() - start,
      detail: `turns=${result.turns} tools=${result.toolCalls.length} session=${finalSessionId ? "active" : "none"}`,
    });

    // ── Auto-TTS for named agents (Telegram / WhatsApp only) ──────────────────
    // Trigger when:
    //   (a) User explicitly asked to read/speak the reply, OR
    //   (b) Auto-TTS is enabled for this channel in the user's preferences.
    //
    // Voice priority: agent config tts_voice → user's global ttsVoice → "nova".
    // Fire-and-forget (non-blocking); never blocks the reply return.
    const platformLower = platform.toLowerCase();
    const isTgOrWa = platformLower === "telegram" || platformLower === "whatsapp";
    if (isTgOrWa) {
      const isExplicitTtsRequest = /\b(say\s+(that|it|this)|read\s+(that|it|this)\s*(out|aloud|to\s*me)?|speak\s+(that|it|this)|voice\s+message\s*(it|that|please)?|send\s+(as\s+)?(a\s+)?voice|read\s+out\s*(loud)?)\b/i.test(
        userMessage,
      );

      (async () => {
        try {
          const { getUserTtsPrefs, getUserTtsChannels, speakToUser } = await import("./tools/tts");
          const enabledChannels = await getUserTtsChannels(userId);
          const shouldSpeak = isExplicitTtsRequest || enabledChannels.includes(platformLower);
          if (!shouldSpeak) return;

          // Agent persona voice takes priority over user's global preference
          const configJson = (agent.configJson ?? {}) as Record<string, unknown>;
          const agentVoice = typeof configJson.tts_voice === "string" ? configJson.tts_voice : null;
          const prefs = await getUserTtsPrefs(userId);
          const voice = agentVoice ?? prefs.voice ?? "nova";

          const ttsResult = await speakToUser(userId, result.reply, voice, {
            channel: platform,
            serverBaseUrl: process.env.SERVER_BASE_URL,
          });

          if (!ttsResult.ok) {
            console.warn(`[${agent.name}/auto-TTS] delivery failed: ${ttsResult.error}`);
          } else {
            console.log(`[${agent.name}/auto-TTS] voice note delivered (voice=${voice}, chars=${result.reply.length})`);
          }
        } catch (err) {
          console.warn(`[${agent.name}/auto-TTS] error (non-blocking):`, err);
        }
      })();
    }

    return {
      reply: result.reply,
      turns: result.turns,
      toolCalls: result.toolCalls,
      agentName: agent.name,
      agentId,
      attachments: (ctx.state.pendingAttachments as ChannelAttachment[]) ?? [],
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
    const openai = createRoutedOpenAIChatShim("[NamedAgentMemoryExtract]", "cheap");

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      user: userId,
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
