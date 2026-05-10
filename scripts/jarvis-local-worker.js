#!/usr/bin/env node
/**
 * Jarvis Local Worker — YouTube Transcript Fetcher + Audio Transcription
 *
 * Run this script on your PC to give Jarvis a local fallback for fetching
 * YouTube transcripts. When all server-side strategies fail (because YouTube
 * blocks Replit's cloud IPs), the server forwards the job here and your
 * machine fetches it instead.
 *
 * Two strategies are tried in order:
 *   1. yt-dlp subtitle extraction (fast, preferred)
 *   2. Audio download + server-side AI transcription (Whisper)
 *      — used when no official captions exist
 *
 * Requirements:
 *   - Node.js 18+
 *   - yt-dlp installed and on your PATH  (https://github.com/yt-dlp/yt-dlp)
 *   - ffmpeg (optional — needed only for splitting very long audio files)
 *
 * Setup:
 *   1. Get your token from Jarvis:
 *        Ask Jarvis: "show me my local worker token"
 *      Or open: https://gameplanjarvisai.up.railway.app/api/local-worker/token  (while logged in)
 *
 *   2. Run:
 *        TOKEN=lw_xxxxx SERVER=https://gameplanjarvisai.up.railway.app node jarvis-local-worker.js
 *
 *      Or set them at the top of this file:
 */

const TOKEN = process.env.TOKEN || "";
const SERVER = (process.env.SERVER || "").replace(/\/$/, "");

// ────────────────────────────────────────────────────────────────────────────

const { execSync, spawnSync } = require("child_process");
const { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } = require("fs");
const path = require("path");
const os = require("os");

if (!TOKEN || !SERVER) {
  console.error("Usage: TOKEN=lw_xxx SERVER=https://gameplanjarvisai.up.railway.app node jarvis-local-worker.js");
  process.exit(1);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── SRT parser (mirrors the server-side version) ──────────────────────────────

function parseSrt(content) {
  const blocks = content.trim().split(/\n\s*\n/);
  const segments = [];
  const tsRe = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/;

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const tsLineIdx = lines.findIndex((l) => tsRe.test(l));
    if (tsLineIdx === -1) continue;

    const m = tsRe.exec(lines[tsLineIdx]);
    const startMs =
      (parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])) * 1000 + parseInt(m[4]);
    const endMs =
      (parseInt(m[5]) * 3600 + parseInt(m[6]) * 60 + parseInt(m[7])) * 1000 + parseInt(m[8]);

    const text = lines
      .slice(tsLineIdx + 1)
      .map((l) => l.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").trim())
      .filter(Boolean)
      .join(" ");

    if (text) segments.push({ text, offset: startMs, duration: endMs - startMs });
  }

  return segments;
}

// ── Subtitle fetch via yt-dlp ─────────────────────────────────────────────────

function fetchSubtitles(url) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ytdlp-lw-"));
  try {
    const outputTemplate = path.join(tmpDir, "%(id)s");
    const result = spawnSync(
      "yt-dlp",
      [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", "en.*,en",
        "--convert-subs", "srt",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--no-progress",
        "--output", outputTemplate,
        "--", url,
      ],
      { timeout: 60_000, encoding: "utf-8" }
    );

    if (result.status !== 0) {
      const errMsg = (result.stderr || result.stdout || "yt-dlp exited non-zero").slice(0, 500);
      throw new Error(errMsg);
    }

    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".srt"));
    if (files.length === 0) return [];

    const best =
      files.find((f) => /\.(en|en-US|en-GB)\.srt$/.test(f)) ??
      files.find((f) => /\.en/.test(f)) ??
      files[0];

    const content = readFileSync(path.join(tmpDir, best), "utf-8");
    return parseSrt(content);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── Audio download + server-side Whisper transcription ───────────────────────
// Used as a fallback when no official captions exist.
// - Your PC downloads the audio (no IP blocks)
// - The server transcribes via OpenAI Whisper (API key stays on server)

const WHISPER_MAX_BYTES = 23 * 1024 * 1024; // 23 MB — leave headroom under 25 MB limit
const CHUNK_SECS = 600;                       // 10 minutes per chunk

/** Check whether ffmpeg is available. */
function hasFfmpeg() {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); return true; } catch { return false; }
}

/** Get total duration of an audio file via ffprobe (seconds). */
function getAudioDuration(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: "utf-8", timeout: 15_000 }
    );
    return parseFloat(out.trim()) || 0;
  } catch { return 0; }
}

/** POST base64-encoded audio to the server for Whisper transcription. */
async function transcribeChunk(audioB64, format) {
  const resp = await apiFetch(
    "POST",
    `${SERVER}/api/local-worker/transcribe-audio?token=${TOKEN}`,
    { audio: audioB64, format }
  );
  if (resp.status !== 200) {
    throw new Error(`Server transcription error ${resp.status}: ${JSON.stringify(resp.body)}`);
  }
  return resp.body?.transcript || "";
}

