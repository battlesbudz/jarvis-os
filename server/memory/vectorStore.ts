import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { userMemories } from "@shared/schema";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export const APPROVED_MEMORY_REVIEW_STATUSES = ["active", "kept", "edited"] as const;

export type MemoryVectorRow = {
  id: string;
  content: string;
  category: string;
  tier: string | null;
  memory_type: string | null;
  relevance_score: number | string | null;
  confidence: number | string | null;
  access_count: number | string | null;
  embedding: number[] | null;
  fts_rank: number | string | null;
  extracted_at: string | Date | null;
  vector_distance?: number | string | null;
};

export type MemoryVectorSearchResult =
  | { status: "disabled"; rows: [] }
  | { status: "ok"; rows: MemoryVectorRow[] }
  | { status: "unavailable"; rows: []; error: unknown };

type EnvLike = Record<string, string | undefined>;

export function isMemoryVectorRetrievalEnabled(env: EnvLike = process.env): boolean {
  return TRUE_VALUES.has(String(env.JARVIS_MEMORY_VECTOR_RETRIEVAL ?? "").toLowerCase());
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }).join(",")}]`;
}

export function isPgvectorUnavailableError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "");
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
  const normalized = message.toLowerCase();
  return (
    code === "42703" ||
    code === "42704" ||
    code === "42883" ||
    normalized.includes("embedding_vector") ||
    normalized.includes("type \"vector\" does not exist") ||
    normalized.includes("operator does not exist") ||
    normalized.includes("pgvector")
  );
}

export async function isPgvectorAvailable(): Promise<boolean> {
  try {
    const result = await db.execute<{ available: boolean }>(sql`
      SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS available
    `);
    return Boolean(result.rows?.[0]?.available);
  } catch (error) {
    if (!isPgvectorUnavailableError(error)) {
      console.warn("[MemoryVectorStore] pgvector capability probe failed:", error);
    }
    return false;
  }
}

export async function upsertMemoryEmbedding(
  memoryId: string,
  embedding: number[],
): Promise<{ wroteJsonb: boolean; wroteVector: boolean }> {
  try {
    await db
      .update(userMemories)
      .set({
        embedding,
        embeddingVector: embedding,
      })
      .where(eq(userMemories.id, memoryId));
    return { wroteJsonb: true, wroteVector: true };
  } catch (error) {
    console.warn("[MemoryVectorStore] embeddingVector write unavailable; storing JSON embedding only:", error);
    await db
      .update(userMemories)
      .set({ embedding })
      .where(eq(userMemories.id, memoryId));
    return { wroteJsonb: true, wroteVector: false };
  }
}

export async function syncExistingMemoryEmbeddingVectors(
  limit = 250,
): Promise<{ updated: number; unavailable: boolean; error?: unknown }> {
  const boundedLimit = Math.max(1, Math.min(limit, 1000));
  try {
    const result = await db.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT id
        FROM user_memories
        WHERE embedding_vector IS NULL
          AND embedding IS NOT NULL
          AND jsonb_typeof(embedding) = 'array'
          AND jsonb_array_length(embedding) = 1536
        ORDER BY extracted_at ASC
        LIMIT ${boundedLimit}
      )
      UPDATE user_memories AS memories
      SET embedding_vector = memories.embedding::text::vector(1536)
      FROM candidates
      WHERE memories.id = candidates.id
      RETURNING memories.id
    `);
    return { updated: result.rows?.length ?? 0, unavailable: false };
  } catch (error) {
    if (!isPgvectorUnavailableError(error)) {
      console.warn("[MemoryVectorStore] JSONB-to-pgvector sync failed:", error);
    }
    return { updated: 0, unavailable: true, error };
  }
}

export async function searchMemoryVectors(input: {
  userId: string;
  query: string;
  queryEmbedding: number[] | null;
  limit: number;
}): Promise<MemoryVectorSearchResult> {
  if (!input.queryEmbedding || !isMemoryVectorRetrievalEnabled()) {
    return { status: "disabled", rows: [] };
  }

  const topK = Math.max(1, Math.min(input.limit, 50));
  const candidateLimit = Math.min(topK * 5, 100);
  const literal = vectorLiteral(input.queryEmbedding);

  try {
    const result = await db.execute(sql`
      SELECT
        ${userMemories.id} AS id,
        ${userMemories.content} AS content,
        ${userMemories.category} AS category,
        ${userMemories.tier} AS tier,
        ${userMemories.memoryType} AS memory_type,
        ${userMemories.relevanceScore} AS relevance_score,
        ${userMemories.confidence} AS confidence,
        ${userMemories.accessCount} AS access_count,
        ${userMemories.embedding} AS embedding,
        ${userMemories.extractedAt} AS extracted_at,
        ts_rank(to_tsvector('english', ${userMemories.content}), plainto_tsquery('english', ${input.query})) AS fts_rank,
        ${userMemories.embeddingVector} <=> ${literal}::vector AS vector_distance
      FROM ${userMemories}
      WHERE ${userMemories.userId} = ${input.userId}
        AND (${userMemories.expiresAt} IS NULL OR ${userMemories.expiresAt} >= NOW())
        AND ${userMemories.pendingReview} = FALSE
        AND ${userMemories.reviewStatus} IN ('active', 'kept', 'edited')
        AND ${userMemories.embeddingVector} IS NOT NULL
      ORDER BY ${userMemories.embeddingVector} <=> ${literal}::vector ASC,
        fts_rank DESC NULLS LAST,
        ${userMemories.relevanceScore} DESC
      LIMIT ${candidateLimit}
    `);
    return { status: "ok", rows: (result.rows ?? []) as MemoryVectorRow[] };
  } catch (error) {
    return { status: "unavailable", rows: [], error };
  }
}
