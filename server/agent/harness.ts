
import type OpenAI from "openai";
import type { AgentTool, AgentToolCallRecord, ToolContext } from "./types";
import type { ActivationPlan } from "./activationPlanner";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { getProvider, accumulateTurn, queryWithFallback, getGlobalFallbackChain, DEFAULT_PROVIDER_MODELS } from "./providers";
import type { ProviderName, FallbackChainEntry } from "./providers";
import { resolveRuntimeAgentModel } from "./runtimeModel";
import { checkResponseQuality, APOLOGY_PHRASES } from "./responseQuality";
import { estimateModelUsage, recordModelUsage } from "./modelUsage";

/**
 * Resolve the provider name from a model string.
 * Runtime execution is forced through Codex OAuth when enabled.
 */
function resolveProviderName(model: string): ProviderName {
  const normalized = model.toLowerCase();
  if (
    normalized.startsWith("modelrelay/") ||
    normalized.startsWith("chatgpt-codex-oauth/") ||
    normalized.startsWith("codex-oauth/") ||
    normalized.startsWith("openai-compatible/") ||
    normalized.startsWith("openrouter/") ||
    normalized.startsWith("groq/") ||
    normalized.startsWith("together/") ||
    normalized.startsWith("fireworks/") ||
    normalized.startsWith("cerebras/") ||
    normalized.startsWith("nvidia/") ||
    normalized.startsWith("deepseek/")
  ) {
    if (normalized.startsWith("chatgpt-codex-oauth/") || normalized.startsWith("codex-oauth/")) {
      return "chatgpt-codex-oauth";
    }
    return "openai-compatible";
  }
  return "openai";
}

export interface RunAgentOptions {
  model?: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools: AgentTool[];
  context: ToolContext;
  maxTurns?: number;
  maxCompletionTokens?: number;
  toolChoice?: "auto" | "required" | "none";
  /**
   * When provided, the final text-reply turn uses the OpenAI streaming API.
   * Called with each token delta as it arrives from the model so callers
   * can progressively update external UIs (e.g. Discord live-edit replies).
   * Intermediate tool-call turns always run non-streaming for clean parsing.
   */
  onToken?: (chunk: string) => void;
  /**
   * Optional AbortSignal. When the signal fires the agent loop exits cleanly
   * after the current turn completes, throwing a DOMException('AbortError').
   * Callers (e.g. the SSE chat route) can wire this to an AbortController so
   * a client-initiated cancel actually stops the running model loop.
   */
  signal?: AbortSignal;
  /**
   * Optional pre-execution hook called before each tool is invoked.
   * Return { allowed: true } to allow execution.
   * Return { allowed: false, reason } to block execution — the tool call
   * receives a denied-error result and the agent is informed.
   *
   * Named agents use this for approval-gate checks on high-risk tools.
   */
  onBeforeTool?: (
    toolName: string,
    toolArgs: Record<string, unknown>,
  ) => Promise<{ allowed: boolean; reason?: string; params?: Record<string, unknown> }>;
  /**
   * Optional callback fired when a tool fails due to an integration auth/
   * connectivity issue. The caller (e.g. the SSE route) can use this to
   * emit a structured `integration_error` event to the client so the UI
   * can surface an actionable "Reconnect <integration>" prompt.
   *
   * integrationKey — one of: google | outlook | telegram | discord | slack | whatsapp
   * message        — the raw error detail from the tool throw
   */
  onIntegrationError?: (integrationKey: string, message: string) => void;
  /**
   * Ordered list of fallback providers to try when the primary provider
   * returns a retriable error (5xx, 429, timeout).
   *
   * The primary provider is automatically derived from the runtime model and
   * Codex OAuth is primary when enabled.
   * Names listed here are appended as backups — duplicates of the primary
   * are silently de-duplicated.
   *
   * Example: `providerFallbackChain: ["openai-compatible"]` can retry on a
   * configured compatible endpoint whenever the primary provider returns a 5xx
   * or rate-limit.
   * The fallback provider uses a sensible default model (see
   * DEFAULT_PROVIDER_MODELS in providers/fallback.ts) unless overridden via
   * `providerFallbackModels`.
   *
   * Opt-in and off by default. A global default can be set via the
   * PROVIDER_FALLBACK_CHAIN environment variable (comma-separated provider
   * names, with optional explicit models via "name:model" syntax, e.g.
   * "chatgpt-codex-oauth:chatgpt-codex-oauth/auto,openai:gpt-4o") which applies to every
   * runAgent call that does not provide its own chain.
   */
  providerFallbackChain?: ProviderName[];
  /**
   * Optional per-provider model overrides for the fallback chain.
   * When a fallback provider is selected, its model string is resolved from
   * this map first, then falls back to DEFAULT_PROVIDER_MODELS.
   *
   * Example: `providerFallbackModels: { "openai-compatible": "modelrelay/auto-fastest" }`
   * will use that model on the backup turn rather than the default.
   */
  providerFallbackModels?: Partial<Record<ProviderName, string>>;
  /**
   * Optional callback fired when a non-integration tool failure occurs
   * (i.e. the tool threw or returned ok=false for a reason unrelated to auth).
   * The SSE route wires this to a `tool_error` event so the mobile UI can
   * show a distinct error state on the chat bubble.
   *
   * toolName — name of the tool that failed
   * message  — the error detail from the throw or ok=false content
   */
  onToolError?: (toolName: string, message: string) => void;
  /**
   * Optional heartbeat callback fired mid-run when an Android task is still
   * in progress after turn 15. Called with a short status message so callers
   * (e.g. the SSE route / Discord channel) can forward it to the user without
   * the agent consuming a model turn to do so.
   *
   * message — human-readable progress text, e.g. "Still working — on step 17"
   */
  onProgressMessage?: (message: string) => void;
  /**
   * Pre-computed activation plan from the ActivationPlanner.
   *
   * When provided, three things happen inside runAgent:
   *
   *   1. Session context injection — focus areas, urgent signals, energy state,
   *      and top Foresight predictions are injected into the first system message
   *      so the model is primed with what to focus on this tick.
   *
   *   2. Manifest suppression (authoritative) — capabilities listed in
   *      `capabilityManifest.suppressedCapabilityIds` have their tools removed
   *      from the active tool set. This filter composes with the integration
   *      health filter and the channel-scope filter:
   *        broken-integration exclusions ∩ manifest suppressions ∩ channel scope
   *
   *   3. Capability decision logging — `capabilityManifest.reasons` are logged
   *      for observability and future admin tooling.
   *
   * Falls back to the harness's existing behaviour when absent, so all
   * existing callers that do not pass an activation plan are unaffected.
   */
  activationPlan?: ActivationPlan;
  /**
   * Optional integration dependency map for test contexts.
   *
   * When provided, this map is used to seed `toolToIntegrationKey` directly
   * instead of calling `capabilityRegistry.getIntegrationDeps()` via the
   * dynamic import of `../capabilities/index`. This bypasses the real registry
   * import (which can fail in test environments due to circular dependencies)
   * while still exercising the full harness classification and error-routing
   * logic from the real code path.
   *
   * Production callers should never set this — leave it undefined so the
   * capability registry is used as normal.
   */
  _testOnlyIntegrationDeps?: Record<string, { label: string; toolNames: string[] }>;
  /**
   * When true, harness-level capability-gap detection is skipped.
   * Set by callers (e.g. runNamedAgent) that perform their own gap detection
   * at a higher level to avoid double-recording the same interaction.
   * Coach/chat paths that call runAgent directly should NOT set this flag —
   * harness-level detection is their only gap-capture path.
   */
  _skipCapabilityGapDetection?: boolean;
}

