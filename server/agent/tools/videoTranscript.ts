/**
 * Video Transcript Tool
 *
 * Transcribes any publicly accessible video file using Google's File API +
 * Gemini — supporting Google Drive share links, Dropbox links, direct video
 * URLs (mp4, mov, webm, …), and any other publicly reachable video file up
 * to 500 MB.
 *
 * This is the complement to get_youtube_transcript (which handles YouTube URLs
 * natively without downloading anything). Use this tool when the user sends a
 * direct video file link rather than a YouTube URL.
 */

import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import {
  transcribeVideoFromUrl,
  isGeminiTranscriptAvailable,
  normalizeVideoUrl,
} from "../../lib/geminiTranscript";

/** Maximum characters to inline before sending as a file attachment. */
const FILE_THRESHOLD = 40_000;
/** Hard cap on context window. */
const MAX_CHARS = 120_000;

export const videoTranscriptTool: AgentTool = {
  name: "transcribe_video_url",
  description:
    "Transcribe any publicly accessible video file — Google Drive share links, Dropbox links, " +
    "direct mp4/mov/webm URLs, or any other publicly reachable video up to 500 MB. " +
    "The video is uploaded to Google's File API and transcribed by Gemini. " +
    "Use this when the user shares a direct video file link (NOT a YouTube URL — use " +
    "get_youtube_transcript for YouTube). " +
    "This is also the correct tool when a user says they sent a large video they want " +
    "transcribed and you need to handle it from a link they share.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Public URL to the video file. Supported: Google Drive share links " +
          "(drive.google.com/file/d/…), Dropbox share links, direct .mp4/.mov/.webm URLs, etc.",
      },
      mime_type: {
        type: "string",
        description:
          "Optional MIME type override (e.g. 'video/mp4', 'video/quicktime'). " +
          "If omitted, it is inferred from the URL extension — usually this is fine.",
      },
    },
    required: ["url"],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const rawUrl = String(args.url || "").trim();
    if (!rawUrl) {
      return {
        ok: false,
        content: "Please provide a public video URL to transcribe.",
        label: "transcribe_video_url: missing URL",
      };
    }

    // Reject YouTube URLs — those go through get_youtube_transcript
    if (/youtube\.com|youtu\.be/i.test(rawUrl)) {
      return {
        ok: false,
        content:
          "That looks like a YouTube URL. Use the get_youtube_transcript tool for YouTube videos — " +
          "it can fetch them without downloading the full video file.",
        label: "transcribe_video_url: YouTube URL rejected",
      };
    }

    if (!isGeminiTranscriptAvailable()) {
      return {
        ok: false,
        content:
          "Video transcription via File API is not available — the Gemini API key is not configured.",
        label: "transcribe_video_url: Gemini not available",
      };
    }

    const mimeType = args.mime_type ? String(args.mime_type) : undefined;
    const normalizedUrl = normalizeVideoUrl(rawUrl);

    console.log(
      `[transcribe_video_url] Starting transcription for user=${ctx.userId} url="${rawUrl}"`
    );

    let transcript: string;
    try {
      transcript = await transcribeVideoFromUrl(rawUrl, mimeType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[transcribe_video_url] Failed for "${rawUrl}":`, msg);
      return {
        ok: false,
        content: `Could not transcribe the video: ${msg}`,
        label: "transcribe_video_url: error",
      };
    }

    if (!transcript || !transcript.trim()) {
      return {
        ok: false,
        content:
          "Gemini returned an empty transcript. The video may contain no speech, " +
          "or the file could not be processed. Please check the URL and try again.",
        label: "transcribe_video_url: empty transcript",
      };
    }

    const header =
      `[AI-generated transcript via Gemini File API]\n` +
      `Source: ${normalizedUrl !== rawUrl ? `${rawUrl} (resolved to direct download)` : rawUrl}\n` +
      `${"─".repeat(60)}\n`;

    const fullText = header + transcript;

    // Long transcripts → send as a file attachment
    if (transcript.length > FILE_THRESHOLD) {
      const pending = (ctx.state.pendingAttachments ||= []);
      pending.push({
        kind: "document",
        filename: `transcript-video.txt`,
        content: fullText,
        caption: `Full video transcript (~${Math.round(transcript.length / 1000)} k chars).`,
        mimeType: "text/plain",
      });
      return {
        ok: true,
        content:
          `Transcript complete (~${Math.round(transcript.length / 1000)} k chars). ` +
          `Sending as a text file so it's easy to save or search.`,
        label: "transcribe_video_url: gemini → file",
      };
    }

    // Shorter transcripts inline, but still cap for context window safety
    let inlineBody = transcript;
    let truncNote = "";
    if (inlineBody.length > MAX_CHARS) {
      inlineBody = inlineBody.slice(0, MAX_CHARS);
      truncNote = `\n\n[Transcript truncated at ${MAX_CHARS.toLocaleString()} characters.]`;
    }

    return {
      ok: true,
      content: header + inlineBody + truncNote,
      label: "transcribe_video_url: gemini",
    };
  },
};
