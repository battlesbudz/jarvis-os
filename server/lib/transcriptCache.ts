/**
 * Transcript Cache
 *
 * In-memory cache for YouTube transcripts keyed by video ID.
 * TTL: 24 hours. Max 500 entries (oldest evicted when full).
 * Thread-safe for single-process Node.js.
 *
 * Fetch pipeline (metadata-first):
 *   Phase 0 — Gemini native video understanding (YouTube URLs only)
 *     → Passes the YouTube URL directly to Gemini 2.5 Flash as a fileData part.
 *     → Google fetches and transcribes the video from its own infrastructure.
 *     → No yt-dlp, no ffmpeg, no IP blocks. Works for any video length.
 *     → Skipped if AI_INTEGRATIONS_GEMINI_API_KEY is not set.
 *
 *   Phase 1 — Metadata check (InnerTube player API, lightweight)
 *     → Determines whether captions exist at all before committing to heavier work.
 *     → Terminal errors (private, age-restricted, rate-limit) surface immediately.
 *
 *   Phase 2a — IF captions confirmed available:
 *     1. Fetch caption XML via InnerTube tracks (reuses data from Phase 1, no extra API call)
 *     2. yt-dlp subtitle extraction (--write-subs / --write-auto-subs)
 *     3. YouTube /api/timedtext direct XML endpoint
 *     4. youtube-transcript library
 *
 *   Phase 2b — IF captions confirmed unavailable:
 *     → Skip all subtitle strategies immediately → audio transcription
 *
 *   Phase 2c — IF InnerTube blocked (can't determine availability):
 *     → Try yt-dlp → timedtext → youtube-transcript library → audio
 *
 *   Phase 3 — Audio transcription (all subtitle strategies failed, OR no captions):
 *     → yt-dlp audio download → ffmpeg WAV → OpenAI Whisper (chunked ≤10 min each)
 *
 * Duplicate strategies are never retried within the same request.
 */

import { exec, spawn } from "child_process";
import { promisify } from "util";
import { readdir, readFile, rm, stat as fsStat, writeFile } from "fs/promises";
import { mkdtempSync } from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

/**
 * Stderr patterns that indicate YouTube is blocking/throttling the request.
 * Detecting these early lets us kill the yt-dlp process immediately instead of
 * waiting for the full 120-second timeout to expire.
 */
const YTDLP_EARLY_ABORT_PATTERNS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /sign in to confirm|sign in to watch|not a bot/i,   code: "CONTENT_RESTRICTED" },
  { pattern: /age.?restricted|age.?gated/i,                       code: "CONTENT_RESTRICTED" },
  { pattern: /http error 403|: 403\b/i,                           code: "CONTENT_RESTRICTED" },
  { pattern: /too many requests|http error 429|: 429\b/i,         code: "TOO_MANY_REQUESTS"  },
  { pattern: /private video|video unavailable|this video is unavailable/i, code: "LOGIN_REQUIRED" },
];

/**
 * Spawns a yt-dlp command and watches stderr line-by-line for known-bad patterns.
 * When a throttling / restriction pattern is detected mid-execution the child
 * process is killed immediately and the returned Promise rejects — typically
 * within a few seconds instead of after the full `timeoutMs` timeout.
 *
 * The rejection error has the shape `{ message, stderr }` to stay compatible
 * with the existing `execAsync` error-handling code.
 */
function spawnYtdlp(cmd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    const startMs = Date.now();

    const stderrChunks: Buffer[] = [];
    let aborted = false;

    const abort = (code: string, fullStderr: string) => {
      if (aborted) return;
      aborted = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      const err = Object.assign(
        new Error(`${code}: ${fullStderr}`),
        { stderr: fullStderr }
      );
      reject(err);
    };

    const timer = setTimeout(() => {
      const fullStderr = stderrChunks.map((b) => b.toString()).join("").trim();
      abort("YTDLP_TIMEOUT", fullStderr || "yt-dlp timed out");
    }, timeoutMs);

    child.stderr!.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (aborted) return;
      // Test against accumulated stderr so patterns split across chunk boundaries
      // are still caught. Only the trailing 512 bytes are needed since patterns
      // are short single-line strings, but we always include the full new chunk.
      const accumulated = stderrChunks.map((b) => b.toString()).join("");
      const window = accumulated.length > 512 ? accumulated.slice(-512) : accumulated;
      for (const { pattern, code } of YTDLP_EARLY_ABORT_PATTERNS) {
        if (pattern.test(window)) {
          const elapsedMs = Date.now() - startMs;
          console.warn(
            `[transcriptCache] yt-dlp early abort (${code}) after ${elapsedMs} ms — ` +
            `pattern matched in stderr: ${chunk.toString().trim()}`
          );
          abort(code, accumulated.trim());
          return;
        }
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (aborted) return;
      const fullStderr = stderrChunks.map((b) => b.toString()).join("").trim();
      if (code !== 0) {
        reject(Object.assign(
          new Error(`yt-dlp exited with code ${code}: ${fullStderr}`),
          { stderr: fullStderr }
        ));
      } else {
        resolve();
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!aborted) reject(err);
    });
  });
}

import type { TranscriptConfig, TranscriptResponse } from "youtube-transcript";

// ── One-time yt-dlp upgrade ───────────────────────────────────────────────────
// Runs lazily on the first audio-transcription attempt so both the dev workflow
// and the production server (npm run server:prod) always use the latest yt-dlp.
//
// Strategy:
//   1. pip install --user -U yt-dlp (--break-system-packages required in Nix)
//   2. Check the installed package version via `python3 -m yt_dlp --version`
//      This works even when the ~/.local/bin binary PATH isn't picked up because
//      Python's sys.path includes ~/.local/lib/.../site-packages before the Nix store.
//   3. If pip succeeded, switch the ytdlpCmd to `python3 -m yt_dlp` so subsequent
//      exec() calls use the newer package regardless of which binary is on PATH.

let ytdlpUpgradePromise: Promise<void> | null = null;
/** The yt-dlp invocation to use — updated to `python3 -m yt_dlp` if pip succeeds. */
let ytdlpCmd = "yt-dlp";
/** True once ensureYtdlpUpgraded() confirms the active yt-dlp is >= 2023.11.16. */
let ytdlpSupportsImpersonate = false;
/** True once ensureYtdlpUpgraded() confirms the resolved ytdlpCmd actually responds to --version. */
let ytdlpAvailable = false;

