/**
 * Lightweight screenshot diff utility.
 *
 * Compares two base64-encoded images (JPEG or PNG) and returns a "change ratio"
 * between 0.0 (identical) and 1.0 (completely different).
 *
 * Strategy:
 *   1. Decode both images via @napi-rs/canvas loadImage (already installed).
 *   2. Draw each image onto a 64×64 canvas and read pixel data.
 *   3. Compute the mean absolute difference per channel across all pixels.
 *   4. Normalise to [0, 1] and return.
 *
 * Fallback (if canvas decode fails): compare raw byte samples across the
 * base64 buffers as a best-effort heuristic.
 */

const THUMB_SIZE = 64;
const CHANGE_CHANNEL_SCALE = 255 * 3; // max sum of |R|+|G|+|B| per pixel

export async function screenshotDiff(base64a: string, base64b: string): Promise<number> {
  try {
    return await diffViaCanvas(base64a, base64b);
  } catch {
    return diffViaRawBytes(base64a, base64b);
  }
}

async function diffViaCanvas(base64a: string, base64b: string): Promise<number> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");

  // Strip data-URL prefix if present
  const strip = (s: string) => s.replace(/^data:[^;]+;base64,/, "");

  const [imgA, imgB] = await Promise.all([
    loadImage(Buffer.from(strip(base64a), "base64")),
    loadImage(Buffer.from(strip(base64b), "base64")),
  ]);

  const canvas = createCanvas(THUMB_SIZE, THUMB_SIZE);
  const ctx = canvas.getContext("2d");

  // Draw image A
  ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
  ctx.drawImage(imgA as never, 0, 0, THUMB_SIZE, THUMB_SIZE);
  const dataA = ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE).data; // Uint8ClampedArray

  // Draw image B
  ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
  ctx.drawImage(imgB as never, 0, 0, THUMB_SIZE, THUMB_SIZE);
  const dataB = ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE).data;

  const pixelCount = THUMB_SIZE * THUMB_SIZE;
  let totalDiff = 0;
  for (let i = 0; i < dataA.length; i += 4) {
    // R, G, B only — skip alpha
    totalDiff += Math.abs(dataA[i] - dataB[i])
      + Math.abs(dataA[i + 1] - dataB[i + 1])
      + Math.abs(dataA[i + 2] - dataB[i + 2]);
  }

  return totalDiff / (pixelCount * CHANGE_CHANNEL_SCALE);
}

/**
 * Fallback: sample evenly spaced bytes from both buffers and compare.
 * This is crude but gives a reasonable signal when canvas is unavailable.
 */
function diffViaRawBytes(base64a: string, base64b: string): number {
  const strip = (s: string) => s.replace(/^data:[^;]+;base64,/, "");
  const bufA = Buffer.from(strip(base64a), "base64");
  const bufB = Buffer.from(strip(base64b), "base64");

  const SAMPLES = 512;
  const minLen = Math.min(bufA.length, bufB.length);
  if (minLen < 4) return 0;

  const step = Math.max(1, Math.floor(minLen / SAMPLES));
  let diff = 0;
  let count = 0;
  for (let i = 64; i < minLen; i += step) {
    // Skip the first 64 bytes which usually contain headers that differ in timestamps
    diff += Math.abs(bufA[i] - bufB[i]);
    count++;
  }

  return count > 0 ? diff / (count * 255) : 0;
}
