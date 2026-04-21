/**
 * Phase 4 — hybrid memory retrieval.
 *
 * Combines Postgres full-text search (primary recall) with cached
 * OpenAI embeddings (semantic re-rank) and the per-row relevance
 * score, then returns the top N memories most likely to be useful
 * for the current user query. Used by SOUL builder and by inline
 * coach prompts that want focused context instead of dumping every
 * memory into the system message.
 *
 * Inspired by OpenClaw's memory retrieval pass (MIT, © 2025 Peter
 * Steinberger). pgvector is intentionally avoided — embeddings are
 * stored as jsonb arrays so the layer works on a stock Postgres.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
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
  relevanceScore: number;
  confidence: number;
  score: number;
}

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  relevance_score: number;
  confidence: number;
  embedding: number[] | null;
  fts_rank: number;
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
  } catch (err) {
    console.error("[MemoryRetrieve] embedText failed:", err);
    return null;
  }
}

export async function backfillEmbedding(memoryId: string, content: string): Promise<void> {
  const v = await embedText(content);
  if (!v) return;
  try {
    await db.execute(sql`UPDATE user_memories SET embedding = ${JSON.stringify(v)}::jsonb WHERE id = ${memoryId}`);
  } catch (err) {
    console.error("[MemoryRetrieve] backfillEmbedding failed:", err);
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
 * Retrieve top-N memories for a user, ranked by:
 *   0.4 * fts_rank + 0.4 * embedding_cosine + 0.2 * (relevance/100)
 * Falls back gracefully if embedding generation fails.
 */
export async function retrieveRelevantMemories(
  userId: string,
  query: string,
  limit = 12,
): Promise<RetrievedMemory[]> {
  const q = query.trim();
  if (!q) return [];

  const queryVec = await embedText(q);

  // Pull a candidate set with FTS rank. plainto_tsquery is forgiving
  // about user-typed natural language. Limit candidates to 60 so the
  // re-rank stays cheap.
  const rows = await db.execute<MemoryRow>(sql`
    SELECT id, content, category, relevance_score, confidence, embedding,
           ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${q})) AS fts_rank
    FROM user_memories
    WHERE user_id = ${userId}
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
    const score = 0.4 * ftsRank + 0.4 * semantic + 0.2 * rel;
    return {
      id: r.id,
      content: r.content,
      category: r.category,
      relevanceScore: Number(r.relevance_score) || 0,
      confidence: Number(r.confidence) || 0,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit);
}
