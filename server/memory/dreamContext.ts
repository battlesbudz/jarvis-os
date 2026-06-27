import { and, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";

/**
 * Dream insights can include review-only outputs. Durable context may only read
 * plain insights plus dream memories the runtime itself auto-kept.
 */
export function approvedDreamInsightContextFilter(userId: string) {
  return and(
    eq(schema.dreamInsights.userId, userId),
    sql`(
      ${schema.dreamInsights.insightKind} = 'insight'
      OR (
        ${schema.dreamInsights.insightKind} = 'memory_candidate'
        AND ${schema.dreamInsights.reviewPayload}->'memoryReview'->>'status' = 'auto_kept'
      )
    )`,
  );
}
