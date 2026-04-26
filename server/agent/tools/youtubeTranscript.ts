/**
 * YouTube Transcript Fetcher
 *
 * Retrieves the full spoken transcript from any YouTube video using
 * official captions or auto-generated subtitles — no API key required.
 *
 * Handles both manual and auto-generated captions for short clips and
 * long-form videos (1h+). Segments are formatted with human-readable
 * timestamps so the AI can cite specific moments.
 */

import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";

/** Maximum characters returned before truncation (≈ ~150k tokens safe limit). */
const MAX_CHARS = 120_000;

/** Format milliseconds → "H:MM:SS" or "M:SS". */
function formatTimestamp(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const youtubeTranscriptTool: AgentTool = {
  name: "get_youtube_transcript",
  description:
    "Retrieve the full spoken transcript from a YouTube video — manual captions or auto-generated. " +
    "Returns timestamped segments so you can cite specific moments. " +
    "Works for short clips and videos over an hour long. " +
    "Use this when the user shares a YouTube URL and wants you to read, summarize, quote, or extract insights from it. " +
    "Returns a clear error message if the video has no captions available.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "YouTube video URL (e.g. https://youtube.com/watch?v=dQw4w9WgXcQ) or bare video ID (e.g. dQw4w9WgXcQ).",
      },
    },
    required: ["url"],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = String(args.url || "").trim();
    if (!input) {
      return { ok: false, content: "Please provide a YouTube URL or video ID.", label: "get_youtube_transcript: missing input" };
    }

    console.log(`[get_youtube_transcript] fetching transcript for "${input}" (user=${ctx.userId})`);

    try {
      const { YoutubeTranscript } = await import("youtube-transcript");
      const segments = await YoutubeTranscript.fetchTranscript(input);

      if (!segments || segments.length === 0) {
        return {
          ok: false,
          content: "No transcript segments were returned. The video may have captions disabled.",
          label: "get_youtube_transcript: empty transcript",
        };
      }

      // ── Normalise offsets to milliseconds ──────────────────────────────────
      // The library returns two formats depending on caption track type:
      //   • srv3 (<p t="32453" d="2500">):  offsets/durations are integers in ms
      //   • classic (<text start="32.453" dur="2.5">): floats in seconds
      //
      // Detection: average (lastOffset / segmentCount). Real segments are ≥ 0.5s
      // each, so seconds-format averages stay < 100 while ms-format averages are
      // always ≥ 100 (≥ 500ms per segment minimum).
      const lastSeg = segments[segments.length - 1];
      const lastRawOffset = lastSeg.offset + (lastSeg.duration ?? 0);
      const avgRawPerSegment = lastRawOffset / segments.length;
      const toMs = avgRawPerSegment < 100 ? 1000 : 1; // multiply seconds→ms when needed

      // Build timestamped lines. Group into ~30s chunks for readability.
      const CHUNK_MS = 30_000;
      const lines: string[] = [];
      let chunkStartMs = segments[0].offset * toMs;
      let chunkText: string[] = [];

      for (const seg of segments) {
        const text = seg.text.trim();
        if (!text) continue;
        const offsetMs = seg.offset * toMs;
        // Start a new chunk every 30 seconds
        if (offsetMs - chunkStartMs >= CHUNK_MS && chunkText.length > 0) {
          lines.push(`[${formatTimestamp(chunkStartMs)}] ${chunkText.join(" ")}`);
          chunkStartMs = offsetMs;
          chunkText = [];
        }
        chunkText.push(text);
      }
      // Flush final chunk
      if (chunkText.length > 0) {
        lines.push(`[${formatTimestamp(chunkStartMs)}] ${chunkText.join(" ")}`);
      }

      const fullTranscript = lines.join("\n");
      const totalDurationMs = lastRawOffset * toMs;
      const totalDuration = formatTimestamp(totalDurationMs);

      // Truncate if unusually large
      let body = fullTranscript;
      let truncationNote = "";
      if (body.length > MAX_CHARS) {
        body = body.slice(0, MAX_CHARS);
        truncationNote = `\n\n[Transcript truncated at ${MAX_CHARS.toLocaleString()} characters. The video is very long — the above covers the first portion.]`;
      }

      const header = `Transcript (${segments.length} segments, ~${totalDuration} duration)\n${"─".repeat(60)}\n`;
      const content = header + body + truncationNote;

      return {
        ok: true,
        content,
        label: `get_youtube_transcript: ${segments.length} segments, ~${totalDuration}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();

      // Provide user-friendly error messages for known failure modes
      if (lower.includes("disabled") || lower.includes("not available")) {
        return {
          ok: false,
          content: `This video does not have captions available. The owner may have disabled transcripts, or it may be a live stream without auto-captions.`,
          label: "get_youtube_transcript: no captions",
        };
      }
      if (lower.includes("unavailable") || lower.includes("not found") || lower.includes("private")) {
        return {
          ok: false,
          content: `Video not found or is private/unavailable. Please check the URL and try again.`,
          label: "get_youtube_transcript: video unavailable",
        };
      }
      if (lower.includes("too many requests") || lower.includes("429")) {
        return {
          ok: false,
          content: `YouTube is rate-limiting transcript requests right now. Please wait a moment and try again.`,
          label: "get_youtube_transcript: rate limited",
        };
      }

      console.error(`[get_youtube_transcript] error: ${msg}`);
      return {
        ok: false,
        content: `Failed to fetch transcript: ${msg}`,
        label: "get_youtube_transcript: error",
      };
    }
  },
};
