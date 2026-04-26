import OpenAI from "openai";
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
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

export const imageGenerateTool: AgentTool = {
  name: "image_generate",
  description:
    "Generate an image from a text prompt using DALL-E 3 and deliver it to the user's current channel. " +
    "On Telegram: sends the image inline as a photo bubble. On Discord: sends as an embedded image attachment. " +
    "In the app: displays the image inline in the chat bubble. " +
    "Use for concept illustrations, motivational visuals, meal plan photos, mind maps, or any explicit image request. " +
    "Do NOT call this for text-only answers — only when the user explicitly asks for an image or a visual would meaningfully enhance the response.",
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
    const size: DallE3Size = SIZE_MAP[sizeKey] ?? "1024x1024";
    const caption = args.caption ? String(args.caption).slice(0, 200) : undefined;

    let imageUrl: string;
    try {
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        response_format: "url",
      });
      const url = response.data[0]?.url;
      if (!url) throw new Error("No image URL returned from DALL-E 3");
      imageUrl = url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[image_generate] DALL-E 3 generation error:", err);
      return {
        ok: false,
        content: `Image generation failed: ${msg}. I'll describe it in text instead.`,
        label: "image_generate: generation failed",
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
          content: `Image generated but Telegram is not linked. View it here: ${imageUrl}`,
          label: "Image generated (Telegram not linked)",
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const buf = await fetchImageBuffer(imageUrl);
      if (!buf) {
        return {
          ok: true,
          content: `Image generated but could not download it for delivery. View it here: ${imageUrl}`,
          label: "Image generated (download failed)",
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const sent = await sendPhoto(chatId, buf, caption);
      if (!sent) {
        return {
          ok: false,
          content: `Image generated but failed to send to Telegram. View it here: ${imageUrl}`,
          label: "Image generated (Telegram send failed)",
          detail: JSON.stringify({ imageUrl }),
        };
      }

      console.log(`[image_generate] Photo sent to Telegram user=${ctx.userId} size=${size}`);
      return {
        ok: true,
        content: caption
          ? `Image sent to Telegram with caption: "${caption}".`
          : "Image sent to Telegram.",
        label: "Image sent to Telegram",
        detail: JSON.stringify({ imageUrl }),
      };
    }

    if (isDiscord) {
      const discordChannelId = ctx.discordChannelId;
      if (!discordChannelId) {
        return {
          ok: true,
          content: `Image generated: ${imageUrl}`,
          label: "Image generated (Discord channel ID unavailable)",
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const buf = await fetchImageBuffer(imageUrl);
      if (!buf) {
        return {
          ok: true,
          content: `Image generated but could not download it for delivery. View it here: ${imageUrl}`,
          label: "Image generated (download failed)",
          detail: JSON.stringify({ imageUrl }),
        };
      }

      const { sendDiscordImage } = await import("../../discord/manager");
      const sent = await sendDiscordImage(ctx.userId, discordChannelId, buf, "image.png", caption);
      if (!sent) {
        return {
          ok: false,
          content: `Image generated but failed to send to Discord. View it here: ${imageUrl}`,
          label: "Image generated (Discord send failed)",
          detail: JSON.stringify({ imageUrl }),
        };
      }

      console.log(`[image_generate] Image sent to Discord user=${ctx.userId} size=${size}`);
      return {
        ok: true,
        content: caption
          ? `Image sent to Discord with caption: "${caption}".`
          : "Image sent to Discord.",
        label: "Image sent to Discord",
        detail: JSON.stringify({ imageUrl }),
      };
    }

    console.log(`[image_generate] Generated image for in-app user=${ctx.userId} size=${size}`);
    return {
      ok: true,
      content: caption
        ? `Here's your generated image — "${caption}".`
        : "Here's the generated image.",
      label: "Image generated",
      detail: JSON.stringify({ imageUrl }),
    };
  },
};
