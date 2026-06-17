import type OpenAI from "openai";

type CoachFunctionDefinition = OpenAI.Chat.Completions.ChatCompletionFunctionTool["function"];
type CoachTool = OpenAI.Chat.Completions.ChatCompletionTool;

function coachFunctionTool(definition: CoachFunctionDefinition): OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  return { type: "function", function: definition };
}

export function buildYoutubeTranscriptCoachTools(): CoachTool[] {
  return [
    coachFunctionTool({
        name: "fetch_youtube_transcript",
        description: "Fetch the COMPLETE transcript/captions of a YouTube video server-side — returns the full text with no truncation. Use this INSTEAD of navigating YouTube's transcript UI on the phone.\n\nINTERNAL PIPELINE — this tool automatically tries multiple methods in order:\n  Phase 0:   Gemini multimodal — feeds the video URL directly to Gemini AI\n  Phase 0.5: Supadata — a cloud transcript API (supadata.ai) that bypasses YouTube's IP blocks. Uses mode=auto: tries native captions first, then AI-generates a transcript if no captions exist. This costs Supadata credits for AI generation.\n  Phase 1-4: YouTube InnerTube API, yt-dlp subtitles, timedtext, youtube-transcript library\n  Phase 5:   Whisper audio transcription (downloads audio via yt-dlp, then transcribes)\n  Phase 6:   Tavily web search fallback (last resort — summaries, not a real transcript)\n\nThe 'via X' label in the result (e.g. 'via Supadata', 'via YouTube captions', 'via Whisper (audio)') tells you which phase succeeded.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (e.g. 'dQw4w9WgXcQ') or full YouTube URL (https://youtube.com/watch?v=dQw4w9WgXcQ). Extract the video ID from the URL visible on screen via android_read_screen." },
          },
          required: ["videoId"],
        },
    }),
    coachFunctionTool({
        name: "fetch_transcript_gemini",
        description: "Fetch a YouTube transcript by feeding the video URL directly to Gemini's multimodal API (gemini-2.5-flash/pro). No captions required — Gemini transcribes the audio from Google's own infrastructure. Use when the video has no captions, or when the user explicitly asks to use Gemini. Requires GOOGLE_GEMINI_API_KEY to be configured.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
    }),
    coachFunctionTool({
        name: "fetch_transcript_supadata",
        description: "Fetch a YouTube transcript via the Supadata API (supadata.ai) using mode=auto. Tries YouTube's native captions first; if none exist, AI-generates a transcript (uses Supadata credits). Use when the user explicitly asks for Supadata, or when native captions are unavailable. Requires SUPADATA_API_KEY.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
    }),
    coachFunctionTool({
        name: "fetch_transcript_audio",
        description: "Fetch a YouTube transcript by downloading the audio via yt-dlp and transcribing it with OpenAI Whisper. Works even when no captions exist and Gemini/Supadata are unavailable. Use when the user explicitly asks for audio/Whisper transcription. Note: slow for long videos (may take several minutes). Requires yt-dlp to be installed.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
    }),
    coachFunctionTool({
        name: "fetch_transcript_captions",
        description: "Fetch a YouTube transcript using only native YouTube captions — no AI, no credits charged. Tries InnerTube, yt-dlp subtitles, timedtext, and the youtube-transcript library. Fast, but only works if the video actually has captions. Use when the user explicitly wants captions-only (no AI generation).",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
    }),
  ];
}
