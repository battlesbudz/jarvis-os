/**
 * Gemini YouTube Transcript + Video File Transcript
 *
 * Two complementary transcription paths powered by Google Gemini:
 *
 * 1. fetchTranscriptViaGemini(youtubeUrl)
 *    Uses Gemini's native YouTube support. Gemini fetches the video directly
 *    from Google's own infrastructure — no yt-dlp, no file size limits.
 *
 * 2. transcribeVideoFromUrl(publicUrl)
 *    Downloads any publicly accessible video (Google Drive, Dropbox, direct
 *    mp4/mov URL, etc.) and uploads it to Google's File API (up to 2 GB),
 *    then transcribes it with the same Gemini model. This path handles videos
 *    that can't be shared as YouTube links.
 *
 * Path 1 uses gemini-2.0-flash (YouTube URL processing requires Gemini 2.0+);
 * Path 2 uses gemini-1.5-flash for file uploads (File API works with 1.5).
 * Both paths fall back to gemini-1.5-pro when the primary model explicitly
 * rejects the content (content policy, context length, etc.).
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

// ── Path 1: YouTube native transcription ──────────────────────────────────────

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
 *   1. Try gemini-2.0-flash — the only Gemini model that supports YouTube URL
 *      processing natively via fileData.fileUri (Gemini 1.5 models do NOT support
 *      YouTube URLs in fileData; they silently fail or return empty responses).
 *   2. If 2.0-flash explicitly rejects the video (content policy, model limit, etc.),
 *      retry once with gemini-1.5-pro as a conservative fallback.
 *   3. Any other error is rethrown so the caller can fall through to Phase 1.
 *
 * @param videoUrl - Full YouTube URL (e.g. https://www.youtube.com/watch?v=...)
 * @returns The full transcript as plain text
 * @throws If both models fail or the API key is missing
 */
export async function fetchTranscriptViaGemini(videoUrl: string): Promise<string> {
  try {
    return await callGemini("gemini-2.0-flash", videoUrl);
  } catch (flashErr) {
    if (isFlashRejection(flashErr)) {
      const flashMsg = flashErr instanceof Error ? flashErr.message : String(flashErr);
      console.warn(
        `[geminiTranscript] gemini-2.0-flash rejected video (${flashMsg}) — retrying with gemini-1.5-pro`
      );
      return await callGemini("gemini-1.5-pro", videoUrl);
    }
    throw Object.assign(
      new Error(`gemini-2.0-flash failed: ${flashErr instanceof Error ? flashErr.message : String(flashErr)}`),
      { cause: flashErr }
    );
  }
}

// ── Path 2: File API upload + transcription ────────────────────────────────────

/**
 * Maximum video size for streaming uploads where the Content-Length is known
 * upfront (matches Google File API's 2 GB hard limit).
 */
const MAX_STREAM_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/**
 * Maximum video size when we must fall back to buffering because the
 * Content-Length header is absent.  Kept lower than MAX_STREAM_BYTES to
 * bound peak server RAM usage in the unknown-length case.
 */
const MAX_BUFFER_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

/**
 * Initiates a Google File API resumable upload and—where possible—pipes the
 * download response body directly into the upload without holding the full
 * file in RAM.
 *
 * When `contentLength` is known the response body is streamed straight to
 * Google (no full-file buffer).  When it is null we fall back to buffering up
 * to MAX_BUFFER_BYTES, because Google's resumable protocol requires knowing
 * the total size in the single-shot `upload, finalize` command.
 *
 * @returns The File API `file.name` (e.g. "files/abc123") needed for polling.
 */
