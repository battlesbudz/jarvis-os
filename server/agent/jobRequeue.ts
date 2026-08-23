import { sql } from "drizzle-orm";
import * as schema from "@shared/schema";

export function staleJobRequeueUpdate(now = new Date(), error?: string) {
  const requeuedAt = now.toISOString();
  return {
    status: "queued",
    startedAt: null,
    input: sql`${schema.agentJobs.input} || jsonb_build_object(
      'requeuedAt', ${requeuedAt},
      'requeueHistory', jsonb_path_query_array(
        (CASE
          WHEN jsonb_typeof(${schema.agentJobs.input}->'requeueHistory') = 'array'
            THEN ${schema.agentJobs.input}->'requeueHistory'
          ELSE '[]'::jsonb
        END) || jsonb_build_array(${requeuedAt}),
        '$[last - 199 to last]'
      )
    )`,
    ...(error ? { error } : {}),
  };
}
