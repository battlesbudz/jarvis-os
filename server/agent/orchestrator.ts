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
import { db } from "../db";
import { orchestrationTraces } from "@shared/schema";
import type { ToolContext } from "./types";
import type { AgentTool } from "./types";

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
 */
async function decomposeRequest(
  userRequest: string,
  systemContext: string,
  orchestratorModel: string,
): Promise<SubTask[]> {
  const response = await anthropic.messages.create({
    model: orchestratorModel,
    max_tokens: ORCHESTRATOR_MAX_TOKENS,
    system: `You are an intelligent task orchestrator. Given a user request and context, break it into discrete, independently executable sub-tasks. Each sub-task must:
1. Have a unique id (task-1, task-2, ...)
2. Have a short label (5-8 words)
3. Have a clear instruction for a sub-agent to execute
4. Have a measurable acceptance criterion
5. List any task ids it depends on (can be empty)

Return ONLY a JSON array in a \`\`\`json block. No other text.

Example:
\`\`\`json
[
  {
    "id": "task-1",
    "label": "Check calendar for tomorrow",
    "instruction": "Look up the user's calendar events for tomorrow and summarize them",
    "acceptanceCriteria": "Lists at least the count of events and the first event time if any exist",
    "dependsOn": []
  },
  {
    "id": "task-2",
    "label": "Suggest morning plan",
    "instruction": "Based on the calendar results, suggest an optimized morning routine",
    "acceptanceCriteria": "Provides a concrete schedule with time slots",
    "dependsOn": ["task-1"]
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
 * Execute a single sub-task via the GPT harness.
 */
async function executeSubTask(
  task: SubTask,
  tools: AgentTool[],
  toolContext: ToolContext,
  dependencyResults: SubTaskResult[],
  correctionContext?: string,
  maxCompletionTokens?: number,
): Promise<string> {
  const depContext = dependencyResults.length > 0
    ? "\n\nContext from prior sub-tasks:\n" +
      dependencyResults.map((r) => `${r.label}: ${r.result}`).join("\n")
    : "";

  const instruction = correctionContext
    ? `${task.instruction}\n\nPrevious attempt was rejected: ${correctionContext}\nPlease try again with this feedback.${depContext}`
    : `${task.instruction}${depContext}`;

  const result = await runAgent({
    model: "gpt-5-mini",
    messages: [
      { role: "user", content: instruction },
    ],
    tools,
    context: toolContext,
    maxTurns: 4,
    maxCompletionTokens: maxCompletionTokens ?? 1500,
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
export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { userId, userRequest, systemContext, tools, toolContext, maxCompletionTokens, maxRetries: maxRetriesOverride, onSubtaskComplete } = input;
  const MAX_RETRIES = resolveMaxRetries(maxRetriesOverride);

  const traceId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  let totalRetries = 0;

  // Resolve orchestrator model from user preferences
  const orchestratorModel = await getModel(userId, "orchestrator");
  console.log(`[orchestrator] ${traceId} — model=${orchestratorModel}`);

  // Step 1: Decompose
  let rawSubTasks: SubTask[];
  try {
    rawSubTasks = await decomposeRequest(userRequest, systemContext, orchestratorModel);
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

    let taskResult = "(no result)";
    let finalPassed = false;
    let retries = 0;
    let verificationReason = "";
    let correctionContext: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        taskResult = await executeSubTask(task, tools, toolContext, depResults, correctionContext, maxCompletionTokens);
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

  return {
    finalAnswer,
    subtaskCount: subTasks.length,
    retryCount: totalRetries,
    traceId,
  };
}
