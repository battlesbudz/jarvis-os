#!/usr/bin/env node
/**
 * Jarvis Local Worker — YouTube Transcript Fetcher
 *
 * Run this script on your PC to give Jarvis a local fallback for fetching
 * YouTube transcripts. When all server-side strategies fail (because YouTube
 * blocks Replit's cloud IPs), the server forwards the job here and your
 * machine fetches it instead.
 *
 * Requirements:
 *   - Node.js 18+
 *   - yt-dlp installed and on your PATH  (https://github.com/yt-dlp/yt-dlp)
 *
 * Setup:
 *   1. Get your token from Jarvis:
 *        Ask Jarvis: "show me my local worker token"
 *      Or open: https://<your-replit-app>/api/local-worker/token  (while logged in)
 *
 *   2. Run:
 *        TOKEN=lw_xxxxx SERVER=https://your-app.replit.app node jarvis-local-worker.js
 *
 *      Or set them at the top of this file:
 */

const TOKEN = process.env.TOKEN || "";
const SERVER = (process.env.SERVER || "").replace(/\/$/, "");

// ────────────────────────────────────────────────────────────────────────────

const { execSync, spawnSync } = require("child_process");
const { mkdtempSync, rmSync, readdirSync, readFileSync } = require("fs");
const path = require("path");
const os = require("os");

if (!TOKEN || !SERVER) {
  console.error("Usage: TOKEN=lw_xxx SERVER=https://your-app.replit.app node jarvis-local-worker.js");
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

// ── Fetch transcript via yt-dlp ───────────────────────────────────────────────

function fetchTranscript(url) {
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
    const segments = fetchTranscript(job.url);
    if (segments.length === 0) throw new Error("yt-dlp returned no subtitle segments");
    await apiFetch("POST", `${SERVER}/api/local-worker/jobs/${job.id}/complete?token=${TOKEN}`, { segments });
    log(`Job ${job.id} completed — ${segments.length} segments`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Job ${job.id} failed: ${msg}`);
    await apiFetch("POST", `${SERVER}/api/local-worker/jobs/${job.id}/fail?token=${TOKEN}`, { error: msg }).catch(() => {});
  }
}

log(`Jarvis local worker started — server: ${SERVER}`);
log("Polling for jobs every 5 seconds. Press Ctrl+C to stop.\n");

tick();
setInterval(tick, 5_000);
