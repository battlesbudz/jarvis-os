/**
 * Transcript Cache
 *
 * In-memory cache for YouTube transcripts keyed by video ID.
 * TTL: 24 hours. Max 500 entries (oldest evicted when full).
 * Thread-safe for single-process Node.js.
 *
 * Fetch strategy (in order):
 *   1. InnerTube API — TVHTML5 → iOS → ANDROID client contexts.
 *   2. yt-dlp — subtitle extraction via the yt-dlp binary (server-side).
 *   3. YouTube /api/timedtext direct XML endpoint (no auth).
 *   4. youtube-transcript library — last-resort fallback.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { readdir, readFile, rm, stat as fsStat } from "fs/promises";
import { mkdtempSync } from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

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
    /(?:youtube\.com\/(?:watch\?(?:[^\s#&]*&)*v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const m = pat.exec(bare);
  return m ? m[1] : null;
}

/**
 * Returns true if the input is a YouTube playlist URL with no individual video selected.
 * Playlist URLs should be rejected — the tool can only fetch one video at a time.
 */
export function isPlaylistUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    const list = url.searchParams.get("list");
    const videoId = url.searchParams.get("v");
    // It's a playlist-only URL if it has a list parameter but no v= video ID
    if (list && !videoId) return true;
  } catch {
    // Not a URL (e.g. bare video ID) — not a playlist
  }
  return false;
}

// ── SRT/VTT subtitle parser ───────────────────────────────────────────────────
// Supports the SRT format produced by yt-dlp --convert-subs srt.

function parseSrt(content: string): TranscriptResponse[] {
  const blocks = content.trim().split(/\n\s*\n/);
  const segments: TranscriptResponse[] = [];
  const tsRe =
    /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/;

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    const tsLineIdx = lines.findIndex((l) => tsRe.test(l));
    if (tsLineIdx === -1) continue;

    const m = tsRe.exec(lines[tsLineIdx])!;
    const startMs =
      (parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])) * 1000 +
      parseInt(m[4]);
    const endMs =
      (parseInt(m[5]) * 3600 + parseInt(m[6]) * 60 + parseInt(m[7])) * 1000 +
      parseInt(m[8]);

    const textLines = lines
      .slice(tsLineIdx + 1)
      .map((l) =>
        l
          .replace(/<[^>]+>/g, "")
          .replace(/\{[^}]+\}/g, "")
          .trim()
      )
      .filter(Boolean);
    const text = textLines.join(" ");
    if (!text) continue;

    segments.push({ text, offset: startMs, duration: endMs - startMs, lang: "en" });
  }

  return segments;
}

// ── yt-dlp subtitle extraction ────────────────────────────────────────────────

async function fetchYtDlpTranscript(videoId: string): Promise<TranscriptResponse[]> {
  let tmpDir: string;
  try {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), `ytdlp-${videoId}-`));
  } catch {
    return [];
  }

  try {
    const outputTemplate = path.join(tmpDir, "%(id)s");
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    await execAsync(
      `yt-dlp --skip-download --write-subs --write-auto-subs ` +
        `--sub-langs "en.*,en" --convert-subs srt --no-playlist ` +
        `--no-warnings --quiet --no-progress ` +
        `--output "${outputTemplate}" -- "${url}"`,
      { timeout: 45_000 }
    );

    const files = await readdir(tmpDir).catch(() => [] as string[]);
    const srtFiles = files.filter((f) => f.endsWith(".srt"));
    if (srtFiles.length === 0) return [];

    // Prefer manual English, then any English, then first file
    const best =
      srtFiles.find((f) => /\.(en|en-US|en-GB)\[.*manual\]\.srt$/.test(f)) ??
      srtFiles.find((f) => /\.(en|en-US|en-GB)\.srt$/.test(f)) ??
      srtFiles.find((f) => /\.en/.test(f)) ??
      srtFiles[0];

    const content = await readFile(path.join(tmpDir, best), "utf-8");
    const segments = parseSrt(content);

    if (segments.length > 0) {
      console.log(
        `[transcriptCache] yt-dlp OK ${videoId} — ${segments.length} segs via ${best}`
      );
    }

    return segments;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    // Surface terminal errors so the caller can skip further strategies
    if (lower.includes("video unavailable") || lower.includes("private video")) {
      throw new Error(`LOGIN_REQUIRED: ${raw}`);
    }
    if (lower.includes("age-restricted") || lower.includes("sign in to confirm")) {
      throw new Error(`CONTENT_RESTRICTED: ${raw}`);
    }
    if (lower.includes("429") || lower.includes("too many requests")) {
      throw new Error(`TOO_MANY_REQUESTS: ${raw}`);
    }
    console.warn(`[transcriptCache] yt-dlp non-terminal failure for ${videoId}: ${raw}`);
    return [];
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
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

// ── Audio transcription via yt-dlp + ffmpeg + OpenAI Whisper ─────────────────
// Last server-side fallback when all subtitle-based strategies fail.
// Downloads audio-only, converts to mono 16 kHz WAV, splits into 10-min chunks
// if needed (Whisper API limit: 25 MB), transcribes each chunk, and combines.
// Labels output as AI-generated so users know it isn't from official captions.

/** Max audio file size we'll attempt to transcribe (~30-40 min at typical bitrate). */
const AUDIO_MAX_BYTES = 80 * 1024 * 1024;
/** Whisper API file size limit with headroom. */
const WHISPER_MAX_BYTES = 23 * 1024 * 1024;
/** Length of each WAV chunk sent to Whisper (10 minutes). */
const AUDIO_CHUNK_SECS = 600;

async function transcribeBuffer(buf: Buffer, ext: "wav" | "mp3"): Promise<string> {
  const { openai } = await import("../replit_integrations/audio/client");
  const { toFile } = await import("openai");
  const file = await toFile(buf, `audio.${ext}`, { type: `audio/${ext}` });
  const resp = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
    response_format: "text",
  });
  return typeof resp === "string" ? resp : ((resp as { text?: string }).text ?? "");
}

