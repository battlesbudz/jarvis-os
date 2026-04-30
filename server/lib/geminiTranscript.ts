/**
 * Gemini YouTube Transcript
 *
 * Uses Google's Gemini 1.5 Flash to transcribe YouTube videos natively.
 * Gemini fetches the video directly from Google's own infrastructure, so there
 * are no cloud-IP blocks, no yt-dlp required, and no file size limits.
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
 * Fetches a full spoken transcript for a YouTube video URL using Gemini 1.5 Flash.
 *
 * @param videoUrl - Full YouTube URL (e.g. https://www.youtube.com/watch?v=...)
 * @returns The full transcript as plain text
 * @throws If the API key is missing, Gemini returns an empty result, or the call fails
 */
export async function fetchTranscriptViaGemini(videoUrl: string): Promise<string> {
  const client = getClient();

  const response = await client.models.generateContent({
    model: "gemini-1.5-flash",
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
    throw new Error("Gemini returned an empty transcript for this video");
  }

  return text.trim();
}

/**
 * Returns true if the Gemini transcript path is configured and available.
 * Callers can use this to skip Phase 0 cheaply when the key is missing.
 */
export function isGeminiTranscriptAvailable(): boolean {
  return !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
}
