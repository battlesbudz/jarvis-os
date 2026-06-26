import { db } from "../db";
import { sql, inArray } from "drizzle-orm";
import { userMemories } from "@shared/schema";
import OpenAI from "openai";
import {
  getProviderEnvValue,
  isDirectOpenAIDisabled,
  isRouterPlaceholderOpenAIKey,
} from "../agent/providers/env";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import type { QueryBrainResult } from "../brain/types";
import {
  searchMemoryVectors,
  upsertMemoryEmbedding,
  type MemoryVectorRow,
} from "./vectorStore";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMENSIONS = 1536;

export interface RetrievedMemory {
  id: string;
  content: string;
  category: string;
  tier: string;
  memoryType: string;
  relevanceScore: number;
  confidence: number;
  accessCount: number;
  score: number;
  source?: "canonical" | "gbrain";
  sourceId?: string;
  sourceRefs?: QueryBrainResult["chunks"][number]["citations"];
}

type MemoryRow = MemoryVectorRow;

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isLocalEmbeddingFallbackEnabled(): boolean {
  return envFlagEnabled(process.env.JARVIS_ENABLE_LOCAL_EMBEDDING_FALLBACK);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildLocalEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBED_DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]{1,}/g)
    ?.slice(0, 512) ?? [];
  const features = tokens.length > 0 ? tokens : [text.toLowerCase().slice(0, 64) || "empty"];

  for (let i = 0; i < features.length; i++) {
    const token = features[i];
    const tokenHash = hashString(token);
    const tokenIndex = tokenHash % EMBED_DIMENSIONS;
    vector[tokenIndex] += (tokenHash & 1) === 0 ? 1 : -1;

    const next = features[i + 1];
    if (next) {
      const bigramHash = hashString(`${token} ${next}`);
      const bigramIndex = bigramHash % EMBED_DIMENSIONS;
      vector[bigramIndex] += (bigramHash & 1) === 0 ? 0.5 : -0.5;
    }
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

function getEmbeddingOpenAIClient(): OpenAI | null {
  if (envFlagEnabled(process.env.JARVIS_DISABLE_OPENAI_EMBEDDINGS)) return null;
  if (isDirectOpenAIDisabled() && !envFlagEnabled(process.env.JARVIS_ENABLE_OPENAI_EMBEDDINGS)) {
    return null;
  }

  const apiKey = getProviderEnvValue(
    "JARVIS_EMBEDDINGS_OPENAI_API_KEY",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
    "OPENAI_API_KEY",
  );
  if (!apiKey || isRouterPlaceholderOpenAIKey(apiKey)) return null;

  return new OpenAI({
    apiKey,
    baseURL: getProviderEnvValue("JARVIS_EMBEDDINGS_OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_BASE_URL"),
  });
}

export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const embeddingClient = getEmbeddingOpenAIClient();
  if (!embeddingClient) {
    return isLocalEmbeddingFallbackEnabled() ? buildLocalEmbedding(trimmed) : null;
  }
  try {
    const res = await embeddingClient.embeddings.create({
      model: EMBED_MODEL,
      input: trimmed.slice(0, 8000),
    });
    const v = res.data[0]?.embedding;
    return Array.isArray(v) ? v : null;
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err);
    const isEndpointUnsupported =
      message.includes("INVALID_ENDPOINT") ||
      (status === 400 && message.toLowerCase().includes("embeddings"));
    if (isEndpointUnsupported) {
      console.debug("[MemoryRetrieve] embedText unavailable (embeddings endpoint not supported by proxy):", message);
    } else {
      console.warn("[MemoryRetrieve] embedText failed (optional enrichment):", message);
    }
    if (isLocalEmbeddingFallbackEnabled()) {
      console.warn("[MemoryRetrieve] using deterministic local embedding fallback");
      return buildLocalEmbedding(trimmed);
    }
    return null;
  }
}

/**
 * Generate and persist an embedding vector for the given memory row.
 * Returns true if the embedding was written, false if it was skipped
 * (endpoint unavailable) or if the DB write failed.
 */
