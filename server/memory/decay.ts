import { db } from "../db";
import { eq, sql, and } from "drizzle-orm";
import * as schema from "@shared/schema";

const DECAY_STEP = 5;
const DECAY_FLOOR = 10;
const STALE_AFTER_REF_DAYS = 7;
const STALE_AFTER_EXTRACT_DAYS = 14;

let lastDecayDayKey = "";

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export interface DecayResult {
  decremented: number;
  deleted: number;
}

export async function runDailyDecay(): Promise<DecayResult> {
  const result: DecayResult = { decremented: 0, deleted: 0 };
  try {
    const dec = await db.execute<{ id: string }>(sql`
      UPDATE user_memories
      SET relevance_score = GREATEST(0, relevance_score - CASE WHEN confidence >= 90 THEN ${sql.raw(String(Math.max(1, Math.floor(DECAY_STEP / 3))))} ELSE ${sql.raw(String(DECAY_STEP))} END)
      WHERE (
        (last_referenced_at IS NOT NULL AND last_referenced_at < NOW() - INTERVAL '${sql.raw(String(STALE_AFTER_REF_DAYS))} days')
        OR (last_referenced_at IS NULL AND extracted_at < NOW() - INTERVAL '${sql.raw(String(STALE_AFTER_EXTRACT_DAYS))} days')
      )
      RETURNING id
    `);
    result.decremented = dec.rows?.length || 0;

    // Only delete rows that are BOTH below the decay floor AND demonstrably
    // stale by the same predicate as the decrement step. This protects
    // recently-extracted or recently-referenced rows that happen to have
    // a low score for unrelated reasons.
    const del = await db.execute<{ id: string }>(sql`
      DELETE FROM user_memories
      WHERE relevance_score < ${DECAY_FLOOR}
        AND (
          (last_referenced_at IS NOT NULL AND last_referenced_at < NOW() - INTERVAL '${sql.raw(String(STALE_AFTER_REF_DAYS))} days')
          OR (last_referenced_at IS NULL AND extracted_at < NOW() - INTERVAL '${sql.raw(String(STALE_AFTER_EXTRACT_DAYS))} days')
        )
      RETURNING id
    `);
    result.deleted = del.rows?.length || 0;

    if (result.decremented > 0 || result.deleted > 0) {
      console.log(`[MemoryDecay] decremented=${result.decremented} deleted=${result.deleted}`);
    }
  } catch (err) {
    console.error("[MemoryDecay] failed:", err);
  }
  return result;
}

/**
 * Idempotent guard. The heartbeat ticks every ~5 min; we only want to
 * actually run decay once per UTC day across the whole process.
 */
export async function maybeRunDailyDecay(): Promise<DecayResult | null> {
  const key = utcDayKey(new Date());
  if (key === lastDecayDayKey) return null;
  lastDecayDayKey = key;
  return runDailyDecay();
}

/** Bump relevance for memories that proved useful (e.g. referenced in a reply). */
export async function reinforceMemories(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db
      .update(schema.userMemories)
      .set({
        relevanceScore: sql`LEAST(100, ${schema.userMemories.relevanceScore} + 5)`,
        lastReferencedAt: new Date(),
      })
      .where(and(eq(schema.userMemories.userId, userId), sql`${schema.userMemories.id} = ANY(${ids})`));
  } catch (err) {
    console.error("[MemoryDecay] reinforce failed:", err);
  }
}
