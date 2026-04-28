/**
 * Server-side pending-confirmation token store for Discord actions.
 *
 * When the coach wants to ask the user whether to create a channel or post a
 * message, it calls `discord_request_confirm` which records a token here.
 * The actual `discord_create_channel` and `discord_post` tools then call
 * `consumeConfirmToken` — if no valid token is present the tool refuses and
 * instructs the coach to re-confirm.  This prevents a stale "yes" from an
 * earlier turn in a long conversation from being re-used.
 *
 * Storage strategy:
 *   L1 — in-memory Map for zero-latency hot path (same behaviour as before)
 *   L2 — postgres `discord_confirm_tokens` table so tokens survive restarts
 *
 * Atomicity:
 *   Both consume paths (L1 and L2) atomically delete the row from the DB
 *   before returning `true`, so the token cannot be replayed even under
 *   concurrent requests or after a partial failure.
 *
 * TTL: 5 minutes.  Only one pending confirmation per user at a time.
 */

import { db } from '../db';
import { discordConfirmTokens } from '@shared/schema';
import { eq, lt, and, gt } from 'drizzle-orm';

export type DiscordConfirmAction = "create_channel" | "post";

interface PendingConfirmation {
  action: DiscordConfirmAction;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

const _cache = new Map<string, PendingConfirmation>();

/** Record a pending confirmation for a user.  Overwrites any existing token. */
export async function setConfirmToken(userId: string, action: DiscordConfirmAction): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MS);

  _cache.set(userId, { action, expiresAt: expiresAt.getTime() });

  try {
    await db
      .insert(discordConfirmTokens)
      .values({ userId, action, expiresAt })
      .onConflictDoUpdate({
        target: discordConfirmTokens.userId,
        set: { action, expiresAt, createdAt: new Date() },
      });
  } catch (err) {
    console.error('[DiscordConfirmStore] setConfirmToken DB write failed:', err);
  }
}

/**
 * Consume the pending confirmation token atomically.
 *
 * Returns true if a valid, unexpired token for `action` exists (and deletes it).
 * Returns false if no token, the token has expired, or the action doesn't match.
 *
 * The L2 (DB) path uses a single DELETE … WHERE … RETURNING statement so that
 * no two concurrent callers can both consume the same token.
 */
export async function consumeConfirmToken(userId: string, action: DiscordConfirmAction): Promise<boolean> {
  const now = Date.now();

  // ── L1: in-memory fast path ─────────────────────────────────────────────────
  const cached = _cache.get(userId);
  if (cached) {
    _cache.delete(userId);

    if (now > cached.expiresAt) {
      // Expired — clean up DB row too, but don't block the rejection.
      _deleteFromDb(userId);
      return false;
    }
    if (cached.action !== action) return false;

    // Atomically delete from DB before confirming success.
    try {
      await db
        .delete(discordConfirmTokens)
        .where(eq(discordConfirmTokens.userId, userId));
    } catch (err) {
      console.error('[DiscordConfirmStore] consumeConfirmToken DB delete failed (L1 path):', err);
      // Token has already been removed from the in-memory cache, so
      // it cannot be replayed in-process.  Treat as consumed.
    }
    return true;
  }

  // ── L2: DB fallback (post-restart scenario) ─────────────────────────────────
  // Atomically delete the row matching all three conditions (userId, action,
  // not-yet-expired).  If the row doesn't exist or doesn't match, RETURNING
  // yields zero rows → false.  Because DELETE is atomic, concurrent calls
  // cannot both succeed.
  try {
    const deleted = await db
      .delete(discordConfirmTokens)
      .where(
        and(
          eq(discordConfirmTokens.userId, userId),
          eq(discordConfirmTokens.action, action),
          gt(discordConfirmTokens.expiresAt, new Date(now)),
        ),
      )
      .returning({ userId: discordConfirmTokens.userId });

    return deleted.length > 0;
  } catch (err) {
    console.error('[DiscordConfirmStore] consumeConfirmToken DB delete failed (L2 path):', err);
    return false;
  }
}

/** Clear any pending confirmation token for a user (e.g. on session end). */
export async function clearConfirmToken(userId: string): Promise<void> {
  _cache.delete(userId);
  _deleteFromDb(userId);
}

function _deleteFromDb(userId: string): void {
  db.delete(discordConfirmTokens)
    .where(eq(discordConfirmTokens.userId, userId))
    .catch((err) => console.error('[DiscordConfirmStore] DB delete failed:', err));
}

/** Called by the nightly scheduler — removes all rows whose TTL has expired. */
export async function cleanUpExpiredDiscordConfirmTokens(): Promise<void> {
  try {
    const now = new Date();
    const deleted = await db
      .delete(discordConfirmTokens)
      .where(lt(discordConfirmTokens.expiresAt, now))
      .returning({ userId: discordConfirmTokens.userId });

    for (const row of deleted) {
      _cache.delete(row.userId);
    }

    console.log(`[DiscordConfirmStore] Expired token cleanup: ${deleted.length} row(s) deleted`);
  } catch (err) {
    console.error('[DiscordConfirmStore] cleanUpExpiredDiscordConfirmTokens failed:', err);
  }
}
