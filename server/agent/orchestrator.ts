/**
 * Claude Opus 4.6 Orchestrator Engine
 *
 * Accepts a user request, decomposes it into discrete sub-tasks via Claude Opus,
 * delegates each sub-task to the existing GPT-based runAgent harness, evaluates
 * results against acceptance criteria, retries failures with corrective context,
 * and assembles a final verified answer.
 *
 * Claude Opus is ONLY the orchestrator (decompose + verify + synthesize).
 * Sub-agents continue using the GPT harness for tool execution.
 *
 * Strict verification contract:
 * - A task is accepted only when the verifier explicitly returns { passed: true }
 * - Verifier errors / parse failures are treated as NOT passed (fail-safe)
 * - After MAX_RETRIES, the orchestration fails with a clear error message rather
 *   than silently accepting a failed result
 */

import { anthropic, ORCHESTRATOR_MAX_TOKENS } from "../lib/anthropicClient";
import { getModel } from "../lib/modelPrefs";
import { runAgent } from "./harness";
import { runNamedAgent } from "./runNamedAgent";
import { resolveSpecialist, getCrewManifest } from "./crewRouter";
import { db } from "../db";
import { orchestrationTraces } from "@shared/schema";
import type { ToolContext } from "./types";
import type { AgentTool } from "./types";
import { detectTournamentSignals } from "./tournamentRunner";

/** Default maximum retries per sub-task when not overridden by caller or env. */
const DEFAULT_MAX_RETRIES = 3;

/** Read configurable retry limit from environment (ORCHESTRATOR_MAX_RETRIES), default 3. */
function resolveMaxRetries(override?: number): number {
  if (override !== undefined && override >= 0) return override;
  const env = parseInt(process.env.ORCHESTRATOR_MAX_RETRIES ?? "", 10);
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_MAX_RETRIES;
}

export interface OrchestratorInput {
  userId: string;
  userRequest: string;
  systemContext: string;
  tools: AgentTool[];
  toolContext: ToolContext;
  maxCompletionTokens?: number;
  /**
   * Maximum number of sub-task retries before orchestration fails.
   * Defaults to ORCHESTRATOR_MAX_RETRIES env var, then 3.
   */
  maxRetries?: number;
  /** Progress callback called when each sub-task completes */
  onSubtaskComplete?: (index: number, total: number, taskLabel: string, passed: boolean) => void;
  /** Optional heartbeat callback fired before each sub-task starts (from the 2nd sub-task
   *  onwards) so callers can surface "Still working…" messages to the user without
   *  blocking the execution loop. */
  onProgressMessage?: (message: string) => void;
}

export interface OrchestratorResult {
  finalAnswer: string;
  subtaskCount: number;
  retryCount: number;
  traceId: string;
}

interface SubTask {
  id: string;
  label: string;
  instruction: string;
  acceptanceCriteria: string;
  dependsOn: string[];
  /** Optional specialist name (ATLAS, HERALD, ORACLE, SCOUT, FORGE, ECHO) */
  assignTo?: string;
}

interface SubTaskResult {
  taskId: string;
  label: string;
  result: string;
  passed: boolean;
  retries: number;
  verificationReason: string;
}

/**
 * Normalize and validate a raw parsed task object into a SubTask.
 * Fills in defaults for any missing or malformed fields.
 */
function normalizeSubTask(raw: unknown, index: number): SubTask {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    id: typeof obj.id === "string" && obj.id ? obj.id : `task-${index + 1}`,
    label: typeof obj.label === "string" && obj.label ? obj.label : `Sub-task ${index + 1}`,
    instruction: typeof obj.instruction === "string" && obj.instruction ? obj.instruction : String(raw),
    acceptanceCriteria: typeof obj.acceptanceCriteria === "string" && obj.acceptanceCriteria
      ? obj.acceptanceCriteria
      : "Provides a helpful and complete response",
    dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn.filter((d): d is string => typeof d === "string") : [],
    assignTo: typeof obj.assignTo === "string" && obj.assignTo ? obj.assignTo : undefined,
  };
}