// ── Persisted impersonate-flag cache ─────────────────────────────────────────
// If --impersonate is discovered to be broken at runtime we write a small JSON
// file so the next server boot skips the wasted first attempt entirely.
// The file is cleared automatically when a version upgrade re-enables the flag.

const YTDLP_FLAGS_PATH = path.join(process.cwd(), ".ytdlp-flags.json");

async function loadPersistedImpersonateDisabled(): Promise<boolean> {
  try {
    const raw = await readFile(YTDLP_FLAGS_PATH, "utf8");
    const data = JSON.parse(raw) as { impersonateDisabled?: boolean };
    return data.impersonateDisabled === true;
  } catch {
    return false;
  }
}

async function persistImpersonateDisabled(): Promise<void> {
  try {
    await writeFile(YTDLP_FLAGS_PATH, JSON.stringify({ impersonateDisabled: true }), "utf8");
  } catch (e) {
    console.warn("[transcriptCache] Failed to persist impersonate flag:", e instanceof Error ? e.message : String(e));
  }
}

async function clearPersistedImpersonateDisabled(): Promise<void> {
  try {
    await rm(YTDLP_FLAGS_PATH, { force: true });
  } catch {
    // best-effort
  }
}

/** Minimum yt-dlp version that supports --impersonate (added 2023.11.16). */
const MIN_IMPERSONATE_VERSION = "2023.11.16";

/**
 * Extracts the leading YYYY.MM.DD portion of a yt-dlp version string so it can
 * be compared lexicographically (the zero-padded date format makes this safe).
 */
function parseYtdlpVersionDate(v: string): string {
  const m = v.match(/^(\d{4}\.\d{2}\.\d{2})/);
  return m ? m[1] : "";
}

/** Returns the resolved yt-dlp command after any pip upgrade. Call after ensureYtdlpUpgraded(). */
export function getYtdlpCmd(): string { return ytdlpCmd; }
/**
 * Returns the availability status of yt-dlp after ensureYtdlpUpgraded() has run.
 * Callers can check this before attempting audio work to surface a clear error
 * instead of a cryptic "command not found" failure.
 */
export function getYtdlpStatus(): { available: boolean; cmd: string } {
  return { available: ytdlpAvailable, cmd: ytdlpCmd };
}
/** Ensures yt-dlp is up-to-date and sets ytdlpCmd appropriately. Safe to call multiple times. */
export { ensureYtdlpUpgraded };

