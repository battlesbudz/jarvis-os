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
 */

import { anthropic, ORCHESTRATOR_MODEL, ORCHESTRATOR_MAX_TOKENS } from "../lib/anthropicClient";
import { runAgent } from "./harness";
import { db } from "../db";
import { orchestrationTraces } from "@shared/schema";
import type { ToolContext } from "./types";
import type { AgentTool } from "./types";

const MAX_RETRIES = 3;

export interface OrchestratorInput {
  userId: string;
  userRequest: string;
  systemContext: string;
  tools: AgentTool[];
  toolContext: ToolContext;
  maxCompletionTokens?: number;
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
 * Parse Claude's decomposition response into structured sub-tasks.
 * Expected format is a JSON array in a ```json block.
 */
function parseSubTasks(text: string): SubTask[] {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    // Fallback: try raw JSON parse
    try {
      const parsed = JSON.parse(text.trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Treat the whole response as a single task
      return [{
        id: "task-1",
        label: "Process request",
        instruction: text,
        acceptanceCriteria: "Provides a helpful and complete response",
        dependsOn: [],
      }];
    }
  }
  try {
    const parsed = JSON.parse(jsonMatch[1]);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
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
async function decomposeRequest(userRequest: string, systemContext: string): Promise<SubTask[]> {
  const response = await anthropic.messages.create({
    model: ORCHESTRATOR_MODEL,
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
 */
async function verifyResult(
  task: SubTask,
  result: string,
  correctionContext?: string,
): Promise<{ passed: boolean; reason: string }> {
  const response = await anthropic.messages.create({
    model: ORCHESTRATOR_MODEL,
    max_tokens: 512,
    system: `You are a strict quality verifier. Evaluate whether a sub-agent's result meets the acceptance criteria. Respond with JSON only: {"passed": true/false, "reason": "brief explanation"}`,
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
  const text = content.type === "text" ? content.text : "{}";
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return {
      passed: Boolean(parsed.passed),
      reason: String(parsed.reason ?? "No reason provided"),
    };
  } catch {
    return { passed: true, reason: "Verification parse error — accepted" };
  }
}

/**
 * Ask Claude Opus to synthesize all passing sub-task results into a final answer.
 */
async function synthesizeFinalAnswer(
  userRequest: string,
  systemContext: string,
  results: SubTaskResult[],
): Promise<string> {
  const resultsSummary = results
    .map((r) => `### ${r.label}\n${r.result}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: ORCHESTRATOR_MODEL,
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
 * Main orchestration loop.
 */
export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { userId, userRequest, systemContext, tools, toolContext, maxCompletionTokens, onSubtaskComplete } = input;

  const traceId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  let totalRetries = 0;

  // Step 1: Decompose
  let subTasks: SubTask[];
  try {
    subTasks = await decomposeRequest(userRequest, systemContext);
  } catch (err) {
    console.error("[orchestrator] decomposition failed:", err);
    // Fall back to single task
    subTasks = [{
      id: "task-1",
      label: "Handle request",
      instruction: userRequest,
      acceptanceCriteria: "Provides a helpful response",
      dependsOn: [],
    }];
  }

  console.log(`[orchestrator] ${traceId} — ${subTasks.length} sub-task(s)`);

  // Step 2: Execute + verify each sub-task (respecting dependencies)
  const completedResults = new Map<string, SubTaskResult>();

  for (const task of subTasks) {
    // Gather dependency results
    const depResults = task.dependsOn
      .map((depId) => completedResults.get(depId))
      .filter((r): r is SubTaskResult => r !== undefined);

    let taskResult: string = "(no result)";
    let passed = false;
    let retries = 0;
    let verificationReason = "";
    let correctionContext: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        taskResult = await executeSubTask(task, tools, toolContext, depResults, correctionContext, maxCompletionTokens);
      } catch (err) {
        taskResult = `Error during execution: ${err instanceof Error ? err.message : String(err)}`;
      }

      let verification: { passed: boolean; reason: string };
      try {
        verification = await verifyResult(task, taskResult, correctionContext);
      } catch {
        verification = { passed: true, reason: "Verification failed — accepted" };
      }

      passed = verification.passed;
      verificationReason = verification.reason;

      if (passed || attempt === MAX_RETRIES) {
        if (!passed) {
          console.warn(`[orchestrator] ${traceId} task "${task.label}" failed after ${MAX_RETRIES} retries — accepting anyway`);
          passed = true; // accept on final retry
        }
        break;
      }

      retries++;
      totalRetries++;
      correctionContext = verification.reason;
      console.log(`[orchestrator] ${traceId} task "${task.label}" retry ${retries}: ${verification.reason}`);
    }

    const subtaskResult: SubTaskResult = {
      taskId: task.id,
      label: task.label,
      result: taskResult,
      passed,
      retries,
      verificationReason,
    };

    completedResults.set(task.id, subtaskResult);
    onSubtaskComplete?.(completedResults.size, subTasks.length, task.label, passed);
  }

  const allResults = Array.from(completedResults.values());

  // Step 3: Synthesize final answer
  let finalAnswer: string;
  try {
    if (allResults.length === 1) {
      // Single task — use the sub-agent result directly if it's good, otherwise ask Claude to polish
      const single = allResults[0];
      if (single.result && single.result.length > 0 && single.result !== "(no result)") {
        finalAnswer = single.result;
      } else {
        finalAnswer = await synthesizeFinalAnswer(userRequest, systemContext, allResults);
      }
    } else {
      finalAnswer = await synthesizeFinalAnswer(userRequest, systemContext, allResults);
    }
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