/**
 * Parse Claude's decomposition response into structured sub-tasks.
 * Expected format is a JSON array in a ```json block.
 */
function parseSubTasks(text: string): SubTask[] {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  const raw = jsonMatch ? jsonMatch[1] : text.trim();
  try {
    const parsed = JSON.parse(raw);
    const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item, i) => normalizeSubTask(item, i));
  } catch {
    // Treat the whole response as a single fallback task if parsing fails
    return [{
      id: "task-1",
      label: "Process request",
      instruction: text,
      acceptanceCriteria: "Provides a helpful and complete response",
      dependsOn: [],
    }];
  }
}

/**
 * Ask Claude Opus to decompose the user request into sub-tasks.
 * Includes the crew manifest so PRIME can assign each sub-task to a specialist.
 */
async function decomposeRequest(
  userRequest: string,
  systemContext: string,
  orchestratorModel: string,
  userId: string,
): Promise<SubTask[]> {
  // Load crew manifest from DB (falls back to static if DB unavailable)
  let crewManifest = "";
  try {
    crewManifest = await getCrewManifest(userId);
  } catch {
    // Non-fatal — decompose without crew routing if manifest load fails
  }

  const crewSection = crewManifest
    ? `\n\n${crewManifest}\n\nInclude an optional "assignTo" field on each sub-task naming the best specialist from the crew manifest. Omit or null "assignTo" only for truly generic tasks.`
    : "";

  const response = await anthropic.messages.create({
    model: orchestratorModel,
    max_tokens: ORCHESTRATOR_MAX_TOKENS,
    system: `You are PRIME, an intelligent task orchestrator. Given a user request and context, break it into discrete, independently executable sub-tasks. Each sub-task must:
1. Have a unique id (task-1, task-2, ...)
2. Have a short label (5-8 words)
3. Have a clear instruction for a sub-agent to execute
4. Have a measurable acceptance criterion
5. List any task ids it depends on (can be empty)
6. Include an "assignTo" field naming the specialist who should handle it (from the crew manifest)${crewSection}

Return ONLY a JSON array in a \`\`\`json block. No other text.

Example:
\`\`\`json
[
  {
    "id": "task-1",
    "label": "Research meeting attendees",
    "instruction": "Search for background information on the meeting attendees",
    "acceptanceCriteria": "Returns key facts about each attendee with sources",
    "dependsOn": [],
    "assignTo": "ATLAS"
  },
  {
    "id": "task-2",
    "label": "Suggest agenda based on research",
    "instruction": "Using the research, draft a meeting agenda with time slots",
    "acceptanceCriteria": "Provides a concrete agenda with time allocations",
    "dependsOn": ["task-1"],
    "assignTo": "FORGE"
  }
]
\`\`\`

Keep sub-tasks minimal — only decompose when there are genuinely independent parallel workstreams. For simple requests, return a single task.`,
    messages: [
      {
        role: "user",
        content: `User request: ${userRequest}\n\nContext:\n${systemContext}`,
      },
    ],
  });

  const content = response.content[0];
  const text = content.type === "text" ? content.text : "";
  return parseSubTasks(text);
}

/**
 * Ask Claude Opus to verify whether a sub-task result meets its acceptance criteria.
 * Fail-safe: any error or unparseable response returns { passed: false }.
 */
