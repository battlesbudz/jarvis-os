import type { Response } from "express";
import crypto from "crypto";

interface Subscriber {
  res: Response;
  token: string;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const subscribers = new Map<string, Subscriber>();

let tokenCounter = 0;
function nextToken(): string {
  return String(++tokenCounter);
}

/**
 * Register an SSE subscriber for a user.
 * Returns the unique token for this registration; callers should pass it to
 * removeSubscriberIfCurrent() on disconnect to avoid unregistering a
 * newer connection that replaced this one.
 */
export function registerSubscriber(userId: string, res: Response): string {
  const existing = subscribers.get(userId);
  if (existing) {
    clearInterval(existing.heartbeatTimer);
    try { existing.res.end(); } catch {}
  }

  const token = nextToken();

  const heartbeatTimer = setInterval(() => {
    const current = subscribers.get(userId);
    if (!current || current.token !== token) {
      clearInterval(heartbeatTimer);
      return;
    }
    try {
      res.write(": heartbeat\n\n");
    } catch {
      removeSubscriberIfCurrent(userId, token);
    }
  }, 20_000);

  subscribers.set(userId, { res, token, heartbeatTimer });
  return token;
}

/**
 * Remove the subscriber only if the provided token matches the current entry.
 * This prevents a late-firing close handler for a replaced connection from
 * evicting the newer subscriber that took its slot.
 */
export function removeSubscriberIfCurrent(userId: string, token: string): void {
  const existing = subscribers.get(userId);
  if (existing && existing.token === token) {
    clearInterval(existing.heartbeatTimer);
    subscribers.delete(userId);
  }
}

export function hasSubscriber(userId: string): boolean {
  return subscribers.has(userId);
}

// ---------------------------------------------------------------------------
// Deduplication: track hashes of messages recently pushed via SSE so that
// inAppChannel can skip writing a duplicate inbox item for the same content.
// ---------------------------------------------------------------------------

const SSE_DEDUP_TTL_MS = 30_000;

// userId -> Map<sha1Hash, expiresAt>
const recentPushes = new Map<string, Map<string, number>>();

function hashText(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function recordPushedHash(userId: string, text: string): void {
  const hash = hashText(text);
  const expiresAt = Date.now() + SSE_DEDUP_TTL_MS;
  let userMap = recentPushes.get(userId);
  if (!userMap) {
    userMap = new Map();
    recentPushes.set(userId, userMap);
  }
  userMap.set(hash, expiresAt);
}

/**
 * Returns true if the given text was already successfully pushed to this user
 * via SSE within the last 30 seconds.  Used by inAppChannel to avoid writing
 * a duplicate inbox item when the chat tab is open.
 */
export function wasRecentlyPushedViaSSE(userId: string, text: string): boolean {
  const userMap = recentPushes.get(userId);
  if (!userMap) return false;
  const hash = hashText(text);
  const expiresAt = userMap.get(hash);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    userMap.delete(hash);
    return false;
  }
  return true;
}

// Sweep expired entries from recentPushes every 5 minutes so the map stays
// bounded even when many users connect once and never reconnect.
setInterval(() => {
  const now = Date.now();
  for (const [userId, userMap] of recentPushes) {
    for (const [hash, expiresAt] of userMap) {
      if (now > expiresAt) {
        userMap.delete(hash);
      }
    }
    if (userMap.size === 0) {
      recentPushes.delete(userId);
    }
  }
}, 5 * 60_000).unref();

export function pushToSubscriber(userId: string, text: string): boolean {
  const sub = subscribers.get(userId);
  if (!sub) return false;
  try {
    const payload = JSON.stringify({ type: "bot_message", content: text });
    sub.res.write(`data: ${payload}\n\n`);
    recordPushedHash(userId, text);
    return true;
  } catch {
    removeSubscriberIfCurrent(userId, sub.token);
    return false;
  }
}
