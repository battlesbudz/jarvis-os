import { db } from "../db";
import { sql, inArray } from "drizzle-orm";
import { userMemories } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const EMBED_MODEL = "text-embedding-3-small";

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
}

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  tier: string;
  memory_type: string;
  relevance_score: number;
  confidence: number;
  access_count: number;
  embedding: number[] | null;
  fts_rank: number;
  extracted_at: string | null;
}

export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const res = await openai.embeddings.create({
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
      console.error("[MemoryRetrieve] embedText failed:", err);
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
    await db.execute(sql`UPDATE user_memories SET embedding = ${JSON.stringify(v)}::jsonb WHERE id = ${memoryId}`);
    return true;
  } catch (err) {
    console.error("[MemoryRetrieve] backfillEmbedding failed:", err);
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
function tierBoost(tier: string, extractedAt: string | null): number {
  if (!extractedAt) return 0;
  const ageMs = Date.now() - new Date(extractedAt).getTime();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  if (tier === "working" && ageMs < oneHour) return 0.15;
  if (tier === "short_term" && ageMs < oneDay) return 0.08;
  return 0;
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

  const queryVec = await embedText(q);

  // Pull a candidate set with FTS rank. plainto_tsquery is forgiving
  // about user-typed natural language. Limit candidates to 60 so the
  // re-rank stays cheap.
  // Excludes memories where expires_at IS NOT NULL AND expires_at < NOW().
  const rows = await db.execute<MemoryRow>(sql`
    SELECT id, content, category, tier, memory_type, relevance_score, confidence, access_count, embedding, extracted_at,
           ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${q})) AS fts_rank
    FROM user_memories
    WHERE user_id = ${userId}
      AND (expires_at IS NULL OR expires_at >= NOW())
    ORDER BY fts_rank DESC NULLS LAST, relevance_score DESC
    LIMIT 60
  `);

  const scored: RetrievedMemory[] = (rows.rows ?? []).map((r) => {
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
  const top = scored.filter((s) => s.score > 0).slice(0, limit);

  // Batch-update access_count and last_referenced_at for returned memories,
  // unless caller asked to skip (e.g. to do a filtered update after post-processing).
  if (!skipAccessUpdate) {
    batchIncrementAccessCount(top.map((m) => m.id));
  }

  return top;
}