async function verifyResult(
  task: SubTask,
  result: string,
  orchestratorModel: string,
  correctionContext?: string,
): Promise<{ passed: boolean; reason: string }> {
  try {
    const response = await anthropic.messages.create({
      model: orchestratorModel,
      max_tokens: 512,
      system: `You are a strict quality verifier. Evaluate whether a sub-agent's result meets the acceptance criteria. Respond with JSON only — no other text: {"passed": true/false, "reason": "brief explanation"}`,
      messages: [
        {
          role: "user",
          content: [
            `Sub-task: ${task.label}`,
            `Instruction: ${task.instruction}`,
            `Acceptance criteria: ${task.acceptanceCriteria}`,
            `Sub-agent result:\n${result}`,
            correctionContext ? `\nPrevious correction context: ${correctionContext}` : "",
          ].filter(Boolean).join("\n"),
        },
      ],
    });

    const content = response.content[0];
    const text = content.type === "text" ? content.text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Could not parse verifier response — fail-safe: treat as not passed
      return { passed: false, reason: "Verifier returned unparseable response — treating as failed" };
    }
    const parsed = JSON.parse(jsonMatch[0]) as { passed?: unknown; reason?: unknown };
    return {
      passed: parsed.passed === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "No reason provided",
    };
  } catch (err) {
    // Verifier error — fail-safe: treat as not passed
    return {
      passed: false,
      reason: `Verifier error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Ask Claude Opus to synthesize all passing sub-task results into a final answer.
 */
async function synthesizeFinalAnswer(
  userRequest: string,
  systemContext: string,
  results: SubTaskResult[],
  orchestratorModel: string,
): Promise<string> {
  const resultsSummary = results
    .map((r) => `### ${r.label}\n${r.result}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: orchestratorModel,
    max_tokens: ORCHESTRATOR_MAX_TOKENS,
    system: `You are Jarvis, an intelligent personal assistant. You have received results from multiple specialized sub-agents. Synthesize their findings into a single, coherent, helpful response addressed directly to the user. Be concise but complete. Use the system context to match the appropriate tone and format.

${systemContext}`,
    messages: [
      {
        role: "user",
        content: `Original request: ${userRequest}\n\nSub-agent results:\n${resultsSummary}`,
      },
    ],
  });

  const content = response.content[0];
  return content.type === "text" ? content.text : "I was unable to synthesize the results.";
}

/**
 * Execute a single sub-task, routing through a specialist agent when available.
 *
 * If `task.assignTo` resolves to a live crew specialist via crewRouter, the task
 * is executed inside that agent's memory namespace and permission scope via
 * runNamedAgent. Otherwise falls back to the bare GPT harness.
 */
async function executeSubTask(
  task: SubTask,
  tools: AgentTool[],
  toolContext: ToolContext,
  dependencyResults: SubTaskResult[],
  correctionContext?: string,
  maxCompletionTokens?: number,
  onProgressMessage?: (message: string) => void,
): Promise<string> {
  const depContext = dependencyResults.length > 0
    ? "\n\nContext from prior sub-tasks:\n" +
      dependencyResults.map((r) => `${r.label}: ${r.result}`).join("\n")
    : "";

  const instruction = correctionContext
    ? `${task.instruction}\n\nPrevious attempt was rejected: ${correctionContext}\nPlease try again with this feedback.${depContext}`
    : `${task.instruction}${depContext}`;

  // ── Crew routing: try to resolve a specialist agent ──────────────────────
  const userId = toolContext.userId;
  if (userId && task.assignTo) {
    try {
      const specialist = await resolveSpecialist(task.assignTo, userId);
      if (specialist) {
        console.log(`[orchestrator] routing sub-task "${task.label}" → specialist ${specialist.name} (${specialist.id})`);
        const result = await runNamedAgent({
          agentId: specialist.id,
          userId,
          userMessage: instruction,
          platform: "orchestrator",
          initiatedBy: "jarvis",
          onProgressMessage,
        });
        return result.reply || "(no result)";
      }
    } catch (err) {
      console.warn(`[orchestrator] specialist routing failed for "${task.label}", falling back to harness:`, err);
    }
  }

  // ── Fallback: bare GPT harness ─────────────────────────────────────────
  const result = await runAgent({
    model: "gpt-4o-mini",
    messages: [
      { role: "user", content: instruction },
    ],
    tools,
    context: toolContext,
    maxTurns: 4,
    maxCompletionTokens: maxCompletionTokens ?? 1500,
    onProgressMessage,
  });

  return result.reply || "(no result)";
}

/**
 * Topological sort of sub-tasks to respect dependsOn ordering.
 * Tasks with unresolvable dependencies (referencing unknown task ids) are
 * executed last with a warning, rather than silently discarding their deps.
 */
