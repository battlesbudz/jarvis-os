import OpenAI from "openai";
import { inference } from "@inferencesh/sdk";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { telegramLinks } from "@shared/schema";
import { sendPhoto } from "../../integrations/telegram";
import type { AgentTool } from "../types";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

type DallE3Size = "1024x1024" | "1792x1024" | "1024x1792";

const SIZE_MAP: Record<string, DallE3Size> = {
  square: "1024x1024",
  landscape: "1792x1024",
  portrait: "1024x1792",
};

/** FLUX image_size values understood by falai/flux-dev-lora */
const FLUX_SIZE_MAP: Record<string, string> = {
  square: "square_hd",
  landscape: "landscape_16_9",
  portrait: "portrait_16_9",
};

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

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

/** Generate an image via DALL-E 3 and return its URL. */
async function generateDallE(prompt: string, size: DallE3Size): Promise<string> {
  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size,
    response_format: "url",
  });
  const url = response.data[0]?.url;
  if (!url) throw new Error("No image URL returned from DALL-E 3");
  return url;
}

/** Generate an image via FLUX (falai/flux-dev-lora) and return its URL. */
async function generateFlux(prompt: string, imageSize: string): Promise<string> {
  const apiKey = process.env.INFSH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "INFSH_API_KEY is not configured. Add it as a Replit secret to enable FLUX image generation."
    );
  }
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

export const imageGenerateTool: AgentTool = {
  name: "image_generate",
  description:
    "Generate an image from a text prompt and deliver it to the user's current channel. " +
    "Supports two models: DALL-E 3 (default — fast, reliable, great for illustrations and concepts) and " +
    "FLUX (high-quality, photorealistic and artistic outputs — requires INFSH_API_KEY). " +
    "On Telegram: sends the image inline as a photo bubble. On Discord: sends as an embedded image attachment. " +
    "In the app: displays the image inline in the chat bubble. " +
    "Use for concept illustrations, motivational visuals, meal plan photos, or any explicit image request. " +
    "Default model is dalle unless the user specifically asks for FLUX or higher quality/photorealistic output.",
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
          "Image model to use. 'dalle' (default) = DALL-E 3 — fast and reliable. 'flux' = FLUX Dev — higher quality, more photorealistic and artistic, slower. Use flux when the user asks for photorealistic or high-quality images.",
      },
      caption: {
        type: "string",
        description: "Optional short caption to accompany the image on Telegram or Discord (max 200 chars).",
      },
    },
    required: ["prompt"],
  },

  async execute(args, ctx) {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) {
      return { ok: false, content: "No prompt provided.", label: "image_generate: no prompt" };
    }

    const sizeKey = String(args.size || "square").toLowerCase();
    const modelKey = String(args.model || "dalle").toLowerCase();
    const useFlux = modelKey === "flux";
    const caption = args.caption ? String(args.caption).slice(0, 200) : undefined;
    const modelLabel = useFlux ? "FLUX" : "DALL-E 3";

    let imageUrl: string;
    try {
      if (useFlux) {
        const fluxSize = FLUX_SIZE_MAP[sizeKey] ?? "square_hd";
        imageUrl = await generateFlux(prompt, fluxSize);
      } else {
        const size: DallE3Size = SIZE_MAP[sizeKey] ?? "1024x1024";
        imageUrl = await generateDallE(prompt, size);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[image_generate] ${modelLabel} generation error:`, err);
      return {
        ok: false,
        content: `Image generation failed (${modelLabel}): ${msg}. I'll describe it in text instead.`,
        label: `image_generate: generation failed (${modelLabel})`,
        detail: msg,
      };
    }

    const channelRaw = (ctx.channel || "app").toLowerCase();
    const isTelegram = channelRaw === "telegram";
    const isDiscord = channelRaw.startsWith("discord");

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

      const buf = await fetchImageBuffer(imageUrl);
      if (!buf) {
        return {
          ok: true,
          content: `Image generated (${modelLabel}) but could not download it for delivery. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, download failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const sent = await sendPhoto(chatId, buf, caption);
      if (!sent) {
        return {
          ok: false,
          content: `Image generated (${modelLabel}) but failed to send to Telegram. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, Telegram send failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      console.log(`[image_generate] Photo sent to Telegram user=${ctx.userId} model=${modelLabel} size=${sizeKey}`);
      return {
        ok: true,
        content: caption
          ? `Image sent to Telegram with caption: "${caption}". (Generated with ${modelLabel})`
          : `Image sent to Telegram. (Generated with ${modelLabel})`,
        label: `Image sent to Telegram (${modelLabel})`,
        detail: JSON.stringify({ imageUrl, model: modelLabel }),
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

      const buf = await fetchImageBuffer(imageUrl);
      if (!buf) {
        return {
          ok: true,
          content: `Image generated (${modelLabel}) but could not download it for delivery. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, download failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const { sendDiscordImage } = await import("../../discord/manager");
      const sent = await sendDiscordImage(ctx.userId, discordChannelId, buf, "image.png", caption);
      if (!sent) {
        return {
          ok: false,
          content: `Image generated (${modelLabel}) but failed to send to Discord. View it here: ${imageUrl}`,
          label: `Image generated (${modelLabel}, Discord send failed)`,
          detail: JSON.stringify({ imageUrl }),
        };
      }

      console.log(`[image_generate] Image sent to Discord user=${ctx.userId} model=${modelLabel} size=${sizeKey}`);
      return {
        ok: true,
        content: caption
          ? `Image sent to Discord with caption: "${caption}". (Generated with ${modelLabel})`
          : `Image sent to Discord. (Generated with ${modelLabel})`,
        label: `Image sent to Discord (${modelLabel})`,
        detail: JSON.stringify({ imageUrl, model: modelLabel }),
      };
    }

    console.log(`[image_generate] Generated image for in-app user=${ctx.userId} model=${modelLabel} size=${sizeKey}`);
    return {
      ok: true,
      content: caption
        ? `Here's your generated image — "${caption}". (Generated with ${modelLabel})`
        : `Here's the generated image. (Generated with ${modelLabel})`,
      label: `Image generated (${modelLabel})`,
      detail: JSON.stringify({ imageUrl, model: modelLabel }),
    };
  },
};
