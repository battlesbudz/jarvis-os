import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { isMemoryVectorRetrievalEnabled, isPgvectorAvailable } from "./vectorStore";

export type MemoryEmbeddingHealthStatus = "healthy" | "degraded" | "down" | "unknown";

export type MemoryEmbeddingHealthAlert = {
  severity: "warning" | "critical";
  message: string;
  metric: string;
};

export type MemoryEmbeddingHealthInput = {
  vectorRetrievalEnabled: boolean;
  pgvectorAvailable: boolean | null;
  approvedMemoryCount: number;
  jsonEmbeddingCount: number;
  vectorEmbeddingCount: number;
  recentVectorErrors15m: number;
};

export type MemoryEmbeddingHealthReport = MemoryEmbeddingHealthInput & {
  status: MemoryEmbeddingHealthStatus;
  generatedAt: string;
  jsonCoveragePct: number;
  vectorCoveragePct: number;
  missingJsonEmbeddingCount: number;
  missingVectorEmbeddingCount: number;
  alerts: MemoryEmbeddingHealthAlert[];
};

export type MemoryEmbeddingRowCounts = Pick<
  MemoryEmbeddingHealthInput,
  "approvedMemoryCount" | "jsonEmbeddingCount" | "vectorEmbeddingCount"
>;

export type MemoryEmbeddingHealthDeps = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  countEmbeddingRows?: () => Promise<MemoryEmbeddingRowCounts>;
  isPgvectorAvailable?: () => Promise<boolean>;
  countRecentVectorErrors?: () => Promise<number>;
};

const VECTOR_COVERAGE_WARNING_THRESHOLD = 95;
const JSON_COVERAGE_WARNING_THRESHOLD = 95;
const VECTOR_ERROR_DOWN_THRESHOLD = 3;

function percent(part: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((Math.max(0, part) / total) * 100);
}

function boundedCount(value: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));
}

export function classifyMemoryEmbeddingHealth(
  input: MemoryEmbeddingHealthInput,
  now: Date = new Date(),
): MemoryEmbeddingHealthReport {
  const approvedMemoryCount = boundedCount(input.approvedMemoryCount);
  const jsonEmbeddingCount = Math.min(approvedMemoryCount, boundedCount(input.jsonEmbeddingCount));
  const vectorEmbeddingCount = Math.min(approvedMemoryCount, boundedCount(input.vectorEmbeddingCount));
  const recentVectorErrors15m = boundedCount(input.recentVectorErrors15m);
  const missingJsonEmbeddingCount = Math.max(0, approvedMemoryCount - jsonEmbeddingCount);
  const missingVectorEmbeddingCount = Math.max(0, approvedMemoryCount - vectorEmbeddingCount);
  const jsonCoveragePct = percent(jsonEmbeddingCount, approvedMemoryCount);
  const vectorCoveragePct = percent(vectorEmbeddingCount, approvedMemoryCount);
  const alerts: MemoryEmbeddingHealthAlert[] = [];

  if (input.vectorRetrievalEnabled && input.pgvectorAvailable === false) {
    alerts.push({
      severity: "critical",
      metric: "pgvectorAvailable",
      message: "pgvector is unavailable while canonical memory vector retrieval is enabled.",
    });
  }

  if (recentVectorErrors15m >= VECTOR_ERROR_DOWN_THRESHOLD) {
    alerts.push({
      severity: "critical",
      metric: "recentVectorErrors15m",
      message: `Memory vector-path error count is ${recentVectorErrors15m} in the last 15 minutes.`,
    });
  } else if (recentVectorErrors15m > 0) {
    alerts.push({
      severity: "warning",
      metric: "recentVectorErrors15m",
      message: `Memory vector-path error count is ${recentVectorErrors15m} in the last 15 minutes.`,
    });
  }

  if (approvedMemoryCount > 0 && vectorCoveragePct < VECTOR_COVERAGE_WARNING_THRESHOLD) {
    alerts.push({
      severity: "warning",
      metric: "vectorCoveragePct",
      message: `Canonical memory vector coverage is ${vectorCoveragePct}% (${missingVectorEmbeddingCount} approved memories missing pgvector embeddings).`,
    });
  }

  if (approvedMemoryCount > 0 && jsonCoveragePct < JSON_COVERAGE_WARNING_THRESHOLD) {
    alerts.push({
      severity: "warning",
      metric: "jsonCoveragePct",
      message: `Canonical memory JSON embedding coverage is ${jsonCoveragePct}% (${missingJsonEmbeddingCount} approved memories missing embeddings).`,
    });
  }

  let status: MemoryEmbeddingHealthStatus = "healthy";
  if (input.pgvectorAvailable === null) status = "unknown";
  if (alerts.some((alert) => alert.severity === "warning")) status = "degraded";
  if (alerts.some((alert) => alert.severity === "critical")) status = "down";

  return {
    vectorRetrievalEnabled: input.vectorRetrievalEnabled,
    pgvectorAvailable: input.pgvectorAvailable,
    approvedMemoryCount,
    jsonEmbeddingCount,
    vectorEmbeddingCount,
    recentVectorErrors15m,
    status,
    generatedAt: now.toISOString(),
    jsonCoveragePct,
    vectorCoveragePct,
    missingJsonEmbeddingCount,
    missingVectorEmbeddingCount,
    alerts,
  };
}