function topologicalSort(tasks: SubTask[]): SubTask[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const sorted: SubTask[] = [];

  function visit(task: SubTask, chain: Set<string>) {
    if (chain.has(task.id)) {
      console.warn(`[orchestrator] circular dependency detected on task "${task.id}" — breaking cycle`);
      return;
    }
    if (visited.has(task.id)) return;
    chain.add(task.id);
    for (const depId of task.dependsOn) {
      const dep = taskMap.get(depId);
      if (dep) {
        visit(dep, chain);
      } else {
        console.warn(`[orchestrator] task "${task.id}" depends on unknown task "${depId}" — skipping dep`);
      }
    }
    chain.delete(task.id);
    visited.add(task.id);
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task, new Set());
  }
  return sorted;
}

/**
 * Main orchestration loop.
 * Throws if any sub-task cannot be verified after all retries.
 */
// Phrases that indicate the user wants to see runners-up from a prior tournament.
const RUNNERS_UP_PATTERNS = [
  /show.*others/i, /see.*others/i, /show.*runner/i, /see.*runner/i,
  /compare.*version/i, /compare.*output/i, /other.*version/i, /other.*answer/i,
  /show.*alternatives/i, /see.*alternatives/i,
];

/**
 * Returns true if the request looks like a follow-up for tournament runners-up.
 */
