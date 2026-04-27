/**
 * Transcript Cache
 *
 * In-memory cache for YouTube transcripts keyed by video ID.
 * TTL: 24 hours. Max 500 entries (oldest evicted when full).
 * Thread-safe for single-process Node.js.
 *
 * Fetch strategy (in order):
 *   1. InnerTube API — tries TVHTML5_SIMPLY_EMBEDDED_PLAYER, then ANDROID
 *      client contexts to bypass bot detection on the WEB client.
 *   2. YouTube timedtext API — direct /api/timedtext XML endpoint (no auth).
 *   3. youtube-transcript library — last-resort fallback.
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

// ── InnerTube multi-client configuration ─────────────────────────────────────
// YouTube increasingly blocks the WEB client context from server-side
// requests. TVHTML5_SIMPLY_EMBEDDED_PLAYER and ANDROID are embedded/app
// clients that bypass most bot-detection filters applied to the web player.

const INNERTUBE_KEY = "your-youtube-innertube-api-key";

interface InnerTubeClientConfig {
  name: string;
  headers: Record<string, string>;
  context: Record<string, unknown>;
}

const INNERTUBE_CLIENTS: InnerTubeClientConfig[] = [
  {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "85",
      "X-YouTube-Client-Version": "2.0",
      "Accept-Language": "en-US,en;q=0.9",
    },
    context: {
      client: {
        clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
        clientVersion: "2.0",
        hl: "en",
        gl: "US",
      },
    },
  },
  {
    name: "IOS",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)",
      "X-YouTube-Client-Name": "5",
      "X-YouTube-Client-Version": "19.29.1",
      "Accept-Language": "en-US,en;q=0.9",
    },
    context: {
      client: {
        clientName: "IOS",
        clientVersion: "19.29.1",
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        osName: "iPhone",
        osVersion: "17.5.1.21F90",
        hl: "en",
        gl: "US",
      },
    },
  },
  {
    name: "ANDROID",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.android.youtube/19.29.34 (Linux; U; Android 11) gzip",
      "X-YouTube-Client-Name": "3",
      "X-YouTube-Client-Version": "19.29.34",
      "Accept-Language": "en-US,en;q=0.9",
    },
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "19.29.34",
        androidSdkVersion: 30,
        hl: "en",
        gl: "US",
      },
    },
  },
];

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
export interface CaptionTextElement {
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
 * Exported so the transcript tool can reuse it for browser-fetched XML.
 */