async function ensureYtdlpUpgraded(): Promise<void> {
  if (ytdlpUpgradePromise) return ytdlpUpgradePromise;
  ytdlpUpgradePromise = (async () => {
    // Load any persisted override from the previous run before doing the version
    // check — if impersonate was already discovered to be broken we start with it
    // disabled so the first download attempt doesn't waste a round-trip.
    const persistedDisabled = await loadPersistedImpersonateDisabled();
    if (persistedDisabled) {
      ytdlpSupportsImpersonate = false;
      console.log("[transcriptCache] Loaded persisted impersonate=false override from disk");
    }

    try {
      // Capture the Nix binary's current version as a baseline before upgrading
      // so that any version comparison is always against the real installed value.
      let nixParsed = "";
      let nixVersion = "unknown";
      try {
        const { stdout: nixVer } = await execAsync("yt-dlp --version", { timeout: 10_000 });
        nixVersion = nixVer.trim();
        nixParsed = parseYtdlpVersionDate(nixVersion);
      } catch {
        // Nix binary may not be present — that is fine; nixParsed stays ""
      }

      // Run pip upgrade — non-fatal. --break-system-packages is needed in
      // Nix/PEP-668 environments; with --user it only touches ~/.local.
      await execAsync(
        "python3 -m pip install --user -U yt-dlp --quiet --disable-pip-version-check --break-system-packages",
        { timeout: 60_000 }
      ).catch(() => null); // best-effort

      // Verify via the Python module path (works even if ~/.local/bin isn't on PATH)
      const { stdout: modVer } = await execAsync(
        "python3 -m yt_dlp --version",
        { timeout: 10_000 }
      );
      const version = modVer.trim();
      const modParsed = parseYtdlpVersionDate(version);

      // Prefer the pip-managed module when it is strictly newer than the Nix binary.
      // Using a proper date comparison (YYYY.MM.DD, lexicographically safe) means
      // this will remain correct when the Nix package is updated in future.
      if (modParsed && modParsed > nixParsed) {
        ytdlpCmd = "python3 -m yt_dlp";
        console.log(`[transcriptCache] yt-dlp upgraded to ${version} (using python3 -m yt_dlp)`);
        ytdlpSupportsImpersonate = modParsed >= MIN_IMPERSONATE_VERSION;
        if (ytdlpSupportsImpersonate) {
          // Version now supports impersonate — clear any stale persisted override
          await clearPersistedImpersonateDisabled();
        } else {
          console.warn(
            `[transcriptCache] yt-dlp too old for --impersonate (v${version}) — running without browser impersonation`
          );
        }
      } else {
        // Module is not newer than the Nix binary — also try updating PATH in case
        // the pip binary landed in ~/.local/bin and is already on disk.
        const { stdout: base } = await execAsync("python3 -m site --user-base", { timeout: 5_000 });
        const userBin = `${base.trim()}/bin`;
        if (!process.env.PATH?.startsWith(userBin)) {
          process.env.PATH = `${userBin}:${process.env.PATH ?? ""}`;
        }
        // Re-read the version after PATH mutation — a newer pip-installed binary may now
        // be visible in ~/.local/bin, so ytdlpSupportsImpersonate must reflect the binary
        // that will actually be invoked, not the pre-mutation Nix snapshot.
        let activeVersion = nixVersion;
        let activeParsed = nixParsed;
        try {
          const { stdout: postVer } = await execAsync("yt-dlp --version", { timeout: 10_000 });
          const v = postVer.trim();
          if (v) { activeVersion = v; activeParsed = parseYtdlpVersionDate(v); }
        } catch {
          // Stick with the pre-mutation snapshot if the binary is still unavailable
        }
        console.log(`[transcriptCache] yt-dlp version: ${activeVersion} (using Nix binary)`);
        ytdlpSupportsImpersonate = !!activeParsed && activeParsed >= MIN_IMPERSONATE_VERSION;
        if (ytdlpSupportsImpersonate) {
          // Version now supports impersonate — clear any stale persisted override
          await clearPersistedImpersonateDisabled();
        } else {
          console.warn(
            `[transcriptCache] yt-dlp too old for --impersonate (v${activeVersion}) — running without browser impersonation`
          );
        }
      }
    } catch (err) {
      console.warn(
        `[transcriptCache] yt-dlp upgrade skipped: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // ── Final availability probe ─────────────────────────────────────────────
    // After all upgrade paths have run (or failed), confirm that the resolved
    // ytdlpCmd actually responds to --version.  If it doesn't, the subsequent
    // exec() calls would fail with an opaque "command not found" error, so we
    // surface a clear startup warning here instead.
    try {
      await execAsync(`${ytdlpCmd} --version`, { timeout: 10_000 });
      ytdlpAvailable = true;
    } catch {
      ytdlpAvailable = false;
      console.warn(
        `[transcriptCache] yt-dlp is NOT available (cmd: "${ytdlpCmd}" did not respond to --version). ` +
        "Audio transcription will fail until yt-dlp is installed. " +
        "Install it via: python3 -m pip install yt-dlp"
      );
    }
  })();
  return ytdlpUpgradePromise;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface CacheEntry {
  segments: TranscriptResponse[];
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Lazily resolved reference to isTranscriptRefusal from geminiTranscript.
 * Cached here so the dynamic import is resolved at most once per process
 * and reused for both the stale-cache eviction check and any future callers.
 */
let _isTranscriptRefusal: ((text: string) => boolean) | undefined;

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
  // Circuit breaker: skip subtitle download while YouTube is rate-limiting us.
  if (isRateLimitCircuitOpen()) {
    const remainingSec = Math.ceil((ytdlpRateLimitedUntil - Date.now()) / 1000);
    console.warn(
      `[transcriptCache] circuit OPEN — skipping subtitle download for ${videoId} ` +
      `(${remainingSec} s remaining in cool-down). Returning [].`
    );
    return [];
  }

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
      openRateLimitCircuit();
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

// ── YouTube rate-limit circuit breaker ────────────────────────────────────────
// When YouTube returns HTTP 429 / TOO_MANY_REQUESTS, further yt-dlp audio
// download attempts are suspended for YTDLP_RATE_LIMIT_COOLDOWN_MS milliseconds.
// Requests that arrive while the circuit is open are rejected immediately
// (without spawning yt-dlp) by throwing a RATE_LIMITED error.
// The circuit resets automatically once the cool-down window has elapsed.

/** Cool-down duration after a 429 (default 90 s; override via env var). */
const YTDLP_RATE_LIMIT_COOLDOWN_MS =
  parseInt(process.env.YTDLP_RATE_LIMIT_COOLDOWN_MS ?? "", 10) || 90_000;

/** Timestamp (ms since epoch) at which the circuit reopens. 0 = circuit closed. */
let ytdlpRateLimitedUntil = 0;

/**
 * Opens the circuit for YTDLP_RATE_LIMIT_COOLDOWN_MS milliseconds and logs it.
 * Safe to call multiple times — repeated calls simply extend the deadline.
 */
function openRateLimitCircuit(): void {
  const wasOpen = Date.now() < ytdlpRateLimitedUntil;
  ytdlpRateLimitedUntil = Date.now() + YTDLP_RATE_LIMIT_COOLDOWN_MS;
  if (!wasOpen) {
    console.warn(
      `[transcriptCache] circuit OPEN — YouTube rate-limited (429). ` +
      `Audio downloads paused for ${YTDLP_RATE_LIMIT_COOLDOWN_MS / 1000} s ` +
      `(until ${new Date(ytdlpRateLimitedUntil).toISOString()}).`
    );
  }
}

/**
 * Checks whether the rate-limit circuit is currently open.
 * Logs a reset message the first time the circuit is found to have expired.
 */
function isRateLimitCircuitOpen(): boolean {
  if (ytdlpRateLimitedUntil === 0) return false;
  if (Date.now() >= ytdlpRateLimitedUntil) {
    console.log(`[transcriptCache] circuit RESET — rate-limit cool-down expired. Resuming audio downloads.`);
    ytdlpRateLimitedUntil = 0;
    return false;
  }
  return true;
}

/** Max audio file size we'll attempt to transcribe (~30-40 min at typical bitrate). */
const AUDIO_MAX_BYTES = 80 * 1024 * 1024;
/** Whisper API file size limit with headroom. */
const WHISPER_MAX_BYTES = 23 * 1024 * 1024;
/** Length of each WAV chunk sent to Whisper (10 minutes). */
const AUDIO_CHUNK_SECS = 600;

// ── Audio transcription telemetry ─────────────────────────────────────────────
// Tracks every non-terminal failure so product/infra can gauge how often
// Phase 3 audio transcription silently fails and which failure class dominates.

export type AudioErrorClass =
  | "empty-output"           // fetchAudioTranscript returned [] (Whisper empty, file too large, no file written, etc.)
  | "yt-dlp-not-installed"   // yt-dlp binary not available after ensureYtdlpUpgraded() ran
  | "yt-dlp-blocked"         // terminal errors re-thrown (LOGIN_REQUIRED, CONTENT_RESTRICTED, TOO_MANY_REQUESTS)
  | "yt-dlp-download-failed" // AUDIO_DOWNLOAD_FAILED — all URL candidates failed yt-dlp
  | "whisper-failure"        // non-terminal error during Whisper transcription step
  | "ffmpeg-failure"         // non-terminal ffmpeg conversion error
  | "non-terminal-error";    // other non-terminal errors not matched above

export interface AudioTranscriptFailureEvent {
  timestamp: string;
  videoId: string;
  errorClass: AudioErrorClass;
  noCaptions: boolean;
  message: string;
}

const AUDIO_TELEMETRY_MAX = 200;
const audioFailureEvents: AudioTranscriptFailureEvent[] = [];
const audioFailureCounts: Record<AudioErrorClass, number> = {
  "empty-output": 0,
  "yt-dlp-not-installed": 0,
  "yt-dlp-blocked": 0,
  "yt-dlp-download-failed": 0,
  "whisper-failure": 0,
  "ffmpeg-failure": 0,
  "non-terminal-error": 0,
};
let audioAttemptCount = 0;

function recordAudioFailure(
  videoId: string,
  errorClass: AudioErrorClass,
  noCaptions: boolean,
  message: string
): void {
  audioFailureCounts[errorClass] = (audioFailureCounts[errorClass] ?? 0) + 1;
  const event: AudioTranscriptFailureEvent = {
    timestamp: new Date().toISOString(),
    videoId,
    errorClass,
    noCaptions,
    message: message.slice(0, 500),
  };
  audioFailureEvents.push(event);
  if (audioFailureEvents.length > AUDIO_TELEMETRY_MAX) audioFailureEvents.shift();
  console.log(
    `[audio-telemetry] FAILURE videoId=${videoId} class=${errorClass} noCaptions=${noCaptions} msg=${message.slice(0, 200)}`
  );
}

function classifyAudioError(msg: string): AudioErrorClass {
  const lower = msg.toLowerCase();
  if (lower.includes("whisper") || lower.includes("transcri")) return "whisper-failure";
  if (lower.includes("ffmpeg")) return "ffmpeg-failure";
  if (lower.includes("yt-dlp") || lower.includes("download") || lower.includes("audio_download")) {
    return "yt-dlp-download-failed";
  }
  return "non-terminal-error";
}

/** Returns a snapshot of audio transcription telemetry for admin/debug use. */
export function getAudioTranscriptTelemetry() {
  const totalFailures = Object.values(audioFailureCounts).reduce((a, b) => a + b, 0);
  return {
    attempts: audioAttemptCount,
    totalFailures,
    failureRate: audioAttemptCount > 0 ? totalFailures / audioAttemptCount : null,
    counts: { ...audioFailureCounts },
    recentFailures: [...audioFailureEvents].reverse().slice(0, 50),
  };
}

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

async function fetchAudioTranscript(videoId: string, originalInput?: string): Promise<TranscriptResponse[]> {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) return [];

  // Circuit breaker: refuse to launch yt-dlp while YouTube is rate-limiting us.
  if (isRateLimitCircuitOpen()) {
    const remainingSec = Math.ceil((ytdlpRateLimitedUntil - Date.now()) / 1000);
    console.warn(
      `[transcriptCache] circuit OPEN — skipping audio download for ${videoId} ` +
      `(${remainingSec} s remaining in cool-down). Throwing RATE_LIMITED.`
    );
    throw new Error(`RATE_LIMITED: YouTube is rate-limiting this server. Retry in ${remainingSec} s.`);
  }

  // Ensure the latest yt-dlp is on PATH (runs once per process, covers prod too)
  await ensureYtdlpUpgraded();

  // Surface a clear error instead of a cryptic "command not found" failure
  if (!ytdlpAvailable) {
    throw new Error(
      "YTDLP_UNAVAILABLE: Audio transcription is temporarily unavailable — the yt-dlp dependency is not installed or could not be found. " +
      "Please try again later or contact support."
    );
  }

  let tmpDir: string;
  try {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), `ytaudio-${videoId}-`));
  } catch {
    return [];
  }

  try {
    const outputTemplate = path.join(tmpDir, "%(id)s.%(ext)s");

    // Build URL candidates. When the original input was a Shorts URL, try the
    // /shorts/ path first — YouTube often serves audio more reliably that way.
    const isShorts = originalInput ? /\/shorts\//i.test(originalInput) : false;
    const urlCandidates: string[] = isShorts
      ? [
          `https://www.youtube.com/shorts/${videoId}`,
          `https://www.youtube.com/watch?v=${videoId}`,
        ]
      : [`https://www.youtube.com/watch?v=${videoId}`];

    let downloadedFile: string | undefined;
    let lastNonTerminalStderr = "";

    for (const url of urlCandidates) {
      try {
        // Download audio only — cap at AUDIO_MAX_BYTES to reject very long videos.
        // ytdlpCmd is set to `python3 -m yt_dlp` if pip upgrade succeeded; falls
        // back to the Nix binary otherwise.
        // --impersonate chrome + realistic UA makes YouTube treat the request
        // as a real browser rather than a bot (requires yt-dlp >= 2023.11.16).
        // --retries 3 handles transient network errors without hard-failing.
        const buildCmd = (withImpersonate: boolean) => {
          const impersonateFlag = withImpersonate ? "--impersonate chrome " : "";
          return (
            `${ytdlpCmd} -f "bestaudio[filesize<80M]/bestaudio" --extract-audio --audio-format mp3 ` +
            `--no-playlist --no-warnings --quiet --no-progress ` +
            `--max-filesize 80M ` +
            `--retries 3 ` +
            `${impersonateFlag}` +
            `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" ` +
            `--output "${outputTemplate}" -- "${url}"`
          );
        };
        try {
          // spawnYtdlp monitors stderr in real-time and aborts the process as soon
          // as a throttling / restriction pattern is detected — avoiding the full
          // 120 s timeout for known-bad responses like HTTP 403 or "sign in to confirm".
          await spawnYtdlp(buildCmd(ytdlpSupportsImpersonate), 120_000);
        } catch (firstErr) {
          const firstErrObj = firstErr as { stderr?: string; message?: string };
          const firstStderr = (firstErrObj.stderr ?? "").trim() || (firstErr instanceof Error ? firstErr.message : String(firstErr));
          const firstLower = firstStderr.toLowerCase();
          // Non-standard or distro-patched yt-dlp builds may reject --impersonate
          // even when the reported version passes the version gate. Detect this at
          // runtime and retry once without the flag so the download can still succeed.
          if (
            ytdlpSupportsImpersonate &&
            (firstLower.includes("unrecognised option") || firstLower.includes("invalid option"))
          ) {
            console.warn(
              `[transcriptCache] yt-dlp rejected --impersonate for ${videoId} — ` +
                `disabling flag and retrying without it. stderr: ${firstStderr}`
            );
            ytdlpSupportsImpersonate = false;
            // Persist so subsequent server boots skip the failed attempt
            persistImpersonateDisabled().catch(() => null);
            await spawnYtdlp(buildCmd(false), 120_000);
          } else {
            throw firstErr;
          }
        }
      } catch (dlErr) {
        // Capture full stderr from yt-dlp so failures are visible in the logs
        const errObj = dlErr as { stderr?: string; stdout?: string; message?: string };
        const stderrMsg = (errObj.stderr ?? "").trim() || (dlErr instanceof Error ? dlErr.message : String(dlErr));
        console.warn(
          `[transcriptCache] yt-dlp audio download failed for ${videoId} (url=${url}):\n${stderrMsg}`
        );
        // Surface terminal errors immediately — no further URL will help.
        // Also check the error message prefix set by spawnYtdlp on early-abort
        // (e.g. "CONTENT_RESTRICTED: ...") so coded errors short-circuit instantly.
        const errMsg = (dlErr instanceof Error ? dlErr.message : String(dlErr));
        const lower = stderrMsg.toLowerCase();
        if (
          errMsg.startsWith("LOGIN_REQUIRED") ||
          lower.includes("private video") || lower.includes("video unavailable")
        ) {
          throw new Error(`LOGIN_REQUIRED: ${stderrMsg}`);
        }
        if (
          errMsg.startsWith("CONTENT_RESTRICTED") ||
          lower.includes("age-restricted") || lower.includes("sign in to confirm") ||
          lower.includes("http error 403") || lower.includes(": 403")
        ) {
          throw new Error(`CONTENT_RESTRICTED: ${stderrMsg}`);
        }
        if (
          errMsg.startsWith("TOO_MANY_REQUESTS") ||
          lower.includes("429") || lower.includes("too many requests") ||
          lower.includes("http error 429")
        ) {
          openRateLimitCircuit();
          throw new Error(`TOO_MANY_REQUESTS: ${stderrMsg}`);
        }
        // Non-terminal: record stderr and try the next URL candidate
        lastNonTerminalStderr = stderrMsg;
        continue;
      }

      // Download succeeded — check if a file was actually written
      const filesAfter = await readdir(tmpDir).catch(() => [] as string[]);
      const mp3Candidate = filesAfter.find((f) => f.endsWith(".mp3")) ?? filesAfter.find((f) => f.endsWith(".m4a"));
      if (mp3Candidate) {
        downloadedFile = mp3Candidate;
        break;
      }
    }

    if (!downloadedFile) {
      if (lastNonTerminalStderr) {
        throw new Error(`AUDIO_DOWNLOAD_FAILED: ${lastNonTerminalStderr}`);
      }
      return [];
    }
    const mp3File = downloadedFile;

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
    // Re-throw terminal errors that were already tagged by the download loop
    if (/^(LOGIN_REQUIRED|CONTENT_RESTRICTED|TOO_MANY_REQUESTS):/.test(raw)) throw err;
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

// ── Caption availability result ───────────────────────────────────────────────
// Returned by checkInnerTubePlayerData() to describe what the player API said.

type CaptionAvailability =
  /** InnerTube responded and confirms captions exist. */
  | { status: "has-captions"; tracks: InnerTubeCaptionTrack[]; clientName: string }
  /** InnerTube responded and confirms no captions on this video. */
  | { status: "no-captions" }
  /** Terminal error: private, age-restricted, rate-limited, etc. */
  | { status: "terminal"; error: Error }
  /** All InnerTube clients returned non-terminal HTTP errors — IP blocked. */
  | { status: "blocked" };

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
 * Lightweight InnerTube metadata check.
 *
 * Calls the player API once (trying each client in turn) to determine whether
 * captions exist for a video — WITHOUT downloading any caption XML.
 * This is Phase 1 of the transcript pipeline: it routes subsequent work so we
 * don't waste time on subtitle strategies when no captions exist.
 *
 * Returns one of four outcomes:
 *   has-captions  → caption tracks found; ready to download XML
 *   no-captions   → player responded but has no caption tracks
 *   terminal      → private / age-restricted / rate-limited
 *   blocked       → all clients returned HTTP errors (Replit IP block)
 */
async function checkInnerTubePlayerData(videoId: string): Promise<CaptionAvailability> {
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const playerRes = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
        {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify({
            context: client.context,
            videoId,
            playbackContext: { contentPlaybackContext: { signatureTimestamp: 0 } },
          }),
        }
      );

      if (!playerRes.ok) {
        if (playerRes.status === 429) {
          return {
            status: "terminal",
            error: new Error("TOO_MANY_REQUESTS: YouTube is rate-limiting requests. Please try again shortly."),
          };
        }
        console.warn(`[transcriptCache] metadata check ${client.name} HTTP ${playerRes.status} for ${videoId}`);
        continue; // try next client
      }

      const player = (await playerRes.json()) as InnerTubePlayerResponse;
      const playStatus = safeStr(player.playabilityStatus?.status);

      if (playStatus && INNERTUBE_TERMINAL_STATUSES.has(playStatus)) {
        if (playStatus === "LOGIN_REQUIRED") {
          return {
            status: "terminal",
            error: new Error("LOGIN_REQUIRED: This video requires a signed-in YouTube account to access."),
          };
        }
        if (playStatus === "AGE_CHECK_REQUIRED" || playStatus === "AGE_VERIFICATION_REQUIRED") {
          return {
            status: "terminal",
            error: new Error("CONTENT_RESTRICTED: This video is age-restricted and cannot be accessed without sign-in."),
          };
        }
        const reason = safeStr(player.playabilityStatus?.reason) ?? playStatus;
        return {
          status: "terminal",
          error: new Error(`CONTENT_RESTRICTED: YouTube reports this video is restricted — ${reason}`),
        };
      }

      const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      if (tracks.length === 0) {
        console.log(`[transcriptCache] metadata/${client.name}: no caption tracks for ${videoId}`);
        return { status: "no-captions" };
      }

      console.log(
        `[transcriptCache] metadata/${client.name}: ${tracks.length} caption track(s) for ${videoId}`
      );
      return { status: "has-captions", tracks, clientName: client.name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[transcriptCache] metadata check ${client.name} failed for ${videoId}: ${msg}`);
    }
  }

  return { status: "blocked" };
}

/**
 * Download and parse caption XML from pre-fetched InnerTube caption tracks.
 *
 * Called after checkInnerTubePlayerData() returns has-captions. Reuses the
 * track list already retrieved in Phase 1 — no second player API call needed.
 */
async function fetchCaptionsFromTracks(
  tracks: InnerTubeCaptionTrack[],
  videoId: string,
  userAgent?: string
): Promise<TranscriptResponse[]> {
  const ranked = rankCaptionTracks(tracks);
  const best = ranked[0];
  if (!best?.baseUrl) return [];

  const captionUrl = new URL(best.baseUrl);
  captionUrl.searchParams.set("fmt", "srv3");
  captionUrl.searchParams.set("tlang", "en");

  const res = await fetch(captionUrl.toString(), {
    headers: {
      "User-Agent":
        userAgent ??
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    console.warn(
      `[transcriptCache] fetchCaptionsFromTracks: HTTP ${res.status} for ${videoId} (${best.languageCode})`
    );
    return [];
  }

  const xml = await res.text();
  const elements = parseTimedTextXml(xml);
  if (elements.length === 0) return [];

  console.log(
    `[transcriptCache] fetchCaptionsFromTracks OK ${videoId} lang=${best.languageCode} — ${elements.length} segs`
  );
  return elements.map((el) => ({
    text: el.text,
    offset: parseFloat(el.start) * 1000,
    duration: parseFloat(el.dur) * 1000,
    lang: best.languageCode,
  }));
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
  /**
   * When true, skip all caption-fetching strategies (Phases 1 & 2) and go
   * straight to audio download + Whisper transcription. Use when official
   * captions are known to be unavailable or previous runs returned empty results.
   */
  audioOnly?: boolean;
  /**
   * Called once when a live fetch is about to begin (i.e. after confirming
   * there is no usable cache entry). Never called on cache hits.
   * Use this to surface a "Fetching transcript…" progress indicator to the user.
   */
  onFetchStart?: () => void;
}

/**
 * Fetch a transcript, returning a cached result when available.
 *
 * On a cache miss (or when bypassCache=true), runs a metadata-first pipeline:
 *
 * Phase 1 — InnerTube player API check (no caption XML downloaded yet).
 *   Determines whether captions exist and surfaces terminal errors immediately.
 *
 * Phase 2a — Captions confirmed available:
 *   a) Download caption XML from InnerTube tracks (data from Phase 1 reused)
 *   b) yt-dlp subtitle extraction
 *   c) YouTube /api/timedtext direct XML
 *   d) youtube-transcript library
 *
 * Phase 2b — Captions confirmed absent:
 *   → Skip straight to audio transcription.
 *
 * Phase 2c — InnerTube blocked (can't determine availability):
 *   → Try yt-dlp → timedtext → youtube-transcript library.
 *
 * Phase 3 — Audio transcription (yt-dlp audio + ffmpeg + OpenAI Whisper).
 *   Only attempted if all subtitle strategies returned nothing.
 *
 * Each strategy is tried at most once per request (no duplicate retries).
 * Terminal errors propagate immediately — no further strategy will succeed.
 */
export async function fetchTranscriptCached(
  input: string,
  options: FetchTranscriptOptions = {}
): Promise<{ segments: TranscriptResponse[]; noCaptionsDetected: boolean }> {
  const { bypassCache = false, config, audioOnly = false, onFetchStart } = options;
  const videoId = extractVideoId(input);

  // audioOnly=true skips the cache read so audio transcription always runs,
  // regardless of any previously cached caption-based transcript.
  if (videoId && !bypassCache && !audioOnly) {
    evictExpired();
    const hit = cache.get(videoId);
    if (hit) {
      // Evict stale entries where Gemini returned a refusal text that was
      // cached before the refusal-detection guard was added.  These are
      // single-segment entries whose text body (after the Gemini source label)
      // is an inability/refusal message rather than an actual transcript.
      const GEMINI_LABEL = "[AI-generated transcript via Gemini]";
      if (hit.segments.length === 1 && hit.segments[0].text.startsWith(GEMINI_LABEL)) {
        const body = hit.segments[0].text.slice(GEMINI_LABEL.length).trimStart();
        _isTranscriptRefusal ??= (await import("./geminiTranscript")).isTranscriptRefusal;
        if (_isTranscriptRefusal(body)) {
          console.warn(
            `[transcriptCache] EVICT ${videoId} — cached entry contains a Gemini refusal (stale). Fetching live.`
          );
          cache.delete(videoId);
          // fall through to live fetch below
        } else {
          const age = Math.round((Date.now() - hit.cachedAt) / 1000);
          console.log(`[transcriptCache] HIT  ${videoId} — ${hit.segments.length} segs, cached ${age}s ago`);
          return { segments: hit.segments, noCaptionsDetected: false };
        }
      } else {
        const age = Math.round((Date.now() - hit.cachedAt) / 1000);
        console.log(`[transcriptCache] HIT  ${videoId} — ${hit.segments.length} segs, cached ${age}s ago`);
        return { segments: hit.segments, noCaptionsDetected: false };
      }
    }
  }

  if (videoId && bypassCache) {
    console.log(`[transcriptCache] BYPASS ${videoId} — fetching live and overwriting cache`);
  }

  // Notify the caller that a live fetch is starting (cache miss confirmed).
  // Callers use this to surface a progress indicator to the user.
  onFetchStart?.();

  const resolvedId = videoId ?? input.trim();
  let segments: TranscriptResponse[] = [];
  let source = "unknown";

  // ── Phase 0: Gemini native video understanding ────────────────────────────
  // Passes the YouTube URL directly to Gemini 2.5 Flash as a fileData part.
  // Gemini 2.0+ models support YouTube URL-based video processing natively
  // via fileData.fileUri.
  // Google fetches and processes the video from its own infrastructure — no
  // yt-dlp, no ffmpeg, no server-IP blocks, no file-size limit.
  // Skipped silently when the API key is absent or this is not a YouTube URL.
  if (videoId) {
    try {
      const { fetchTranscriptViaGemini, isGeminiTranscriptAvailable } = await import("./geminiTranscript");
      if (isGeminiTranscriptAvailable()) {
        const refreshTag = bypassCache ? " (bypass/refresh)" : "";
        console.log(`[transcriptCache] Phase 0: trying Gemini for ${resolvedId}${refreshTag}`);
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const geminiText = await fetchTranscriptViaGemini(videoUrl);
        if (geminiText) {
          segments = [{ text: `[AI-generated transcript via Gemini]\n\n${geminiText}`, offset: 0, duration: 0, lang: "en" }];
          source = "gemini";
          console.log(`[transcriptCache] Phase 0 Gemini OK ${resolvedId} — ${geminiText.length} chars`);
          evictExpired();
          if (!cache.has(videoId) && cache.size >= MAX_ENTRIES) evictOldest();
          cache.set(videoId, { segments, cachedAt: Date.now() });
          const reason = bypassCache ? "BYPASS→stored" : "MISS→stored";
          console.log(`[transcriptCache] ${reason} ${videoId} via ${source} (cache size: ${cache.size})`);
          return { segments, noCaptionsDetected: false };
        }
      } else {
        console.warn("[transcriptCache] Phase 0 skipped — no Gemini key configured (set GOOGLE_GEMINI_API_KEY for direct access, or AI_INTEGRATIONS_GEMINI_API_KEY for proxy)");
      }
    } catch (geminiErr) {
      const geminiErrMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      const geminiCause = geminiErr instanceof Error && geminiErr.cause
        ? ` (cause: ${geminiErr.cause instanceof Error ? geminiErr.cause.message : String(geminiErr.cause)})`
        : "";
      console.warn(
        `[transcriptCache] Phase 0 Gemini failed for ${resolvedId} — falling through to Phase 1: ` +
        geminiErrMsg + geminiCause
      );
      if (geminiErr instanceof Error && geminiErr.stack) {
        console.warn(`[transcriptCache] Phase 0 stack: ${geminiErr.stack}`);
      }
    }
  }

  // ── Phase 0.5: Supadata cloud transcript API ──────────────────────────────
  // Supadata runs its own infrastructure (residential IPs) so YouTube's
  // datacenter IP blocks don't apply.  It also has an AI fallback (mode=auto)
  // that generates a transcript even when YouTube has no captions at all.
  // Skipped when SUPADATA_API_KEY is not set or segments were already found.
  if (videoId && segments.length === 0) {
    try {
      const { fetchTranscriptViaSupadata, isSupadataAvailable } = await import("./supadataTranscript");
      if (isSupadataAvailable()) {
        const refreshTag = bypassCache ? " (bypass/refresh)" : "";
        console.log(`[transcriptCache] Phase 0.5: trying Supadata for ${resolvedId}${refreshTag}`);
        const supadataSegs = await fetchTranscriptViaSupadata(resolvedId);
        if (supadataSegs.length > 0) {
          segments = supadataSegs;
          source = "supadata";
          const totalChars = supadataSegs.reduce((n, s) => n + s.text.length, 0);
          console.log(
            `[transcriptCache] Phase 0.5 Supadata OK ${resolvedId} — ` +
            `${supadataSegs.length} segs, ${totalChars} chars`
          );
          evictExpired();
          if (!cache.has(videoId) && cache.size >= MAX_ENTRIES) evictOldest();
          cache.set(videoId, { segments, cachedAt: Date.now() });
          const reason = bypassCache ? "BYPASS→stored" : "MISS→stored";
          console.log(`[transcriptCache] ${reason} ${videoId} via ${source} (cache size: ${cache.size})`);
          return { segments, noCaptionsDetected: false };
        }
      } else {
        console.log(
          "[transcriptCache] Phase 0.5 skipped — SUPADATA_API_KEY not set " +
          "(get a free key at https://dash.supadata.ai)"
        );
      }
    } catch (supadataErr) {
      const msg = supadataErr instanceof Error ? supadataErr.message : String(supadataErr);
      console.warn(
        `[transcriptCache] Phase 0.5 Supadata failed for ${resolvedId} — falling through to Phase 1: ${msg}`
      );
    }
  }

  // ── audioOnly fast-path: skip Phases 1 & 2 entirely ──────────────────────
  if (audioOnly) {
    console.log(`[transcriptCache] audioOnly=true for ${resolvedId} — going straight to audio transcription`);
    audioAttemptCount++;
    try {
      const audioSegs = await fetchAudioTranscript(resolvedId, input);
      if (audioSegs.length > 0) {
        segments = audioSegs;
        source = "audio-transcription";
        console.log(
          `[transcriptCache] yt-dlp audio download OK ${resolvedId} — ` +
            `${audioSegs.reduce((n, s) => n + s.text.length, 0)} chars`
        );
      } else {
        const hasOpenAIKey = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        const emptyReason = hasOpenAIKey
          ? "fetchAudioTranscript returned 0 segments (Whisper empty output, file too large, or audio download produced no file)"
          : "OpenAI API key not configured — audio transcription skipped";
        recordAudioFailure(resolvedId, "empty-output", true, emptyReason);
      }
    } catch (audioErr) {
      const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
      if (msg.startsWith("YTDLP_UNAVAILABLE:")) {
        console.warn(`[transcriptCache] audio transcription skipped: yt-dlp not available`);
        recordAudioFailure(resolvedId, "yt-dlp-not-installed", true, msg);
        throw audioErr;
      }
      if (/^(LOGIN_REQUIRED|CONTENT_RESTRICTED|TOO_MANY_REQUESTS|RATE_LIMITED):/.test(msg)) {
        recordAudioFailure(resolvedId, "yt-dlp-blocked", true, msg);
        throw audioErr;
      }
      if (msg.startsWith("AUDIO_DOWNLOAD_FAILED:")) {
        const detail = msg.slice("AUDIO_DOWNLOAD_FAILED:".length).trim();
        console.warn(`[transcriptCache] audio-download-failed for ${resolvedId}: ${detail}`);
        recordAudioFailure(resolvedId, "yt-dlp-download-failed", true, detail);
        throw audioErr;
      }
      console.warn(`[transcriptCache] audio transcription failed for ${resolvedId}: ${msg}`);
      recordAudioFailure(resolvedId, classifyAudioError(msg), true, msg);
    }

    if (videoId && segments.length > 0) {
      evictExpired();
      if (!cache.has(videoId) && cache.size >= MAX_ENTRIES) evictOldest();
      cache.set(videoId, { segments, cachedAt: Date.now() });
      const reason = bypassCache ? "BYPASS→stored" : "MISS→stored";
      console.log(
        `[transcriptCache] ${reason} ${videoId} via ${source} — ${segments.length} segs (cache size: ${cache.size})`
      );
    }

    return { segments, noCaptionsDetected: false };
  }

  // ── Phase 1: InnerTube metadata check ────────────────────────────────────
  // One lightweight API call that tells us: captions exist / don't exist / terminal / blocked.
  // This avoids wasting time on subtitle strategies when a video has no captions at all.
  const meta = await checkInnerTubePlayerData(resolvedId);

  if (meta.status === "terminal") {
    console.log(`[transcriptCache] terminal error from metadata check for ${resolvedId}: ${meta.error.message}`);
    throw meta.error;
  }

  const hasCaptions = meta.status === "has-captions";
  const noCaptions  = meta.status === "no-captions";
  const isBlocked   = meta.status === "blocked";

  // ── Phase 2: Route based on metadata ─────────────────────────────────────

  if (noCaptions) {
    // Fast path: player API confirmed no captions → nothing to look up with subtitle tools
    console.log(
      `[transcriptCache] no captions confirmed for ${resolvedId} — skipping subtitle strategies`
    );
  } else {
    // hasCaptions OR blocked — attempt subtitle strategies

    // ── 2a: Download caption XML from InnerTube tracks ─────────────────────
    // If Phase 1 succeeded we already have the track list — just download the XML.
    // If Phase 1 was blocked, skip InnerTube entirely (already failed for this request).
    if (hasCaptions) {
      try {
        const clientHeaders = INNERTUBE_CLIENTS.find((c) => c.name === meta.clientName)?.headers;
        const userAgent = clientHeaders?.["User-Agent"] as string | undefined;
        segments = await fetchCaptionsFromTracks(meta.tracks, resolvedId, userAgent);
        if (segments.length > 0) {
          source = `innertube/${meta.clientName}`;
        } else {
          console.log(
            `[transcriptCache] InnerTube caption XML returned 0 segs for ${resolvedId} — trying yt-dlp`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/^(LOGIN_REQUIRED|CONTENT_RESTRICTED|TOO_MANY_REQUESTS):/.test(msg)) throw err;
        console.warn(`[transcriptCache] InnerTube caption download failed for ${resolvedId}: ${msg}`);
      }
    } else {
      // isBlocked — InnerTube is unavailable; log and fall through to yt-dlp
      console.log(
        `[transcriptCache] InnerTube blocked for ${resolvedId} — trying yt-dlp subtitles`
      );
    }

    // ── 2b: yt-dlp subtitle extraction ─────────────────────────────────────
    if (segments.length === 0) {
      try {
        segments = await fetchYtDlpTranscript(resolvedId);
        if (segments.length > 0) {
          source = "yt-dlp";
        } else {
          console.log(`[transcriptCache] yt-dlp 0 segs for ${resolvedId} — trying timedtext`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/^(LOGIN_REQUIRED|CONTENT_RESTRICTED|TOO_MANY_REQUESTS):/.test(msg)) throw err;
        console.warn(`[transcriptCache] yt-dlp failed for ${resolvedId}: ${msg}`);
      }
    }

    // ── 2c: YouTube /api/timedtext direct XML ──────────────────────────────
    if (segments.length === 0) {
      try {
        segments = await fetchTimedTextTranscript(resolvedId);
        if (segments.length > 0) {
          source = "timedtext";
          console.log(`[transcriptCache] timedtext OK ${resolvedId} — ${segments.length} segs`);
        } else {
          console.log(`[transcriptCache] timedtext 0 segs for ${resolvedId} — trying youtube-transcript`);
        }
      } catch (err) {
        console.warn(
          `[transcriptCache] timedtext failed for ${resolvedId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // ── 2d: youtube-transcript library ─────────────────────────────────────
    if (segments.length === 0) {
      try {
        const { YoutubeTranscript } = await import("youtube-transcript/dist/youtube-transcript.esm.js");
        segments = await YoutubeTranscript.fetchTranscript(input, config);
        if (segments.length > 0) {
          source = "youtube-transcript";
          console.log(`[transcriptCache] youtube-transcript OK ${resolvedId} — ${segments.length} segs`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[transcriptCache] youtube-transcript failed for ${resolvedId}: ${msg}`);
      }
    }
  }

  // ── Phase 3: Audio transcription ─────────────────────────────────────────
  // Reached when:
  //   • Captions confirmed absent (noCaptions) — fastest path into here
  //   • All subtitle strategies returned nothing
  // Downloads audio via yt-dlp (with --impersonate chrome), converts to WAV,
  // transcribes via Whisper. Runs BEFORE the browser and local-worker fallbacks
  // so the one path that works is tried as the third option, not the last.
  if (segments.length === 0) {
    const reason = noCaptions
      ? "no captions — going straight to audio transcription"
      : "all subtitle strategies failed — trying audio transcription";
    console.log(`[transcriptCache] ${reason} for ${resolvedId}`);
    audioAttemptCount++;
    try {
      const audioSegs = await fetchAudioTranscript(resolvedId, input);
      if (audioSegs.length > 0) {
        segments = audioSegs;
        source = "audio-transcription";
        console.log(
          `[transcriptCache] yt-dlp audio download OK ${resolvedId} — ` +
            `${audioSegs.reduce((n, s) => n + s.text.length, 0)} chars`
        );
      } else {
        const hasOpenAIKey = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        const emptyReason = hasOpenAIKey
          ? "fetchAudioTranscript returned 0 segments (Whisper empty output, file too large, or audio download produced no file)"
          : "OpenAI API key not configured — audio transcription skipped";
        recordAudioFailure(resolvedId, "empty-output", noCaptions, emptyReason);
      }
    } catch (audioErr) {
      const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
      if (msg.startsWith("YTDLP_UNAVAILABLE:")) {
        console.warn(`[transcriptCache] audio transcription skipped: yt-dlp not available`);
        recordAudioFailure(resolvedId, "yt-dlp-not-installed", noCaptions, msg);
        throw audioErr;
      }
      if (/^(LOGIN_REQUIRED|CONTENT_RESTRICTED|TOO_MANY_REQUESTS|RATE_LIMITED):/.test(msg)) {
        recordAudioFailure(resolvedId, "yt-dlp-blocked", noCaptions, msg);
        throw audioErr;
      }
      if (msg.startsWith("AUDIO_DOWNLOAD_FAILED:")) {
        const detail = msg.slice("AUDIO_DOWNLOAD_FAILED:".length).trim();
        console.warn(
          `[transcriptCache] audio-download-failed for ${resolvedId}: ${detail}`
        );
        recordAudioFailure(resolvedId, "yt-dlp-download-failed", noCaptions, detail);
        throw audioErr;
      }
      console.warn(`[transcriptCache] audio transcription non-terminal failure for ${resolvedId}: ${msg}`);
      recordAudioFailure(resolvedId, classifyAudioError(msg), noCaptions, msg);
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

  return { segments, noCaptionsDetected: noCaptions };
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