function isRunnersUpRequest(text: string): boolean {
  return RUNNERS_UP_PATTERNS.some((r) => r.test(text));
}

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { userId, userRequest, systemContext, tools, toolContext, maxCompletionTokens, maxRetries: maxRetriesOverride, onSubtaskComplete, onProgressMessage } = input;
  const MAX_RETRIES = resolveMaxRetries(maxRetriesOverride);

  const traceId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  let totalRetries = 0;

  // ── Short-circuit: runners-up recall ──────────────────────────────────────
  // If the user says "show me the others", "compare versions", etc., look up
  // the most recent tournament run and return the runners-up immediately without
  // running the full orchestration pipeline.
  if (isRunnersUpRequest(userRequest)) {
    try {
      const { getTournamentRunners } = await import("./tournamentRunner");
      const { found, run } = await getTournamentRunners(userId);
      if (found && run) {
        const outputs = (run.outputs as Array<{ agentIndex: number; approach: string; body: string }>) || [];
        const scores = (run.scores as Array<{ agentIndex: number; score: number; reasoning: string }>) || [];
        const winnerId = run.winnerId;
        const runnersUp = outputs
          .filter((o) => o.approach !== winnerId)
          .map((o, idx) => {
            const score = scores.find((s) => s.agentIndex === o.agentIndex);
            return [
              `## Runner-up ${idx + 1} — ${o.approach} (score: ${score?.score ?? "n/a"}/100)`,
              score ? `> ${score.reasoning}` : "",
              "",
              o.body,
            ].filter(Boolean).join("\n");
          });
        if (runnersUp.length > 0) {
          const finalAnswer =
            `Here are the runners-up from your most recent ${run.agentType} tournament:\n\n` +
            runnersUp.join("\n\n---\n\n");
          return { finalAnswer, subtaskCount: 0, retryCount: 0, traceId };
        }
      }
    } catch {
      // Non-fatal — fall through to normal orchestration
    }
  }

  // Resolve orchestrator model from user preferences
  const orchestratorModel = await getModel(userId, "orchestrator");
  console.log(`[orchestrator] ${traceId} — model=${orchestratorModel}`);

  // Step 1: Decompose (crew manifest injected into prompt for specialist routing)
  let rawSubTasks: SubTask[];
  try {
    rawSubTasks = await decomposeRequest(userRequest, systemContext, orchestratorModel, userId);
  } catch (err) {
    console.error("[orchestrator] decomposition failed:", err);
    // Fall back to single task
    rawSubTasks = [{
      id: "task-1",
      label: "Handle request",
      instruction: userRequest,
      acceptanceCriteria: "Provides a helpful response",
      dependsOn: [],
    }];
  }

  // Sort sub-tasks topologically to honour dependsOn
  const subTasks = topologicalSort(rawSubTasks);
  console.log(`[orchestrator] ${traceId} — ${subTasks.length} sub-task(s) (sorted)`);

  // Step 2: Execute + verify each sub-task in dependency order
  const completedResults = new Map<string, SubTaskResult>();
  const failedTaskLabels: string[] = [];

  for (const task of subTasks) {
    // Gather resolved dependency results (unresolved deps already warned above)
    const depResults = task.dependsOn
      .map((depId) => completedResults.get(depId))
      .filter((r): r is SubTaskResult => r !== undefined);

    // Fire progress heartbeat before each sub-task after the first so the user
    // knows the agent is still working on a multi-step plan.
    const stepIndex = completedResults.size + 1;
    if (stepIndex > 1 && onProgressMessage) {
      onProgressMessage(`Still working — on step ${stepIndex} of ${subTasks.length}`);
    }

    let taskResult = "(no result)";
    let finalPassed = false;
    let retries = 0;
    let verificationReason = "";
    let correctionContext: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        taskResult = await executeSubTask(task, tools, toolContext, depResults, correctionContext, maxCompletionTokens, onProgressMessage);
      } catch (err) {
        taskResult = `Execution error: ${err instanceof Error ? err.message : String(err)}`;
      }

      // Strict verification — fail-safe on errors
      const verification = await verifyResult(task, taskResult, orchestratorModel, correctionContext);
      verificationReason = verification.reason;

      if (verification.passed) {
        finalPassed = true;
        break;
      }

      if (attempt < MAX_RETRIES) {
        retries++;
        totalRetries++;
        correctionContext = verification.reason;
        console.log(
          `[orchestrator] ${traceId} task "${task.label}" retry ${retries}/${MAX_RETRIES}: ${verification.reason}`,
        );
      }
      // else: fall through — finalPassed remains false
    }

    if (!finalPassed) {
      failedTaskLabels.push(task.label);
      console.error(
        `[orchestrator] ${traceId} task "${task.label}" failed after ${MAX_RETRIES} retries (${verificationReason})`,
      );
    }

    const subtaskResult: SubTaskResult = {
      taskId: task.id,
      label: task.label,
      result: taskResult,
      passed: finalPassed,
      retries,
      verificationReason,
    };

    completedResults.set(task.id, subtaskResult);
    onSubtaskComplete?.(completedResults.size, subTasks.length, task.label, finalPassed);
  }

  const allResults = Array.from(completedResults.values());

  // If any tasks failed all retries, fail the orchestration
  if (failedTaskLabels.length > 0) {
    const failMsg = `Orchestration failed: the following sub-tasks could not be verified after ${MAX_RETRIES} retries: ${failedTaskLabels.join(", ")}`;
    console.error(`[orchestrator] ${traceId} — ${failMsg}`);

    // Persist partial trace before throwing
    await db.insert(orchestrationTraces).values({
      userId,
      traceId,
      userRequest,
      subtasks: subTasks as unknown as Record<string, unknown>[],
      results: allResults as unknown as Record<string, unknown>[],
      finalAnswer: failMsg,
      totalRetries,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }).catch((e) => console.error("[orchestrator] trace persist (partial) failed:", e));

    throw new Error(failMsg);
  }

  // Step 3: Synthesize final answer via Claude (always — no single-task bypass)
  let finalAnswer: string;
  try {
    finalAnswer = await synthesizeFinalAnswer(userRequest, systemContext, allResults, orchestratorModel);
  } catch (err) {
    console.error("[orchestrator] synthesis failed:", err);
    finalAnswer = allResults.map((r) => r.result).join("\n\n");
  }

  // Step 4: Persist trace
  try {
    await db.insert(orchestrationTraces).values({
      userId,
      traceId,
      userRequest,
      subtasks: subTasks as unknown as Record<string, unknown>[],
      results: allResults as unknown as Record<string, unknown>[],
      finalAnswer,
      totalRetries,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    console.error("[orchestrator] trace persist failed (non-fatal):", err);
  }

  // ── Proactive tournament offer ────────────────────────────────────────────
  // When the original request shows high-stakes signals (important emails,
  // strategy docs, legal/financial analysis) AND tournament mode was not
  // already used, offer it as a follow-up option.
  if (detectTournamentSignals(userRequest)) {
    finalAnswer =
      '_Tip: I can run this as a tournament across 3 independent agents for a higher-quality result — just say "run as tournament" if you\'d like that._\n\n' +
      finalAnswer;
  }

  return {
    finalAnswer,
    subtaskCount: subTasks.length,
    retryCount: totalRetries,
    traceId,
  };
}

// ── Agent-type-specific quality criteria ─────────────────────────────────────

const JOB_QUALITY_CRITERIA: Record<string, string> = {
  research:
    "Does the output contain concrete findings, cited sources, and directly address the research question? " +
    "A ## Sources section with real URLs is required.",
  writing:
    "Does the document match the requested format and length, and cover the topic described in the prompt?",
  planning:
    "Does the plan decompose the goal into actionable, sequenced steps?",
  email:
    "Does the email address the named recipient and stated purpose, and is it complete enough to send?",
  custom_agent:
    "Does the output satisfy the instructions in the original prompt?",
  self_heal:
    "Does this code change logically address the stated problem? Or does it merely compile without fixing the root cause?",
  build_feature:
    "Does the code change implement the step's acceptance criteria? " +
    "Does TypeScript type-check pass (exit code 0)? Is the implementation clean, minimal, and follows existing Jarvis patterns? " +
    "Does the worker output indicate the change was applied to disk via apply_code_change?",
};

/**
 * Verify a background job's output quality using Claude Opus.
 *
 * Exported so jobQueue.ts and selfHealTool.ts can call it without reimplementing
 * the Anthropic call.
 *
 * Return contract:
 *   passed: true  — Opus judged the output acceptable
 *   passed: false — Opus rejected the output (retry or flag for review)
 *   passed: null  — Verifier could not be reached (timeout / Anthropic error) —
 *                   FAIL-OPEN: caller must not retry and must treat the result as
 *                   unknown, delivering the output with verificationPassed = null.
 */
export async function verifyJobOutput(opts: {
  agentType: string;
  originalPrompt: string;
  result: string;
  orchestratorModel: string;
  correctionContext?: string;
}): Promise<{ passed: boolean | null; reason: string }> {
  const VERIFY_TIMEOUT_MS = 8000;

  const criteria =
    JOB_QUALITY_CRITERIA[opts.agentType] ?? JOB_QUALITY_CRITERIA.custom_agent;

  try {
    const verifyPromise = anthropic.messages.create({
      model: opts.orchestratorModel,
      max_tokens: 512,
      system:
        `You are a strict quality verifier for background agent jobs. ` +
        `Evaluate whether the agent's output meets the quality bar for its type. ` +
        `Respond with JSON only — no other text: {"passed": true/false, "reason": "brief explanation"}`,
      messages: [
        {
          role: "user",
          content: [
            `Agent type: ${opts.agentType}`,
            `Quality criterion: ${criteria}`,
            `Original prompt: ${opts.originalPrompt}`,
            opts.correctionContext ? `Previous rejection reason: ${opts.correctionContext}` : "",
            `Agent output:\n${opts.result}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("verify_timeout")), VERIFY_TIMEOUT_MS),
    );

    const response = await Promise.race([verifyPromise, timeoutPromise]);
    const content = response.content[0];
    const text = content.type === "text" ? content.text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Unparseable response — treat as unknown (fail-open)
      return { passed: null, reason: "verify_unparseable" };
    }
    const parsed = JSON.parse(jsonMatch[0]) as { passed?: unknown; reason?: unknown };
    return {
      passed: parsed.passed === true ? true : parsed.passed === false ? false : null,
      reason: typeof parsed.reason === "string" ? parsed.reason : "No reason provided",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Timeout or Anthropic error: fail-open — caller delivers as-is with null status
    return { passed: null, reason: msg === "verify_timeout" ? "verify_timeout" : `verify_error: ${msg}` };
  }
}
