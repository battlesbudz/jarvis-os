/**
 * YouTube Transcript Fetcher
 *
 * Retrieves the full spoken transcript from any YouTube video using
 * official captions, auto-generated subtitles, audio transcription, or
 * web-search as a last resort — no API key required for basic usage.
 *
 * Also performs visual analysis: keyframe extraction + GPT-4o vision
 * produces a "Visual Summary" section describing what is shown on screen
 * at key moments, run in parallel with transcript fetching.
 *
 * Strategy order:
 *   1-4. Server-side (InnerTube → yt-dlp subs → timedtext → yt-transcript lib → audio transcription)
 *   5.   Browser fallback (Playwright with real cookies)
 *   6.   Local worker (user's own machine, bypasses IP blocks)
 *   7.   Tavily web search (last resort — returns summaries, not real transcript)
 */

import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import {
  fetchTranscriptCached,
  extractVideoId,
  parseTimedTextXml,
  isPlaylistUrl,
  getYtdlpStatus,
} from "../../lib/transcriptCache";
import { humanReadableSource } from "../../lib/transcriptSourceLabel";
import { buildVisualSummary } from "../../lib/videoFrames";
import { callBrowserTool } from "../mcp/playwrightMcpClient";
import {
  isWorkerOnline,
  queueTranscriptJob,
  type LocalJobSegment,
} from "../../lib/localWorkerQueue";

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
 * YouTube applies to many cloud providers.
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

// ── Tavily web-search fallback ────────────────────────────────────────────────
// Absolute last resort: searches the web for information about the video when
// no transcript can be retrieved by any other method. Returns summaries and
// external sources, clearly labelled as web-search results (not a transcript).

