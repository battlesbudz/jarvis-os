import type { Response } from "express";

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

export function pushToSubscriber(userId: string, text: string): boolean {
  const sub = subscribers.get(userId);
  if (!sub) return false;
  try {
    const payload = JSON.stringify({ type: "bot_message", content: text });
    sub.res.write(`data: ${payload}\n\n`);
    return true;
  } catch {
    removeSubscriberIfCurrent(userId, sub.token);
    return false;
  }
}
