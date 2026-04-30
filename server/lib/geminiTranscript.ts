/**
 * Gemini YouTube Transcript
 *
 * Uses Google's Gemini 1.5 Flash (with automatic Pro fallback) to transcribe
 * YouTube videos natively. Gemini fetches the video directly from Google's own
 * infrastructure, so there are no cloud-IP blocks, no yt-dlp required, and no
 * file size limits.
 *
 * Works for any video length — 3 minutes or 3 hours.
 * Returns the full spoken transcript as plain text.
 */

import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI_INTEGRATIONS_GEMINI_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

const TRANSCRIPT_PROMPT =
  "Provide a complete, verbatim transcript of every word spoken in this video. " +
  "Plain text only. Use natural paragraph breaks to separate topics or speakers. " +
  "Do not include timestamps, speaker labels, or any other formatting — just the spoken words.";

/**
 * Patterns in Gemini error messages that indicate the Flash model explicitly
 * rejected the video (e.g. content policy, model capability limit) rather than
 * a transient network/quota error. When matched, we retry with Pro.
 */
const FLASH_REJECTION_PATTERNS = [
  /video.*not supported/i,
  /unsupported.*video/i,
  /model.*not support/i,
  /content.*policy/i,
  /safety.*block/i,
  /token.*limit/i,
  /context.*length/i,
  /too.*long/i,
];

function isFlashRejection(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return FLASH_REJECTION_PATTERNS.some((p) => p.test(msg));
}

async function callGemini(model: string, videoUrl: string): Promise<string> {
  const client = getClient();
  const response = await client.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { fileData: { mimeType: "video/mp4", fileUri: videoUrl } },
          { text: TRANSCRIPT_PROMPT },
        ],
      },
    ],
  });
  const text = response.text;
  if (!text || !text.trim()) {
    throw new Error(`Gemini model ${model} returned an empty transcript for this video`);
  }
  return text.trim();
}

/**
 * Fetches a full spoken transcript for a YouTube video URL using Gemini.
 *
 * Strategy:
 *   1. Try gemini-1.5-flash (fast and cheap)
 *   2. If Flash explicitly rejects the video (content policy, model limit, etc.),
 *      retry once with gemini-1.5-pro
 *   3. Any other error is rethrown so the caller can fall through to Phase 1
 *
 * @param videoUrl - Full YouTube URL (e.g. https://www.youtube.com/watch?v=...)
 * @returns The full transcript as plain text
 * @throws If both models fail or the API key is missing
 */
export async function fetchTranscriptViaGemini(videoUrl: string): Promise<string> {
  try {
    return await callGemini("gemini-1.5-flash", videoUrl);
  } catch (flashErr) {
    if (isFlashRejection(flashErr)) {
      const flashMsg = flashErr instanceof Error ? flashErr.message : String(flashErr);
      console.warn(
        `[geminiTranscript] Flash rejected video (${flashMsg}) — retrying with gemini-1.5-pro`
      );
      return await callGemini("gemini-1.5-pro", videoUrl);
    }
    throw Object.assign(
      new Error(`gemini-1.5-flash failed: ${flashErr instanceof Error ? flashErr.message : String(flashErr)}`),
      { cause: flashErr }
    );
  }
}

/**
 * Returns true if the Gemini transcript path is configured and available.
 * Callers can use this to skip Phase 0 cheaply when the key is missing.
 */
export function isGeminiTranscriptAvailable(): boolean {
  return !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
}
