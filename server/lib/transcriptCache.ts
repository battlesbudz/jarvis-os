/**
 * Transcript Cache
 *
 * In-memory cache for YouTube transcripts keyed by video ID.
 * TTL: 24 hours. Max 500 entries (oldest evicted when full).
 * Thread-safe for single-process Node.js.
 *
 * Fetch strategy (in order):
 *   1. InnerTube API — works for public videos with no login required.
 *   2. youtube-transcript library — fallback for edge cases.
 */

import type { TranscriptConfig, TranscriptResponse } from "youtube-transcript";

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

// ── InnerTube transcript fetching ─────────────────────────────────────────────

/** InnerTube API client key (public, browser-level key used by YouTube web client). */
const INNERTUBE_KEY = "your-youtube-innertube-api-key";
const INNERTUBE_CLIENT_VERSION = "2.20240101.00.00";

/**
 * Known InnerTube API error statuses that indicate no transcript is available
 * and a fallback to youtube-transcript would also fail.
 * These are propagated immediately as clear user-facing errors.
 */
const INNERTUBE_TERMINAL_STATUSES = new Set([
  "LOGIN_REQUIRED",
  "CONTENT_RESTRICTED",
  "AGE_RESTRICTED",
  "UNPLAYABLE",
]);

// ── InnerTube response type interfaces ───────────────────────────────────────

interface InnerTubeSnippetRun {
  text: string;
}

interface InnerTubeTranscriptSegmentRenderer {
  startMs: string;
  endMs: string;
  snippet: { runs: InnerTubeSnippetRun[] };
}

interface InnerTubeTranscriptSegmentItem {
  transcriptSegmentRenderer?: InnerTubeTranscriptSegmentRenderer;
}

interface InnerTubeTranscriptSegmentListRenderer {
  initialSegments: InnerTubeTranscriptSegmentItem[];
}

interface InnerTubePlayabilityStatus {
  status: string;
}

interface InnerTubeResponse {
  playabilityStatus?: InnerTubePlayabilityStatus;
  actions?: Array<{
    updateEngagementPanelAction?: {
      content?: {
        transcriptRenderer?: {
          content?: {
            transcriptSearchPanelRenderer?: {
              body?: {
                transcriptSegmentListRenderer?: InnerTubeTranscriptSegmentListRenderer;
              };
            };
          };
        };
      };
    };
  }>;
}

/** Safely read a string property from an unknown value, returning undefined if not a string. */
function safeStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Fetch a transcript via YouTube's InnerTube API (`/youtubei/v1/get_transcript`).
 * Works for public videos without authentication.
 * Returns an empty array when no captions track is found (triggers fallback).
 * Throws with a clear message for terminal errors (private, restricted, etc.).
 */
async function fetchInnerTubeTranscript(videoId: string): Promise<TranscriptResponse[]> {
  const payload = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: INNERTUBE_CLIENT_VERSION,
        hl: "en",
        gl: "US",
      },
    },
    params: Buffer.from(`\n\x0b${videoId}`).toString("base64"),
  };

  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/get_transcript?key=${INNERTUBE_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": INNERTUBE_CLIENT_VERSION,
        Origin: "https://www.youtube.com",
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("TOO_MANY_REQUESTS: YouTube is rate-limiting transcript access. Please try again shortly.");
    }
    throw new Error(`InnerTube HTTP ${res.status} for video ${videoId}`);
  }

  const json = (await res.json()) as InnerTubeResponse;

  // Check for terminal playability errors
  const errorStatus = safeStr(json.playabilityStatus?.status);
  if (errorStatus && INNERTUBE_TERMINAL_STATUSES.has(errorStatus)) {
    if (errorStatus === "LOGIN_REQUIRED") {
      throw new Error("LOGIN_REQUIRED: This video requires a signed-in YouTube account to access.");
    }
    if (errorStatus === "AGE_RESTRICTED") {
      throw new Error("CONTENT_RESTRICTED: This video is age-restricted and cannot be accessed without sign-in.");
    }
    throw new Error(`CONTENT_RESTRICTED: YouTube reports this video is restricted (${errorStatus}).`);
  }

  // Navigate the InnerTube response tree to the transcript segment list
  const transcriptBody =
    json.actions?.[0]
      ?.updateEngagementPanelAction
      ?.content
      ?.transcriptRenderer
      ?.content
      ?.transcriptSearchPanelRenderer
      ?.body
      ?.transcriptSegmentListRenderer
      ?.initialSegments;

  if (!transcriptBody || !Array.isArray(transcriptBody)) {
    // No transcript track present — return empty so the fallback is tried
    return [];
  }

  const segments: TranscriptResponse[] = [];
  for (const item of transcriptBody) {
    const seg = item.transcriptSegmentRenderer;
    if (!seg) continue;
    const startMs = parseInt(safeStr(seg.startMs) ?? "0", 10);
    const endMs = parseInt(safeStr(seg.endMs) ?? safeStr(seg.startMs) ?? "0", 10);
    const durationMs = endMs - startMs;
    const runs: InnerTubeSnippetRun[] = Array.isArray(seg.snippet?.runs) ? seg.snippet.runs : [];
    const rawText = runs.map((r) => safeStr(r.text) ?? "").join("");
    const text = rawText.replace(/\n/g, " ").trim();
    if (!text) continue;
    segments.push({
      text,
      offset: startMs,      // milliseconds
      duration: durationMs, // milliseconds
      lang: "en",
    });
  }

  return segments;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface FetchTranscriptOptions {
  /** When true, skip the cache lookup and overwrite any existing entry with a fresh fetch. */
  bypassCache?: boolean;
  /** youtube-transcript library config (language, custom fetch). */
  config?: TranscriptConfig;
}

