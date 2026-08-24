import { sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { AgentJobCancellationStatus } from "./voiceRuntimeResourceCore";

export function cancellationUpdateForAgentJob(status: AgentJobCancellationStatus, now = new Date()) {
  return status === "cancelled"
    ? {
        status,
        completedAt: now,
        input: sql`${schema.agentJobs.input} || jsonb_build_object('cancelRequestedAt', ${now.toISOString()})`,
      }
    : {
        status,
        input: sql`${schema.agentJobs.input} || jsonb_build_object('cancelRequestedAt', ${now.toISOString()})`,
      };
}