export function parseTimedTextXml(xml: string): CaptionTextElement[] {
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
 * Fetch a transcript via a single InnerTube client config.
 * Returns empty array on non-terminal failures (triggers next strategy).
 * Throws terminal errors immediately.
 */
async function fetchInnerTubeWithClient(
  videoId: string,
  client: InnerTubeClientConfig
): Promise<TranscriptResponse[]> {
  const playerRes = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
    {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        context: client.context,
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
    // Non-terminal HTTP error — return empty to try next client
    console.warn(`[transcriptCache] InnerTube ${client.name} HTTP ${playerRes.status} for ${videoId}`);
    return [];
  }

  const player = (await playerRes.json()) as InnerTubePlayerResponse;

  // Check terminal playability errors
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

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) return [];

  const ranked = rankCaptionTracks(tracks);
  const best = ranked[0];
  if (!best.baseUrl) return [];

  const captionUrl = new URL(best.baseUrl);
  captionUrl.searchParams.set("fmt", "srv3");
  captionUrl.searchParams.set("tlang", "en");

  const captionRes = await fetch(captionUrl.toString(), {
    headers: {
      "User-Agent": (client.headers["User-Agent"] as string) ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!captionRes.ok) {
    console.warn(`[transcriptCache] InnerTube ${client.name} caption download HTTP ${captionRes.status} for ${videoId}`);
    return [];
  }

  const xml = await captionRes.text();
  const elements = parseTimedTextXml(xml);
  if (elements.length === 0) return [];

  return elements.map((el) => ({
    text: el.text,
    offset: parseFloat(el.start) * 1000,
    duration: parseFloat(el.dur) * 1000,
    lang: best.languageCode,
  }));
}

/**
 * Fetch a transcript via YouTube's InnerTube player API.
 * Tries TVHTML5_SIMPLY_EMBEDDED_PLAYER first, then ANDROID as fallback.
 * Both bypass the bot-detection that YouTube applies to the WEB client.
 */
async function fetchInnerTubeTranscript(videoId: string): Promise<TranscriptResponse[]> {
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const segments = await fetchInnerTubeWithClient(videoId, client);
      if (segments.length > 0) {
        console.log(`[transcriptCache] InnerTube OK via ${client.name} ${videoId} — ${segments.length} segs`);
        return segments;
      }
      console.log(`[transcriptCache] InnerTube ${client.name} returned 0 segs for ${videoId}, trying next client`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Terminal errors propagate immediately — no point trying other clients
      if (
        msg.startsWith("LOGIN_REQUIRED") ||
        msg.startsWith("CONTENT_RESTRICTED") ||
        msg.startsWith("TOO_MANY_REQUESTS")
      ) {
        throw err;
      }
      console.warn(`[transcriptCache] InnerTube ${client.name} non-terminal failure for ${videoId}: ${msg}`);
    }
  }
  return [];
}

/**
 * Fetch a transcript via YouTube's legacy /api/timedtext endpoint.
 * This direct XML endpoint sometimes works for videos whose caption
 * baseUrls aren't exposed in the player response.
 */
async function fetchTimedTextTranscript(videoId: string): Promise<TranscriptResponse[]> {
  const langs = ["en", "en-US", "en-GB", "a.en"];
  for (const lang of langs) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${lang}&fmt=srv3`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.trim().startsWith("<")) continue;
      const elements = parseTimedTextXml(xml);
      if (elements.length === 0) continue;
      console.log(`[transcriptCache] timedtext OK lang=${lang} ${videoId} — ${elements.length} segs`);
      return elements.map((el) => ({
        text: el.text,
        offset: parseFloat(el.start) * 1000,
        duration: parseFloat(el.dur) * 1000,
        lang,
      }));
    } catch {
      // Non-fatal — try next lang
    }
  }
  return [];
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
 * On a cache miss (or when bypassCache=true), three strategies are tried:
 *   1. InnerTube API (TVHTML5_SIMPLY_EMBEDDED_PLAYER → ANDROID client)
 *   2. YouTube /api/timedtext direct XML endpoint
 *   3. youtube-transcript library (last resort)
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

  // ── Strategy 1: InnerTube API (multi-client) ──────────────────────────────
  try {
    segments = await fetchInnerTubeTranscript(resolvedId);
    if (segments.length > 0) {
      source = "innertube";
    } else {
      console.log(
        `[transcriptCache] InnerTube 0 segs for ${resolvedId}, trying timedtext fallback`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.startsWith("LOGIN_REQUIRED") ||
      msg.startsWith("CONTENT_RESTRICTED") ||
      msg.startsWith("TOO_MANY_REQUESTS")
    ) {
      console.log(`[transcriptCache] InnerTube terminal error for ${resolvedId}: ${msg}`);
      throw err;
    }
    console.warn(
      `[transcriptCache] InnerTube non-terminal failure for ${resolvedId}: ${msg} — trying timedtext`
    );
  }

  // ── Strategy 2: YouTube /api/timedtext direct XML ─────────────────────────
  if (segments.length === 0) {
    try {
      segments = await fetchTimedTextTranscript(resolvedId);
      if (segments.length > 0) {
        source = "timedtext";
        console.log(`[transcriptCache] timedtext strategy OK ${resolvedId} — ${segments.length} segs`);
      } else {
        console.log(`[transcriptCache] timedtext returned 0 segs for ${resolvedId}, trying youtube-transcript fallback`);
      }
    } catch (err) {
      console.warn(
        `[transcriptCache] timedtext strategy failed for ${resolvedId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // ── Strategy 3: youtube-transcript library (last resort) ─────────────────
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

  // ── Cache the result ──────────────────────────────────────────────────────
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