async function uploadVideoStream(
  downloadResponse: Response,
  mimeType: string,
  contentLength: number | null,
  apiKey: string
): Promise<string> {
  // ── Step 1: Initiate the resumable upload session ─────────────────────────
  const initiateHeaders: Record<string, string> = {
    "X-Goog-Upload-Protocol": "resumable",
    "X-Goog-Upload-Command": "start",
    "X-Goog-Upload-Header-Content-Type": mimeType,
    "Content-Type": "application/json",
  };
  if (contentLength !== null) {
    initiateHeaders["X-Goog-Upload-Header-Content-Length"] = String(contentLength);
  }

  const initiateRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${apiKey}`,
    {
      method: "POST",
      headers: initiateHeaders,
      body: JSON.stringify({ file: { display_name: "jarvis-video-upload" } }),
    }
  );
  if (!initiateRes.ok) {
    const errText = await initiateRes.text().catch(() => "(no body)");
    throw new Error(
      `Resumable upload initiation failed: HTTP ${initiateRes.status} — ${errText}`
    );
  }

  const uploadUrl =
    initiateRes.headers.get("x-goog-upload-url") ??
    initiateRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) {
    throw new Error("Google File API did not return a resumable upload URL");
  }

  // ── Step 2: Upload the video bytes ───────────────────────────────────────
  let uploadBody: BodyInit;
  let uploadContentLength: number;

  if (contentLength !== null) {
    // True streaming path: pipe the download body directly — no full buffer.
    if (!downloadResponse.body) {
      throw new Error(
        "Download response has no readable body stream — cannot stream to Google File API"
      );
    }
    uploadBody = downloadResponse.body as BodyInit;
    uploadContentLength = contentLength;
  } else {
    // Buffered fallback: read everything, then upload.
    const arrayBuffer = await downloadResponse.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    if (bytes > MAX_BUFFER_BYTES) {
      throw new Error(
        `Video is too large (${Math.round(bytes / 1024 / 1024)} MB). ` +
        `Maximum supported size for videos without a Content-Length header is ` +
        `${Math.round(MAX_BUFFER_BYTES / 1024 / 1024)} MB.`
      );
    }
    uploadBody = arrayBuffer;
    uploadContentLength = bytes;
  }

  const uploadHeaders: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Length": String(uploadContentLength),
    "X-Goog-Upload-Offset": "0",
    "X-Goog-Upload-Command": "upload, finalize",
  };

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: uploadHeaders,
    body: uploadBody,
    // Required for Node.js 18+ streaming request bodies
    // @ts-ignore
    duplex: "half",
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "(no body)");
    throw new Error(`Resumable upload failed: HTTP ${uploadRes.status} — ${errText}`);
  }

  const data = (await uploadRes.json()) as { file?: { name?: string } };
  const fileName = data?.file?.name;
  if (!fileName) {
    throw new Error("Google File API upload response is missing file.name");
  }
  return fileName;
}

/**
 * Convert common share-link formats to a direct download URL.
 *
 * Handles:
 *   - Google Drive  /file/d/<id>/view  →  /uc?export=download&id=<id>&confirm=t
 *   - Google Drive  /open?id=<id>      →  /uc?export=download&id=<id>&confirm=t
 *   - Dropbox       ?dl=0              →  ?dl=1
 *   - All other URLs are returned unchanged.
 */
export function normalizeVideoUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Google Drive file share links
    if (parsed.hostname === "drive.google.com") {
      // /file/d/<id>/view  or  /file/d/<id>/...
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      if (fileMatch) {
        return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}&confirm=t`;
      }
      // /open?id=<id>
      const openId = parsed.searchParams.get("id");
      if (openId) {
        return `https://drive.google.com/uc?export=download&id=${openId}&confirm=t`;
      }
    }

    // Dropbox — change dl=0 to dl=1 for direct download
    if (parsed.hostname.includes("dropbox.com")) {
      parsed.searchParams.set("dl", "1");
      return parsed.toString();
    }

    return url;
  } catch {
    return url;
  }
}

/**
 * Infer a MIME type from the URL path extension.
 * Falls back to video/mp4 for unknown or missing extensions.
 */
function inferMimeType(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".mov") || pathname.endsWith(".qt")) return "video/quicktime";
    if (pathname.endsWith(".avi")) return "video/x-msvideo";
    if (pathname.endsWith(".webm")) return "video/webm";
    if (pathname.endsWith(".mkv")) return "video/x-matroska";
    if (pathname.endsWith(".3gp")) return "video/3gpp";
  } catch {
    // ignore
  }
  return "video/mp4";
}

