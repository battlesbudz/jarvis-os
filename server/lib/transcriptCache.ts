/**
 * Transcript Cache
 *
 * In-memory cache for YouTube transcripts keyed by video ID.
 * TTL: 24 hours. Max 500 entries (oldest evicted when full).
 * Thread-safe for single-process Node.js.
 */

import type { TranscriptResponse } from "youtube-transcript";

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface CacheEntry {
  segments: TranscriptResponse[];
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Extract the 11-char YouTube video ID from a URL or bare ID. Returns null if unrecognised. */
export function extractVideoId(input: string): string | null {
  const bare = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(bare)) return bare;

  const pat =
    /(?:youtube\.com\/(?:watch\?(?:[^\s#&]*&)*v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const m = pat.exec(bare);
  return m ? m[1] : null;
}

/** Evict entries that have expired. Called before every cache read/write to keep memory lean. */
function evictExpired(): void {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.cachedAt >= TTL_MS) cache.delete(id);
  }
}

/** Evict the single oldest entry when the cache is at capacity. */
function evictOldest(): void {
  let oldestKey: string | undefined;
  let oldestTime = Infinity;
  for (const [id, entry] of cache) {
    if (entry.cachedAt < oldestTime) {
      oldestTime = entry.cachedAt;
      oldestKey = id;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/**
 * Fetch a transcript, returning a cached result when available.
 * Falls through to the live youtube-transcript library on a miss or expiry.
 */
export async function fetchTranscriptCached(
  input: string,
  config?: Parameters<import("youtube-transcript").YoutubeTranscript["fetchTranscript"]>[1]
): Promise<TranscriptResponse[]> {
  const videoId = extractVideoId(input);

  if (videoId) {
    evictExpired();
    const hit = cache.get(videoId);
    if (hit) {
      const age = Math.round((Date.now() - hit.cachedAt) / 1000);
      console.log(
        `[transcriptCache] HIT  ${videoId} — ${hit.segments.length} segs, cached ${age}s ago`
      );
      return hit.segments;
    }
  }

  const { YoutubeTranscript } = await import("youtube-transcript");
  const segments = await YoutubeTranscript.fetchTranscript(input, config);

  if (videoId && segments && segments.length > 0) {
    evictExpired();
    if (cache.size >= MAX_ENTRIES) evictOldest();
    cache.set(videoId, { segments, cachedAt: Date.now() });
    console.log(
      `[transcriptCache] MISS ${videoId} — fetched live, ${segments.length} segs stored (cache size: ${cache.size})`
    );
  }

  return segments;
}

/** Manually invalidate a single video's cache entry (e.g. on explicit user request). */
export function invalidateTranscript(input: string): boolean {
  const videoId = extractVideoId(input);
  if (!videoId) return false;
  const deleted = cache.delete(videoId);
  if (deleted) console.log(`[transcriptCache] INVALIDATED ${videoId}`);
  return deleted;
}

/** Current number of live (non-expired) cache entries. */
export function transcriptCacheSize(): number {
  evictExpired();
  return cache.size;
}
