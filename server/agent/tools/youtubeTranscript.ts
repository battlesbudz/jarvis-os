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
import { fetchTranscriptCached, extractVideoId, parseTimedTextXml } from "../../lib/transcriptCache";
import { callBrowserTool } from "../mcp/playwrightMcpClient";

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

/**
 * Browser-based transcript fallback.
 *
 * Uses the Playwright MCP browser to fetch YouTube's timedtext API endpoint
 * with real browser cookies and headers — bypasses server-side IP blocks that
 * YouTube applies to cloud providers like Replit.
 *
 * Returns an empty array (not throws) on any failure so callers can degrade
 * gracefully.
 */
async function fetchTranscriptViaBrowser(
  input: string,
  userId: string,
): Promise<Array<{ text: string; offset: number; duration: number }>> {
  type McpContent = { type: string; text?: string };
  const extractText = (result: { content?: McpContent[]; isError?: boolean }) =>
    ((result.content as McpContent[]) || []).map((c) => c.text || "").join("");

  const videoId = extractVideoId(input) ?? input.trim();

  try {
    // Step 1: Visit the watch page to establish YouTube session cookies.
    await callBrowserTool(userId, "browser_navigate", {
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });

    // Step 2: Try different language variants of the timedtext endpoint.
    for (const lang of ["en", "en-US", "a.en"]) {
      const timedtextUrl = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${lang}&fmt=srv3`;

      await callBrowserTool(userId, "browser_navigate", { url: timedtextUrl });
      const snap = await callBrowserTool(userId, "browser_snapshot", {});

      if (snap.isError) continue;

      const raw = extractText(snap);

      // The browser snapshot of an XML page contains the raw XML text.
      if (!raw.includes("<text ")) continue;

      const elements = parseTimedTextXml(raw);
      if (elements.length === 0) continue;

      console.log(
        `[get_youtube_transcript] browser fallback OK lang=${lang} videoId=${videoId} — ${elements.length} segs`,
      );

      return elements.map((el) => ({
        text: el.text,
        offset: parseFloat(el.start) * 1000,
        duration: parseFloat(el.dur) * 1000,
      }));
    }

    return [];
  } catch (err) {
    console.warn(
      `[get_youtube_transcript] browser fallback failed for ${videoId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

export const youtubeTranscriptTool: AgentTool = {
  name: "get_youtube_transcript",
  description:
    "Retrieve the full spoken transcript from a YouTube video — manual captions or auto-generated. " +
    "Returns timestamped segments so you can cite specific moments. " +
    "Works for short clips and videos over an hour long. " +
    "Use this when the user shares a YouTube URL and wants you to read, summarize, quote, or extract insights from it. " +
    "Set refresh=true when the user asks to re-read, refresh, or get the latest version of a video. " +
    "Returns a clear error message if the video has no captions available.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "YouTube video URL (e.g. https://youtube.com/watch?v=dQw4w9WgXcQ) or bare video ID (e.g. dQw4w9WgXcQ).",
      },
      refresh: {
        type: "boolean",
        description:
          "Set to true to bypass the transcript cache and fetch a fresh copy directly from YouTube. " +
          "Use when the user explicitly asks to re-read, refresh, or get an updated transcript.",
      },
    },
    required: ["url"],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = String(args.url || "").trim();
    if (!input) {
      return { ok: false, content: "Please provide a YouTube URL or video ID.", label: "get_youtube_transcript: missing input" };
    }

    const bypassCache = args.refresh === true;
    console.log(
      `[get_youtube_transcript] fetching transcript for "${input}" (user=${ctx.userId}, bypassCache=${bypassCache})`
    );

    // ── Shared formatter: segments → readable timestamped transcript ──────────
    const buildResult = (
      rawSegments: Array<{ text: string; offset: number; duration?: number | null }>
    ): ToolResult => {
      // Normalise offsets: InnerTube ms vs. classic library seconds detection.
      const lastSeg = rawSegments[rawSegments.length - 1];
      const lastRawOffset = lastSeg.offset + (lastSeg.duration ?? 0);
      const avgRawPerSegment = lastRawOffset / rawSegments.length;
      const toMs = avgRawPerSegment < 100 ? 1000 : 1;

      const CHUNK_MS = 30_000;
      const lines: string[] = [];
      let chunkStartMs = rawSegments[0].offset * toMs;
      let chunkText: string[] = [];

      for (const seg of rawSegments) {
        const text = seg.text.trim();
        if (!text) continue;
        const offsetMs = seg.offset * toMs;
        if (offsetMs - chunkStartMs >= CHUNK_MS && chunkText.length > 0) {
          lines.push(`[${formatTimestamp(chunkStartMs)}] ${chunkText.join(" ")}`);
          chunkStartMs = offsetMs;
          chunkText = [];
        }
        chunkText.push(text);
      }
      if (chunkText.length > 0) {
        lines.push(`[${formatTimestamp(chunkStartMs)}] ${chunkText.join(" ")}`);
      }

      let body = lines.join("\n");
      let truncationNote = "";
      if (body.length > MAX_CHARS) {
        body = body.slice(0, MAX_CHARS);
        truncationNote = `\n\n[Transcript truncated at ${MAX_CHARS.toLocaleString()} characters. The video is very long — the above covers the first portion.]`;
      }

      const totalDuration = formatTimestamp(lastRawOffset * toMs);
      const header = `Transcript (${rawSegments.length} segments, ~${totalDuration} duration)\n${"─".repeat(60)}\n`;

      return {
        ok: true,
        content: header + body + truncationNote,
        label: `get_youtube_transcript: ${rawSegments.length} segments, ~${totalDuration}`,
      };
    };

    try {
      let segments = await fetchTranscriptCached(input, { bypassCache });

      // ── Strategy 4: browser fallback if server-side got nothing ──────────────
      // YouTube increasingly blocks server-side requests from cloud IPs. Running
      // the same fetch through a real browser (Playwright) bypasses that block.
      if (!segments || segments.length === 0) {
        console.log(`[get_youtube_transcript] server strategies returned 0 segs — trying browser fallback`);
        const browserSegs = await fetchTranscriptViaBrowser(input, ctx.userId);
        if (browserSegs.length > 0) return buildResult(browserSegs);
        return {
          ok: false,
          content: "No transcript segments were returned. The video may have captions disabled.",
          label: "get_youtube_transcript: empty transcript",
        };
      }

      return buildResult(segments);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();

      // ── Terminal errors — no fallback will help ─────────────────────────────
      if (msg.startsWith("LOGIN_REQUIRED")) {
        return {
          ok: false,
          content: "This video requires a signed-in YouTube account to access (private or members-only video). I can't retrieve its transcript.",
          label: "get_youtube_transcript: login required",
        };
      }
      if (msg.startsWith("CONTENT_RESTRICTED")) {
        return {
          ok: false,
          content: "This video is restricted (age-restricted, region-locked, or not available). I can't retrieve its transcript without a logged-in account.",
          label: "get_youtube_transcript: content restricted",
        };
      }
      if (msg.startsWith("TOO_MANY_REQUESTS") || lower.includes("too many requests") || lower.includes("429")) {
        return {
          ok: false,
          content: "YouTube is rate-limiting transcript requests right now. Please wait a moment and try again.",
          label: "get_youtube_transcript: rate limited",
        };
      }
      if (lower.includes("disabled") || lower.includes("no transcript") || lower === "transcript is disabled on this video") {
        return {
          ok: false,
          content: "This video doesn't have captions available. The creator may have disabled transcripts, or it may be a live stream.",
          label: "get_youtube_transcript: no captions",
        };
      }

      // ── Non-terminal: try browser fallback before giving up ─────────────────
      console.log(`[get_youtube_transcript] non-terminal error (${msg}) — trying browser fallback`);
      const browserSegs = await fetchTranscriptViaBrowser(input, ctx.userId);
      if (browserSegs.length > 0) return buildResult(browserSegs);

      console.error(`[get_youtube_transcript] all strategies exhausted: ${msg}`);
      return {
        ok: false,
        content: "Couldn't read the captions for this video right now — please try again in a moment.",
        label: "get_youtube_transcript: error",
      };
    }
  },
};
