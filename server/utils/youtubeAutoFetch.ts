/**
 * YouTube Auto-Fetch Utility
 *
 * Detects YouTube URLs in a user message and proactively fetches their
 * transcripts so Jarvis can summarize without requiring the user to ask.
 */

import { fetchTranscriptCached } from "../lib/transcriptCache";
import { humanReadableSource } from "../lib/transcriptSourceLabel";

/** Per-URL character limit (prevents a single very long video from consuming the whole budget). */
const MAX_CHARS_PER_URL = 60_000;
/** Global character budget across all URLs in one request (prevents 3-URL × 80k = 240k blowup). */
const MAX_CHARS_TOTAL = 60_000;

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Find all YouTube video URLs in a string (deduped). */
export function findYouTubeUrls(text: string): string[] {
  const pat =
    /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?(?:[^\s&]*&)*v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})[^\s]*/gi;
  const seen = new Set<string>();
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pat.exec(text)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      results.push(m[0]);
    }
  }
  return results;
}

/**
 * Build a transcript context block for any YouTube URLs found in `message`.
 * Returns an empty string when no URLs are present or all fetches fail silently.
 * Successful transcripts are formatted with timestamps and injected with a
 * clear header so the LLM knows what to do with them.
 */
export async function buildYouTubeContextBlock(message: string): Promise<string> {
  const urls = findYouTubeUrls(message);
  if (urls.length === 0) return "";

  const blocks: string[] = [];
  let totalCharsUsed = 0;

  for (const url of urls.slice(0, 3)) {
    if (totalCharsUsed >= MAX_CHARS_TOTAL) {
      console.log(`[youtubeAutoFetch] Global budget exhausted (${totalCharsUsed}/${MAX_CHARS_TOTAL}), skipping ${url}`);
      break;
    }

    try {
      const { segments, source } = await fetchTranscriptCached(url);

      if (!segments || segments.length === 0) continue;

      const lastSeg = segments[segments.length - 1];
      const lastRawOffset = lastSeg.offset + (lastSeg.duration ?? 0);
      const avgRaw = lastRawOffset / segments.length;
      const toMs = avgRaw < 100 ? 1000 : 1;

      const CHUNK_MS = 30_000;
      const lines: string[] = [];
      let chunkStart = segments[0].offset * toMs;
      let chunk: string[] = [];

      for (const seg of segments) {
        const text = seg.text.trim();
        if (!text) continue;
        const ms = seg.offset * toMs;
        if (ms - chunkStart >= CHUNK_MS && chunk.length > 0) {
          lines.push(`[${fmtMs(chunkStart)}] ${chunk.join(" ")}`);
          chunkStart = ms;
          chunk = [];
        }
        chunk.push(text);
      }
      if (chunk.length > 0) lines.push(`[${fmtMs(chunkStart)}] ${chunk.join(" ")}`);

      let transcript = lines.join("\n");

      // Apply per-URL cap first
      if (transcript.length > MAX_CHARS_PER_URL) {
        transcript = transcript.slice(0, MAX_CHARS_PER_URL) + "\n[Transcript truncated — video is very long]";
      }

      // Apply remaining global budget
      const remaining = MAX_CHARS_TOTAL - totalCharsUsed;
      if (transcript.length > remaining) {
        transcript = transcript.slice(0, remaining) + "\n[Transcript truncated — global context budget reached]";
      }

      const totalDuration = fmtMs(lastRawOffset * toMs);
      const readableSrc = humanReadableSource(source);
      const sourceLabel = source === "gemini"
        ? " | Source: Gemini AI (AI-generated — not verbatim)"
        : readableSrc
          ? ` | Source: ${readableSrc}`
          : "";
      const block =
        `[Auto-fetched YouTube transcript for ${url}]\n` +
        `Duration: ~${totalDuration} | ${segments.length} caption segments${sourceLabel}\n` +
        "─".repeat(50) +
        "\n" +
        transcript +
        "\n" +
        "─".repeat(50);

      blocks.push(block);
      totalCharsUsed += transcript.length;
      console.log(
        `[youtubeAutoFetch] Fetched transcript for ${url} (${segments.length} segs, ~${totalDuration}, ` +
          `${transcript.length} chars; total ${totalCharsUsed}/${MAX_CHARS_TOTAL})`
      );
    } catch (err) {
      console.warn(
        `[youtubeAutoFetch] Could not fetch transcript for ${url}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (blocks.length === 0) return "";

  return (
    "\n\n" +
    blocks.join("\n\n") +
    "\n\n[TRANSCRIPT AUTO-FETCHED: The transcript above was pre-loaded for this message. " +
    "Reply INLINE right now — do NOT call queue_background_job for this. " +
    "If the user gave no explicit instruction, provide a thorough summary of the video here in this message. " +
    "If they asked a specific question, answer it using the transcript. " +
    "Never route transcript-backed summaries to the background queue.]"
  );
}