export interface AgentRunResult {
  reply: string;
  turns: number;
  toolCalls: AgentToolCallRecord[];
  finishReason: string | null;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

/**
 * Detects whether a tool throw was caused by an integration auth/connectivity
 * failure. Returns the integration key (e.g. "google", "outlook") if the
 * error message contains known auth signals and the tool is mapped to an
 * integration; returns null otherwise.
 */
function detectIntegrationErrorKey(
  toolName: string,
  errorMsg: string,
  toolToIntegration: Map<string, string[]>,
): string | null {
  const candidates = toolToIntegration.get(toolName);
  if (!candidates || candidates.length === 0) return null;

  const lower = errorMsg.toLowerCase();
  const authSignals = [
    "401", "403",
    "unauthorized", "forbidden",
    "expired", "invalid_grant", "revoked",
    "token", "authentication", "oauth",
    "permission denied", "scope", "credentials",
    "unauthenticated", "access denied",
  ];
  if (!authSignals.some((s) => lower.includes(s))) return null;

  // For multi-provider tools, only return a key if the error text contains a
  // clear provider hint. Without one, suppress (return null) — guessing the
  // first candidate risks sending users to the wrong reconnect flow.
  if (candidates.length > 1) {
    if (/microsoft|outlook|office365/i.test(lower) && candidates.includes("outlook")) return "outlook";
    if (/google|gmail/i.test(lower) && candidates.includes("google")) return "google";
    return null; // ambiguous — suppress rather than misattribute
  }
  return candidates[0];
}

function toOpenAITool(t: AgentTool): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  };
}

