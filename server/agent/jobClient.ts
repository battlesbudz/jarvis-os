/**
 * Thin DB client for queuing agent jobs.
 * Extracted from jobQueue.ts so workflowEngine.ts can import it
 * without creating a circular dependency.
 */
import { db } from "../db";
import * as schema from "@shared/schema";
import type { SubAgentType } from "./subagents";

export type AgentJobType = SubAgentType | "goal_decompose" | "weekly_pattern" | "named_agent_task";

export interface SubmitJobInput {
  userId: string;
  agentType: AgentJobType;
  title: string;
  prompt: string;
  input?: Record<string, unknown>;
}

/**
 * Per-sub-agent-type model routing table.
 *
 * Maps sub-agent types to the appropriate OpenAI GPT mini model for that workload:
 *   - research / planning  → gpt-4.1-mini — stronger reasoning for complex tasks
 *   - writing / email      → gpt-4o-mini  — fast, efficient for prose + drafts
 *
 * Claude Opus 4.6 is reserved exclusively for the top-level orchestrator brain.
 * All sub-agents (background jobs, named agents, workflow steps) use GPT minis.
 *
 * `submitAgentJob` automatically injects the routed model into `input.model`
 * for every job whose type appears in this table, unless the caller has
 * already supplied an explicit `input.model` override. This means ALL call
 * sites (workflow engine, goal decomposer, tools, routes, etc.) benefit
 * without any per-call changes.
 *
 * To change which model a task type uses, edit this table — nowhere else.
 */
export const SUB_AGENT_MODEL_ROUTING: Partial<Record<AgentJobType, string>> = {
  research: "gpt-4.1-mini",
  planning: "gpt-4.1-mini",
  writing: "gpt-4o-mini",
  email: "gpt-4o-mini",
};

/**
 * Return the preferred model string for a given sub-agent job type, or
 * undefined for job types that handle their own model resolution
 * (e.g. weekly_pattern, goal_decompose, named_agent_task).
 */
export function getModelForJobType(agentType: AgentJobType): string | undefined {
  return SUB_AGENT_MODEL_ROUTING[agentType];
}

export async function submitAgentJob(input: SubmitJobInput): Promise<string> {
  // Auto-inject the routed model when the caller has not provided one.
  // This ensures every enqueue path (tools, workflow engine, routes, etc.)
  // gets complexity-appropriate model selection without per-call changes.
  const callerInput = (input.input || {}) as Record<string, unknown>;
  const routedModel = getModelForJobType(input.agentType);
  const mergedInput: Record<string, unknown> =
    callerInput.model !== undefined || routedModel === undefined
      ? callerInput
      : { ...callerInput, model: routedModel };

  const inserted = await db
    .insert(schema.agentJobs)
    .values({
      userId: input.userId,
      agentType: input.agentType,
      title: input.title.slice(0, 200),
      prompt: input.prompt,
      input: mergedInput,
      status: "queued",
    })
    .returning({ id: schema.agentJobs.id });
  const id = inserted[0]?.id || "";
  const model = mergedInput.model ?? "agent-default";
  console.log(
    `[JobQueue] queued job ${id} type=${input.agentType} model=${model} user=${input.userId} title="${input.title.slice(0, 60)}"`,
  );
  return id;
}
