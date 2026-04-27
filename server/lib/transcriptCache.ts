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

/** InnerTube API key (public WEB client key, same as YouTube's web player). */
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_CLIENT_VERSION = "2.20241107.04.00";

const INNERTUBE_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "X-YouTube-Client-Name": "1",
  "X-YouTube-Client-Version": INNERTUBE_CLIENT_VERSION,
  Origin: "https://www.youtube.com",
  "Accept-Language": "en-US,en;q=0.9",
};

const INNERTUBE_CONTEXT = {
  client: {
    clientName: "WEB",
    clientVersion: INNERTUBE_CLIENT_VERSION,
    hl: "en",
    gl: "US",
  },
};

/** Playability statuses that mean no fallback will help. */
const INNERTUBE_TERMINAL_STATUSES = new Set([
  "LOGIN_REQUIRED",
  "CONTENT_RESTRICTED",
  "AGE_CHECK_REQUIRED",
  "AGE_VERIFICATION_REQUIRED",
  "UNPLAYABLE",
]);

// ── InnerTube typed interfaces ────────────────────────────────────────────────

interface InnerTubePlayabilityStatus {
  status: string;
  reason?: string;
}

interface InnerTubeCaptionTrack {
  baseUrl: string;
  name: { simpleText: string };
  vssId: string;
  languageCode: string;
  kind?: string;
}

interface InnerTubeCaptionTrackListRenderer {
  captionTracks?: InnerTubeCaptionTrack[];
}

interface InnerTubePlayerResponse {
  playabilityStatus?: InnerTubePlayabilityStatus;
  captions?: {
    playerCaptionsTracklistRenderer?: InnerTubeCaptionTrackListRenderer;
  };
}

/** A single <text> element parsed from YouTube's timed-text XML caption format. */
interface CaptionTextElement {
  start: string;
  dur: string;
  text: string;
}

/** Safely read a string property from an unknown value. */
function safeStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Parse YouTube's timed-text XML (srv3 / timedtext format) into
 * a list of caption elements with start/dur/text.
 */
function parseTimedTextXml(xml: string): CaptionTextElement[] {
  const results: CaptionTextElement[] = [];
  const textTagRx = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  const attrRx = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = textTagRx.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRx.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    attrRx.lastIndex = 0;
    const rawText = match[2]
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!rawText) continue;
    results.push({
      start: attrs.start ?? "0",
      dur: attrs.dur ?? "0",
      text: rawText,
    });
  }

  return results;
}

/**
 * Rank caption tracks: prefer English manual captions, then ASR, then any other language.
 * Returns tracks sorted best-first.
 */
function rankCaptionTracks(tracks: InnerTubeCaptionTrack[]): InnerTubeCaptionTrack[] {
  return [...tracks].sort((a, b) => {
    const aEn = a.languageCode.startsWith("en");
    const bEn = b.languageCode.startsWith("en");
    const aAsr = a.kind === "asr";
    const bAsr = b.kind === "asr";
    if (aEn && !aAsr && (!bEn || bAsr)) return -1;
    if (bEn && !bAsr && (!aEn || aAsr)) return 1;
    if (aEn && !bEn) return -1;
    if (bEn && !aEn) return 1;
    return 0;
  });
}

/**
 * Fetch a transcript via YouTube's InnerTube player API.
 *
 * Strategy:
 *   1. POST /youtubei/v1/player with the videoId to get a player response.
 *   2. Extract available caption tracks from captions.playerCaptionsTracklistRenderer.
 *   3. Choose the best track (English manual > English ASR > other).
 *   4. Append fmt=srv3&tlang=en to the track's baseUrl and download the XML captions.
 *   5. Parse the timed-text XML into TranscriptResponse[].
 *
 * Returns empty array when no caption tracks are present (triggers fallback).
 * Throws terminal errors for private/restricted videos.
 */
async function fetchInnerTubeTranscript(videoId: string): Promise<TranscriptResponse[]> {
  // Step 1: Call /youtubei/v1/player to get caption track metadata
  const playerRes = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
    {
      method: "POST",
      headers: INNERTUBE_HEADERS,
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        videoId,
        playbackContext: {
          contentPlaybackContext: { signatureTimestamp: 0 },
        },
      }),
    }
  );

  if (!playerRes.ok) {
    if (playerRes.status === 429) {
      throw new Error("TOO_MANY_REQUESTS: YouTube is rate-limiting requests. Please try again shortly.");
    }
    throw new Error(`InnerTube player request failed with HTTP ${playerRes.status}`);
  }

  const player = (await playerRes.json()) as InnerTubePlayerResponse;

  // Step 2: Check terminal playability errors
  const status = safeStr(player.playabilityStatus?.status);
  if (status && INNERTUBE_TERMINAL_STATUSES.has(status)) {
    if (status === "LOGIN_REQUIRED") {
      throw new Error("LOGIN_REQUIRED: This video requires a signed-in YouTube account to access.");
    }
    if (status === "AGE_CHECK_REQUIRED" || status === "AGE_VERIFICATION_REQUIRED") {
      throw new Error("CONTENT_RESTRICTED: This video is age-restricted and cannot be accessed without sign-in.");
    }
    const reason = safeStr(player.playabilityStatus?.reason) ?? status;
    throw new Error(`CONTENT_RESTRICTED: YouTube reports this video is restricted — ${reason}`);
  }

  // Step 3: Extract and rank caption tracks
  const tracks =
    player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    // No captions available at all — return empty so the fallback is tried
    return [];
  }

  const ranked = rankCaptionTracks(tracks);
  const best = ranked[0];
  if (!best.baseUrl) return [];

  // Step 4: Download the timed-text XML (srv3 format)
  const captionUrl = new URL(best.baseUrl);
  captionUrl.searchParams.set("fmt", "srv3");
  captionUrl.searchParams.set("tlang", "en");

  const captionRes = await fetch(captionUrl.toString(), {
    headers: { "User-Agent": INNERTUBE_HEADERS["User-Agent"] },
  });
  if (!captionRes.ok) {
    // Non-fatal — return empty to trigger fallback
    console.warn(`[transcriptCache] InnerTube caption download returned HTTP ${captionRes.status} for ${videoId}`);
    return [];
  }

  const xml = await captionRes.text();

  // Step 5: Parse XML into TranscriptResponse[]
  const elements = parseTimedTextXml(xml);
  if (elements.length === 0) return [];

  return elements.map((el) => {
    const offsetSec = parseFloat(el.start);
    const durSec = parseFloat(el.dur);
    return {
      text: el.text,
      offset: offsetSec * 1000,  // convert seconds → milliseconds
      duration: durSec * 1000,   // convert seconds → milliseconds
      lang: best.languageCode,
    };
  });
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