export async function backfillEmbedding(memoryId: string, content: string): Promise<boolean> {
  const v = await embedText(content);
  if (!v) return false;
  try {
    await upsertMemoryEmbedding(memoryId, v);
    return true;
  } catch (err) {
    console.warn("[MemoryRetrieve] backfillEmbedding failed (optional enrichment):", err);
    return false;
  }
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Compute a tier-recency boost based on memory tier and how recently it was extracted.
 * - working tier extracted within last hour → +0.15
 * - short_term tier extracted within last 24h → +0.08
 */
function tierBoost(tier: string, extractedAt: string | Date | null): number {
  if (!extractedAt) return 0;
  const ageMs = Date.now() - new Date(extractedAt).getTime();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  if (tier === "working" && ageMs < oneHour) return 0.15;
  if (tier === "short_term" && ageMs < oneDay) return 0.08;
  return 0;
}

function clampRelevanceScore(score: number): number {
  return Math.max(0, Math.min(100, Number(score) || 0));
}

export function mapBrainChunksToRetrievedMemories(chunks: QueryBrainResult["chunks"]): RetrievedMemory[] {
  return chunks.map((chunk, index) => {
    const canonicalMemoryId = chunk.citations.find((citation) => citation.kind === "user_memory")?.id;
    const brainChunkId = `${chunk.pageSlug}:${index}`;

    return {
      id: canonicalMemoryId ?? brainChunkId,
      content: chunk.content,
      category: "fact",
      tier: "long_term",
      memoryType: "semantic",
      relevanceScore: clampRelevanceScore(chunk.score),
      confidence: 80,
      accessCount: 0,
      score: chunk.score,
      source: "gbrain",
      sourceId: brainChunkId,
      sourceRefs: chunk.citations,
    };
  });
}

/**
 * Batch-increment access_count + last_referenced_at for a set of memory IDs.
 * Fire-and-forget (errors are logged but not re-thrown).
 */
export function batchIncrementAccessCount(ids: string[]): void {
  if (ids.length === 0) return;
  db
    .update(userMemories)
    .set({
      accessCount: sql`access_count + 1`,
      lastReferencedAt: sql`NOW()`,
    })
    .where(inArray(userMemories.id, ids))
    .catch((err) => console.error("[MemoryRetrieve] access_count update failed:", err));
}

export function applyAccessUpdateForRetrievedMemories(
  memories: Pick<RetrievedMemory, "id">[],
  skipAccessUpdate: boolean,
  increment: (ids: string[]) => void = batchIncrementAccessCount,
): void {
  if (skipAccessUpdate) return;
  increment(memories.map((memory) => memory.id));
}

export function rankMemoryRowsForRetrieval(
  rows: MemoryRow[],
  queryVec: number[] | null,
  limit: number,
): RetrievedMemory[] {
  const scored: RetrievedMemory[] = (rows ?? []).map((r) => {
    const ftsRank = Math.min(1, Number(r.fts_rank) || 0);
    const rel = Math.max(0, Math.min(100, Number(r.relevance_score) || 0)) / 100;
    let semantic = 0;
    if (queryVec && Array.isArray(r.embedding) && r.embedding.length > 0) {
      semantic = Math.max(0, Math.min(1, (cosine(queryVec, r.embedding) + 1) / 2));
    }
    const boost = tierBoost(r.tier || "long_term", r.extracted_at);
    // access_count boost: log-scaled so frequently-recalled memories surface higher.
    // log2(1 + count) / 10 gives 0 for untouched, ~0.03 at 1, ~0.10 at 10, ~0.15 at 30
    const accessBoost = Math.min(0.15, Math.log2(1 + Math.max(0, Number(r.access_count) || 0)) / 10);
    const score = 0.4 * ftsRank + 0.4 * semantic + 0.2 * rel + boost + accessBoost;
    return {
      id: r.id,
      content: r.content,
      category: r.category,
      tier: r.tier || "long_term",
      memoryType: r.memory_type || "semantic",
      relevanceScore: Number(r.relevance_score) || 0,
      confidence: Number(r.confidence) || 0,
      accessCount: Number(r.access_count) || 0,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit);
}

export async function retrieveCanonicalMemoriesWithQueryVector(
  userId: string,
  query: string,
  queryVec: number[] | null,
  limit = 12,
  skipAccessUpdate = false,
): Promise<RetrievedMemory[]> {
  const q = query.trim();
  if (!q) return [];

  let vectorRows: MemoryRow[] = [];
  const vectorSearch = await searchMemoryVectors({
    userId,
    query: q,
    queryEmbedding: queryVec,
    limit,
  });
  if (vectorSearch.status === "ok" && vectorSearch.rows.length > 0) {
    vectorRows = vectorSearch.rows;
  } else if (vectorSearch.status === "unavailable") {
    console.warn("[MemoryRetrieve] canonical vector retrieval unavailable; falling back to FTS/JSONB retrieval:", vectorSearch.error);
  }

  // Pull a candidate set with FTS rank. plainto_tsquery is forgiving
  // about user-typed natural language. Limit candidates to 60 so the
  // re-rank stays cheap.
  // Excludes memories where expires_at IS NOT NULL AND expires_at < NOW().
  let rows: { rows: MemoryRow[] };
  try {
    const rawRows = await db.execute(sql`
      SELECT id, content, category, tier, memory_type, relevance_score, confidence, access_count, embedding, extracted_at,
             ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${q})) AS fts_rank
      FROM user_memories
      WHERE user_id = ${userId}
        AND (expires_at IS NULL OR expires_at >= NOW())
        AND (pending_review = FALSE OR pending_review IS NULL)
        AND review_status IN ('active', 'kept', 'edited')
      ORDER BY fts_rank DESC NULLS LAST, relevance_score DESC
      LIMIT 60
    `);
    rows = { rows: (rawRows.rows ?? []) as MemoryRow[] };
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Memory retrieval completed successfully",
      metadata: { recovery: true, operation: "retrieveRelevantMemories" },
    }).catch(() => {});
  } catch (dbErr) {
    const detail = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error("[MemoryRetrieve] DB query failed:", dbErr);
    if (vectorRows.length > 0) {
      const top = rankMemoryRowsForRetrieval(vectorRows, queryVec, limit);
      applyAccessUpdateForRetrievedMemories(top, skipAccessUpdate);
      return top;
    }
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Memory retrieval DB query failed: ${detail.slice(0, 300)}`,
      metadata: { operation: "retrieveRelevantMemories" },
    }).catch(() => {});
    return [];
  }

  const candidates = new Map<string, MemoryRow>();
  for (const row of rows.rows ?? []) candidates.set(row.id, row);
  for (const row of vectorRows) {
    const existing = candidates.get(row.id);
    candidates.set(row.id, existing ? { ...existing, ...row } : row);
  }
  const top = rankMemoryRowsForRetrieval([...candidates.values()], queryVec, limit);

  if (vectorRows.length > 0) {
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Memory vector retrieval completed successfully",
      metadata: { recovery: true, operation: "retrieveRelevantMemories", mode: "pgvector+fts" },
    }).catch(() => {});
  }

  // Batch-update access_count and last_referenced_at for returned memories,
  // unless caller asked to skip (e.g. to do a filtered update after post-processing).
  applyAccessUpdateForRetrievedMemories(top, skipAccessUpdate);

  return top;
}

export async function retrieveCanonicalRelevantMemories(
  userId: string,
  query: string,
  limit = 12,
  skipAccessUpdate = false,
): Promise<RetrievedMemory[]> {
  const q = query.trim();
  if (!q) return [];

  const queryVec = await embedText(q);
  return retrieveCanonicalMemoriesWithQueryVector(userId, q, queryVec, limit, skipAccessUpdate);
}

/**
 * Retrieve top-N memories for a user, ranked by:
 *   0.4 * fts_rank + 0.4 * embedding_cosine + 0.2 * (relevance/100) + tier_boost + access_boost
 * Filters out memories whose expires_at < NOW().
 * Increments access_count and last_referenced_at for all returned memories
 * unless skipAccessUpdate is true (use when caller will do its own filtered update).
 * Falls back gracefully if embedding generation fails.
 */
export async function retrieveRelevantMemories(
  userId: string,
  query: string,
  limit = 12,
  skipAccessUpdate = false,
): Promise<RetrievedMemory[]> {
  const q = query.trim();
  if (!q) return [];

  if (process.env.JARVIS_BRAIN_RETRIEVAL === "1") {
    try {
      const { queryBrain } = await import("../brain/adapter");
      const derived = await queryBrain({
        userId,
        actorId: "memory-retrieve",
        query: q,
        topK: limit,
        approvalFilter: "approved_only",
      });

      const mapped = mapBrainChunksToRetrievedMemories(derived.chunks);
      if (mapped.length > 0) {
        applyAccessUpdateForRetrievedMemories(mapped, skipAccessUpdate);
        return mapped;
      }
    } catch (err) {
      console.warn("[MemoryRetrieve] derived brain retrieval failed; falling back to legacy retrieval:", err);
    }
  }

  return retrieveCanonicalRelevantMemories(userId, q, limit, skipAccessUpdate);
}
