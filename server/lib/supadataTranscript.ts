/**
 * Supadata YouTube Transcript
 *
 * Uses the Supadata API to fetch YouTube transcripts via their cloud
 * infrastructure — bypassing YouTube's IP blocks on datacenter servers.
 *
 * Uses mode='auto': tries native captions first, falls back to AI-generated
 * transcription when no captions exist. Async jobs (large videos) are polled
 * until complete or timeout.
 *
 * Requires the SUPADATA_API_KEY environment variable.
 */

import type { TranscriptResponse } from "youtube-transcript";

/** Max time to wait for an async Supadata job (large video transcription). */
const JOB_POLL_TIMEOUT_MS = 30_000;
const JOB_POLL_INTERVAL_MS = 2_000;

/** Returns true when a Supadata API key is configured. */
export function isSupadataAvailable(): boolean {
  return !!process.env.SUPADATA_API_KEY;
}

/**
 * Fetch a YouTube transcript via Supadata.
 *
 * Uses mode='auto': tries YouTube's native captions first, then falls back to
 * AI-generated transcription if no captions are available. This handles the
 * case where Phase 0 (Gemini) also fails due to no available captions.
 *
 * @param videoId - The 11-character YouTube video ID
 * @returns Array of transcript segments matching TranscriptResponse shape
 * @throws If Supadata returns an error, the video is private/unavailable, or
 *         the async job times out.
 */
export async function fetchTranscriptViaSupadata(videoId: string): Promise<TranscriptResponse[]> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("SUPADATA_API_KEY is not set");

  // Dynamic import so the module is only loaded when actually needed
  const { Supadata, SupadataError } = await import("@supadata/js");
  const client = new Supadata({ apiKey });

  let transcript;
  try {
    // Use the top-level transcript callable with mode='auto'
    // mode='auto': tries native captions first, AI-generates if unavailable
    const result = await client.transcript({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      lang: "en",
      mode: "auto",
    } as Parameters<typeof client.transcript>[0]);

    // Handle async job (202 response for large videos)
    if (result && "jobId" in result) {
      const jobId = (result as { jobId: string }).jobId;
      console.log(`[supadataTranscript] Async job started: ${jobId} for ${videoId}`);
      transcript = await pollSupadataJob(apiKey, jobId);
    } else {
      transcript = result;
    }
  } catch (err) {
    if (err instanceof SupadataError) {
      throw new Error(
        `Supadata error for ${videoId}: ${err.error} — ${err.message}${err.details ? ` (${err.details})` : ""}`
      );
    }
    throw err;
  }

  if (!transcript) {
    throw new Error(`Supadata returned no transcript for ${videoId}`);
  }

  const content = transcript.content;

  // Plain-text response (text: true was not set, but just in case)
  if (typeof content === "string") {
    if (!content.trim()) throw new Error(`Supadata returned empty transcript text for ${videoId}`);
    return [{ text: content.trim(), offset: 0, duration: 0, lang: transcript.lang ?? "en" }];
  }

  // Structured chunk array (normal response)
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`Supadata returned empty transcript chunks for ${videoId}`);
  }

  return content.map((chunk) => ({
    text: chunk.text,
    offset: chunk.offset,        // already in milliseconds per Supadata spec
    duration: chunk.duration,    // already in milliseconds per Supadata spec
    lang: chunk.lang ?? transcript.lang ?? "en",
  }));
}

/**
 * Polls a Supadata async job until it completes or the timeout is reached.
 * Uses the REST API directly since `transcript.getJobStatus` is a property on
 * the callable function and may not surface correctly in all SDK versions.
 */
async function pollSupadataJob(
  apiKey: string,
  jobId: string,
): Promise<import("@supadata/js").Transcript> {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(JOB_POLL_INTERVAL_MS);
    const resp = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
      headers: { "x-api-key": apiKey },
    });
    if (!resp.ok) {
      throw new Error(`Supadata job poll failed: HTTP ${resp.status}`);
    }
    const job = await resp.json() as {
      status: string;
      result?: import("@supadata/js").Transcript | null;
      error?: { error?: string } | null;
    };
    if (job.status === "completed" && job.result) {
      console.log(`[supadataTranscript] Job ${jobId} completed`);
      return job.result;
    }
    if (job.status === "failed") {
      throw new Error(
        `Supadata job ${jobId} failed: ${job.error?.error ?? "unknown error"}`
      );
    }
    if (job.status === "cancelled") {
      throw new Error(`Supadata job ${jobId} was cancelled`);
    }
    // still 'processing' — keep polling
  }
  throw new Error(
    `Supadata job ${jobId} timed out after ${JOB_POLL_TIMEOUT_MS / 1000}s`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
