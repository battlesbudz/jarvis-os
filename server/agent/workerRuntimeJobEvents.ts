import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { withWorkerApprovalCheckpoint } from "./workerRuntime";

function jobInputOf(job: { input: unknown }): Record<string, unknown> {
  return (job.input && typeof job.input === "object" ? job.input : {}) as Record<string, unknown>;
}

export async function appendWorkerApprovalCheckpointToJob(opts: {
  jobId: string;
  gateId: string;
  toolName: string;
  reason: string;
}): Promise<void> {
  const [job] = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.id, opts.jobId))
    .limit(1);
  if (!job) return;

  const input = jobInputOf(job);
  const nextInput = withWorkerApprovalCheckpoint(input, {
    agentType: job.agentType,
    title: job.title,
    gateId: opts.gateId,
    toolName: opts.toolName,
    reason: opts.reason,
  });

  await db
    .update(schema.agentJobs)
    .set({ input: nextInput })
    .where(eq(schema.agentJobs.id, opts.jobId));
}
