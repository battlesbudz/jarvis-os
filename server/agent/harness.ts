
import OpenAI from "openai";
import type { AgentTool, AgentToolCallRecord, ToolContext } from "./types";
import type { ActivationPlan } from "./activationPlanner";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
  ) => Promise<{ allowed: boolean; reason?: string }>;
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
}

export interface AgentRunResult {
  reply: string;
  turns: number;
  toolCalls: AgentToolCallRecord[];
  finishReason: string | null;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
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
 * Run a single turn using the OpenAI streaming API.
 * Accumulates tool-call deltas across chunks so the caller can execute tools
 * after the stream completes.
 *
 * Text deltas are buffered and NOT forwarded to onToken during the stream.
 * The caller inspects the result: if toolCallList is empty (text-only reply)
 * it replays the buffer via onToken. This prevents intermediate tool-call
 * content from leaking into live-edit UIs (e.g. Discord placeholder edits).
 */
async function runStreamingTurn(params: {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  toolChoice: "auto" | "required" | "none";
  maxCompletionTokens: number;
}): Promise<{
  textContent: string;
  textChunks: string[];
  toolCallList: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  finishReason: string | null;
}> {
  const stream = await openai.chat.completions.create({
    model: params.model,
    messages: params.messages,
    tools: params.openAITools,
    tool_choice: params.openAITools ? params.toolChoice : undefined,
    max_completion_tokens: params.maxCompletionTokens,
    stream: true,
  });

  let textContent = "";
  const textChunks: string[] = [];
  // Accumulate tool-call arguments across chunks keyed by index
  const toolCallAccum = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const fr = chunk.choices[0]?.finish_reason;
    if (fr) finishReason = fr;

    if (delta?.content) {
      textContent += delta.content;
      textChunks.push(delta.content); // buffered — caller decides when to emit
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallAccum.has(idx)) {
          toolCallAccum.set(idx, { id: "", name: "", args: "" });
        }
        const acc = toolCallAccum.get(idx)!;
        if (tc.id) acc.id += tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
      }
    }
  }

  // Reconstruct OpenAI-compatible tool_calls array from accumulated deltas
  const toolCallList: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
    Array.from(toolCallAccum.entries())
      .sort(([a], [b]) => a - b)
      .map(([, acc]) => ({
        id: acc.id,
        type: "function" as const,
        function: { name: acc.name, arguments: acc.args },
      }));

  if (!textContent && toolCallList.length === 0) {
    console.warn(`[harness] runStreamingTurn: stream completed with empty textContent and no tool calls (finishReason=${finishReason})`);
  }

  return { textContent, textChunks, toolCallList, finishReason };
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

  const { getModel } = await import("../lib/modelPrefs");
  const model = modelOpt ?? (await getModel(context.userId, "chat"));

  const channel = context.channel || "Agent";

  // ── Inject user skills into system prompt ──────────────────────────────────
  // Load active skill files for this user and append their instructions to the
  // first system message so the agent follows learnt behaviour patterns.
  let messages = opts.messages;
  if (context.userId) {
    try {
      const { loadUserSkills } = await import("../intelligence/skillWriter");
      const skills = await loadUserSkills(context.userId);
      if (skills.length > 0) {
        const skillBlock = skills
          .map((s) => `### Skill: ${s.name}\n${s.instructions}`)
          .join("\n\n");
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

    // ── Inject operator skill packs + Ego instruction overrides ───────────────
    // Load versioned instruction packs published by the Jarvis team and any
    // per-user overrides written by the Ego self-correction loop. Packs are
    // resolved at session start (not mid-session) for stability.
    // Falls back silently on any error so existing behaviour is unchanged.
    try {
      const { loadPackInstructionsForUser } = await import("../intelligence/behaviorStore");
      const packs = await loadPackInstructionsForUser(context.userId);
      if (packs.length > 0) {
        const packBlock = packs
          .map((p) => `### Pack: ${p.name} (v${p.version})\n${p.merged}`)
          .join("\n\n");
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

      // send_email and fetch_emails require at least one operational email provider.
      // "Operational" = healthy or expiring_soon (token still works).
      // "Non-operational" = broken OR unconfigured — treat both as unavailable
      // for fallback decisions so {google: broken, outlook: unconfigured} → excluded.
      const googleOperational = statuses.google === "healthy" || statuses.google === "expiring_soon";
      const outlookOperational = statuses.outlook === "healthy" || statuses.outlook === "expiring_soon";
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
  const openAITools = tools.length > 0 ? tools.map(toOpenAITool) : undefined;

  // Inject the active tool set so surface-scoped tools (e.g. test_tool)
  // can verify they are not being used to escape per-surface restrictions.
  context.allowedToolNames = new Set(tools.map((t) => t.name));

  // `messages` was already set above (with skills injected); spread into a mutable copy
  const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...messages,
  ];
  const toolCalls: AgentToolCallRecord[] = [];
  let lastFinish: string | null = null;
  let reply = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    // ── Non-streaming path (default, tool-call turns) ───────────────────
    let msgContent: string | null = null;
    let msgToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined;

    if (!onToken) {
      // Original non-streaming behaviour — unchanged for all existing callers.
      const completion = await openai.chat.completions.create({
        model,
        messages: conversationMessages,
        tools: openAITools,
        tool_choice: openAITools ? toolChoice : undefined,
        max_completion_tokens: maxCompletionTokens,
      });

      const choice = completion.choices[0];
      lastFinish = choice?.finish_reason || null;
      const msg = choice?.message;
      console.log(
        `[${channel}/Agent] turn=${turn} finish=${lastFinish} tool_calls=${msg?.tool_calls?.length || 0}`,
      );
      if (!msg) break;
      msgContent = msg.content ?? null;
      msgToolCalls = msg.tool_calls ?? undefined;
    } else {
      // ── Streaming path ─────────────────────────────────────────────────
      // All turns run streaming so tool-call deltas can be accumulated.
      // Text chunks are buffered inside runStreamingTurn and are only
      // forwarded to onToken AFTER we confirm this is a text-only turn
      // (no tool calls). This prevents partial tool-orchestration text
      // from leaking into live-edit UIs such as Discord placeholder edits.
      const streamResult = await runStreamingTurn({
        model,
        messages: conversationMessages,
        openAITools,
        toolChoice,
        maxCompletionTokens,
      });

      lastFinish = streamResult.finishReason;
      console.log(
        `[${channel}/Agent] turn=${turn} (streaming) finish=${lastFinish} tool_calls=${streamResult.toolCallList.length}`,
      );
      msgContent = streamResult.textContent || null;
      msgToolCalls =
        streamResult.toolCallList.length > 0
          ? streamResult.toolCallList
          : undefined;

      // Replay buffered text tokens only for pure text replies so the
      // caller's live-edit UI (e.g. Discord) sees progressive updates on
      // the final turn but stays quiet during tool-call turns.
      if (!msgToolCalls && streamResult.textChunks.length > 0) {
        for (const chunk of streamResult.textChunks) {
          onToken(chunk);
        }
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

          // ── Pre-execution approval gate check ────────────────────────
          if (opts.onBeforeTool) {
            try {
              const gate = await opts.onBeforeTool(tc.function.name, parsedArgs);
              if (!gate.allowed) {
                const deniedResult = {
                  ok: false,
                  content: `Tool execution blocked: ${gate.reason ?? "user approval required"}`,
                  label: "Approval required",
                };
                toolCalls.push({
                  name: tc.function.name,
                  args: parsedArgs,
                  result: deniedResult,
                  durationMs: Date.now() - start,
                });
                console.log(`[${channel}/Agent] tool=${tc.function.name} BLOCKED (approval required)`);
                return { tc, content: deniedResult.content };
              }
            } catch (gateErr) {
              console.warn(`[${channel}/Agent] onBeforeTool check failed for ${tc.function.name}:`, gateErr);
              // On gate check error, allow execution (fail-open for non-critical tools)
            }
          }

          try {
            const result = await tool.execute(parsedArgs, context);
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start,
            });
            console.log(
              `[${channel}/Agent] tool=${tc.function.name} ok=${result.ok}${result.label ? ` label="${result.label}"` : ""} ${Date.now() - start}ms`,
            );
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
            diagEmit({
              userId: context.userId,
              subsystem: "agent_harness",
              severity: "warning",
              message: `Tool ${tc.function.name} threw: ${detail.slice(0, 200)}`,
              metadata: { toolName: tc.function.name, channel: context.channel ?? "unknown" },
            }).catch(() => {});
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
    return { reply, turns: turn + 1, toolCalls, finishReason: lastFinish, messages: conversationMessages };
  }

  // Hit max turns. Force a final answer with tools disabled.
  console.warn(`[${channel}/Agent] hit maxTurns=${maxTurns}, forcing final answer`);
  try {
    if (onToken) {
      const streamResult = await runStreamingTurn({
        model,
        messages: conversationMessages,
        openAITools: undefined, // no tools — force text reply
        toolChoice: "none",
        maxCompletionTokens,
      });
      reply = streamResult.textContent;
      lastFinish = streamResult.finishReason;
      // Replay buffered chunks — this is always a text-only turn (no tools).
      for (const chunk of streamResult.textChunks) {
        onToken(chunk);
      }
    } else {
      const final = await openai.chat.completions.create({
        model,
        messages: conversationMessages,
        max_completion_tokens: maxCompletionTokens,
      });
      reply = final.choices[0]?.message?.content || "";
      lastFinish = final.choices[0]?.finish_reason || lastFinish;
    }
  } catch (err) {
    console.error(`[${channel}/Agent] final-answer call failed:`, err);
  }

  return { reply, turns: maxTurns, toolCalls, finishReason: lastFinish, messages: conversationMessages };
}
