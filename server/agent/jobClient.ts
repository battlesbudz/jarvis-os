/**
 * Thin DB client for queuing agent jobs.
 * Extracted from jobQueue.ts so workflowEngine.ts can import it
 * without creating a circular dependency.
 */
import { db } from "../db";
import * as schema from "@shared/schema";
import type { SubAgentType } from "./subagents";

export type AgentJobType = SubAgentType | "goal_decompose" | "weekly_pattern";

export interface SubmitJobInput {
  userId: string;
  agentType: AgentJobType;
  title: string;
  prompt: string;
  input?: Record<string, unknown>;
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
  console.log(
    `[JobQueue] queued job ${id} type=${input.agentType} user=${input.userId} title="${input.title.slice(0, 60)}"`,
  );
  return id;
}