// ── Security helpers ──────────────────────────────────────────────────────────

/**
 * SSRF guard: reject URLs that point to localhost, private RFC-1918/RFC-4193
 * ranges, link-local addresses, cloud metadata endpoints, or non-http(s) schemes.
 *
 * This is best-effort — it operates on the URL string before any DNS resolution.
 * It prevents the most common SSRF attack vectors but is not a substitute for
 * network-level egress controls.
 */
function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" — only http/https is allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject obvious localhost / loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error(`Blocked URL: loopback addresses are not allowed`);
  }

  // Reject RFC-1918 private ranges (as literal IPs)
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 ||                          // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) ||          // 192.168.0.0/16
      (a === 169 && b === 254) ||          // 169.254.0.0/16 link-local
      a === 0                              // 0.0.0.0/8
    ) {
      throw new Error(`Blocked URL: private/link-local IP addresses are not allowed`);
    }
  }

  // Reject cloud metadata IPs
  if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
    throw new Error(`Blocked URL: cloud metadata endpoints are not allowed`);
  }
}

/**
 * Validate the Content-Type header from a download response.
 * Rejects HTML pages (which usually indicate a redirect to a login or warning
 * page rather than the actual video file).
 */
function assertVideoContentType(contentType: string | null, url: string): void {
  if (!contentType) return; // no header → allow and let Gemini reject if needed
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct === "text/html" || ct === "application/xhtml+xml" || ct === "text/xml") {
    throw new Error(
      `The URL did not return a video file (got Content-Type: ${ct}). ` +
      `This often happens with Google Drive links that require sign-in or show a virus-scan warning. ` +
      `Make sure the file is shared with "Anyone with the link" and try again.`
    );
  }
}

/**
 * Call Gemini using an already-uploaded File API file reference.
 */
async function callGeminiWithFile(
  model: string,
  fileUri: string,
  mimeType: string
): Promise<string> {
  const client = getClient();
  const response = await client.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { fileData: { fileUri, mimeType } },
          { text: TRANSCRIPT_PROMPT },
        ],
      },
    ],
  });
  const text = response.text;
  if (!text || !text.trim()) {
    throw new Error(`Gemini model ${model} returned an empty transcript for this video file`);
  }
  return text.trim();
}

/**
 * Downloads a publicly accessible video, uploads it to Google's File API via
 * resumable streaming upload, transcribes it with Gemini, and cleans up.
 *
 * Supports Google Drive share links, Dropbox links, and any direct video URL.
 * When the server receives a Content-Length header the download body is piped
 * directly to Google without buffering the full file in RAM (up to 2 GB).
 * When Content-Length is absent a buffered fallback is used (up to 1 GB).
 *
 * @param videoUrl - Public URL to the video file (or Google Drive share link)
 * @param mimeType - Optional MIME type override; inferred from URL if omitted
 * @returns The full spoken transcript as plain text
 * @throws If the video cannot be downloaded, is too large, or transcription fails
 */
