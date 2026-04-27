/**
 * Atomic deduplication guard for proactive / scheduled message sends.
 *
 * Shared by telegramRoutes.ts (proactive scheduler) and heartbeat.ts
 * so both use the identical INSERT … ON CONFLICT DO NOTHING primitive.
 */
import { db } from "../db";
import * as schema from "@shared/schema";

/**
 * Atomically claim a proactive send slot.
 *
 * Tries to INSERT a row into proactive_schedule_log with ON CONFLICT DO NOTHING.
 * Returns `true` if this call won the race (new row inserted — safe to send),
 * or `false` if the row already existed (already sent by another instance or
 * an earlier restart — skip this send).
 *
 * This prevents the TOCTOU race where two rapid server restarts both read
 * "not yet sent" before either write, causing the message to be delivered
 * twice. The unique index on (userId, messageType, sentDate) acts as the
 * database-level hard stop.
 */
export async function claimAndMark(
  userId: string,
  messageType: string,
  dateKey: string,
): Promise<boolean> {
  try {
    const rows = await db
      .insert(schema.proactiveScheduleLog)
      .values({ userId, messageType, sentDate: dateKey })
      .onConflictDoNothing()
      .returning({ id: schema.proactiveScheduleLog.id });
    return rows.length > 0;
  } catch {
    // Any unexpected error (e.g. DB outage) → treat conservatively as "already sent"
    // so we don't spam the user in a degraded state.
    return false;
  }
}
