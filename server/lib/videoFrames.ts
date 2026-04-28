/**
 * Video Keyframe Extraction & Vision Analysis
 *
 * Extracts JPEG keyframes from a YouTube video using yt-dlp + ffmpeg, then
 * sends them to GPT-4o vision to produce brief timestamped visual descriptions.
 *
 * Designed to be called in parallel with transcript fetching — any failure
 * is caught and returns null so the caller can degrade gracefully.
 *
 * Frame sampling strategy:
 *   - Short videos (<90 sec / Shorts): 3–5 evenly spaced frames derived from
 *     explicit timestamps (guarantees the frame count, not interval-based).
 *   - Longer videos: one frame every 30 seconds, capped at 20 frames.
 *
 * Vision output uses response_format json_object for reliable parsing.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { readdir, readFile, rm } from "fs/promises";
import { mkdtempSync } from "fs";
import path from "path";
import os from "os";
import { ensureYtdlpUpgraded, getYtdlpCmd } from "./transcriptCache";

const execAsync = promisify(exec);

export interface Keyframe {
  timestampSec: number;
  jpegBuffer: Buffer;
}

export interface VisualObservation {
  timestamp: string;
  description: string;
}

/** Format seconds → "M:SS" or "H:MM:SS". */
function formatSec(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Get video duration in seconds using ffprobe on a downloaded file.
 * Returns 0 if unavailable.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { timeout: 15_000 }
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Extract a single frame at an explicit timestamp using ffmpeg -ss.
 * Returns the JPEG buffer or null if extraction failed.
 */
async function extractFrameAt(
  videoPath: string,
  timestampSec: number,
  outputPath: string
): Promise<Buffer | null> {
  try {
    await execAsync(
      `ffmpeg -ss ${timestampSec.toFixed(2)} -i "${videoPath}" ` +
        `-frames:v 1 -vf "scale=640:-2" -q:v 3 "${outputPath}" -y`,
      { timeout: 30_000 }
    );
    return await readFile(outputPath);
  } catch {
    return null;
  }
}

/**
 * Download the lowest-quality video stream for a YouTube video and extract
 * JPEG keyframes.
 *
 * For Shorts / short videos (< 90 sec): extracts exactly 3–5 evenly spaced
 * frames at computed timestamps (guarantees frame count).
 * For longer videos: extracts one frame every 30 seconds, capped at 20.
 *
 * Uses the same yt-dlp upgrade path as the transcript pipeline for consistency.
 *
 * @param videoId       11-char YouTube video ID
 * @param intervalSecs  Override interval for long videos (optional)
 * @returns Array of { timestampSec, jpegBuffer } or empty array on failure
 */
export async function extractKeyframes(
  videoId: string,
  intervalSecs?: number
): Promise<Keyframe[]> {
  let tmpDir: string;
  try {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), `ytviz-${videoId}-`));
  } catch {
    return [];
  }

  try {
    // Reuse the same yt-dlp upgrade strategy as the transcript/audio pipeline
    await ensureYtdlpUpgraded();
    const cmd = getYtdlpCmd();

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const videoPath = path.join(tmpDir, `${videoId}.mp4`);

    // Download the smallest available video stream (no audio needed)
    await execAsync(
      `${cmd} -f "worstvideo[ext=mp4]/worstvideo/worst[ext=mp4]/worst" ` +
        `--no-playlist --no-warnings --quiet --no-progress ` +
        `--max-filesize 150M ` +
        `--output "${videoPath}" -- "${url}"`,
      { timeout: 120_000 }
    );

    // Check the file was actually written (yt-dlp may change the extension)
    const files = await readdir(tmpDir).catch(() => [] as string[]);
    const videoFile = files.find(
      (f) => f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv")
    );
    if (!videoFile) return [];

    const actualVideoPath = path.join(tmpDir, videoFile);
    const duration = await getVideoDuration(actualVideoPath);

    const framesDir = path.join(tmpDir, "frames");
    await execAsync(`mkdir -p "${framesDir}"`, { timeout: 5_000 });

    const keyframes: Keyframe[] = [];

    if (duration > 0 && duration < 90) {
      // ── Short video / Shorts: 3–5 evenly spaced explicit timestamps ───────
      // Guarantee exactly N frames by computing evenly spaced timestamps and
      // extracting each with a targeted -ss seek. N is clamped to 3–5 (and
      // further capped at ≤6 per spec for videos near the 90s threshold).
      //
      // Formula: timestamps = [D/(N+1), 2D/(N+1), ..., ND/(N+1)]
      // For a 30s video → 3 frames at 7.5s, 15s, 22.5s (→ 8, 15, 23 rounded)
      // For a 60s Short → 4 frames at 12, 24, 36, 48
      const targetFrames = Math.max(3, Math.min(5, Math.round(duration / 15)));
      const timestamps: number[] = [];
      for (let i = 1; i <= targetFrames; i++) {
        timestamps.push(Math.round((duration / (targetFrames + 1)) * i));
      }

      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        const framePath = path.join(framesDir, `frame-${String(i + 1).padStart(4, "0")}.jpg`);
        const buf = await extractFrameAt(actualVideoPath, ts, framePath);
        if (buf) keyframes.push({ timestampSec: ts, jpegBuffer: buf });
      }
    } else {
      // ── Longer video: interval-based with fps filter ───────────────────
      const interval = intervalSecs ?? 30;
      const maxFrames = 20;
      const fpsExpr = `1/${interval}`;
      await execAsync(
        `ffmpeg -i "${actualVideoPath}" -vf "fps=${fpsExpr},scale=640:-2" ` +
          `-frames:v ${maxFrames} -q:v 3 ` +
          `"${framesDir}/frame-%04d.jpg" -y`,
        { timeout: 120_000 }
      );

      const frameFiles = (await readdir(framesDir).catch(() => [] as string[]))
        .filter((f) => f.endsWith(".jpg"))
        .sort();

      for (let i = 0; i < frameFiles.length; i++) {
        const timestampSec = i * interval;
        try {
          const buf = await readFile(path.join(framesDir, frameFiles[i]));
          keyframes.push({ timestampSec, jpegBuffer: buf });
        } catch {
          // Skip unreadable frames
        }
      }
    }

    console.log(
      `[videoFrames] extracted ${keyframes.length} keyframes for ${videoId} ` +
        `(duration=${Math.round(duration)}s)`
    );

    return keyframes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[videoFrames] keyframe extraction failed for ${videoId}: ${msg}`);
    return [];
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Send batches of keyframes to GPT-4o vision and return timestamped descriptions.
 *
 * Frames are batched in groups of ≤10 to stay within context limits.
 * Uses response_format: json_object for reliable, schema-enforced parsing.
 *
 * @returns Array of { timestamp, description } or empty array on failure
 */
export async function describeFrames(frames: Keyframe[]): Promise<VisualObservation[]> {
  if (frames.length === 0) return [];
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) return [];

  try {
    const { openai } = await import("../replit_integrations/audio/client");
    const BATCH_SIZE = 10;
    const observations: VisualObservation[] = [];

    for (let i = 0; i < frames.length; i += BATCH_SIZE) {
      const batch = frames.slice(i, i + BATCH_SIZE);

      const imageContent: Array<{
        type: "image_url";
        image_url: { url: string; detail: "low" };
      }> = batch.map((frame) => ({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${frame.jpegBuffer.toString("base64")}`,
          detail: "low",
        },
      }));

      const timestampList = batch
        .map((f, idx) => `Frame ${idx + 1}: [${formatSec(f.timestampSec)}]`)
        .join(", ");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `You are analysing video keyframes. ` +
                  `The frames correspond to these timestamps: ${timestampList}. ` +
                  `For each frame in order, write one brief sentence describing what is visually shown — ` +
                  `objects, text on screen, setting, people, diagrams, code, etc. ` +
                  `Be specific and factual. ` +
                  `Respond with JSON in this exact shape: {"descriptions": ["...", "..."]} ` +
                  `with exactly ${batch.length} string(s) in the array, one per frame.`,
              },
              ...imageContent,
            ],
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "";

      // Parse structured JSON response
      let descriptions: string[] = [];
      try {
        const parsed = JSON.parse(raw) as { descriptions?: unknown };
        if (Array.isArray(parsed.descriptions)) {
          descriptions = parsed.descriptions.map(String);
        }
      } catch {
        // Fallback: extract any array from the response
        try {
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (jsonMatch) descriptions = JSON.parse(jsonMatch[0]);
        } catch {
          descriptions = raw
            .split("\n")
            .map((l) => l.replace(/^[-•*\d.]+\s*/, "").trim())
            .filter(Boolean);
        }
      }

      for (let j = 0; j < batch.length; j++) {
        const desc = descriptions[j]?.trim();
        if (desc) {
          observations.push({
            timestamp: formatSec(batch[j].timestampSec),
            description: desc,
          });
        }
      }
    }

    console.log(`[videoFrames] vision analysis produced ${observations.length} observations`);
    return observations;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[videoFrames] vision analysis failed: ${msg}`);
    return [];
  }
}

/**
 * Full pipeline: extract keyframes + describe them visually.
 *
 * Returns a formatted "Visual Summary" string ready to append to a transcript,
 * or null if the pipeline fails or produces no output.
 *
 * @param videoId       11-char YouTube video ID
 * @param intervalSecs  Optional override for long-video keyframe interval
 */
export async function buildVisualSummary(
  videoId: string,
  intervalSecs?: number
): Promise<string | null> {
  // Short-circuit early: no point downloading video if we can't describe it
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) return null;

  try {
    const frames = await extractKeyframes(videoId, intervalSecs);
    if (frames.length === 0) return null;

    const observations = await describeFrames(frames);
    if (observations.length === 0) return null;

    const lines = observations.map((o) => `[${o.timestamp}] ${o.description}`);
    return (
      `Visual Summary\n` +
      `${"─".repeat(60)}\n` +
      lines.join("\n")
    );
  } catch (err) {
    console.warn(
      `[videoFrames] buildVisualSummary failed for ${videoId}: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
