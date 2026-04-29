/**
 * MCP API Key management for the Jarvis MCP server endpoint.
 *
 * Key format: jarvis_<40 hex chars>
 * Only the bcrypt hash is stored. The raw key is returned once on creation.
 *
 * Rate limits (DB-backed sliding windows — survive server restarts):
 *   - Authenticated requests: 120 req/min per key ID (DB row UUID).
 *   - Pre-auth attempts: 10 attempts/min per 16-char prefix bucket to
 *     prevent bcrypt CPU amplification on the unauthenticated endpoint.
 */

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { mcpApiKeys } from "@shared/schema";
import { eq } from "drizzle-orm";

// 16-char prefix: "jarvis_" (7) + 9 random hex chars — ~68 billion unique buckets.
// This makes prefix-bucketed lookups effectively one-per-key while keeping the
// prefix short enough to show in UI.
const KEY_PREFIX_LEN = 16;
const BCRYPT_ROUNDS = 10;

// Authenticated-request rate limit
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Pre-auth attempt rate limit (prevents bcrypt CPU amplification)
const PRE_AUTH_MAX = 10;
const PRE_AUTH_WINDOW_MS = 60_000;

// Periodic cleanup: delete expired rows from DB every 5 minutes to prevent unbounded growth.
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;
const _mcpEvictTimer = setInterval(async () => {
  const now = Date.now();
  await db.execute(sql`
    DELETE FROM mcp_rate_limits
    WHERE
      (bucket LIKE 'auth:%'     AND ${now} - window_start >= ${RATE_LIMIT_WINDOW_MS})
      OR
      (bucket LIKE 'pre-auth:%' AND ${now} - window_start >= ${PRE_AUTH_WINDOW_MS})
  `).catch(() => {});
}, EVICTION_INTERVAL_MS);
if (typeof (_mcpEvictTimer as unknown as NodeJS.Timeout).unref === "function") (_mcpEvictTimer as unknown as NodeJS.Timeout).unref();

// ── Key generation ─────────────────────────────────────────────────────────────

/**
 * Generate a new MCP API key for the given user.
 * Revokes any existing keys first (one key per user).
 * Returns the raw key — only chance to capture it.
 */
export async function generateMcpApiKey(userId: string): Promise<{ rawKey: string; prefix: string }> {
  const rawKey = `jarvis_${crypto.randomBytes(20).toString("hex")}`;
  const prefix = rawKey.slice(0, KEY_PREFIX_LEN);
  const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

  // Revoke all existing keys for this user
  await db.delete(mcpApiKeys).where(eq(mcpApiKeys.userId, userId));

  // Store the new key
  await db.insert(mcpApiKeys).values({
    userId,
    keyHash,
    keyPrefix: prefix,
  });

  return { rawKey, prefix };
}

/**
 * Revoke all MCP API keys for the given user.
 */
export async function revokeMcpApiKeys(userId: string): Promise<void> {
  await db.delete(mcpApiKeys).where(eq(mcpApiKeys.userId, userId));
}

// ── Key verification ───────────────────────────────────────────────────────────

export interface VerifiedKey {
  userId: string;
  keyId: string;
  prefix: string;
}

/**
 * Verify an MCP API key from the Authorization: Bearer header.
 *
 * Pre-auth throttle: caps bcrypt compares at PRE_AUTH_MAX per prefix per minute
 * to prevent CPU amplification on the unauthenticated endpoint.
 *
 * Returns the userId and keyId if valid, null otherwise.
 * Updates last_used_at on success.
 */
export async function verifyMcpApiKey(rawKey: string): Promise<VerifiedKey | null> {
  if (!rawKey.startsWith("jarvis_") || rawKey.length < KEY_PREFIX_LEN) return null;

  const prefix = rawKey.slice(0, KEY_PREFIX_LEN);

  // Pre-auth rate limit: reject before doing any bcrypt if too many attempts
  if (!(await checkCounter("pre-auth", prefix, PRE_AUTH_MAX, PRE_AUTH_WINDOW_MS))) {
    return null;
  }

  // Fetch rows matching the prefix
  const rows = await db
    .select()
    .from(mcpApiKeys)
    .where(eq(mcpApiKeys.keyPrefix, prefix));

  for (const row of rows) {
    const valid = await bcrypt.compare(rawKey, row.keyHash);
    if (valid) {
      // Reset pre-auth counter on success (best-effort)
      resetCounter("pre-auth", prefix).catch(() => {});

      // Update last_used_at asynchronously — don't block response
      db.update(mcpApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(mcpApiKeys.id, row.id))
        .catch(() => {});

      return { userId: row.userId, keyId: row.id, prefix };
    }
  }

  return null;
}

// ── Rate limiting ──────────────────────────────────────────────────────────────

/**
 * Check per-key rate limit (authenticated requests).
 * Key: DB row UUID — unique per key, no cross-user coupling.
 * Returns true if the request should be allowed, false if rate-limited.
 * Backed by the DB so the window survives server restarts.
 */
export async function checkRateLimit(keyId: string): Promise<boolean> {
  return checkCounter("auth", keyId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
}

/**
 * DB-backed sliding-window counter helper.
 *
 * Uses an atomic PostgreSQL upsert so reads and increments are race-free even
 * under concurrent requests or across multiple server processes.
 *
 * Returns true (allow) when count after increment is within [1, max].
 * Returns false (deny) when count exceeds max — the counter continues to
 * increment so the caller cannot game the window by sending exactly max reqs.
 */
async function checkCounter(
  namespace: string,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const bucket = `${namespace}:${key}`;
  const now = Date.now();

  const result = await db.execute(sql`
    INSERT INTO mcp_rate_limits (bucket, count, window_start)
    VALUES (${bucket}, 1, ${now})
    ON CONFLICT (bucket) DO UPDATE
    SET
      count = CASE
        WHEN ${now} - mcp_rate_limits.window_start >= ${windowMs}
          THEN 1
        ELSE mcp_rate_limits.count + 1
      END,
      window_start = CASE
        WHEN ${now} - mcp_rate_limits.window_start >= ${windowMs}
          THEN ${now}
        ELSE mcp_rate_limits.window_start
      END
    RETURNING count
  `);

  const count = (result.rows[0] as { count: number }).count;
  return count <= max;
}

/**
 * Reset a rate-limit counter (e.g. on successful pre-auth to clear the throttle).
 */
async function resetCounter(namespace: string, key: string): Promise<void> {
  const bucket = `${namespace}:${key}`;
  await db.execute(sql`DELETE FROM mcp_rate_limits WHERE bucket = ${bucket}`);
}

// ── Key info retrieval ─────────────────────────────────────────────────────────

/**
 * Get the key prefix for a user (for display in settings UI).
 * Returns null if the user has no key.
 */
export async function getMcpKeyInfo(userId: string): Promise<{ prefix: string; createdAt: Date; lastUsedAt: Date | null } | null> {
  const rows = await db
    .select()
    .from(mcpApiKeys)
    .where(eq(mcpApiKeys.userId, userId))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    prefix: row.keyPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}