export async function transcribeVideoFromUrl(
  videoUrl: string,
  mimeType?: string,
): Promise<string> {
  // ── Safety: reject private/loopback/metadata URLs (SSRF guard) ───────────
  assertSafeUrl(videoUrl);

  const downloadUrl = normalizeVideoUrl(videoUrl);

  // Also validate the resolved URL (Drive/Dropbox rewrites point to google.com
  // or dropboxusercontent.com — both safe, but still worth checking).
  assertSafeUrl(downloadUrl);

  const resolvedMime = mimeType ?? inferMimeType(downloadUrl);

  console.log(
    `[geminiTranscript] Downloading video for File API upload: ${downloadUrl} (mime=${resolvedMime})`
  );

  // ── Download ──────────────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(downloadUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Jarvis-Bot/1.0)" },
    });
  } catch (fetchErr) {
    throw new Error(
      `Failed to reach video URL: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Video download failed: HTTP ${response.status} from ${downloadUrl}`
    );
  }

  // ── Content-type guard: reject HTML warning/login pages ──────────────────
  assertVideoContentType(response.headers.get("content-type"), downloadUrl);

  const rawContentLength = response.headers.get("content-length");
  const parsedLength = rawContentLength ? parseInt(rawContentLength, 10) : NaN;
  // Treat malformed / negative / non-finite values as unknown length so we
  // fall back to the buffered path rather than sending Content-Length: NaN.
  const contentLength =
    Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null;

  if (contentLength !== null && contentLength > MAX_STREAM_BYTES) {
    throw new Error(
      `Video is too large (${Math.round(contentLength / 1024 / 1024)} MB). ` +
      `Maximum supported size is ${Math.round(MAX_STREAM_BYTES / 1024 / 1024 / 1024)} GB.`
    );
  }

  const streamMode = contentLength !== null;
  console.log(
    `[geminiTranscript] Starting ${streamMode ? "streaming" : "buffered"} upload to File API` +
    (contentLength !== null ? ` (${Math.round(contentLength / 1024 / 1024)} MB)` : " (size unknown)")
  );

  // ── Stream or buffer-then-upload to Google File API ───────────────────────
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI_INTEGRATIONS_GEMINI_API_KEY is not set");

  let fileName: string;
  try {
    fileName = await uploadVideoStream(response, resolvedMime, contentLength, apiKey);
  } catch (uploadErr) {
    throw new Error(
      `File API upload failed: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`
    );
  }

  console.log(`[geminiTranscript] Uploaded — file name: ${fileName}, polling for ACTIVE state`);

  // ── Poll until ACTIVE (or FAILED) ─────────────────────────────────────────
  const client = getClient();
  // Google typically processes video files in under a minute; we allow up to 5 min.
  const POLL_INTERVAL_MS = 5_000;
  const MAX_POLL_ATTEMPTS = 60; // 5 min max

  try {
    let fileInfo = await client.files.get({ name: fileName });
    let attempts = 0;

    while (fileInfo.state === "PROCESSING" && attempts < MAX_POLL_ATTEMPTS) {
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      fileInfo = await client.files.get({ name: fileName });
      attempts++;
    }

    if (fileInfo.state !== "ACTIVE") {
      throw new Error(
        `File processing ended in state "${fileInfo.state}" after ${attempts} polls — cannot transcribe`
      );
    }

    const fileUri = fileInfo.uri;
    if (!fileUri) {
      throw new Error("File API did not return a URI for the uploaded file");
    }

    console.log(`[geminiTranscript] File ACTIVE (uri=${fileUri}) — running Gemini transcription`);

    // ── Transcribe (Flash → Pro fallback) ──────────────────────────────────
    try {
      return await callGeminiWithFile("gemini-1.5-flash", fileUri, resolvedMime);
    } catch (flashErr) {
      if (isFlashRejection(flashErr)) {
        const flashMsg = flashErr instanceof Error ? flashErr.message : String(flashErr);
        console.warn(
          `[geminiTranscript] Flash rejected uploaded file (${flashMsg}) — retrying with gemini-1.5-pro`
        );
        return await callGeminiWithFile("gemini-1.5-pro", fileUri, resolvedMime);
      }
      throw Object.assign(
        new Error(
          `Gemini transcription failed: ${flashErr instanceof Error ? flashErr.message : String(flashErr)}`
        ),
        { cause: flashErr }
      );
    }
  } finally {
    // Always delete the uploaded file from Google's servers
    try {
      await client.files.delete({ name: fileName });
      console.log(`[geminiTranscript] Cleaned up uploaded file: ${fileName}`);
    } catch (cleanupErr) {
      console.warn(
        `[geminiTranscript] Failed to delete uploaded file ${fileName}:`,
        cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      );
    }
  }
}

/**
 * Returns true if the Gemini transcript path is configured and available.
 * Callers can use this to skip Phase 0 cheaply when the key is missing.
 */
export function isGeminiTranscriptAvailable(): boolean {
  return !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
}
