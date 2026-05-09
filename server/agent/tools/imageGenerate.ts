import OpenAI from "openai";
import { getOpenAIClientConfig } from "../providers/env";
// @inferencesh/sdk is loaded dynamically inside generateFlux() — do NOT
// add a static top-level import here.  The package uses bare ESM relative
// imports (no .js extensions) that crash Node.js at startup when the module
// is left external by esbuild.  Dynamic import() defers resolution until the
// FLUX path is actually executed (i.e. only when INFSH_API_KEY is set).
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { telegramLinks } from "@shared/schema";
import { sendPhoto } from "../../integrations/telegram";
import {
  ensureJarvisFolder,
  ensureJarvisSubfolder,
  createDriveBinaryFile,
} from "../../integrations/googleDrive";
import type { AgentTool } from "../types";

// Chat/text completions — routes through the Replit AI integration proxy.
const openai = new OpenAI(getOpenAIClientConfig());

// Image generation — must bypass the Replit proxy, which only supports
// chat/text models and returns "Unknown model" for gpt-image-1 / dall-e-3.
// Only uses a real OPENAI_API_KEY (sk-...). The Replit AI integration proxy
// key must NOT be used here — it only works with the proxy base URL and
// will return "Unknown model" when hitting api.openai.com directly.
const imageOpenai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "no-direct-openai-key",
  // No baseURL — image requests go to api.openai.com directly.
});

type GptImage1Size = "1024x1024" | "1536x1024" | "1024x1536";
type Dalle3Size    = "1024x1024" | "1792x1024" | "1024x1792";

const SIZE_MAP: Record<string, GptImage1Size> = {
  square:    "1024x1024",
  landscape: "1536x1024",
  portrait:  "1024x1536",
};

// dall-e-3 has slightly different size values; map from gpt-image-1 equivalents.
const DALLE3_SIZE_MAP: Record<GptImage1Size, Dalle3Size> = {
  "1024x1024": "1024x1024",
  "1536x1024": "1792x1024",
  "1024x1536": "1024x1792",
};

/** FLUX image_size values understood by falai/flux-dev-lora */
const FLUX_SIZE_MAP: Record<string, string> = {
  square:    "square_hd",
  landscape: "landscape_16_9",
  portrait:  "portrait_16_9",
};

const GENERATED_IMAGES_FOLDER = "Generated Images";

async function getTelegramChatId(userId: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ chatId: telegramLinks.chatId })
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, userId))
      .limit(1);
    return rows[0]?.chatId ?? null;
  } catch {
    return null;
  }
}

interface FetchedImage {
  buffer: Buffer;
  /** MIME type inferred from data URL prefix or HTTP content-type header. */
  mimeType: string;
}

async function fetchImageBuffer(url: string): Promise<FetchedImage | null> {
  // gpt-image-1 / dall-e-3 (b64_json mode) return base64 data URLs — decode directly.
  if (url.startsWith("data:")) {
    const b64 = url.split(",")[1];
    if (!b64) return null;
    // Parse mime from "data:<mime>;base64,..."
    const mimeMatch = url.match(/^data:([^;]+);/);
    const mimeType = mimeMatch?.[1] ?? "image/png";
    return { buffer: Buffer.from(b64, "base64"), mimeType };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    // Use the actual content-type from the response so Drive metadata is accurate.
    const ct = res.headers.get("content-type") ?? "image/png";
    const mimeType = ct.split(";")[0].trim() || "image/png";
    return { buffer: Buffer.from(arr), mimeType };
  } catch {
    return null;
  }
}

/**
 * Detect whether an OpenAI error is a "model not found / not supported" error
 * (as opposed to quota, content policy, auth, etc.).
 */
function isModelNotFoundError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("unknown model") ||
    msg.includes("model not found") ||
    msg.includes("does not exist") ||
    msg.includes("no such model") ||
    msg.includes("unsupported model")
  );
}