/** Download audio for a YouTube URL and transcribe via Whisper. */
async function fetchAudioTranscript(url) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ytaudio-lw-"));

  try {
    log("  Downloading audio (this may take a minute)…");
    const outputTemplate = path.join(tmpDir, "%(id)s.%(ext)s");
    const result = spawnSync(
      "yt-dlp",
      [
        "-f", "bestaudio[filesize<100M]/bestaudio",
        "--extract-audio",
        "--audio-format", "mp3",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--no-progress",
        "--max-filesize", "100M",
        "--output", outputTemplate,
        "--", url,
      ],
      { timeout: 180_000, encoding: "utf-8" }
    );

    if (result.status !== 0) {
      const errMsg = (result.stderr || result.stdout || "yt-dlp audio download failed").slice(0, 500);
      throw new Error(errMsg);
    }

    const files = readdirSync(tmpDir).filter((f) => /\.(mp3|m4a|opus|webm)$/i.test(f));
    if (files.length === 0) throw new Error("yt-dlp produced no audio file");

    const audioPath = path.join(tmpDir, files[0]);
    const audioExt = path.extname(files[0]).slice(1).toLowerCase() || "mp3";
    const audioSize = statSync(audioPath).size;

    log(`  Audio downloaded: ${files[0]} (${(audioSize / 1024 / 1024).toFixed(1)} MB)`);

    // ── Single chunk (fits within Whisper limit) ─────────────────────────────
    if (audioSize <= WHISPER_MAX_BYTES) {
      log("  Sending to Whisper for transcription…");
      const audioB64 = readFileSync(audioPath).toString("base64");
      const transcript = await transcribeChunk(audioB64, audioExt);
      if (!transcript.trim()) throw new Error("Whisper returned empty transcript");
      return transcript.trim();
    }

    // ── Multi-chunk (split with ffmpeg) ─────────────────────────────────────
    if (!hasFfmpeg()) {
      throw new Error(
        `Audio is too large (${(audioSize / 1024 / 1024).toFixed(1)} MB) for a single Whisper request. ` +
        `Install ffmpeg to enable automatic chunking: https://ffmpeg.org/download.html`
      );
    }

    const totalDuration = getAudioDuration(audioPath);
    if (!totalDuration) throw new Error("Could not determine audio duration for chunking");

    log(`  Audio is large — splitting into ${CHUNK_SECS}s chunks for Whisper…`);
    const parts = [];
    let offset = 0;
    let chunkNum = 0;

    while (offset < totalDuration) {
      const chunkPath = path.join(tmpDir, `chunk-${chunkNum}.mp3`);
      execSync(
        `ffmpeg -i "${audioPath}" -ss ${offset} -t ${CHUNK_SECS} -acodec libmp3lame -q:a 4 -y "${chunkPath}"`,
        { stdio: "ignore", timeout: 60_000 }
      );
      const chunkB64 = readFileSync(chunkPath).toString("base64");
      log(`  Transcribing chunk ${chunkNum + 1}…`);
      const text = await transcribeChunk(chunkB64, "mp3");
      if (text.trim()) parts.push(text.trim());
      offset += CHUNK_SECS;
      chunkNum++;
    }

    if (parts.length === 0) throw new Error("All chunks returned empty transcripts");
    return parts.join(" ");

  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiFetch(method, url, body) {
  const { default: https } = await import("https");
  const { default: http } = await import("http");
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const data = body ? JSON.stringify(body) : undefined;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let consecutive404 = 0;

async function tick() {
  // Heartbeat
  await apiFetch("POST", `${SERVER}/api/local-worker/heartbeat?token=${TOKEN}`, {}).catch(() => {});

  // Poll for next job
  const resp = await apiFetch("GET", `${SERVER}/api/local-worker/jobs/next?token=${TOKEN}`).catch(
    (e) => { log(`Poll error: ${e.message}`); return null; }
  );

  if (!resp) return;
  if (resp.status === 401) {
    log("Invalid token — check TOKEN env variable. Exiting.");
    process.exit(1);
  }
  if (resp.status === 204) return; // no jobs
  if (resp.status === 404) {
    consecutive404++;
    if (consecutive404 >= 5) { log("Server not reachable (404). Will keep retrying."); consecutive404 = 0; }
    return;
  }
  consecutive404 = 0;

  const job = resp.body;
  if (!job?.id || !job?.url) return;

  log(`Claimed job ${job.id} — url: ${job.url}`);

  try {
    // ── Strategy 1: Subtitle extraction ───────────────────────────────────────
    log("  Trying subtitle extraction…");
    const segments = fetchSubtitles(job.url);

    if (segments.length > 0) {
      await apiFetch("POST", `${SERVER}/api/local-worker/jobs/${job.id}/complete?token=${TOKEN}`, { segments });
      log(`Job ${job.id} completed via subtitles — ${segments.length} segments`);
      return;
    }

    // ── Strategy 2: Audio transcription ───────────────────────────────────────
    log("  No subtitles found — trying audio transcription…");
    const transcript = await fetchAudioTranscript(job.url);

    // Return as a single AI-generated segment (matching server-side format)
    const aiSegments = [{
      text: `[AI-generated transcript — no official captions available]\n\n${transcript}`,
      offset: 0,
      duration: 0,
    }];

    await apiFetch("POST", `${SERVER}/api/local-worker/jobs/${job.id}/complete?token=${TOKEN}`, { segments: aiSegments });
    log(`Job ${job.id} completed via audio transcription — ${transcript.length} chars`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Job ${job.id} failed: ${msg}`);
    await apiFetch("POST", `${SERVER}/api/local-worker/jobs/${job.id}/fail?token=${TOKEN}`, { error: msg }).catch(() => {});
  }
}

log(`Jarvis local worker started — server: ${SERVER}`);
log("Strategies: subtitles → audio transcription (via Whisper)");
log("Polling for jobs every 5 seconds. Press Ctrl+C to stop.\n");

tick();
setInterval(tick, 5_000);
