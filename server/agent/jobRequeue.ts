import { sql } from "drizzle-orm";
import * as schema from "@shared/schema";

export function staleJobRequeueUpdate(now = new Date(), error?: string) {
  return {
    status: "queued",
    startedAt: null,
    input: sql`${schema.agentJobs.input} || jsonb_build_object('requeuedAt', ${now.toISOString()})`,
    ...(error ? { error } : {}),
  };
}