/**
 * Generate an image via gpt-image-1 (direct OpenAI) and return a data URL.
 * Falls back to dall-e-3 automatically if gpt-image-1 is not available on
 * the current API key tier.
 */
async function generateGptImage(prompt: string, size: GptImage1Size): Promise<string> {
  // ── Attempt 1: gpt-image-1 ─────────────────────────────────────────────
  try {
    const response = await imageOpenai.images.generate({
      model: "gpt-image-1",
      prompt,
      n: 1,
      size,
    });
    const b64 = (response.data ?? [])[0]?.b64_json;
    if (b64) return `data:image/png;base64,${b64}`;
  } catch (err) {
    if (!isModelNotFoundError(err)) {
      // Non-model error (quota, content policy, size not supported…) — retry
      // with square before propagating, then re-throw the original.
      if (size !== "1024x1024") {
        console.warn(`[image_generate] gpt-image-1 size ${size} failed, retrying 1024x1024:`, err);
        try {
          const retry = await imageOpenai.images.generate({
            model: "gpt-image-1",
            prompt,
            n: 1,
            size: "1024x1024",
          });
          const b64 = (retry.data ?? [])[0]?.b64_json;
          if (b64) return `data:image/png;base64,${b64}`;
        } catch {
          // fall through to dall-e-3 below
        }
      }
      // Auth / quota errors that won't be helped by switching models
      const msg = err instanceof Error ? err.message : String(err);
      if (/auth|unauthorized|permission|quota|rate.?limit|billing/i.test(msg)) {
        throw new Error(
          "Image generation requires a direct OpenAI API key. " +
          "The Replit AI integration proxy does not support image models. " +
          "Add your own OPENAI_API_KEY as a Replit secret to enable image generation. " +
          `(Original error: ${msg})`
        );
      }
      // For other errors fall through to dall-e-3
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[image_generate] gpt-image-1 unavailable (${errMsg}), falling back to dall-e-3`);
  }

  // ── Attempt 2: dall-e-3 fallback ──────────────────────────────────────
  const dalle3Size = DALLE3_SIZE_MAP[size] ?? "1024x1024";
  try {
    const response = await imageOpenai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: dalle3Size,
      response_format: "b64_json",
    });
    const b64 = (response.data ?? [])[0]?.b64_json;
    if (b64) return `data:image/png;base64,${b64}`;
    // Normalize URL response to a base64 data URL so downstream delivery is consistent.
    const remoteUrl = ((response.data ?? [])[0] as { url?: string } | undefined)?.url;
    if (remoteUrl) {
      const fetched = await fetchImageBuffer(remoteUrl);
      if (fetched) return `data:image/png;base64,${fetched.buffer.toString("base64")}`;
      return remoteUrl; // Last resort: return the URL if fetch fails
    }
  } catch (dalle3Err) {
    const msg = dalle3Err instanceof Error ? dalle3Err.message : String(dalle3Err);
    // Any failure at the dall-e-3 stage means neither model is accessible — provide
    // actionable guidance regardless of the specific error type.
    throw new Error(
      "Image generation requires a direct OpenAI API key — " +
      "the Replit AI integration proxy only supports chat/text models. " +
      "Add your own OPENAI_API_KEY as a Replit secret to enable image generation. " +
      `(Error: ${msg})`
    );
  }

  throw new Error("No image data returned from gpt-image-1 or dall-e-3");
}

const POLLINATIONS_SIZE_MAP: Record<string, { width: number; height: number }> = {
  square:    { width: 1024, height: 1024 },
  landscape: { width: 1792, height: 1024 },
  portrait:  { width: 1024, height: 1792 },
};

/**
 * Generate an image via Pollinations.ai — free, no API key required.
 * Returns a data URL (data:image/jpeg;base64,...) ready for existing delivery paths.
 */
async function generatePollinations(prompt: string, sizeKey: string): Promise<string> {
  const { width, height } = POLLINATIONS_SIZE_MAP[sizeKey] ?? { width: 1024, height: 1024 };
  const seed = Math.floor(Math.random() * 2_147_483_647);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&model=flux&nologo=true&seed=${seed}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) {
    throw new Error(`Pollinations returned HTTP ${res.status}`);
  }
  const arr = await res.arrayBuffer();
  const b64 = Buffer.from(arr).toString("base64");
  return `data:image/jpeg;base64,${b64}`;
}

/** Generate an image via FLUX (falai/flux-dev-lora) and return its URL. */
async function generateFlux(prompt: string, imageSize: string): Promise<string> {
  const apiKey = process.env.INFSH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "INFSH_API_KEY is not configured. Add it as a Replit secret to enable FLUX image generation."
    );
  }
  // Dynamic import so the module is never loaded when INFSH_API_KEY is absent.
  const { inference } = await import("@inferencesh/sdk");
  const client = inference({ apiKey });
  const result = await Promise.race([
    client.run({
      app: "falai/flux-dev-lora",
      input: { prompt, image_size: imageSize, num_images: 1 },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("FLUX generation timed out after 3 minutes")), 180_000)
    ),
  ]);
  const output = (result as { output?: unknown }).output as Record<string, unknown> | null;
  const images = output?.images as Array<{ url: string }> | undefined;
  const url = images?.[0]?.url;
  if (!url) throw new Error("No image URL returned from FLUX");
  return url;
}

/** Build a Drive-friendly filename from a prompt and the actual MIME type. */
function buildImageFilename(prompt: string, mimeType: string): string {
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extMap[mimeType] ?? "png";
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  const ts = new Date().toISOString().slice(0, 10);
  return `${slug || "generated-image"}-${ts}.${ext}`;
}

/**
 * Upload an image buffer to the user's Google Drive under
 * "Jarvis Workspace / Generated Images". Returns the web view link, or null on failure.
 */
async function saveImageToDrive(
  accessToken: string,
  buf: Buffer,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  try {
    const parentFolderId = await ensureJarvisFolder(accessToken);
    const folderId = await ensureJarvisSubfolder(accessToken, parentFolderId, GENERATED_IMAGES_FOLDER);
    const file = await createDriveBinaryFile(accessToken, filename, buf, mimeType, { folderId });
    return file.webViewLink;
  } catch (err) {
    console.error("[image_generate] Drive upload failed:", err);
    return null;
  }
}

export const imageGenerateTool: AgentTool = {
  name: "image_generate",
  description:
    "Generate an image from a text prompt and deliver it to the user's current channel. " +
    "Supports two models: GPT Image (default — fast, reliable, great for illustrations and concepts) and " +
    "FLUX (high-quality, photorealistic and artistic outputs — requires INFSH_API_KEY). " +
    "On Telegram: sends the image inline as a photo bubble. On Discord: sends as an embedded image attachment. " +
    "In the app: displays the image inline in the chat bubble. " +
    "Can optionally save the generated image to the user's Google Drive under 'Jarvis Workspace / Generated Images'. " +
    "Use for concept illustrations, motivational visuals, meal plan photos, or any explicit image request. " +
    "Default model is GPT Image (use 'dalle' as the model parameter value) unless the user specifically asks for FLUX or higher quality/photorealistic output.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "A detailed description of the image to generate. Include style, content, mood, and any relevant details.",
      },
      size: {
        type: "string",
        enum: ["square", "landscape", "portrait"],
        description:
          "Image aspect ratio: square (1:1, default), landscape (16:9, wide), portrait (9:16, tall).",
      },
      model: {
        type: "string",
        enum: ["dalle", "flux"],
        description:
          "Image model to use. 'dalle' (default) = GPT Image — fast and reliable. 'flux' = FLUX Dev — higher quality, more photorealistic and artistic, slower. Use flux when the user asks for photorealistic or high-quality images.",
      },
      caption: {
        type: "string",
        description: "Optional short caption to accompany the image on Telegram or Discord (max 200 chars).",
      },
      save_to_drive: {
        type: "boolean",
        description:
          "If true and the user has Google Drive connected, save the generated image to their Google Drive under 'Jarvis Workspace / Generated Images'.",
      },
    },
    required: ["prompt"],
  },

  async execute(args, ctx) {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) {
      return { ok: false, content: "No prompt provided.", label: "image_generate: no prompt" };
    }

    const sizeKey       = String(args.size  || "square").toLowerCase();
    const modelKey      = String(args.model || "dalle").toLowerCase();
    const useFlux       = modelKey === "flux";
    const caption       = args.caption ? String(args.caption).slice(0, 200) : undefined;
    const wantDriveSave = !!(args as { save_to_drive?: boolean }).save_to_drive;
    // Drive save is only possible when the user's Google token is available.
    const saveToDrive   = wantDriveSave && !!ctx.googleAccessToken;

    const hasInfshKey   = !!process.env.INFSH_API_KEY;
    const hasOpenAiKey  = !!(process.env.OPENAI_API_KEY?.startsWith("sk-"));
    const usingPollinations = (useFlux && !hasInfshKey) || (!useFlux && !hasOpenAiKey);
    const modelLabel = usingPollinations
      ? "Pollinations (FLUX)"
      : useFlux ? "FLUX" : "GPT Image";

    let imageUrl: string;
    try {
      if (useFlux) {
        if (hasInfshKey) {
          const fluxSize = FLUX_SIZE_MAP[sizeKey] ?? "square_hd";
          imageUrl = await generateFlux(prompt, fluxSize);
        } else {
          imageUrl = await generatePollinations(prompt, sizeKey);
        }
      } else {
        if (hasOpenAiKey) {
          const size: GptImage1Size = SIZE_MAP[sizeKey] ?? "1024x1024";
          try {
            imageUrl = await generateGptImage(prompt, size);
          } catch (openaiErr) {
            // OpenAI image generation failed (model tier, quota, key issue, etc.).
            // Always fall back to Pollinations so the user gets an image regardless.
            const openaiMsg = openaiErr instanceof Error ? openaiErr.message : String(openaiErr);
            console.warn(`[image_generate] OpenAI failed (${openaiMsg}), falling back to Pollinations`);
            imageUrl = await generatePollinations(prompt, sizeKey);
          }
        } else {
          imageUrl = await generatePollinations(prompt, sizeKey);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[image_generate] ${modelLabel} generation error:`, err);
      return {
        ok: false,
        content: `Image generation failed: ${msg}`,
        label: `image_generate: generation failed (${modelLabel})`,
        detail: msg,
      };
    }

    // Surface a clear note when the user asked for Drive save but Google is not connected.
    const driveUnavailableNote = wantDriveSave && !saveToDrive
      ? " (Google Drive not connected — reconnect Google from the Profile screen to enable Drive saves)"
      : "";

    const channelRaw = (ctx.channel || "app").toLowerCase();
    const isTelegram = channelRaw === "telegram";
    const isDiscord  = channelRaw.startsWith("discord");

    if (isTelegram) {
      const chatId = await getTelegramChatId(ctx.userId);
      if (!chatId) {
        return {
          ok: true,
          content: `Image generated (${modelLabel}) but Telegram is not linked. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, Telegram not linked)`,
          detail: JSON.stringify({ imageUrl, model: modelLabel }),
        };
      }

      const fetched = await fetchImageBuffer(imageUrl);
      if (!fetched) {
        return {
          ok: true,
          content: `Image generated (${modelLabel}) but could not download it for delivery. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, download failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const telegramFilename = buildImageFilename(prompt, fetched.mimeType);
      const sent = await sendPhoto(chatId, fetched.buffer, caption, fetched.mimeType, telegramFilename);
      if (!sent) {
        return {
          ok: false,
          content: `Image generated (${modelLabel}) but failed to send to Telegram. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, Telegram send failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      console.log(`[image_generate] Photo sent to Telegram user=${ctx.userId} model=${modelLabel} size=${sizeKey}`);

      const drivePart = saveToDrive
        ? await saveImageToDrive(
            ctx.googleAccessToken!,
            fetched.buffer,
            buildImageFilename(prompt, fetched.mimeType),
            fetched.mimeType,
          )
        : null;

      const baseContent = caption
        ? `Image sent to Telegram with caption: "${caption}". (Generated with ${modelLabel})`
        : `Image sent to Telegram. (Generated with ${modelLabel})`;
      return {
        ok: true,
        content: drivePart
          ? `${baseContent} Also saved to Google Drive: ${drivePart}`
          : `${baseContent}${driveUnavailableNote}`,
        label: drivePart
          ? `Image sent to Telegram + saved to Drive (${modelLabel})`
          : `Image sent to Telegram (${modelLabel})`,
        detail: JSON.stringify({ imageUrl, model: modelLabel, ...(drivePart ? { driveLink: drivePart } : {}) }),
      };
    }

    if (isDiscord) {
      const discordChannelId = ctx.discordChannelId;
      if (!discordChannelId) {
        return {
          ok: true,
          content: `Image generated (${modelLabel}): ${imageUrl}`,
          label: `Image generated (${modelLabel}, Discord channel ID unavailable)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const fetched = await fetchImageBuffer(imageUrl);
      if (!fetched) {
        return {
          ok: true,
          content: `Image generated (${modelLabel}) but could not download it for delivery. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, download failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const { sendDiscordImage } = await import("../../discord/manager");
      const sent = await sendDiscordImage(ctx.userId, discordChannelId, fetched.buffer, "image.png", caption);
      if (!sent) {
        return {
          ok: false,
          content: `Image generated (${modelLabel}) but failed to send to Discord. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, Discord send failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      console.log(`[image_generate] Image sent to Discord user=${ctx.userId} model=${modelLabel} size=${sizeKey}`);

      const drivePart = saveToDrive
        ? await saveImageToDrive(
            ctx.googleAccessToken!,
            fetched.buffer,
            buildImageFilename(prompt, fetched.mimeType),
            fetched.mimeType,
          )
        : null;

      const baseContent = caption
        ? `Image sent to Discord with caption: "${caption}". (Generated with ${modelLabel})`
        : `Image sent to Discord. (Generated with ${modelLabel})`;
      return {
        ok: true,
        content: drivePart
          ? `${baseContent} Also saved to Google Drive: ${drivePart}`
          : `${baseContent}${driveUnavailableNote}`,
        label: drivePart
          ? `Image sent to Discord + saved to Drive (${modelLabel})`
          : `Image sent to Discord (${modelLabel})`,
        detail: JSON.stringify({ imageUrl, model: modelLabel, ...(drivePart ? { driveLink: drivePart } : {}) }),
      };
    }

    // ── In-app delivery ────────────────────────────────────────────────────────
    console.log(`[image_generate] Generated image for in-app user=${ctx.userId} model=${modelLabel} size=${sizeKey}`);

    let drivePart: string | null = null;
    if (saveToDrive) {
      const fetched = await fetchImageBuffer(imageUrl);
      if (fetched) {
        drivePart = await saveImageToDrive(
          ctx.googleAccessToken!,
          fetched.buffer,
          buildImageFilename(prompt, fetched.mimeType),
          fetched.mimeType,
        );
      }
    }

    const baseContent = caption
      ? `Here's your generated image — "${caption}". (Generated with ${modelLabel})`
      : `Here's the generated image. (Generated with ${modelLabel})`;
    return {
      ok: true,
      content: drivePart
        ? `${baseContent} Also saved to Google Drive: ${drivePart}`
        : `${baseContent}${driveUnavailableNote}`,
      label: drivePart
        ? `Image generated + saved to Drive (${modelLabel})`
        : `Image generated (${modelLabel})`,
      detail: JSON.stringify({ imageUrl, model: modelLabel, ...(drivePart ? { driveLink: drivePart } : {}) }),
    };
  },
};
