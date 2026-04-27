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
 * Maps sub-agent types to appropriately-sized Anthropic models:
 *   - research / planning  → Claude Sonnet — complex reasoning + tool use
 *   - writing / email      → Claude Haiku  — quality prose, lower latency
 *
 * Orchestrator-controlled spawn tools (queue_background_job, spawn_subagent)
 * call getModelForJobType() to inject input.model at enqueue time so the job
 * queue can pass the correct model through to runSubAgent.
 *
 * submitAgentJob itself does NOT auto-inject; callers that omit input.model
 * preserve the original resolution path (getModel(userId, "research")).
 */
export const SUB_AGENT_MODEL_ROUTING: Partial<Record<AgentJobType, string>> = {
  research: "claude-sonnet-4-6",
  planning: "claude-sonnet-4-6",
  writing: "claude-haiku-4-5",
  email: "claude-haiku-4-5",
};

/**
 * Return the preferred model string for a given sub-agent job type, or
 * undefined for job types that handle their own model resolution.
 */
export function getModelForJobType(agentType: AgentJobType): string | undefined {
  return SUB_AGENT_MODEL_ROUTING[agentType];
}

export async function submitAgentJob(input: SubmitJobInput): Promise<string> {
  const inserted = await db
    .insert(schema.agentJobs)
    .values({
      userId: input.userId,
      agentType: input.agentType,
      title: input.title.slice(0, 200),
      prompt: input.prompt,
      input: input.input || {},
      status: "queued",
    })
    .returning({ id: schema.agentJobs.id });
  const id = inserted[0]?.id || "";
  const model = (input.input as Record<string, unknown> | undefined)?.model ?? "agent-default";
  console.log(
    `[JobQueue] queued job ${id} type=${input.agentType} model=${model} user=${input.userId} title="${input.title.slice(0, 60)}"`,
  );
  return id;
}
