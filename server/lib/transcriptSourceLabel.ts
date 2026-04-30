/**
 * Transcript Source Labelling
 *
 * Shared helper that converts internal transcript source keys (returned by
 * fetchTranscriptCached) into concise human-readable labels.
 *
 * Kept in server/lib/ so it can be imported by both the agent tool layer
 * (server/agent/tools/youtubeTranscript.ts) and utility helpers
 * (server/utils/youtubeAutoFetch.ts) without creating cross-layer coupling.
 */

/**
 * Map an internal transcript source key to a short, user-facing label string.
 *
 * Returns null when the source is already implicit in the transcript body
 * (e.g. Gemini outputs "[AI-generated transcript via Gemini]") or when the
 * source is unknown / a plain cache hit with no stored origin.
 *
 * @example
 * humanReadableSource("supadata")            // → "Supadata (verbatim captions)"
 * humanReadableSource("innertube/ANDROID")   // → "YouTube captions (verbatim)"
 * humanReadableSource("yt-dlp")              // → "YouTube captions (verbatim)"
 * humanReadableSource("audio-transcription") // → "Whisper (AI audio transcription)"
 * humanReadableSource("gemini")              // → null  (already shown in body)
 * humanReadableSource("cache")               // → null  (origin unknown)
 */
export function humanReadableSource(src: string | undefined): string | null {
  if (!src || src === "unknown" || src === "cache") return null;
  if (src === "gemini") return null;
  if (src === "supadata") return "Supadata (verbatim captions)";
  if (
    src.startsWith("innertube/") ||
    src === "yt-dlp" ||
    src === "timedtext" ||
    src === "youtube-transcript"
  )
    return "YouTube captions (verbatim)";
  if (src === "audio-transcription" || src.startsWith("audio-transcription"))
    return "Whisper (AI audio transcription)";
  if (src === "browser") return "browser";
  if (src === "local-worker") return "local worker";
  return src;
}
