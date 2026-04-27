/**
 * MCP API Key management for the Jarvis MCP server endpoint.
 *
 * Key format: jarvis_<40 hex chars>
 * Only the bcrypt hash is stored. The raw key is returned once on creation.
 *
 * Rate limits (in-memory sliding windows):
 *   - Authenticated requests: 120 req/min per key ID (DB row UUID).
 *   - Pre-auth attempts: 10 attempts/min per 16-char prefix bucket to
 *     prevent bcrypt CPU amplification on the unauthenticated endpoint.
 */

import crypto from "crypto";
import bcrypt from "bcryptjs";
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

// In-memory trackers
const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();
const preAuthCounters  = new Map<string, { count: number; windowStart: number }>();

// Periodic cleanup: evict expired entries every 5 minutes to prevent unbounded growth.
// Attackers sending many unique prefixes to the unauthenticated endpoint would otherwise
// cause preAuthCounters to grow without bound.
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;
function evictExpired(map: Map<string, { count: number; windowStart: number }>, windowMs: number): void {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.windowStart >= windowMs) map.delete(key);
  }
}
setInterval(() => {
  evictExpired(rateLimitCounters, RATE_LIMIT_WINDOW_MS);
  evictExpired(preAuthCounters, PRE_AUTH_WINDOW_MS);
}, EVICTION_INTERVAL_MS).unref(); // .unref() so the timer never prevents process exit

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
  if (!checkCounter(preAuthCounters, prefix, PRE_AUTH_MAX, PRE_AUTH_WINDOW_MS)) {
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
      // Reset pre-auth counter on success
      preAuthCounters.delete(prefix);

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
 */
export function checkRateLimit(keyId: string): boolean {
  return checkCounter(rateLimitCounters, keyId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
}

/** Shared sliding-window counter helper. */
function checkCounter(
  map: Map<string, { count: number; windowStart: number }>,
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = map.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    map.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= max) return false;
  entry.count++;
  return true;
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
