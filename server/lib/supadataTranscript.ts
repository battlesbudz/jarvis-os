/**
 * Supadata YouTube Transcript
 *
 * Uses the Supadata REST API directly (no SDK) to fetch YouTube transcripts via
 * their cloud infrastructure — bypassing YouTube's IP blocks on datacenter servers.
 *
 * Strategy:
 *   1. Try native captions first (mode=native) — fast, no credits used.
 *   2. If no native captions, request AI generation (mode=auto).
 *   3. If mode=auto returns HTTP 202, an async job has started. Poll the job
 *      status endpoint with exponential backoff for up to 10 minutes.
 *
 * When a userId is provided and Supadata returns an async job ID, the job is
 * tracked in the DB and a SupadataJobPendingError is thrown so the caller can
 * respond to the user immediately instead of blocking for minutes.
 *
 * Requires the SUPADATA_API_KEY environment variable.
 */

import type { TranscriptResponse } from "youtube-transcript";

const BASE = "https://api.supadata.ai/v1";

/** Max time to poll an async Supadata job when no userId is provided (synchronous fallback). */
const JOB_POLL_TIMEOUT_MS = 600_000; // 10 minutes — long videos need this long
/** Starting poll interval for exponential backoff. */
const JOB_POLL_INTERVAL_START_MS = 3_000;
/** Maximum poll interval cap. */
const JOB_POLL_INTERVAL_MAX_MS = 30_000;
/** Log progress every N ms while polling. */
const JOB_POLL_LOG_INTERVAL_MS = 30_000;

/**
 * Thrown when Supadata returns an async job ID and a userId is available.
 * The job is being tracked in the DB and will complete in the background.
 */
export class SupadataJobPendingError extends Error {
  constructor(public readonly jobId: string) {
    super(`SUPADATA_JOB_PENDING:${jobId}`);
    this.name = "SupadataJobPendingError";
  }
}

/** Returns true when a Supadata API key is configured. */
export function isSupadataAvailable(): boolean {
  return !!process.env.SUPADATA_API_KEY;
}

/**
 * Fetch a YouTube transcript via the Supadata REST API.
 *
 * Strategy:
 *   1. Try native captions first (mode=native) — fast, free.
 *   2. If 404 or empty, request AI generation (mode=auto) — costs credits.
 *   3. If mode=auto returns 202 (async job started):
 *      - When userId is provided: save to DB + throw SupadataJobPendingError.
 *      - When no userId: poll synchronously with exponential backoff, up to 10 min.
 *
 * @param videoId - The 11-character YouTube video ID
 * @param userId - Optional user ID for async job tracking on long videos
 * @returns Array of transcript segments matching TranscriptResponse shape
 * @throws SupadataJobPendingError when an async job was started (userId provided)
 * @throws If Supadata returns an error or the async job times out
 */
export async function fetchTranscriptViaSupadata(
  videoId: string,
  userId?: string
): Promise<TranscriptResponse[]> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("SUPADATA_API_KEY is not set");

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };

  // ── Step 1: Try native captions (fast, no credits) ─────────────────────────
  const nativeUrl = `${BASE}/youtube/transcript?videoId=${encodeURIComponent(videoId)}&lang=en&mode=native`;
  console.log(`[supadataTranscript] Trying native captions for ${videoId}`);

  let nativeRes: Response;
  try {
    nativeRes = await fetch(nativeUrl, { headers });
  } catch (fetchErr) {
    throw new Error(
      `Supadata network error (native): ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
    );
  }

  if (nativeRes.ok) {
    const data = await nativeRes.json() as SupadataTranscriptResponse;
    const segments = parseSupadataResponse(videoId, data);
    if (segments.length > 0) {
      console.log(`[supadataTranscript] Native captions OK for ${videoId} — ${segments.length} segs`);
      return segments;
    }
    // Empty response — fall through to AI generation
    console.log(`[supadataTranscript] Native captions returned empty for ${videoId} — trying AI generation`);
  } else if (nativeRes.status === 404 || nativeRes.status === 400) {
    // No native captions available — expected, fall through to AI generation
    const body = await nativeRes.text().catch(() => "");
    console.log(`[supadataTranscript] No native captions for ${videoId} (${nativeRes.status}) — trying AI generation. Body: ${body.slice(0, 200)}`);
  } else {
    // Unexpected error on native step — log but still try auto
    const body = await nativeRes.text().catch(() => "");
    console.warn(`[supadataTranscript] Native captions unexpected ${nativeRes.status} for ${videoId}: ${body.slice(0, 200)}`);
  }

  // ── Step 2: Request AI generation (mode=auto) ──────────────────────────────
  const autoUrl = `${BASE}/youtube/transcript?videoId=${encodeURIComponent(videoId)}&lang=en&mode=auto`;
  console.log(`[supadataTranscript] Requesting AI generation (mode=auto) for ${videoId}`);

  let autoRes: Response;
  try {
    autoRes = await fetch(autoUrl, { headers });
  } catch (fetchErr) {
    throw new Error(
      `Supadata network error (auto): ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
    );
  }

  if (autoRes.status === 202) {
    // Async job started — poll or delegate
    const jobData = await autoRes.json() as { jobId: string };
    const jobId = jobData.jobId;
    console.log(`[supadataTranscript] Async job started: ${jobId} for ${videoId}`);

    if (userId) {
      // Save to DB and throw so the caller can tell the user it's in progress
      const { startSupadataJob } = await import("./transcriptJobTracker");
      await startSupadataJob(userId, videoId, jobId);
      throw new SupadataJobPendingError(jobId);
    } else {
      // No userId — fall back to synchronous polling
      return await pollSupadataJob(apiKey, jobId, videoId);
    }
  }

  if (autoRes.ok) {
    const data = await autoRes.json() as SupadataTranscriptResponse;
    const segments = parseSupadataResponse(videoId, data);
    if (segments.length > 0) {
      console.log(`[supadataTranscript] AI generation OK for ${videoId} — ${segments.length} segs`);
      return segments;
    }
    throw new Error(`Supadata returned empty transcript for ${videoId} (mode=auto)`);
  }

  // Error response — capture and throw with full detail
  const errBody = await autoRes.text().catch(() => "(could not read body)");
  throw new Error(`Supadata ${autoRes.status} for ${videoId}: ${errBody}`);
}

