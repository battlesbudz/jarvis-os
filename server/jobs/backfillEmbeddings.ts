/**
 * Backfill embedding vectors for user_memories rows that have no JSONB
 * embedding, and mirror existing JSONB embeddings into pgvector when the
 * optional vector extension is available.
 *
 * Runs incrementally in batches so it does not overwhelm the DB or the
 * embeddings API.  A short inter-item delay keeps rate-limit pressure low.
 * If the embeddings endpoint is unavailable the job aborts early rather than
 * burning retries on every row.
 *
 * Progress is printed to stdout so it is visible in the diagnostics console
 * and captured by the scheduler's log stream.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { backfillEmbedding, embedText } from "../memory/retrieve";
import { syncExistingMemoryEmbeddingVectors } from "../memory/vectorStore";
import { emit } from "../diagnostics/diagnosticsService";

const BATCH_SIZE = 50;
const INTER_ITEM_DELAY_MS = 200;

interface MemoryStub {
  id: string;
  content: string;
}

let isRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check whether the embeddings endpoint is reachable by sending a minimal
 * probe.  Returns true if available, false if the proxy reports the endpoint
 * is not supported.
 */
async function isEmbeddingsAvailable(): Promise<boolean> {
  const result = await embedText("probe");
  return result !== null;
}

/**
 * Fetch up to `limit` memories that still need an embedding vector.
 * Rows are fetched oldest-first so incremental runs make steady forward
 * progress rather than rescanning the same candidates.
 */
async function fetchUnembedded(limit: number): Promise<MemoryStub[]> {
  const rows = await db.execute<{ id: string; content: string }>(sql`
    SELECT id, content
    FROM user_memories
    WHERE embedding IS NULL
      AND content IS NOT NULL
      AND content != ''
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);
  return rows.rows ?? [];
}

/**
 * Count how many memories still have no embedding (for progress reporting).
 */
async function countUnembedded(): Promise<number> {
  const result = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt FROM user_memories WHERE embedding IS NULL
  `);
  return parseInt((result.rows?.[0]?.cnt as string) ?? "0", 10);
}

/**
 * Run one full backfill pass: fetch rows in batches of BATCH_SIZE, embed each
 * one, and continue until no more unembedded rows remain or the embeddings
 * endpoint becomes unavailable.
 *
 * This function is re-entrant-safe: a second call while a pass is already
 * running returns immediately.
 */
export async function runBackfillEmbeddings(): Promise<void> {
  if (isRunning) {
    console.log("[BackfillEmbeddings] Already running — skipping this tick");
    return;
  }
  isRunning = true;

  const startedAt = Date.now();
  let totalProcessed = 0;
  let totalFailed = 0;
  let batchNumber = 0;

  try {
    const vectorSync = await syncExistingMemoryEmbeddingVectors(BATCH_SIZE);
    if (vectorSync.updated > 0) {
      console.log(`[BackfillEmbeddings] Mirrored ${vectorSync.updated} existing JSON embedding(s) into pgvector`);
    }

    const totalPending = await countUnembedded();
    if (totalPending === 0) {
      console.log("[BackfillEmbeddings] No unembedded memories — nothing to do");
      return;
    }

    console.log(`[BackfillEmbeddings] Starting pass — ${totalPending} memory row(s) need embeddings`);

    const available = await isEmbeddingsAvailable();
    if (!available) {
      console.log("[BackfillEmbeddings] Embeddings endpoint unavailable — aborting pass (will retry next scheduled run)");
      return;
    }

    while (true) {
      const batch = await fetchUnembedded(BATCH_SIZE);
      if (batch.length === 0) break;

      batchNumber++;
      console.log(`[BackfillEmbeddings] Batch ${batchNumber}: processing ${batch.length} row(s)`);

      let batchSucceeded = 0;
      let batchFailed = 0;
      for (const row of batch) {
        try {
          const ok = await backfillEmbedding(row.id, row.content);
          if (ok) {
            totalProcessed++;
            batchSucceeded++;
          } else {
            totalFailed++;
            batchFailed++;
          }
        } catch (err) {
          batchFailed++;
          totalFailed++;
          console.error(`[BackfillEmbeddings] Unexpected error embedding memory ${row.id}:`, err);
        }
        await sleep(INTER_ITEM_DELAY_MS);
      }

      const remaining = await countUnembedded();
      console.log(
        `[BackfillEmbeddings] Batch ${batchNumber} done — ` +
          `succeeded: ${batchSucceeded}, failed: ${batchFailed}, ` +
          `remaining: ${remaining}`
      );

      if (remaining === 0) break;

      if (batchSucceeded === 0) {
        console.warn(
          `[BackfillEmbeddings] No forward progress in batch ${batchNumber} ` +
            `(all ${batch.length} item(s) failed) — aborting pass to avoid spinning`
        );
        break;
      }

      const reachable = await isEmbeddingsAvailable();
      if (!reachable) {
        console.log("[BackfillEmbeddings] Embeddings endpoint became unavailable mid-pass — stopping early");
        break;
      }
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[BackfillEmbeddings] Pass complete — ` +
        `processed: ${totalProcessed}, failed: ${totalFailed}, elapsed: ${elapsedSec}s`
    );

    await emit({
      subsystem: "memory",
      severity: totalFailed > 0 ? "warning" : "info",
      message:
        `Embedding backfill complete: ${totalProcessed} embedded, ${totalFailed} failed`,
      metadata: { totalProcessed, totalFailed, elapsedSec },
    }).catch(() => {});
  } catch (err) {
    console.error("[BackfillEmbeddings] Unexpected error during pass:", err);
    await emit({
      subsystem: "memory",
      severity: "error",
      message: `Embedding backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { totalProcessed, totalFailed },
    }).catch(() => {});
  } finally {
    isRunning = false;
  }
}