async function countEmbeddingRows(): Promise<MemoryEmbeddingRowCounts> {
  const result = await db.execute<{
    approved_memory_count: number | string;
    json_embedding_count: number | string;
    vector_embedding_count: number | string;
  }>(sql`
    SELECT
      COUNT(*)::int AS approved_memory_count,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS json_embedding_count,
      COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL)::int AS vector_embedding_count
    FROM user_memories
    WHERE (expires_at IS NULL OR expires_at >= NOW())
      AND pending_review = FALSE
      AND review_status IN ('active', 'kept', 'edited')
  `);
  const row = result.rows?.[0];
  return {
    approvedMemoryCount: Number(row?.approved_memory_count ?? 0),
    jsonEmbeddingCount: Number(row?.json_embedding_count ?? 0),
    vectorEmbeddingCount: Number(row?.vector_embedding_count ?? 0),
  };
}

async function countRecentVectorErrors(): Promise<number> {
  const windowStart = new Date(Date.now() - 15 * 60 * 1000);
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.diagnosticEvents)
    .where(and(
      eq(schema.diagnosticEvents.subsystem, "memory"),
      eq(schema.diagnosticEvents.resolved, false),
      gte(schema.diagnosticEvents.createdAt, windowStart),
      sql`${schema.diagnosticEvents.severity} IN ('error', 'critical')`,
      sql`(${schema.diagnosticEvents.metadata}->>'type') IS DISTINCT FROM 'pattern_detected'`,
      sql`(${schema.diagnosticEvents.metadata}->>'operation') IN ('retrieveRelevantMemories', 'searchMemoryVectors', 'upsertMemoryEmbedding', 'syncExistingMemoryEmbeddingVectors', 'memoryEmbeddingHealth')`,
    ));
  return Number(result[0]?.count ?? 0);
}

export async function getMemoryEmbeddingHealth(
  deps: MemoryEmbeddingHealthDeps = {},
): Promise<MemoryEmbeddingHealthReport> {
  const now = deps.now?.() ?? new Date();
  const vectorRetrievalEnabled = isMemoryVectorRetrievalEnabled(deps.env ?? process.env);

  try {
    const [counts, pgvectorAvailable, recentVectorErrors15m] = await Promise.all([
      (deps.countEmbeddingRows ?? countEmbeddingRows)(),
      (deps.isPgvectorAvailable ?? isPgvectorAvailable)(),
      (deps.countRecentVectorErrors ?? countRecentVectorErrors)(),
    ]);

    return classifyMemoryEmbeddingHealth(
      {
        vectorRetrievalEnabled,
        pgvectorAvailable,
        approvedMemoryCount: counts.approvedMemoryCount,
        jsonEmbeddingCount: counts.jsonEmbeddingCount,
        vectorEmbeddingCount: counts.vectorEmbeddingCount,
        recentVectorErrors15m,
      },
      now,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = classifyMemoryEmbeddingHealth(
      {
        vectorRetrievalEnabled,
        pgvectorAvailable: null,
        approvedMemoryCount: 0,
        jsonEmbeddingCount: 0,
        vectorEmbeddingCount: 0,
        recentVectorErrors15m: 0,
      },
      now,
    );
    return {
      ...report,
      status: "unknown",
      alerts: [{
        severity: "warning",
        metric: "memoryEmbeddingHealth",
        message: `Memory embedding health check failed: ${message}`,
      }],
    };
  }
}
