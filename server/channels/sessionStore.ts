/**
 * Persistent write-through session store for coach channel conversations.
 *
 * Each channel handler (Discord, Slack, WhatsApp, daemon, Telegram) uses this
 * module instead of a bare in-process Map so sdkSessionIds survive server
 * restarts.
 *
 * Architecture:
 *   - in-process Map  → zero-latency fast path within a single server lifetime
 *   - DB table        → persistence layer; loaded into the Map on first access
 *                       (lazy seed) or explicitly via seedAllSessions()
 *
 * Both reads and writes are non-blocking from the caller's perspective:
 *   - getSession()  returns synchronously from the Map on cache hit; otherwise
 *                   awaits one DB read and populates the Map for next time.
 *   - setSession()  writes to the Map immediately and to the DB fire-and-forget.
 */

import { db } from "../db";
import { coachChannelSessions } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

const cache = new Map<string, string>();

function cacheKey(userId: string, channel: string): string {
  return `${userId}:${channel}`;
}

/**
 * Read the sdkSessionId for a user/channel pair.
 * Returns undefined when no session is stored.
 */
export async function getSession(userId: string, channel: string): Promise<string | undefined> {
  const key = cacheKey(userId, channel);
  if (cache.has(key)) return cache.get(key);

  try {
    const rows = await db
      .select({ sdkSessionId: coachChannelSessions.sdkSessionId })
      .from(coachChannelSessions)
      .where(
        and(
          eq(coachChannelSessions.userId, userId),
          eq(coachChannelSessions.channel, channel),
        ),
      )
      .limit(1);
    if (rows[0]) {
      cache.set(key, rows[0].sdkSessionId);
      return rows[0].sdkSessionId;
    }
  } catch (err) {
    console.warn("[sessionStore] getSession DB read failed (non-fatal):", err);
  }
  return undefined;
}

/**
 * Persist the sdkSessionId for a user/channel pair.
 * Writes to the in-process Map synchronously; DB write is fire-and-forget.
 */
export function setSession(userId: string, channel: string, sdkSessionId: string): void {
  const key = cacheKey(userId, channel);
  cache.set(key, sdkSessionId);

  db.execute(sql`
    INSERT INTO coach_channel_sessions (user_id, channel, sdk_session_id, updated_at)
    VALUES (${userId}, ${channel}, ${sdkSessionId}, NOW())
    ON CONFLICT (user_id, channel) DO UPDATE
      SET sdk_session_id = EXCLUDED.sdk_session_id,
          updated_at     = NOW()
  `).catch((err) => {
    console.warn("[sessionStore] setSession DB write failed (non-fatal):", err);
  });
}

/**
 * Pre-warm the in-process cache from the DB on server startup so the very
 * first message after a restart still benefits from session resumption.
 * Safe to call multiple times; subsequent calls are no-ops once the cache
 * has been seeded.
 */
let seeded = false;
export async function seedAllSessions(): Promise<void> {
  if (seeded) return;
  seeded = true;
  try {
    const rows = await db
      .select({
        userId: coachChannelSessions.userId,
        channel: coachChannelSessions.channel,
        sdkSessionId: coachChannelSessions.sdkSessionId,
      })
      .from(coachChannelSessions);
    for (const row of rows) {
      cache.set(cacheKey(row.userId, row.channel), row.sdkSessionId);
    }
    if (rows.length > 0) {
      console.log(`[sessionStore] Seeded ${rows.length} coach session(s) from DB`);
    }
  } catch (err) {
    console.warn("[sessionStore] seedAllSessions failed (non-fatal):", err);
    seeded = false;
  }
}