/**
 * Runs an OpenAI completion in a loop, executing any tool calls the model
 * requests and feeding the results back until the model returns a final
 * assistant message (or maxTurns is hit).
 *
 * When `onToken` is provided, the turn that produces the final text reply
 * uses the streaming API so the caller receives token deltas in real time.
 * Tool-call turns always run non-streaming for clean function-call parsing.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const {
    model: modelOpt,
    tools: initialTools,
    context,
    maxTurns = 6,
    maxCompletionTokens = 2000,
    toolChoice = "auto",
    onToken,
    signal,
  } = opts;

  // `tools` is mutable so the channel-scope gate below can reassign it.
  let tools = initialTools;

  // Aggregated tool-group preferences from active skill packs.
  // Populated during pack loading; consumed by the tool-filter phase.
  let packBoostCapIds: string[] = [];
  let packSuppressCapIds: string[] = [];

  // Tools hard-excluded by integration health (broken integrations).
  // Pack boosts MUST NOT re-add these — they are unavailable at runtime.
  const hardExcludedToolNames = new Set<string>();

  // Reverse map: toolName → integrationKey[] — built during the pre-flight
  // integration health check below. Multi-provider tools (e.g. send_email,
  // fetch_emails) may depend on more than one integration, so we store all
  // candidate keys and resolve the broken one via live validator status.
  const toolToIntegrationKey = new Map<string, string[]>();

  const { getModel } = await import("../lib/modelPrefs");
  const model = resolveRuntimeAgentModel(modelOpt ?? (await getModel(context.userId, "chat")));

  const channel = context.channel || "Agent";

  // ── Inject workspace context into system prompt ────────────────────────────
  // Load SOUL.md, AGENTS.md, and MEMORY.md from ~/.jarvis/workspace/ and
  // prepend them to the first system message under a "Workspace Instructions"
  // heading. This runs before all other injections so workspace rules take
  // highest precedence.
  let messages = opts.messages;
  const seedUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const seedQuery =
    typeof seedUserMessage?.content === "string"
      ? seedUserMessage.content
      : Array.isArray(seedUserMessage?.content)
        ? (seedUserMessage.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join(" ")
        : "";
  try {
    const { getWorkspaceContext } = await import("../workspace/loader");
    const workspaceBlock = await getWorkspaceContext({ seedQuery });
    if (workspaceBlock) {
      messages = messages.map((m, i) => {
        if (i === 0 && m.role === "system") {
          return { ...m, content: workspaceBlock + (m.content ?? "") };
        }
        return m;
      });
      console.log(`[${channel}/Harness] workspace context injected`);
    }
  } catch {
    // Best-effort — never block an agent run
  }

  // ── Inject user skills into system prompt ──────────────────────────────────
  // Load active skill files for this user and append their instructions to the
  // first system message so the agent follows learnt behaviour patterns.
  if (context.userId) {
    try {
      const { loadUserSkills } = await import("../intelligence/skillWriter");
      const { truncateToBudget, BUDGET_PRESETS } = await import("../memory/contextBuilder");
      const skills = await loadUserSkills(context.userId);
      if (skills.length > 0) {
        const skillBlockRaw = skills
          .map((s) => `### Skill: ${s.name}\n${s.instructions}`)
          .join("\n\n");
        const skillBlock = truncateToBudget(skillBlockRaw, BUDGET_PRESETS.agentTurn.skills);
        const injected = `\n\n---\n## Learnt Behaviour Skills\nThe following skills have been crystallised from repeated patterns and MUST be followed:\n\n${skillBlock}`;
        messages = messages.map((m, i) => {
          if (i === 0 && m.role === "system") {
            return { ...m, content: (m.content ?? "") + injected };
          }
          return m;
        });
      }
    } catch {
      // skills are best-effort — never block an agent run
    }

    // ── Inject DB-backed user skills (Task #502) ───────────────────────────────
    // Load active skills from the user_skills table and prepend them to the
    // system prompt under an ## Active Skills block.
    try {
      const { userSkills: userSkillsTable } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const { db: dbImport } = await import("../db");
      const { truncateToBudget, BUDGET_PRESETS } = await import("../memory/contextBuilder");
      const activeSkills = await dbImport
        .select()
        .from(userSkillsTable)
        .where(and(eq(userSkillsTable.userId, context.userId), eq(userSkillsTable.isActive, true)));
      if (activeSkills.length > 0) {
        const skillBlockRaw = activeSkills
          .map((s) => `### ${s.emoji} ${s.name}\n${s.instructions}`)
          .join("\n\n");
        const skillBlock = truncateToBudget(skillBlockRaw, BUDGET_PRESETS.agentTurn.skills);
        const injected = `\n\n---\n## Active Skills\nThe user has enabled the following personal skills. You MUST follow their instructions:\n\n${skillBlock}`;
        messages = messages.map((m, i) => {
          if (i === 0 && m.role === "system") {
            return { ...m, content: (m.content ?? "") + injected };
          }
          return m;
        });
        console.log(`[${channel}/Harness] injected ${activeSkills.length} user skill(s)`);
      }
    } catch {
      // DB skills are best-effort — never block an agent run
    }

    // ── Inject operator skill packs + Ego instruction overrides ───────────────
    // Load versioned instruction packs published by the Jarvis team and any
    // per-user overrides written by the Ego self-correction loop. Packs are
    // resolved at session start (not mid-session) for stability.
    // Falls back silently on any error so existing behaviour is unchanged.
    try {
      const { loadPackInstructionsForUser } = await import("../intelligence/behaviorStore");
      const { truncateToBudget, BUDGET_PRESETS } = await import("../memory/contextBuilder");
      const packs = await loadPackInstructionsForUser(context.userId);
      if (packs.length > 0) {
        const packBlockRaw = packs
          .map((p) => `### Pack: ${p.name} (v${p.version})\n${p.merged}`)
          .join("\n\n");
        const packBlock = truncateToBudget(packBlockRaw, BUDGET_PRESETS.agentTurn.behaviorPacks);
        // Build heartbeat-rules summary for packs that have non-empty rules.
        const heartbeatLines: string[] = [];
        for (const p of packs) {
          const r = p.heartbeatRules;
          const lines: string[] = [];
          if (r.disableDuringFocusBlocks) lines.push("do not send proactive messages during focus blocks");
          if (r.batchInterruptions) lines.push("batch non-urgent interruptions outside focus hours");
          if (r.quietHoursOnly) lines.push("limit proactive messaging to quiet hours only");
          if (r.suppressNotificationTypes?.length) {
            lines.push(`suppress notification types: ${r.suppressNotificationTypes.join(", ")}`);
          }
          if (lines.length > 0) heartbeatLines.push(`${p.name}: ${lines.join("; ")}`);
        }
        const heartbeatSection = heartbeatLines.length > 0
          ? `\n\n**Active heartbeat rules from packs:** ${heartbeatLines.join(" | ")}`
          : "";

        const injected = `\n\n---\n## Behaviour Packs\nThe following operator instructions MUST be followed. Per-user Ego adjustments are included:${heartbeatSection}\n\n${packBlock}`;
        messages = messages.map((m, i) => {
          if (i === 0 && m.role === "system") {
            return { ...m, content: (m.content ?? "") + injected };
          }
          return m;
        });
        console.log(`[${channel}/Harness] injected ${packs.length} behaviour pack(s)`);

        // Aggregate tool-group preferences from all active packs for use
        // in the tool-filter phase (applied after manifest suppressions).
        for (const p of packs) {
          if (p.toolGroups?.boost?.length) packBoostCapIds.push(...p.toolGroups.boost);
          if (p.toolGroups?.suppress?.length) packSuppressCapIds.push(...p.toolGroups.suppress);
        }
      }
    } catch {
      // packs are best-effort — never block an agent run
    }
  }

  // ── Activation plan: inject session context into system prompt ─────────────
  // When the caller supplies a pre-computed ActivationPlan, inject the session
  // context (focus areas, urgent signals, energy state) into the first system
  // message so the model is primed with what to focus on this session.
  // The manifest's reasons are logged for observability.
  // Falls back to existing behaviour when no plan is provided.
  if (opts.activationPlan) {
    try {
      const { sessionContext, capabilityManifest, reason } = opts.activationPlan;
      console.log(`[${channel}/Harness] activation plan: ${reason}`);
      if (Object.keys(capabilityManifest.reasons).length > 0) {
        const reasonLines = Object.entries(capabilityManifest.reasons)
          .map(([id, r]) => `  ${id}: ${r}`)
          .join("\n");
        console.log(`[${channel}/Harness] capability decisions:\n${reasonLines}`);
      }

      // Build context block to inject into the system prompt.
      const contextParts: string[] = [];

      if (sessionContext.urgentSignals.length > 0) {
        contextParts.push(
          `Urgent signals this session:\n${sessionContext.urgentSignals.map((s) => `- ${s}`).join("\n")}`,
        );
      }

      if (sessionContext.focusAreas.length > 0) {
        contextParts.push(
          `Suggested focus areas:\n${sessionContext.focusAreas.map((f) => `- ${f}`).join("\n")}`,
        );
      }

      if (sessionContext.energyState) {
        const { stressScore, flowScore, label } = sessionContext.energyState;
        contextParts.push(
          `Current user state: ${label} (stress: ${stressScore}/10, flow: ${flowScore}/10)`,
        );
      }

      if (sessionContext.topPredictions.length > 0) {
        const predLines = sessionContext.topPredictions
          .map(
            (p) =>
              `- ${p.humanReadable}${p.actionSuggestion ? ` → ${p.actionSuggestion}` : ""}`,
          )
          .join("\n");
        contextParts.push(`Foresight predictions:\n${predLines}`);
      }

      if (contextParts.length > 0) {
        const planBlock = `\n\n---\n## Activation Context\n${contextParts.join("\n\n")}`;
        messages = messages.map((m, i) => {
          if (i === 0 && m.role === "system") {
            return { ...m, content: (m.content ?? "") + planBlock };
          }
          return m;
        });
      }
    } catch {
      // activation plan injection is best-effort — never block an agent run
    }
  }

  // ── Pre-flight integration status: tool exclusion + system prompt note ──────
  // Reads cached integration health for this user and:
  //   (a) Deterministically removes tools whose required integration is BROKEN
  //       from the active tool list — prompt-only guidance is insufficient.
  //   (b) Injects a plain-language system prompt note so the model can explain
  //       proactively why certain capabilities are unavailable.
  //   (c) Adds a softer advisory note for EXPIRING_SOON integrations (still
  //       usable — warn the user to reconnect soon but don't block tools).
  //
  // The integration → tool mapping is sourced from the capability registry so
  // each capability module owns its own dependency declaration rather than
  // being hard-coded here. The registry is lazily imported and cached by Node.

  // Build reverse mapping unconditionally: toolName → integrationKey[] for integration error
  // detection. This mapping comes from the capability registry (not per-user data), so it must
  // be populated regardless of whether a userId is present. Without this, integration auth
  // failures are not classified in headless / test-harness runs that lack a userId.
  //
  // In test contexts, callers may inject the map directly via opts._testOnlyIntegrationDeps
  // to bypass the dynamic import (which can fail in test environments due to circular deps).
  if (opts._testOnlyIntegrationDeps) {
    for (const [key, { toolNames }] of Object.entries(opts._testOnlyIntegrationDeps)) {
      for (const toolName of toolNames) {
        const existing = toolToIntegrationKey.get(toolName) ?? [];
        if (!existing.includes(key)) existing.push(key);
        toolToIntegrationKey.set(toolName, existing);
      }
    }
  } else {
    try {
      const { capabilityRegistry } = await import("../capabilities/index");
      const integrationDeps = capabilityRegistry.getIntegrationDeps();

      // Multiple integrations can share a tool (e.g. send_email works with google/outlook),
      // so we collect all candidate keys and resolve the broken one later via live status.
      for (const [key, { toolNames }] of Object.entries(integrationDeps)) {
        for (const toolName of toolNames) {
          const existing = toolToIntegrationKey.get(toolName) ?? [];
          if (!existing.includes(key)) existing.push(key);
          toolToIntegrationKey.set(toolName, existing);
        }
      }
    } catch {
      // registry import is best-effort — never block an agent run
    }
  }

  if (context.userId) {
    try {
      const { capabilityRegistry } = await import("../capabilities/index");
      const integrationDeps = capabilityRegistry.getIntegrationDeps();

      const { getUserIntegrationStatuses } = await import("../intelligence/integrationValidator");
      const statuses = await getUserIntegrationStatuses(context.userId);

      // Collect broken integrations: split into those with agent tools (tools disabled)
      // and those without (channel-only — delivery is broken but no tools to exclude).
      const brokenWithTools: string[] = [];   // integrations where tools were removed
      const brokenChannelOnly: string[] = []; // broken but no tools to exclude
      const toolsToExclude = new Set<string>();

      for (const [key, { label, toolNames: depTools }] of Object.entries(integrationDeps)) {
        if (statuses[key as keyof typeof statuses] === "broken") {
          if (depTools.length > 0) {
            brokenWithTools.push(label);
            for (const t of depTools) toolsToExclude.add(t);
          } else {
            brokenChannelOnly.push(label);
          }
        }
      }

      // Post-process: multi-provider tools (e.g. send_email, fetch_emails,
      // create_calendar_event) are listed in toolNames for both Google and Outlook.
      // The loop above adds them to toolsToExclude when ANY provider is broken, but
      // they should only be excluded when ALL their mapped providers are unavailable.
      // "Operational" = healthy, expiring_soon, or degraded (first-failure grace period).
      for (const toolName of [...toolsToExclude]) {
        const candidates = toolToIntegrationKey.get(toolName) ?? [];
        if (candidates.length <= 1) continue; // single-provider — exclusion is correct
        const hasOperationalProvider = candidates.some((k) => {
          const s = statuses[k as keyof typeof statuses];
          return s === "healthy" || s === "expiring_soon" || s === "degraded";
        });
        if (hasOperationalProvider) toolsToExclude.delete(toolName);
      }

      // Reconcile brokenWithTools: if all dep tools for an integration were
      // restored by the multi-provider post-processing step above, that integration
      // no longer has any tools disabled — remove it from brokenWithTools so the
      // system prompt does not falsely claim tools were removed.
      for (const [key, { label, toolNames: depTools }] of Object.entries(integrationDeps)) {
        const idx = brokenWithTools.indexOf(label);
        if (idx === -1) continue; // not in brokenWithTools
        if (depTools.length === 0) continue; // channel-only — skip
        const stillExcluded = depTools.some((t) => toolsToExclude.has(t));
        if (!stillExcluded) {
          // All tools restored via another provider — no longer tool-disabling broken
          brokenWithTools.splice(idx, 1);
          if (!brokenChannelOnly.includes(label)) brokenChannelOnly.push(label);
        }
      }

      // send_email and fetch_emails require at least one operational email provider.
      // "Operational" = healthy, expiring_soon, or degraded (first-failure grace period —
      // tools stay active while we wait for a second consecutive failure to confirm broken).
      // "Non-operational" = broken OR unconfigured — treat both as unavailable
      // for fallback decisions so {google: broken, outlook: unconfigured} → excluded.
      const googleOperational = statuses.google === "healthy" || statuses.google === "expiring_soon" || statuses.google === "degraded";
      const outlookOperational = statuses.outlook === "healthy" || statuses.outlook === "expiring_soon" || statuses.outlook === "degraded";
      if (!googleOperational && !outlookOperational) {
        toolsToExclude.add("send_email");
        toolsToExclude.add("fetch_emails");
        // Only surface in the alert note if a provider is explicitly broken
        // (unconfigured providers are expected and don't need an alert).
        if (statuses.google === "broken" && !brokenWithTools.includes("Google (Gmail + Calendar + Drive)")) {
          brokenWithTools.push("Google (Gmail + Calendar + Drive)");
        }
        if (statuses.outlook === "broken" && !brokenWithTools.includes("Microsoft Outlook")) {
          brokenWithTools.push("Microsoft Outlook");
        }
      }

      // (a) Deterministic tool exclusion for broken integrations.
      if (toolsToExclude.size > 0) {
        // Record hard exclusions so pack boosts cannot re-add unavailable tools.
        for (const name of toolsToExclude) hardExcludedToolNames.add(name);
        const before = tools.length;
        tools = tools.filter((t: AgentTool) => !toolsToExclude.has(t.name));
        console.log(
          `[${channel}/Harness] excluded ${before - tools.length} tools for broken integrations: ${brokenWithTools.join(", ")}`,
        );
      }

      // (b) System prompt note for broken integrations.
      // Separate the message for tool-disabled integrations vs channel-only integrations
      // so we never tell the model tools were disabled when they were not.
      const allBroken = [...brokenWithTools, ...brokenChannelOnly];
      if (allBroken.length > 0) {
        let unavailableNote = "\n\n---\n## Integration Alerts\n";
        if (brokenWithTools.length > 0) {
          unavailableNote += `The following integrations are BROKEN and their associated tools have been disabled for this session:\n${brokenWithTools.map((b) => `- ${b}`).join("\n")}\nDo not attempt to call the disabled tools. Tell the user these integrations need to be reconnected in Settings → Connections.\n`;
        }
        if (brokenChannelOnly.length > 0) {
          unavailableNote += `The following messaging channels are BROKEN — Jarvis cannot receive or send messages through them:\n${brokenChannelOnly.map((b) => `- ${b}`).join("\n")}\nTell the user these channels need to be reconnected in Settings → Connections.\n`;
        }
        messages = messages.map((m, i) =>
          i === 0 && m.role === "system"
            ? { ...m, content: (m.content ?? "") + unavailableNote }
            : m,
        );
        console.log(`[${channel}/Harness] integration alert (broken): ${allBroken.join(", ")}`);
      }

      // (c) Advisory note for expiring-soon integrations (tools still active).
      const expiringSoon: string[] = [];
      if (statuses.google === "expiring_soon") expiringSoon.push("Google");
      if (statuses.outlook === "expiring_soon") expiringSoon.push("Microsoft Outlook");
      if (expiringSoon.length > 0) {
        const expiryNote = `\n\n⚠️ Note: The following integration tokens are expiring soon (tools are still active): ${expiringSoon.join(", ")}. Mention this to the user if relevant so they can reconnect before the token expires.`;
        messages = messages.map((m, i) =>
          i === 0 && m.role === "system"
            ? { ...m, content: (m.content ?? "") + expiryNote }
            : m,
        );
      }
    } catch {
      // Best-effort — never block an agent run
    }
  }

  // ── Unified tool-set filter: (channel_baseline ∪ activations) − suppressions ──
  //
  // Task #281 lazy capability loading — unified filter replacing the former
  // separate positive-filter / suppression / channel-scope blocks.
  //
  // Policy (in priority order):
  //   1. Channel baseline  — resolveChannelTools seeds the allowed set
  //      (backward-compat: channel sessions without a plan work as before).
  //   2. Manifest activations — activeCapabilityIds UNION their tools into the
  //      set, so high-priority rules (e.g. "meeting in 30 min → activate
  //      calendar + email") can ADD tools beyond the channel's normal scope.
  //   3. Manifest suppressions — suppressedCapabilityIds DELETE their tools from
  //      the allowed set, overriding both baseline and activations.
  //
  // Effective set = (channel_baseline ∪ activeCapability_tools) − suppressed_tools
  //
  // Without an activationPlan:
  //   • channel sessions → pure channel scope (unchanged from before).
  //   • heartbeat/subagent (no channel) → no filter, all tools pass.
  // Without a channel (heartbeat):
  //   • effective set = activeCapability_tools − suppressed_tools.
  //   • If activeCapabilityIds empty and no channel → no filter (backward compat).
  if (context.channel || opts.activationPlan) {
    try {
      const { capabilityRegistry } = await import("../capabilities/index");
      const allowedToolNames = new Set<string>();
      let hasAnyScope = false;

      // Step 1: Seed from channel scope (backward-compatible baseline).
      if (context.channel) {
        const { resolveChannelTools } = await import("./tools/channelTools");
        const hasGoogle = !!context.googleAccessToken;
        const scoped = await resolveChannelTools(context.channel, hasGoogle);
        if (scoped.length > 0) {
          hasAnyScope = true;
          for (const t of scoped) allowedToolNames.add(t.name);
          console.log(`[${channel}/Harness] channel-scope baseline: ${scoped.length} tools`);
        }
      }

      // Step 2a: UNION in activated capability tools.
      // Allows planner rules to add tools beyond the channel's normal scope
      // (e.g. calendar + email for upcoming meeting on a Discord channel).
      if (opts.activationPlan?.capabilityManifest.activeCapabilityIds.length) {
        let added = 0;
        for (const capId of opts.activationPlan.capabilityManifest.activeCapabilityIds) {
          const cap = capabilityRegistry.getById(capId);
          if (cap) {
            for (const tool of cap.tools) {
              if (!allowedToolNames.has(tool.name)) added++;
              allowedToolNames.add(tool.name);
            }
          }
        }
        hasAnyScope = true;
        if (added > 0) {
          console.log(
            `[${channel}/Harness] manifest activations: +${added} tools for capabilities: [${opts.activationPlan.capabilityManifest.activeCapabilityIds.join(", ")}]`,
          );
        }
      }

      // Step 2b: Suppression-only heartbeat fallback.
      // When a plan has ONLY suppressions (no active capabilities) and there is no
      // channel scope, the allowed set is empty so suppressions would be a no-op.
      // Fix: seed with the full current tool list so Step 3 can remove from it.
      // This handles cases like "suppress browser + research on general heartbeat"
      // without requiring the planner to explicitly enumerate every other capability.
      if (
        !context.channel &&
        opts.activationPlan &&
        !opts.activationPlan.capabilityManifest.activeCapabilityIds.length &&
        opts.activationPlan.capabilityManifest.suppressedCapabilityIds.length > 0
      ) {
        hasAnyScope = true;
        for (const t of tools) allowedToolNames.add(t.name);
        console.log(
          `[${channel}/Harness] suppression-only heartbeat: seeded ${tools.length} tools before removing suppressed capabilities`,
        );
      }

      // Step 3: REMOVE suppressed capability tools (highest priority — wins over activations).
      if (opts.activationPlan?.capabilityManifest.suppressedCapabilityIds.length) {
        let removed = 0;
        for (const capId of opts.activationPlan.capabilityManifest.suppressedCapabilityIds) {
          const cap = capabilityRegistry.getById(capId);
          if (cap) {
            for (const tool of cap.tools) {
              if (allowedToolNames.has(tool.name)) { allowedToolNames.delete(tool.name); removed++; }
            }
          }
        }
        if (removed > 0) {
          console.log(
            `[${channel}/Harness] manifest suppressions: -${removed} tools for capabilities: [${opts.activationPlan.capabilityManifest.suppressedCapabilityIds.join(", ")}]`,
          );
        }
      }

      // Step 3b: Always allow tools that are not registered in the capability
      // registry — these are "injected" tools explicitly added by the caller
      // (e.g. flag_task_needs_attention injected by the scheduler). They are
      // safe to pass through because the caller already made a deliberate
      // scoping decision to include them.
      if (hasAnyScope) {
        const registeredNames = new Set(capabilityRegistry.getAllTools().map((t) => t.name));
        for (const t of tools) {
          if (!registeredNames.has(t.name)) {
            allowedToolNames.add(t.name);
          }
        }
      }

      // Step 4: Apply the allowed set to the tool list.
      if (hasAnyScope) {
        const before = tools.length;
        tools = tools.filter((t: AgentTool) => allowedToolNames.has(t.name));
        const reduction = before > 0 ? Math.round((1 - tools.length / before) * 100) : 0;
        console.log(
          `[${channel}/Harness] effective tool set: ${tools.length}/${initialTools.length} (${reduction}% reduction from initial)`,
        );
      }
    } catch {
      // Best-effort — never block an agent run
    }
  }

  // ── Step 5: Skill-pack tool-group overrides ────────────────────────────────
  // Always applied, regardless of whether a channel or activation plan is
  // present. This ensures user-activated pack preferences are honored in
  // every session type: channel, heartbeat, and direct (no plan).
  //
  //   Pack boosts  → union capability tools into the active set (from initialTools)
  //   Pack suppressions → difference: remove capability tools (wins over boosts)
  if (packBoostCapIds.length > 0 || packSuppressCapIds.length > 0) {
    try {
      const { capabilityRegistry } = await import("../capabilities/index");

      if (packBoostCapIds.length > 0) {
        const currentNames = new Set(tools.map((t: AgentTool) => t.name));
        let boosted = 0;
        for (const capId of packBoostCapIds) {
          const cap = capabilityRegistry.getById(capId);
          if (cap) {
            for (const tool of cap.tools) {
              // Never re-add tools hard-excluded by integration health.
              if (hardExcludedToolNames.has(tool.name)) continue;
              if (!currentNames.has(tool.name)) {
                const src = (initialTools as AgentTool[]).find((it) => it.name === tool.name);
                if (src) { tools = [...tools, src]; currentNames.add(src.name); boosted++; }
              }
            }
          }
        }
        if (boosted > 0) {
          console.log(
            `[${channel}/Harness] pack boosts: +${boosted} tools for capabilities: [${[...new Set(packBoostCapIds)].join(", ")}]`,
          );
        }
      }

      if (packSuppressCapIds.length > 0) {
        const suppressNames = new Set<string>();
        for (const capId of packSuppressCapIds) {
          const cap = capabilityRegistry.getById(capId);
          if (cap) {
            for (const tool of cap.tools) suppressNames.add(tool.name);
          }
        }
        const before = tools.length;
        tools = tools.filter((t: AgentTool) => !suppressNames.has(t.name));
        const removed = before - tools.length;
        if (removed > 0) {
          console.log(
            `[${channel}/Harness] pack suppressions: -${removed} tools for capabilities: [${[...new Set(packSuppressCapIds)].join(", ")}]`,
          );
        }
      }
    } catch {
      // Best-effort — never block an agent run
    }
  }

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // ── Android/daemon task detection ────────────────────────────────────────
  // Detect whether any tool in the active set is an Android or daemon-shell
  // tool. Android UI navigation sequences (screenshot → read → tap → verify)
  // require 3–5 turns per sub-step, so a 4-step task like "open YouTube,
  // search, tap channel, open video" easily needs 15–20 turns.
  //
  // Heuristic: any tool whose name starts with "android_" or equals
  // "run_daemon_shell" or "daemon_action" is counted as an Android/daemon tool.
  //
  // IMPORTANT: If the max-turns ceiling below is lowered, also update the
  // heartbeat threshold inside the turn loop (currently turn >= 15) so the
  // progress message still fires before the budget is exhausted.
  const hasAndroidTools = tools.some(
    (t) => t.name.startsWith("android_") || t.name === "run_daemon_shell" || t.name === "daemon_action",
  );

  // Raise the effective turn budget for Android-heavy sessions. The default 6
  // is far too low for multi-step UI navigation; 25 allows complex flows to
  // complete without hitting the ceiling mid-task.
  const effectiveMaxTurns = hasAndroidTools ? Math.max(maxTurns, 25) : maxTurns;
  if (hasAndroidTools && effectiveMaxTurns > maxTurns) {
    console.log(
      `[${channel}/Harness] android tools detected — raising maxTurns ${maxTurns} → ${effectiveMaxTurns}`,
    );
  }

  // ── Android sequential-execution instruction ─────────────────────────────
  // When Android tools are present, inject a hard rule into the system prompt
  // that forbids the model from sending text announcements between tool calls.
  // This prevents the "I will now tap the channel. Proceeding..." → turn ends
  // pattern without conflicting with the screen-reading requirement.
  if (hasAndroidTools) {
    const androidRule =
      "\n\n---\n## Android Task Execution Rule\n" +
      "Chain tool calls directly: after each tool result, proceed immediately to your " +
      "next tool call without sending any text announcement in between. Never send a " +
      "standalone reply like 'I will now tap...' or 'Proceeding now...' — just call the " +
      "next tool. This rule does NOT override screen-reading: you must still call " +
      "android_read_screen after every navigation before tapping anything.\n\n" +
      "**Screen reading vs screenshots — always prefer text:**\n" +
      "- **`android_read_screen` is your first choice** for reading what is on screen. " +
      "It returns all visible text, UI labels, and element coordinates from the accessibility " +
      "tree instantly, without taking a photo. Use it to confirm navigation, check page content, " +
      "find elements to tap, or verify that an action worked.\n" +
      "- **`android_screenshot` (via android_screen_understand) is last resort only** — use it " +
      "exclusively when you need pixel-level visual information the accessibility tree cannot " +
      "provide: reading a QR code, verifying an image loaded correctly, or debugging a UI with " +
      "no text labels. Do NOT use screenshots just to 'see what the screen looks like' — " +
      "android_read_screen gives you that information faster and without extra cost.\n" +
      "- **Hard limit: 4 screenshots per task.** After 4, the tool returns an error and you " +
      "must switch to android_read_screen. Plan accordingly — never take a screenshot when " +
      "reading the accessibility tree would answer your question.\n\n" +
      "When the user provides a YouTube URL (youtube.com/watch?v=… or youtu.be/…), " +
      "ALWAYS call the `get_youtube_transcript` tool first — do NOT open the YouTube app, " +
      "do NOT use android_browse to navigate to YouTube, and do NOT search YouTube manually. " +
      "get_youtube_transcript uses Gemini AI natively and is always available. " +
      "For non-YouTube URLs to a specific page, use `daemon_action` " +
      "with action `android_browse` and the full URL immediately — do not open the app " +
      "manually and search for it.";
    messages = messages.map((m, i) => {
      if (i === 0 && m.role === "system") {
        return { ...m, content: (m.content ?? "") + androidRule };
      }
      return m;
    });
  }

  const openAITools = tools.length > 0 ? tools.map(toOpenAITool) : undefined;

  // Inject the active tool set so surface-scoped tools (e.g. test_tool)
  // can verify they are not being used to escape per-surface restrictions.
  context.allowedToolNames = new Set(tools.map((t) => t.name));

  // Resolve the provider once per run based on the runtime model.
  const primaryProviderName = resolveProviderName(model);
  const provider = getProvider(primaryProviderName);

  // Build the effective fallback chain (opt-in).
  //   Priority: per-run option > global env var > single-provider (no fallback).
  // The primary provider is always first; duplicates from the tail are removed.
  // Each entry carries its own model string so cross-provider fallback always
  // sends a model ID the receiving provider understands.
  const effectiveFallbackChain: FallbackChainEntry[] | null = (() => {
    if (primaryProviderName === "chatgpt-codex-oauth") return null;

    // Resolve the tail: per-run option takes priority over the global env chain.
    // opts.providerFallbackChain is ProviderName[]; env chain is already
    // FallbackChainEntry[] (supports "provider:model" syntax).
    const globalChain = getGlobalFallbackChain();
    if (opts.providerFallbackChain) {
      // Per-run option: caller supplies provider names; resolve models from
      // providerFallbackModels overrides first, then DEFAULT_PROVIDER_MODELS.
      const tail: FallbackChainEntry[] = opts.providerFallbackChain
        .filter((n) => n !== primaryProviderName)
        .map((n) => ({
          providerName: n,
          model: opts.providerFallbackModels?.[n] ?? DEFAULT_PROVIDER_MODELS[n],
        }));
      if (tail.length === 0) return null;
      return [{ providerName: primaryProviderName, model }, ...tail];
    } else if (globalChain) {
      // Global env chain: already FallbackChainEntry[] with models resolved.
      // Replace the first entry with the actual primary (the env var primary
      // may differ from the model the caller requested this run).
      const tail = globalChain.filter((e) => e.providerName !== primaryProviderName);
      if (tail.length === 0) return null;
      return [{ providerName: primaryProviderName, model }, ...tail];
    }
    return null;
  })();

  if (effectiveFallbackChain) {
    const chainDesc = effectiveFallbackChain
      .map((e) => `${e.providerName}(${e.model})`)
      .join(" → ");
    console.log(`[${channel}/Agent] provider_fallback enabled: chain=[${chainDesc}]`);
  }

  /**
   * Run a single provider turn, using the fallback chain when enabled.
   * Falls back to the plain accumulateTurn(provider.query(...)) path when
   * no fallback chain is configured so the hot path has no extra overhead.
   */
  const runProviderQuery = async (
    queryParams: Parameters<typeof provider.query>[0],
  ) => {
    const startedAt = Date.now();
    try {
      const result = effectiveFallbackChain
        ? await queryWithFallback(effectiveFallbackChain, queryParams, `[${channel}/Agent]`)
        : await (async () => {
            console.log(`[${channel}/Agent] provider=${primaryProviderName} model=${model}`);
            const plainResult = await accumulateTurn(provider.query(queryParams));
            plainResult.providerName = primaryProviderName;
            plainResult.model = queryParams.model;
            plainResult.fallbackUsed = false;
            return plainResult;
          })();

      if (context.userId) {
        const usage = estimateModelUsage({
          messages: queryParams.messages,
          tools: queryParams.tools,
          textContent: result.textContent,
          toolCallList: result.toolCallList,
        });
        void recordModelUsage({
          userId: context.userId,
          provider: result.providerName ?? primaryProviderName,
          model: result.model ?? queryParams.model,
          source: context.channel ?? channel,
          ...usage,
          durationMs: Date.now() - startedAt,
          success: true,
          metadata: {
            finishReason: result.finishReason,
            toolCalls: result.toolCallList.length,
            fallbackUsed: Boolean(result.fallbackUsed),
          },
        });
      }

      return result;
    } catch (err) {
      if (context.userId) {
        const usage = estimateModelUsage({
          messages: queryParams.messages,
          tools: queryParams.tools,
          textContent: "",
          toolCallList: [],
        });
        void recordModelUsage({
          userId: context.userId,
          provider: primaryProviderName,
          model: queryParams.model,
          source: context.channel ?? channel,
          ...usage,
          completionTokens: 0,
          totalTokens: usage.promptTokens,
          durationMs: Date.now() - startedAt,
          success: false,
          metadata: {
            error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
          },
        });
      }
      throw err;
    }
  };

  // `messages` was already set above (with skills injected); spread into a mutable copy
  const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...messages,
  ];
  const toolCalls: AgentToolCallRecord[] = [];
  let lastFinish: string | null = null;
  let reply = "";
  // Set to true whenever a non-integration tool error occurs so callers
  // (e.g. the SSE route) know the reply may be an error-recovery response.
  let hadToolError = false;

  // ── Inline Android quality check state ───────────────────────────────────
  // Extract the last user message text once so the inline quality checker can
  // reference the original request without re-scanning conversationMessages
  // every turn. Content may be a string or an array of content parts.
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const inlineUserMessageText: string =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.content)
        ? (lastUserMsg.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join(" ")
        : "";
  // Guard: allow at most 2 inline revisions per Android session to prevent
  // infinite revision loops within the same harness run.
  let inlineRevisionCount = 0;
  // When a post-stream quality revision is triggered, the corrective model
  // turn should NOT be streamed to the caller — the prior chunks were already
  // delivered, so emitting a second streaming pass would produce duplicate /
  // overlapping text in live-edit UIs (e.g. Discord).
  let suppressNextStream = false;

  for (let turn = 0; turn < effectiveMaxTurns; turn++) {
    // ── Abort check — honour caller cancellation before each turn ───────
    if (signal?.aborted) {
      throw new DOMException("Agent run aborted by caller", "AbortError");
    }

    // ── Android heartbeat — notify user the task is still running ────────
    // When an Android-heavy session reaches turn 15 and Android tools are
    // still available, emit a lightweight progress message via the optional
    // onProgressMessage callback. This does NOT consume a model turn — it is
    // purely informational so the user knows the agent has not stalled.
    // Fires once every 5 turns after the threshold to avoid flooding.
    if (hasAndroidTools && turn >= 15 && (turn - 15) % 5 === 0 && opts.onProgressMessage) {
      opts.onProgressMessage(`Still working — on step ${turn + 1} of the plan`);
      console.log(`[${channel}/Harness] android heartbeat at turn=${turn}`);
    }

    // ── Provider query (streaming or non-streaming) ─────────────────────
    // Text chunks are buffered inside the provider and replayed via onToken
    // only after confirming this is a text-only turn (no tool calls), so
    // intermediate orchestration text never leaks into live-edit UIs.
    let msgContent: string | null = null;
    let msgToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] | undefined;

    const turnResult = await runProviderQuery({
      model,
      messages: conversationMessages,
      tools: openAITools,
      toolChoice,
      maxCompletionTokens,
      stream: !!onToken,
      signal,
    });

    lastFinish = turnResult.finishReason;
    console.log(
      `[${channel}/Agent] turn=${turn}${onToken ? " (streaming)" : ""} finish=${lastFinish} tool_calls=${turnResult.toolCallList.length}`,
    );
    msgContent = turnResult.textContent || null;
    msgToolCalls = turnResult.toolCallList.length > 0 ? turnResult.toolCallList : undefined;

    // Replay buffered text tokens only for pure text replies so the
    // caller's live-edit UI (e.g. Discord) sees progressive updates on
    // the final turn but stays quiet during tool-call turns.
    // suppressNextStream is set by the post-stream quality check when it
    // triggers a corrective turn — we must not re-stream old/corrective text
    // on top of chunks the caller already received.
    if (onToken && !msgToolCalls && turnResult.textChunks.length > 0 && !suppressNextStream) {
      for (const chunk of turnResult.textChunks) {
        onToken(chunk);
      }
    }
    suppressNextStream = false;

    // ── Post-stream quality check (streaming sessions only) ──────────────
    // The inline quality check below is guarded by !onToken so it is skipped
    // when streaming (chunks were already sent before the guard is reached).
    // This block restores quality-check coverage for streaming Android sessions
    // by running the same check here, after chunks have been fully replayed and
    // the complete reply is assembled. When a revision is needed we push a
    // corrective turn and continue the loop; the retry turn is NOT re-streamed
    // (suppressNextStream = true) so the caller only receives the final reply.
    if (
      onToken &&
      !msgToolCalls &&
      hasAndroidTools &&
      inlineRevisionCount < 2 &&
      inlineUserMessageText &&
      msgContent
    ) {
      const qc = checkResponseQuality({
        userMessage: inlineUserMessageText,
        agentReply: msgContent,
        toolsUsed: toolCalls.map((tc) => tc.name),
        androidToolsAvailable: true,
      });

      if (qc.action === "revise") {
        inlineRevisionCount++;
        console.log(
          `[${channel}/Harness] post-stream quality check → revise (pass ${inlineRevisionCount}): ${qc.reason.slice(0, 120)}`,
        );
        if (opts.onProgressMessage) {
          opts.onProgressMessage(`[Quality check] Revising response…`);
        }
        conversationMessages.push({ role: "assistant", content: msgContent });
        conversationMessages.push({
          role: "user",
          content: `[QUALITY REMINDER] ${qc.reason}`,
        });
        suppressNextStream = true;
        continue;
      }
    }

    // ── Tool-call branch ───────────────────────────────────────────────
    if (msgToolCalls && msgToolCalls.length > 0) {
      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam =
        {
          role: "assistant",
          content: msgContent,
          tool_calls: msgToolCalls,
        };
      conversationMessages.push(assistantMsg);

      const results = await Promise.all(
        msgToolCalls.map(async (tc) => {
          const start = Date.now();
          const tool = toolMap.get(tc.function.name);
          let parsedArgs: Record<string, unknown> = {};
          try {
            const raw = JSON.parse(tc.function.arguments || "{}");
            if (raw && typeof raw === "object")
              parsedArgs = raw as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }

          if (!tool) {
            const result = {
              ok: false,
              content: `Unknown tool: ${tc.function.name}`,
              label: "Unknown tool",
            };
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start,
            });
            return { tc, content: result.content };
          }

          // ── Pre-execution hook gate check ─────────────────────────────
          let effectiveArgs = parsedArgs;
          if (opts.onBeforeTool) {
            try {
              const gate = await opts.onBeforeTool(tc.function.name, parsedArgs);
              if (!gate.allowed) {
                const deniedResult = {
                  ok: false,
                  content: `[Tool blocked] ${gate.reason ?? "This action is not permitted"}`,
                  label: "Blocked",
                };
                toolCalls.push({
                  name: tc.function.name,
                  args: parsedArgs,
                  result: deniedResult,
                  durationMs: Date.now() - start,
                });
                console.log(`[${channel}/Agent] tool=${tc.function.name} BLOCKED`);
                return { tc, content: deniedResult.content };
              }
              // Apply rewritten params from hook (e.g. sanitisation, injection)
              if (gate.params) {
                effectiveArgs = gate.params;
              }
            } catch (gateErr) {
              // Fail-closed: approval gate errors block the tool, not allow it.
              // Allowing execution on gate failure would silently bypass the hook system.
              const errMsg = gateErr instanceof Error ? gateErr.message : String(gateErr);
              console.error(`[${channel}/Agent] onBeforeTool gate error for ${tc.function.name}: ${errMsg}`);
              const blockedResult = {
                ok: false,
                content: `[Tool blocked] Hook check failed (${errMsg.slice(0, 100)})`,
                label: "Gate error",
              };
              toolCalls.push({
                name: tc.function.name,
                args: parsedArgs,
                result: blockedResult,
                durationMs: Date.now() - start,
              });
              return { tc, content: blockedResult.content };
            }
          }

          try {
            const result = await tool.execute(effectiveArgs, context);
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start,
            });
            console.log(
              `[${channel}/Agent] tool=${tc.function.name} ok=${result.ok}${result.label ? ` label="${result.label}"` : ""} ${Date.now() - start}ms`,
            );
            // Classify integration auth failures from { ok: false } tool returns.
            // Many tools return { ok: false, content: "..." } rather than throwing.
            // Apply the same validator + heuristic logic used in the catch block.
            let okFalseIntegFired = false;
            if (!result.ok && opts.onIntegrationError) {
              const errorText = result.content ?? "";
              const okFalseCandidates = toolToIntegrationKey.get(tc.function.name) ?? [];
              if (okFalseCandidates.length > 0) {
                let okFalseIntegKey: string | null = null;
                // Primary: live validator (requires userId — skip in headless contexts)
                if (context.userId) {
                  try {
                    const { getUserIntegrationStatuses } = await import("../intelligence/integrationValidator");
                    const liveStatuses = await getUserIntegrationStatuses(context.userId);
                    for (const key of okFalseCandidates) {
                      if (liveStatuses[key as keyof typeof liveStatuses] === "broken") {
                        okFalseIntegKey = key;
                        break;
                      }
                    }
                  } catch { /* validator unavailable — fall through to heuristic */ }
                }
                // Heuristic fallback: works with or without userId
                if (!okFalseIntegKey) {
                  okFalseIntegKey = detectIntegrationErrorKey(tc.function.name, errorText, toolToIntegrationKey);
                }
                if (okFalseIntegKey) {
                  console.warn(`[${channel}/Agent] integration_error (ok=false): tool=${tc.function.name} integration=${okFalseIntegKey}`);
                  diagEmit({
                    userId: context.userId,
                    subsystem: "integration",
                    severity: "error",
                    message: `Integration ${okFalseIntegKey} auth failure (ok=false) from tool ${tc.function.name}: ${errorText.slice(0, 200)}`,
                    metadata: { toolName: tc.function.name, integrationKey: okFalseIntegKey, source: "tool_ok_false" },
                  }).catch(() => {});
                  opts.onIntegrationError(okFalseIntegKey, errorText);
                  okFalseIntegFired = true;
                }
              }
            }
            // Non-integration tool failure — inform caller so the UI can surface
            // a distinct error state rather than silently showing a partial reply.
            if (!result.ok && !okFalseIntegFired) {
              hadToolError = true;
              opts.onToolError?.(tc.function.name, result.content ?? "tool returned an error");
            }
            return { tc, content: result.content };
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            const result = {
              ok: false,
              content: `Tool ${tc.function.name} threw: ${detail}`,
              label: "Tool error",
              detail,
            };
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start,
            });
            console.error(
              `[${channel}/Agent] tool=${tc.function.name} threw:`,
              err,
            );

            // Check if this is an integration auth failure.
            // Primary signal: re-check the live status for all candidate integrations
            // from the validator (grounded in DB state, not error-text heuristics).
            // Multi-provider tools (send_email, fetch_emails) may depend on more than
            // one integration — we iterate all candidates and emit for the first broken.
            // Falls back to heuristic text matching for tokens that expire mid-run
            // before the validator DB row has been updated.
            let integrationKey: string | null = null;
            const candidateKeys = toolToIntegrationKey.get(tc.function.name) ?? [];
            if (candidateKeys.length > 0) {
              // Primary: live validator (requires userId — skip in headless contexts)
              if (context.userId) {
                try {
                  const { getUserIntegrationStatuses } = await import("../intelligence/integrationValidator");
                  const liveStatuses = await getUserIntegrationStatuses(context.userId);
                  for (const key of candidateKeys) {
                    if (liveStatuses[key as keyof typeof liveStatuses] === "broken") {
                      integrationKey = key;
                      break;
                    }
                  }
                } catch {
                  // Validator unavailable — fall through to heuristic
                }
              }
              // Heuristic fallback: token expired mid-run, or no userId available
              if (!integrationKey) {
                integrationKey = detectIntegrationErrorKey(tc.function.name, detail, toolToIntegrationKey);
              }
            }
            if (integrationKey) {
              console.warn(
                `[${channel}/Agent] integration_error: tool=${tc.function.name} integration=${integrationKey}`,
              );
              diagEmit({
                userId: context.userId,
                subsystem: "integration",
                severity: "error",
                message: `Integration ${integrationKey} auth failure from tool ${tc.function.name}: ${detail.slice(0, 200)}`,
                metadata: { toolName: tc.function.name, integrationKey, source: "tool_throw" },
              }).catch(() => {});
              if (opts.onIntegrationError) {
                opts.onIntegrationError(integrationKey, detail);
              }
            } else {
              diagEmit({
                userId: context.userId,
                subsystem: "agent_harness",
                severity: "warning",
                message: `Tool ${tc.function.name} threw: ${detail.slice(0, 200)}`,
                metadata: { toolName: tc.function.name, channel: context.channel ?? "unknown" },
              }).catch(() => {});
              // Non-integration throw — fire onToolError so the UI can show a
              // distinct error state instead of silently returning an empty reply.
              hadToolError = true;
              opts.onToolError?.(tc.function.name, detail);
            }

            return { tc, content: result.content };
          }
        }),
      );

      for (const { tc, content } of results) {
        conversationMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
      }
      continue; // next turn
    }

    // ── Text reply — no tool calls ─────────────────────────────────────
    reply = msgContent || "";
    // If tools failed (non-integration) and the model returned nothing, provide
    // a minimal fallback so the user never sees a blank assistant bubble.
    if (!reply && hadToolError) {
      reply = "I couldn't complete that action. Let me try a different approach.";
    }

    // ── Inline Android quality check ──────────────────────────────────
    // When Android tools are available, consult the quality checker before
    // returning the reply so that mid-task "announce then stop" patterns are
    // caught and corrected within the same harness run rather than waiting for
    // the post-run revision pass in runNamedAgent.
    // Guard: at most 2 inline revisions per Android session.
    // Skip when streaming (onToken set) — chunks have already been sent to the
    // caller so a mid-stream revision would surface the premature text and then
    // stream corrected text on top of it, producing a confusing UX.
    if (hasAndroidTools && inlineRevisionCount < 2 && inlineUserMessageText && !onToken) {
      const qc = checkResponseQuality({
        userMessage: inlineUserMessageText,
        agentReply: reply,
        // Pass the names of tools used across all prior turns so check 1b
        // (deflection) doesn't fire simply because this specific turn had no
        // tool calls (earlier turns may have used tools legitimately).
        toolsUsed: toolCalls.map((tc) => tc.name),
        androidToolsAvailable: true,
      });

      if (qc.action === "revise") {
        inlineRevisionCount++;
        console.log(
          `[${channel}/Harness] inline quality check → revise (pass ${inlineRevisionCount}): ${qc.reason.slice(0, 120)}`,
        );
        // Append the premature assistant reply and a corrective user-turn so
        // the model has full context when it retries. The corrective message
        // uses the QUALITY REMINDER prefix so the model treats it as a system
        // directive rather than a new user request.
        conversationMessages.push({ role: "assistant", content: reply });
        conversationMessages.push({
          role: "user",
          content: `[QUALITY REMINDER] ${qc.reason}`,
        });
        continue; // loop — model will attempt the action again
      }
    }

    // ── Capability-gap detection on the TRUE final reply ─────────────
    // Runs AFTER the inline quality check so we only record gaps for the
    // reply that actually reaches the caller (never for intermediate replies
    // that get corrected by the inline revision loop above).
    //
    // Skipped when the caller (e.g. runNamedAgent) handles gap detection at
    // a higher level to avoid double-recording (_skipCapabilityGapDetection).
    if (reply && context.userId && !opts._skipCapabilityGapDetection) {
      // Prefer inlineUserMessageText (captured before any quality-reminder turns
      // are appended) for Android sessions. For non-Android sessions, search
      // history but skip [QUALITY REMINDER] injections so the stored message
      // always reflects the original user request, not a system directive.
      const userMsg: string = inlineUserMessageText || (() => {
        for (let mi = conversationMessages.length - 1; mi >= 0; mi--) {
          const m = conversationMessages[mi];
          if (
            m.role === "user" &&
            typeof m.content === "string" &&
            !m.content.startsWith("[QUALITY REMINDER]")
          ) {
            return m.content;
          }
        }
        return "";
      })();

      let gapReason: string | null = null;

      // Persistent-failure detection: Android session exhausted 2 inline
      // revisions AND the final reply still triggers the quality checker.
      // This is a genuine capability gap — Jarvis tried twice and still
      // couldn't complete the task.
      if (hasAndroidTools && inlineRevisionCount >= 2 && inlineUserMessageText && !onToken) {
        const qcFinal = checkResponseQuality({
          userMessage: inlineUserMessageText,
          agentReply: reply,
          toolsUsed: toolCalls.map((tc) => tc.name),
          androidToolsAvailable: true,
        });
        if (qcFinal.action === "revise") {
          gapReason = "deflection";
          console.log(
            `[${channel}/Harness] inline revision exhausted and reply still fails quality — recording deflection gap`,
          );
        }
      }

      // Apology-phrase detection: reply contains a clear "I can't do that"
      // signal regardless of revision count or Android session status.
      if (!gapReason) {
        const lowerReply = reply.toLowerCase();
        if (APOLOGY_PHRASES.some((p) => lowerReply.includes(p))) {
          gapReason = "apology_only";
        }
      }

      if (gapReason) {
        // Capture primitives before the async boundary for closure safety.
        const capturedUserId = context.userId!;
        const capturedReply = reply;
        const capturedChannel = context.channel ?? channel;
        const capturedReason = gapReason;
        setImmediate(() => {
          import("../db").then(({ db }) =>
            import("@shared/schema").then(({ capabilityGaps }) =>
              db.insert(capabilityGaps).values({
                userId: capturedUserId,
                userMessage: userMsg.slice(0, 500),
                agentReplySnippet: capturedReply.slice(0, 300),
                detectedReason: capturedReason,
                channel: capturedChannel,
              }).catch(() => {})
            )
          ).catch(() => {});
        });
      }
    }

    return {
      reply,
      turns: turn + 1,
      toolCalls,
      finishReason: hadToolError ? "tool_error" : lastFinish,
      messages: conversationMessages,
    };
  }

  // Hit max turns. Force a final answer with tools disabled.
  console.warn(`[${channel}/Agent] hit maxTurns=${effectiveMaxTurns}, forcing final answer`);
  try {
    const finalResult = await runProviderQuery({
      model,
      messages: conversationMessages,
      tools: undefined, // no tools — force text reply
      toolChoice: "none",
      maxCompletionTokens,
      stream: !!onToken,
      signal,
    });
    reply = finalResult.textContent;
    lastFinish = finalResult.finishReason;
    // Replay buffered chunks — this is always a text-only turn (no tools).
    if (onToken) {
      for (const chunk of finalResult.textChunks) {
        onToken(chunk);
      }
    }
  } catch (err) {
    console.error(`[${channel}/Agent] final-answer call failed:`, err);
  }

  return {
    reply,
    turns: effectiveMaxTurns,
    toolCalls,
    finishReason: hadToolError ? "tool_error" : lastFinish,
    messages: conversationMessages,
  };
}