/**
 * Fetch a transcript, returning a cached result when available.
 *
 * On a cache miss (or when bypassCache=true):
 *   1. Try InnerTube API first — handles most public videos without authentication.
 *   2. Fall back to the youtube-transcript library if InnerTube returns empty segments.
 *
 * Terminal InnerTube errors (LOGIN_REQUIRED, CONTENT_RESTRICTED, TOO_MANY_REQUESTS)
 * are propagated immediately — no fallback is attempted because the fallback
 * would encounter the same restriction.
 */
export async function fetchTranscriptCached(
  input: string,
  options: FetchTranscriptOptions = {}
): Promise<TranscriptResponse[]> {
  const { bypassCache = false, config } = options;
  const videoId = extractVideoId(input);

  if (videoId && !bypassCache) {
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

  if (videoId && bypassCache) {
    console.log(`[transcriptCache] BYPASS ${videoId} — fetching live and overwriting cache`);
  }

  const resolvedId = videoId ?? input.trim();
  let segments: TranscriptResponse[] = [];
  let source = "unknown";

  // ── Strategy 1: InnerTube API ────────────────────────────────────────────────
  try {
    segments = await fetchInnerTubeTranscript(resolvedId);
    if (segments.length > 0) {
      source = "innertube";
      console.log(`[transcriptCache] InnerTube OK ${resolvedId} — ${segments.length} segs`);
    } else {
      console.log(
        `[transcriptCache] InnerTube returned 0 segs for ${resolvedId}, trying youtube-transcript fallback`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Terminal errors: propagate immediately — the fallback would also fail
    if (
      msg.startsWith("LOGIN_REQUIRED") ||
      msg.startsWith("CONTENT_RESTRICTED") ||
      msg.startsWith("TOO_MANY_REQUESTS")
    ) {
      console.log(`[transcriptCache] InnerTube terminal error for ${resolvedId}: ${msg}`);
      throw err;
    }
    console.warn(
      `[transcriptCache] InnerTube non-terminal failure for ${resolvedId}: ${msg} — trying fallback`
    );
  }

  // ── Strategy 2: youtube-transcript library (fallback) ────────────────────────
  if (segments.length === 0) {
    try {
      const { YoutubeTranscript } = await import("youtube-transcript/dist/youtube-transcript.esm.js");
      segments = await YoutubeTranscript.fetchTranscript(input, config);
      if (segments.length > 0) {
        source = "youtube-transcript";
        console.log(`[transcriptCache] youtube-transcript fallback OK ${resolvedId} — ${segments.length} segs`);
      }
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.warn(`[transcriptCache] youtube-transcript fallback also failed for ${resolvedId}: ${msg}`);
      if (segments.length === 0) throw fallbackErr;
    }
  }

  // ── Cache the result ─────────────────────────────────────────────────────────
  if (videoId && segments && segments.length > 0) {
    evictExpired();
    if (!cache.has(videoId) && cache.size >= MAX_ENTRIES) evictOldest();
    cache.set(videoId, { segments, cachedAt: Date.now() });
    const reason = bypassCache ? "BYPASS→stored" : "MISS→stored";
    console.log(
      `[transcriptCache] ${reason} ${videoId} via ${source} — ${segments.length} segs (cache size: ${cache.size})`
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