async function fetchAudioTranscript(videoId: string): Promise<TranscriptResponse[]> {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) return [];

  let tmpDir: string;
  try {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), `ytaudio-${videoId}-`));
  } catch {
    return [];
  }

  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const outputTemplate = path.join(tmpDir, "%(id)s.%(ext)s");

    // Download audio only — cap at AUDIO_MAX_BYTES to reject very long videos
    await execAsync(
      `yt-dlp -f "bestaudio[filesize<80M]/bestaudio" --extract-audio --audio-format mp3 ` +
        `--no-playlist --no-warnings --quiet --no-progress ` +
        `--max-filesize 80M ` +
        `--output "${outputTemplate}" -- "${url}"`,
      { timeout: 120_000 }
    );

    const files = await readdir(tmpDir).catch(() => [] as string[]);
    const mp3File = files.find((f) => f.endsWith(".mp3")) ?? files.find((f) => f.endsWith(".m4a"));
    if (!mp3File) return [];

    const mp3Path = path.join(tmpDir, mp3File);
    const mp3Stat = await fsStat(mp3Path);
    if (mp3Stat.size > AUDIO_MAX_BYTES) {
      console.warn(
        `[transcriptCache] audio: ${videoId} exceeds size limit (${mp3Stat.size} bytes) — skipping`
      );
      return [];
    }

    // Convert to mono 16 kHz WAV for chunking
    const wavPath = path.join(tmpDir, `${videoId}.wav`);
    await execAsync(
      `ffmpeg -i "${mp3Path}" -ar 16000 -ac 1 -acodec pcm_s16le -y "${wavPath}"`,
      { timeout: 120_000 }
    );

    const wavStat = await fsStat(wavPath);
    let fullText = "";

    if (wavStat.size <= WHISPER_MAX_BYTES) {
      const buf = await readFile(wavPath);
      fullText = await transcribeBuffer(buf, "wav");
    } else {
      // Get total duration so we can split into fixed-length chunks
      const { stdout } = await execAsync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${wavPath}"`,
        { timeout: 15_000 }
      );
      const totalDuration = parseFloat(stdout.trim()) || 0;

      if (!totalDuration) {
        // Unknown duration — just try the whole file (may exceed Whisper limit)
        const buf = await readFile(wavPath);
        fullText = await transcribeBuffer(buf, "wav");
      } else {
        const chunks: string[] = [];
        let offset = 0;
        let chunkNum = 0;
        while (offset < totalDuration) {
          const chunkPath = path.join(tmpDir, `chunk-${chunkNum}.wav`);
          await execAsync(
            `ffmpeg -i "${wavPath}" -ss ${offset} -t ${AUDIO_CHUNK_SECS} ` +
              `-ar 16000 -ac 1 -acodec pcm_s16le -y "${chunkPath}"`,
            { timeout: 60_000 }
          );
          const buf = await readFile(chunkPath);
          const text = await transcribeBuffer(buf, "wav").catch(() => "");
          if (text.trim()) chunks.push(text.trim());
          offset += AUDIO_CHUNK_SECS;
          chunkNum++;
        }
        fullText = chunks.join(" ");
      }
    }

    if (!fullText.trim()) return [];

    console.log(
      `[transcriptCache] audio transcription OK ${videoId} — ${fullText.length} chars`
    );
    return [
      {
        text: `[AI-generated transcript — no official captions available]\n\n${fullText.trim()}`,
        offset: 0,
        duration: 0,
        lang: "en",
      },
    ];
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    if (lower.includes("private video") || lower.includes("video unavailable")) {
      throw new Error(`LOGIN_REQUIRED: ${raw}`);
    }
    if (lower.includes("age-restricted") || lower.includes("sign in to confirm")) {
      throw new Error(`CONTENT_RESTRICTED: ${raw}`);
    }
    if (lower.includes("429") || lower.includes("too many requests")) {
      throw new Error(`TOO_MANY_REQUESTS: ${raw}`);
    }
    console.warn(`[transcriptCache] audio transcription non-terminal failure for ${videoId}: ${raw}`);
    return [];
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
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
 * On a cache miss (or when bypassCache=true), four server-side strategies are tried:
 *   1. InnerTube API (TVHTML5 → iOS → ANDROID clients)
 *   2. yt-dlp subtitle extraction (--write-subs, --write-auto-subs)
 *   3. YouTube /api/timedtext direct XML endpoint
 *   4. youtube-transcript library (last resort)
 *
 * Terminal errors (LOGIN_REQUIRED, CONTENT_RESTRICTED, TOO_MANY_REQUESTS) are
 * propagated immediately — no further strategy will succeed.
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
        `[transcriptCache] InnerTube 0 segs for ${resolvedId}, trying yt-dlp`
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
      `[transcriptCache] InnerTube non-terminal failure for ${resolvedId}: ${msg} — trying yt-dlp`
    );
  }

  // ── Strategy 2: yt-dlp subtitle extraction ────────────────────────────────
  if (segments.length === 0) {
    try {
      segments = await fetchYtDlpTranscript(resolvedId);
      if (segments.length > 0) {
        source = "yt-dlp";
      } else {
        console.log(`[transcriptCache] yt-dlp 0 segs for ${resolvedId}, trying timedtext`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.startsWith("LOGIN_REQUIRED") ||
        msg.startsWith("CONTENT_RESTRICTED") ||
        msg.startsWith("TOO_MANY_REQUESTS")
      ) {
        console.log(`[transcriptCache] yt-dlp terminal error for ${resolvedId}: ${msg}`);
        throw err;
      }
      console.warn(
        `[transcriptCache] yt-dlp non-terminal failure for ${resolvedId}: ${msg} — trying timedtext`
      );
    }
  }

  // ── Strategy 3: YouTube /api/timedtext direct XML ─────────────────────────
  if (segments.length === 0) {
    try {
      segments = await fetchTimedTextTranscript(resolvedId);
      if (segments.length > 0) {
        source = "timedtext";
        console.log(`[transcriptCache] timedtext strategy OK ${resolvedId} — ${segments.length} segs`);
      } else {
        console.log(`[transcriptCache] timedtext returned 0 segs for ${resolvedId}, trying youtube-transcript library`);
      }
    } catch (err) {
      console.warn(
        `[transcriptCache] timedtext strategy failed for ${resolvedId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // ── Strategy 3: youtube-transcript library (last subtitle resort) ────────
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
    }
  }

  // ── Strategy 4: Audio transcription (yt-dlp audio → ffmpeg WAV → Whisper) ─
  // Only attempted when all subtitle strategies fail. Downloads the audio track,
  // converts to mono 16 kHz WAV, splits into ≤10-min chunks, and transcribes
  // via OpenAI Whisper. Result is labelled as AI-generated.
  if (segments.length === 0) {
    console.log(`[transcriptCache] strategy 4: audio transcription for ${resolvedId}`);
    try {
      const audioSegs = await fetchAudioTranscript(resolvedId);
      if (audioSegs.length > 0) {
        segments = audioSegs;
        source = "audio-transcription";
        console.log(
          `[transcriptCache] audio transcription OK ${resolvedId} — ${audioSegs.length} seg(s), ` +
            `${audioSegs.reduce((n, s) => n + s.text.length, 0)} chars`
        );
      }
    } catch (audioErr) {
      const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
      // Re-throw known terminal errors so they surface correctly
      if (/^(LOGIN_REQUIRED|CONTENT_RESTRICTED|TOO_MANY_REQUESTS):/.test(msg)) throw audioErr;
      console.warn(`[transcriptCache] audio transcription failed for ${resolvedId}: ${msg}`);
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
