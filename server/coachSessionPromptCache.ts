/**
 * In-process cache for system-prompt source data used by the in-app coach.
 *
 * On the first turn of a coaching session the route fetches Gmail items,
 * memories, commitments and other context from the DB / external APIs. These
 * values are expensive to re-fetch on every message but don't change within a
 * short conversation window.
 *
 * Cache keys are scoped by BOTH userId and sdkSessionId so that a client
 * sending a session ID that belongs to a different user cannot load that
 * user's cached context.
 *
 * Usage pattern:
 *   1. First turn  — perform all fetches; after initSession() returns the new
 *                    sdkSessionId call `setPromptData(userId, sdkSessionId, data)`.
 *   2. Next turns  — call `getPromptData(userId, sdkSessionId)`.  If a cache
 *                    hit is returned, skip the DB/API fetches entirely.
 *   3. Cache miss on resumed session — fetch fresh data, then call
 *                    `setPromptData(userId, sdkSessionId, data)` to re-seed so
 *                    subsequent turns do not pay the full fetch cost again.
 *   4. Expiry      — entries are evicted after SESSION_PROMPT_TTL_MS so they
 *                    never live longer than the session itself.  The cache is
 *                    also bounded to MAX_ENTRIES to prevent unbounded growth.
 */

const SESSION_PROMPT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — matches session TTL
const MAX_ENTRIES = 500;

export interface CoachPromptData {
  resolvedGmailConnected: boolean;
  resolvedGmailItems: any[];
  calendarEvents: any[];
  userCommitments: any[];
  memories: { content: string; category: string }[];
  morningNoteSummary: string;
  documentsContext: string;
  proactiveQuestionContext: string;
  crossChannelContext: string;
  soulBlock: string;
  emotionalStateBlock: string;
  websiteContext: string;
}

interface CacheEntry {
  data: CoachPromptData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, sdkSessionId: string): string {
  return `${userId}:${sdkSessionId}`;
}

export function setPromptData(userId: string, sdkSessionId: string, data: CoachPromptData): void {
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(cacheKey(userId, sdkSessionId), { data, expiresAt: Date.now() + SESSION_PROMPT_TTL_MS });
}

export function getPromptData(userId: string | undefined, sdkSessionId: string | undefined): CoachPromptData | null {
  if (!userId || !sdkSessionId) return null;
  const key = cacheKey(userId, sdkSessionId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function deletePromptData(userId: string, sdkSessionId: string): void {
  cache.delete(cacheKey(userId, sdkSessionId));
}