// ── Internal types ────────────────────────────────────────────────────────────

interface SupadataChunk {
  text: string;
  offset: number;
  duration: number;
  lang?: string;
}

interface SupadataTranscriptResponse {
  content: SupadataChunk[] | string;
  lang?: string;
}

interface SupadataJobStatusResponse {
  status: "queued" | "active" | "completed" | "failed";
  result?: SupadataTranscriptResponse;
  error?: { error: string; message?: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSupadataResponse(
  videoId: string,
  transcript: SupadataTranscriptResponse
): TranscriptResponse[] {
  const content = transcript.content;

  if (typeof content === "string") {
    if (!content.trim()) return [];
    return [{ text: content.trim(), offset: 0, duration: 0, lang: transcript.lang ?? "en" }];
  }

  if (!Array.isArray(content) || content.length === 0) return [];

  return content.map((chunk) => ({
    text: chunk.text,
    offset: chunk.offset,
    duration: chunk.duration,
    lang: chunk.lang ?? transcript.lang ?? "en",
  }));
}

/**
 * Polls a Supadata async job until it completes or the timeout is reached.
 * Uses exponential backoff: starts at 3s, doubles each miss, caps at 30s.
 * Logs progress every 30 seconds so the server logs show activity.
 */
async function pollSupadataJob(
  apiKey: string,
  jobId: string,
  videoId: string
): Promise<TranscriptResponse[]> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  const statusUrl = `${BASE}/youtube/transcript/${encodeURIComponent(jobId)}`;

  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  let intervalMs = JOB_POLL_INTERVAL_START_MS;
  let lastLogAt = Date.now();

  console.log(`[supadataTranscript] Polling job ${jobId} for ${videoId} (max ${JOB_POLL_TIMEOUT_MS / 1000}s)`);

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const elapsed = Math.round((Date.now() - (deadline - JOB_POLL_TIMEOUT_MS)) / 1000);
    if (Date.now() - lastLogAt >= JOB_POLL_LOG_INTERVAL_MS) {
      console.log(`[supadataTranscript] Still waiting for job ${jobId} — ${elapsed}s elapsed`);
      lastLogAt = Date.now();
    }

    let res: Response;
    try {
      res = await fetch(statusUrl, { headers });
    } catch (fetchErr) {
      console.warn(`[supadataTranscript] Poll network error for job ${jobId}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
      // Don't abort on transient network errors — keep polling
      intervalMs = Math.min(intervalMs * 2, JOB_POLL_INTERVAL_MAX_MS);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[supadataTranscript] Poll error ${res.status} for job ${jobId}: ${body.slice(0, 200)}`);
      intervalMs = Math.min(intervalMs * 2, JOB_POLL_INTERVAL_MAX_MS);
      continue;
    }

    const job = await res.json() as SupadataJobStatusResponse;

    if (job.status === "completed" && job.result) {
      const segments = parseSupadataResponse(videoId, job.result);
      const elapsed2 = Math.round((Date.now() - (deadline - JOB_POLL_TIMEOUT_MS)) / 1000);
      if (segments.length === 0) {
        throw new Error(
          `Supadata job ${jobId} completed for ${videoId} but returned empty content (no speech detected or AI generation produced no output).`
        );
      }
      console.log(`[supadataTranscript] Job ${jobId} completed after ${elapsed2}s — ${segments.length} segs`);
      return segments;
    }

    if (job.status === "failed") {
      const errMsg = job.error?.error ?? job.error?.message ?? "unknown error";
      throw new Error(`Supadata job ${jobId} failed for ${videoId}: ${errMsg}`);
    }

    // queued or active — keep polling with backoff
    intervalMs = Math.min(intervalMs * 2, JOB_POLL_INTERVAL_MAX_MS);
  }

  throw new Error(
    `Supadata AI generation timed out after ${JOB_POLL_TIMEOUT_MS / 60000} min for ${videoId}. ` +
    `This video has no native captions and AI generation is slow for long videos. ` +
    `The job (${jobId}) may still be running — try again in a few minutes.`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