async function fetchViaTavily(input: string): Promise<ToolResult | null> {
  if (!process.env.TAVILY_API_KEY) return null;

  const { tavilySearch } = await import("../../integrations/search");
  const videoId = extractVideoId(input);
  const videoUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : input;

  try {
    // Run two parallel searches: one for the URL itself, one for transcript sites
    const [urlRes, transcriptRes] = await Promise.allSettled([
      tavilySearch(videoUrl, 5),
      tavilySearch(`${videoId ?? input} youtube transcript`, 5),
    ]);

    const parts: string[] = [];

    if (urlRes.status === "fulfilled" && urlRes.value.answer) {
      parts.push(`**What the web says about this video:**\n${urlRes.value.answer}`);
    }
    if (transcriptRes.status === "fulfilled" && transcriptRes.value.answer) {
      parts.push(`**Transcript search summary:**\n${transcriptRes.value.answer}`);
    }

    // Deduplicate results by URL and take top 6
    const seen = new Set<string>();
    const results: Array<{ title: string; url: string; content: string }> = [];
    for (const pool of [urlRes, transcriptRes]) {
      if (pool.status !== "fulfilled") continue;
      for (const r of pool.value.results) {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          results.push(r);
        }
      }
    }

    if (results.length > 0) {
      parts.push(
        "**Related sources:**\n" +
          results
            .slice(0, 6)
            .map((r) => `- [${r.title}](${r.url})\n  ${r.content.slice(0, 250)}`)
            .join("\n\n")
      );
    }

    if (parts.length === 0) return null;

    const header =
      `⚠️ No official transcript could be retrieved — showing web search results instead.\n` +
      `These are NOT a word-for-word transcript but may still help.\n` +
      `${"─".repeat(60)}\n`;

    return {
      ok: true,
      content: header + parts.join("\n\n"),
      label: "get_youtube_transcript: tavily-search fallback",
    };
  } catch (err) {
    console.warn(
      `[get_youtube_transcript] Tavily fallback error: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export const youtubeTranscriptTool: AgentTool = {
  name: "get_youtube_transcript",
  description:
    "Retrieve the full spoken transcript AND visual context from a YouTube video. " +
    "Uses Google Gemini AI natively as the primary transcription method (Phase 0) — " +
    "call this tool whenever the user shares a YouTube URL, asks to 'use Gemini' for a video, " +
    "or mentions AI transcription / Gemini transcripts. You do NOT need any separate Gemini tool; " +
    "Gemini is already built into this tool and runs automatically. " +
    "Returns timestamped transcript segments so you can cite specific moments, " +
    "plus a Visual Summary describing what is shown on screen at key moments — " +
    "diagrams, code, slides, people, text on screen, settings, and visual demonstrations. " +
    "Works for short clips, YouTube Shorts, and videos over an hour long. " +
    "Use this when the user shares a YouTube URL and wants you to read, summarize, quote, " +
    "analyse, or extract insights from it — including visual or on-screen content. " +
    "IMPORTANT: Only call this tool when the user has explicitly provided a YouTube URL or video ID " +
    "in their current message. Never re-use a video URL or ID from an earlier part of the conversation — " +
    "if the user asks about 'another video' or 'a different video' without providing a URL, ask them to share the link first. " +
    "Always tell the user which method successfully retrieved the transcript (e.g. 'via Supadata', 'via YouTube captions', 'via Whisper') — " +
    "this information is in the result label and transcript header. " +
    "Set refresh=true when the user asks to re-read, refresh, or get the latest version of a video. " +
    "Set includeVisuals=false only if the user explicitly wants transcript text only with no visual analysis. " +
    "Set force_audio=true to skip caption lookups entirely and transcribe the audio directly via Whisper — " +
    "this is the best option when official captions are unavailable (e.g. Alex Hormozi videos, " +
    "channels that disable captions) or when previous attempts returned empty results. " +
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
      includeVisuals: {
        type: "boolean",
        description:
          "Whether to include a visual summary of keyframes (default: true). " +
          "Set to false only when the user explicitly wants transcript text only.",
      },
      force_audio: {
        type: "boolean",
        description:
          "Skip all caption-fetching strategies and go straight to audio download + Whisper transcription. " +
          "Use this when official captions are unavailable, the channel has captions disabled, " +
          "or previous transcript attempts returned empty or unhelpful results. " +
          "Produces a word-for-word AI-generated transcript from the actual audio.",
      },
    },
    required: ["url"],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = String(args.url || "").trim();
    if (!input) {
      return { ok: false, content: "Please provide a YouTube URL or video ID.", label: "get_youtube_transcript: missing input" };
    }

    // ── Reject playlist URLs ──────────────────────────────────────────────────
    if (isPlaylistUrl(input)) {
      return {
        ok: false,
        content:
          "That looks like a YouTube playlist URL. I can only fetch transcripts for individual videos. " +
          "Please share a single video URL (e.g. https://youtube.com/watch?v=VIDEO_ID).",
        label: "get_youtube_transcript: playlist URL rejected",
      };
    }

    const bypassCache = args.refresh === true;
    const includeVisuals = args.includeVisuals !== false;
    const forceAudio = args.force_audio === true;
    const videoId = extractVideoId(input);

    console.log(
      `[get_youtube_transcript] fetching transcript for "${input}" (user=${ctx.userId}, bypassCache=${bypassCache}, includeVisuals=${includeVisuals}, forceAudio=${forceAudio})`
    );

    // ── Start visual pipeline concurrently with transcript retrieval ──────────
    // Kicked off immediately so keyframe download + vision analysis runs in
    // parallel with the (potentially slow) transcript fetch pipeline.
    // The promise is awaited only inside withVisuals() when a successful
    // transcript result is available. Failures are silently swallowed.
    const visualPromise: Promise<string | null> =
      includeVisuals && videoId
        ? buildVisualSummary(videoId, undefined, bypassCache).catch(() => null)
        : Promise.resolve(null);

    // ── Shared formatter: segments → readable timestamped transcript ──────────
    // Long transcripts (> 40 000 chars, roughly a 1 h+ video) are sent as a
    // .txt file attachment so the chat isn't flooded with message chunks.
    const FILE_THRESHOLD = 40_000;

    const buildResult = (
      rawSegments: Array<{ text: string; offset: number; duration?: number | null }>,
      source?: string
    ): ToolResult => {
      const readableSource = humanReadableSource(source);
      const sourceTag = readableSource ? ` · via ${readableSource}` : "";

      // ── AI-generated transcript (audio transcription, no timestamps) ──────
      // Audio-transcribed segments have offset=0 and duration=0, with a
      // special prefix in the text. Format them as plain text without timestamps.
      const isAiGenerated =
        rawSegments.length === 1 &&
        rawSegments[0].offset === 0 &&
        rawSegments[0].duration === 0 &&
        rawSegments[0].text.startsWith("[AI-generated transcript");

      if (isAiGenerated) {
        const body = rawSegments[0].text;
        const isGeminiTranscript = body.startsWith("[AI-generated transcript via Gemini]");
        const transcriptMethod = isGeminiTranscript ? "via Gemini" : "audio transcription";
        const header =
          `AI-Generated Transcript (${transcriptMethod}${sourceTag})\n` +
          `${"─".repeat(60)}\n`;
        const fullText = header + body;

        if (body.length > FILE_THRESHOLD) {
          const pending = (ctx.state.pendingAttachments ||= []);
          pending.push({
            kind: "document",
            filename: `transcript-${(extractVideoId(input) ?? "video")}.txt`,
            content: fullText,
            caption: isGeminiTranscript
              ? `Full transcript via Gemini (no official captions needed).`
              : `AI-generated transcript (no official captions were available).`,
            mimeType: "text/plain",
          });
          return {
            ok: true,
            content: isGeminiTranscript
              ? `Transcript complete via Gemini (~${Math.round(body.length / 1000)} k chars). Sending as a text file.`
              : `Audio transcription complete (~${Math.round(body.length / 1000)} k chars). ` +
                `No official captions were available, so the audio was transcribed via AI. ` +
                `Sending the full transcript as a text file.`,
            label: isGeminiTranscript
              ? `get_youtube_transcript: gemini → file`
              : `get_youtube_transcript: ai-audio-transcription → file`,
          };
        }

        let inlineBody = body;
        let truncNote = "";
        if (inlineBody.length > MAX_CHARS) {
          inlineBody = inlineBody.slice(0, MAX_CHARS);
          truncNote = `\n\n[Transcript truncated at ${MAX_CHARS.toLocaleString()} characters.]`;
        }
        return {
          ok: true,
          content: header + inlineBody + truncNote,
          label: isGeminiTranscript
            ? `get_youtube_transcript: gemini`
            : `get_youtube_transcript: ai-audio-transcription`,
        };
      }

      // ── Standard timestamped transcript ───────────────────────────────────
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

      const totalDuration = formatTimestamp(lastRawOffset * toMs);
      const header =
        `Transcript (${rawSegments.length} segments, ~${totalDuration} duration${sourceTag})\n` +
        `${"─".repeat(60)}\n`;
      const body = lines.join("\n");
      const fullText = header + body;

      // ── Long transcript → .txt file ────────────────────────────────────────
      // When a transcript is very long (> 40 k chars, roughly a 1 h+ video),
      // push it as a file attachment so the chat isn't flooded with text chunks.
      if (body.length > FILE_THRESHOLD) {
        const pending = (ctx.state.pendingAttachments ||= []);
        pending.push({
          kind: "document",
          filename: `transcript-${(extractVideoId(input) ?? "video")}.txt`,
          content: fullText,
          caption: `Full transcript (~${totalDuration}) — ${rawSegments.length} segments.`,
          mimeType: "text/plain",
        });
        return {
          ok: true,
          content:
            `Transcript retrieved (${rawSegments.length} segments, ~${totalDuration}${sourceTag}). ` +
            `The full text is long (~${Math.round(body.length / 1000)} k chars) — I'm sending it as a text file so it's easy to save or search.`,
          label: `get_youtube_transcript: ${rawSegments.length} segments, ~${totalDuration}${sourceTag} → file`,
        };
      }

      // Short enough to inline — but still cap at MAX_CHARS for the AI context window
      let inlineBody = body;
      let truncationNote = "";
      if (inlineBody.length > MAX_CHARS) {
        inlineBody = inlineBody.slice(0, MAX_CHARS);
        truncationNote = `\n\n[Transcript truncated at ${MAX_CHARS.toLocaleString()} characters. The video is very long — the above covers the first portion.]`;
      }

      return {
        ok: true,
        content: header + inlineBody + truncationNote,
        label: `get_youtube_transcript: ${rawSegments.length} segments, ~${totalDuration}${sourceTag}`,
      };
    };

    // ── Helper: join visual summary into a successful ToolResult ─────────────
    // Awaits the pre-started visualPromise and appends its output (if any).
    // No-ops on error results or when visualPromise resolved to null.
    const withVisuals = async (result: ToolResult): Promise<ToolResult> => {
      if (!result.ok) return result;
      try {
        const visualSummary = await visualPromise;
        if (visualSummary) {
          return {
            ...result,
            content: result.content + `\n\n${"─".repeat(60)}\n` + visualSummary,
          };
        }
      } catch {
        // Silently ignore — visual pipeline failure never surfaces to the user
      }
      return result;
    };

    // ── Early check: surface yt-dlp unavailability before attempting audio ────
    // When force_audio=true the entire pipeline depends on yt-dlp being present.
    // Check up-front so the user gets a clear message instead of a cryptic failure.
    if (forceAudio) {
      const { available: ytdlpOk } = getYtdlpStatus();
      if (!ytdlpOk) {
        return {
          ok: false,
          content:
            "Audio transcription is temporarily unavailable — the yt-dlp dependency is not installed on this server. " +
            "Please try again later. If you have the local worker running on your PC it can handle audio transcription instead.",
          label: "get_youtube_transcript: yt-dlp unavailable",
        };
      }
    }

    try {
      const { segments: rawSegments, noCaptionsDetected, source: fetchedSource, asyncJobPending, jobId } = await fetchTranscriptCached(input, {
        bypassCache,
        audioOnly: forceAudio,
        userId: ctx.userId,
        signal: ctx.signal,
        onFetchStart: () => {
          ctx.state.onProgressMessage?.("📝 Fetching transcript…");
        },
      });

      // ── Async Supadata job started for long video ─────────────────────────
      // Supadata has begun generating the transcript for this 3+ hour video.
      // It takes 5–10 minutes. We return a friendly message now and notify
      // the user when the background job finishes.
      if (asyncJobPending) {
        const videoIdLabel = videoId ?? "this video";
        return {
          ok: true,
          content:
            `I've started generating the transcript for this video using Supadata AI. ` +
            `This typically takes **5–10 minutes** for long videos. ` +
            `I'll send you a notification when it's ready — you can then ask me to summarize it or answer questions about it. ` +
            `Press the ⬛ stop button to cancel transcript generation at any time.` +
            (jobId ? ` (job: ${jobId})` : ""),
          label: `get_youtube_transcript: supadata-async-job-started (${videoIdLabel})`,
        };
      }
      let segments = rawSegments;

      // ── Strategy 5: browser fallback if server-side got nothing ──────────────
      // YouTube increasingly blocks server-side requests from cloud IPs. Running
      // the same fetch through a real browser (Playwright) bypasses that block.
      if (!segments || segments.length === 0) {
        console.log(`[get_youtube_transcript] server strategies returned 0 segs — trying browser fallback`);
        const browserSegs = await fetchTranscriptViaBrowser(input, ctx.userId);
        if (browserSegs.length > 0) return withVisuals(buildResult(browserSegs, "browser"));

        // ── Strategy 6: local worker ─────────────────────────────────────────
        // If the user has a local agent running on their PC, forward the job to
        // it — their machine usually will not be subject to cloud-host IP-level blocks.
        if (isWorkerOnline(ctx.userId)) {
          console.log(`[get_youtube_transcript] browser fallback empty — forwarding to local worker`);
          try {
            const localSegs = await queueTranscriptJob(ctx.userId, input);
            if (localSegs.length > 0) return withVisuals(buildResult(localSegs, "local-worker"));
          } catch (lwErr) {
            console.warn(`[get_youtube_transcript] local worker failed: ${lwErr instanceof Error ? lwErr.message : String(lwErr)}`);
          }
        }

        // ── Auto-retry with audio mode when no captions were detected ────────
        // Instead of surfacing a hint and making the user ask again, automatically
        // re-run through the audio transcription pipeline one time.
        // Skip entirely when yt-dlp is unavailable — surface a clear message instead.
        if (noCaptionsDetected && !forceAudio) {
          const { available: ytdlpOk } = getYtdlpStatus();
          if (!ytdlpOk) {
            console.log(`[get_youtube_transcript] noCaptionsDetected but yt-dlp unavailable — skipping audio auto-retry`);
          } else {
            console.log(`[get_youtube_transcript] noCaptionsDetected — auto-retrying with audioOnly=true`);
            try {
              const { segments: audioSegs, source: audioRetrySource } = await fetchTranscriptCached(input, { bypassCache: true, audioOnly: true });
              if (audioSegs.length > 0) {
                return withVisuals(buildResult(audioSegs, audioRetrySource));
              }
            } catch (audioRetryErr) {
              const retryMsg = audioRetryErr instanceof Error ? audioRetryErr.message : String(audioRetryErr);
              if (retryMsg.startsWith("YTDLP_UNAVAILABLE:")) {
                console.warn(`[get_youtube_transcript] audio auto-retry skipped: yt-dlp unavailable`);
              } else {
                console.warn(`[get_youtube_transcript] audio auto-retry failed: ${retryMsg}`);
              }
            }
          }
        }

        // Build the hint only when the auto-retry (or forceAudio pass) also produced nothing.
        const { available: ytdlpOkForHint } = getYtdlpStatus();
        const audioHint =
          noCaptionsDetected && !forceAudio
            ? ytdlpOkForHint
              ? "\n\n💡 **This video has no official captions and the automatic audio transcription also failed.** To retry via direct audio transcription, call `get_youtube_transcript` again with `force_audio=true` — this downloads and transcribes the audio using Whisper and bypasses caption lookups entirely."
              : "\n\n⚠️ **This video has no official captions, and audio transcription is currently unavailable** because the yt-dlp dependency is not installed on this server. Please try again later."
            : "";

        // ── Strategy 7: Tavily web-search ────────────────────────────────────
        // All transcript methods exhausted — search the web for any available
        // summaries or third-party transcripts instead.
        // Note: visual summary is NOT appended to Tavily results — they are web
        // search output, not an actual video transcript, so the combination would
        // be semantically misleading.
        console.log(`[get_youtube_transcript] all strategies empty — trying Tavily web search`);
        const tavilyResult = await fetchViaTavily(input);
        if (tavilyResult) {
          return {
            ...tavilyResult,
            content: tavilyResult.content + audioHint,
          };
        }

        return {
          ok: false,
          content:
            "No transcript could be retrieved for this video. It may have captions disabled, " +
            "be a live stream, or be blocked from server access. If you have the local worker " +
            "running on your PC, it can often succeed where the server cannot." +
            audioHint,
          label: "get_youtube_transcript: all strategies exhausted",
        };
      }

      return withVisuals(buildResult(segments, fetchedSource));

    } catch (err: unknown) {
      // ── User cancelled via Stop button — stop immediately, no fallbacks ─────
      if (err instanceof Error && (err.name === 'AbortError' || err.message?.includes('aborted'))) {
        throw err;
      }

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
      if (msg.startsWith("TOO_MANY_REQUESTS") || msg.startsWith("RATE_LIMITED") || lower.includes("too many requests") || lower.includes("429")) {
        return {
          ok: false,
          content: "YouTube is rate-limiting transcript requests right now. Please wait a moment and try again.",
          label: "get_youtube_transcript: rate limited",
        };
      }
      if (lower.includes("disabled") || lower.includes("no transcript") || lower === "transcript is disabled on this video") {
        return {
          ok: false,
          content:
            "This video doesn't have captions available. The creator may have disabled transcripts, or it may be a live stream. " +
            "To attempt audio transcription directly via Whisper, call `get_youtube_transcript` again with `force_audio=true`.",
          label: "get_youtube_transcript: no captions",
        };
      }
      if (msg.startsWith("YTDLP_UNAVAILABLE:")) {
        return {
          ok: false,
          content:
            "Audio transcription is temporarily unavailable — the yt-dlp dependency is not installed on this server. " +
            "Please try again later. If you have the local worker running on your PC it can handle audio transcription instead.",
          label: "get_youtube_transcript: yt-dlp unavailable",
        };
      }
      if (msg.startsWith("AUDIO_DOWNLOAD_FAILED:")) {
        console.warn(`[get_youtube_transcript] audio-download-failed for ${videoId ?? input}: ${msg}`);
        return {
          ok: false,
          content:
            "The audio download failed — YouTube may be blocking this request from the server. " +
            "You can try again in a moment, or start the local worker on your PC for better results.",
          label: "get_youtube_transcript: audio-download-failed",
        };
      }

      // ── Non-terminal: try browser fallback before giving up ─────────────────
      console.log(`[get_youtube_transcript] non-terminal error (${msg}) — trying browser fallback`);
      const browserSegs = await fetchTranscriptViaBrowser(input, ctx.userId);
      if (browserSegs.length > 0) return withVisuals(buildResult(browserSegs, "browser"));

      // ── Local worker ──────────────────────────────────────────────────────
      if (isWorkerOnline(ctx.userId)) {
        console.log(`[get_youtube_transcript] browser also failed — forwarding to local worker`);
        try {
          const localSegs = await queueTranscriptJob(ctx.userId, input);
          if (localSegs.length > 0) return withVisuals(buildResult(localSegs, "local-worker"));
        } catch (lwErr) {
          console.warn(`[get_youtube_transcript] local worker also failed: ${lwErr instanceof Error ? lwErr.message : String(lwErr)}`);
        }
      }

      // ── Tavily web search (absolute last resort) ───────────────────────────
      // Note: visual summary is NOT appended to Tavily results — web search
      // output is not an actual transcript and the combination is misleading.
      console.log(`[get_youtube_transcript] all strategies failed — trying Tavily web search`);
      const tavilyFallback = await fetchViaTavily(input);
      if (tavilyFallback) return tavilyFallback;

      console.error(`[get_youtube_transcript] all strategies exhausted: ${msg}`);
      return {
        ok: false,
        content:
          "Couldn't retrieve the transcript for this video right now. " +
          "The video may be private, have captions disabled, or YouTube is blocking server access. " +
          "You can try again in a moment, or start the local worker on your PC for better results.",
        label: "get_youtube_transcript: all strategies exhausted",
      };
    }
  },
};
