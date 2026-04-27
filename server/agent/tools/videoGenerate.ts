import { inference } from "@inferencesh/sdk";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { telegramLinks } from "@shared/schema";
import { sendVideo } from "../../integrations/telegram";
import type { AgentTool } from "../types";

const VIDEO_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes — Veo can take 4-6 min

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

async function fetchVideoBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

/**
 * Extract a video URL from various output shapes that inference.sh apps may return.
 * Handles: { video: { url } }, { video_url }, { url }, { videos: [{ url }] }
 */
function extractVideoUrl(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (typeof o.video === "object" && o.video !== null) {
    const v = o.video as Record<string, unknown>;
    if (typeof v.url === "string") return v.url;
  }
  if (typeof o.video_url === "string") return o.video_url;
  if (typeof o.url === "string") return o.url;
  if (Array.isArray(o.videos) && o.videos.length > 0) {
    const first = o.videos[0] as Record<string, unknown>;
    if (typeof first.url === "string") return first.url;
  }
  return null;
}

/**
 * Generate a short AI video using Veo 3.1 Fast (primary) or Seedance 1.5 (fallback).
 * Returns the video URL on success, throws on error.
 * @param prompt  Text description of the video to generate.
 * @param duration Optional duration hint in seconds (e.g. 5, 8). Passed to the model as-is;
 *                 not all models honour it — it is a best-effort hint.
 */
async function generateVideo(prompt: string, duration?: number): Promise<string> {
  const apiKey = process.env.INFSH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "INFSH_API_KEY is not configured. Add it as a Replit secret to enable AI video generation."
    );
  }
  const client = inference({ apiKey });

  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Video generation timed out after ${VIDEO_TIMEOUT_MS / 60_000} minutes`)),
          VIDEO_TIMEOUT_MS
        )
      ),
    ]);

  const baseInput: Record<string, unknown> = { prompt };
  if (duration != null && duration > 0) {
    baseInput.duration = duration;
  }

  let lastError: Error | null = null;

  for (const app of ["google/veo-3-1-fast", "bytedance/seedance-1-5-pro"] as const) {
    try {
      console.log(
        `[generate_video] Trying model=${app} duration=${duration ?? "default"} prompt="${prompt.slice(0, 60)}..."`
      );
      const result = await withTimeout(
        client.run({ app, input: baseInput })
      );
      const url = extractVideoUrl((result as { output?: unknown }).output);
      if (url) {
        console.log(`[generate_video] Success model=${app} url=${url.slice(0, 80)}`);
        return url;
      }
      throw new Error(`No video URL in response from ${app}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[generate_video] ${app} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("All video generation models failed");
}

export const videoGenerateTool: AgentTool = {
  name: "generate_video",
  description:
    "Generate a short AI video from a text prompt and deliver it to the user's current channel. " +
    "Uses Google Veo 3.1 (primary) with Seedance 1.5 as fallback. " +
    "On Telegram: sends the video inline as a video message. On Discord: sends as a video attachment. " +
    "In the app: returns the video URL for in-app playback. " +
    "Video generation takes 2-6 minutes — inform the user it will take a moment. " +
    "Use for animated concept visualisations, short cinematic clips, or any explicit video generation request. " +
    "Requires INFSH_API_KEY to be configured. Do NOT use for long-form video or video editing.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "A detailed description of the video to generate. Include motion, camera style, lighting, subject, and mood. " +
          "More detail produces better results. Example: 'Slow drone shot over a misty forest at sunrise, golden light filtering through trees, cinematic.'",
      },
      duration: {
        type: "number",
        description:
          "Optional duration hint in seconds (e.g. 5 or 8). Best-effort — not all models guarantee an exact length. " +
          "Omit to use the model default.",
      },
      caption: {
        type: "string",
        description: "Optional short caption to accompany the video on Telegram or Discord (max 200 chars).",
      },
    },
    required: ["prompt"],
  },

  async execute(args, ctx) {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) {
      return { ok: false, content: "No prompt provided.", label: "generate_video: no prompt" };
    }
    const duration =
      args.duration != null && Number.isFinite(Number(args.duration)) && Number(args.duration) > 0
        ? Math.round(Number(args.duration))
        : undefined;
    const caption = args.caption ? String(args.caption).slice(0, 200) : undefined;
    const detailMeta = (): Record<string, unknown> => ({
      ...(duration != null ? { duration } : {}),
      ...(caption ? { caption } : {}),
    });

    const channelRaw = (ctx.channel || "app").toLowerCase();
    const isTelegram = channelRaw === "telegram";
    const isDiscord = channelRaw.startsWith("discord");

    // ── Discord: post a "generating…" placeholder before the long wait ──────
    // Video generation takes 2-6 minutes. Send an immediate status message so
    // the user knows their request was received and work is underway.
    let discordPlaceholderId: string | null = null;
    if (isDiscord && ctx.discordChannelId) {
      try {
        const { sendDiscordMessage } = await import("../../discord/manager");
        discordPlaceholderId = await sendDiscordMessage(
          ctx.userId,
          ctx.discordChannelId,
          "🎬 Generating your video — this takes 2-6 minutes, hang tight...",
        );
      } catch {
        // Non-fatal — generation proceeds even if the placeholder fails
      }
    }

    let videoUrl: string;
    try {
      videoUrl = await generateVideo(prompt, duration);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[generate_video] Generation error:", err);
      // Edit the Discord placeholder to reflect the failure
      if (discordPlaceholderId && ctx.discordChannelId) {
        try {
          const { editDiscordMessage } = await import("../../discord/manager");
          await editDiscordMessage(
            ctx.userId,
            ctx.discordChannelId,
            discordPlaceholderId,
            "❌ Video generation failed — please try again.",
          );
        } catch {
          // ignore
        }
      }
      return {
        ok: false,
        content: `Video generation failed: ${msg}`,
        label: "generate_video: generation failed",
        detail: msg,
      };
    }

    if (isTelegram) {
      const chatId = await getTelegramChatId(ctx.userId);
      if (!chatId) {
        return {
          ok: true,
          content: `Video generated but Telegram is not linked. View it here: ${videoUrl}`,
          label: "Video generated (Telegram not linked)",
          detail: JSON.stringify({ videoUrl, ...detailMeta() }),
        };
      }

      const buf = await fetchVideoBuffer(videoUrl);
      if (!buf) {
        return {
          ok: true,
          content: `Video generated but could not download it for delivery. View it here: ${videoUrl}`,
          label: "Video generated (download failed)",
          detail: JSON.stringify({ videoUrl, ...detailMeta() }),
        };
      }

      const sent = await sendVideo(chatId, buf, caption);
      if (!sent) {
        return {
          ok: false,
          content: `Video generated but failed to send to Telegram. View it here: ${videoUrl}`,
          label: "Video generated (Telegram send failed)",
          detail: JSON.stringify({ videoUrl, ...detailMeta() }),
        };
      }

      console.log(`[generate_video] Video sent to Telegram user=${ctx.userId} duration=${duration ?? "default"}`);
      return {
        ok: true,
        content: caption
          ? `Video sent to Telegram with caption: "${caption}".`
          : "Video sent to Telegram.",
        label: "Video sent to Telegram",
        detail: JSON.stringify({ videoUrl, ...detailMeta() }),
      };
    }

    if (isDiscord) {
      const discordChannelId = ctx.discordChannelId;
      if (!discordChannelId) {
        return {
          ok: true,
          content: `Video generated: ${videoUrl}`,
          label: "Video generated (Discord channel ID unavailable)",
          detail: JSON.stringify({ videoUrl, ...detailMeta() }),
        };
      }

      const buf = await fetchVideoBuffer(videoUrl);
      if (!buf) {
        if (discordPlaceholderId) {
          const { editDiscordMessage } = await import("../../discord/manager");
          await editDiscordMessage(
            ctx.userId,
            discordChannelId,
            discordPlaceholderId,
            `❌ Video generated but could not be downloaded for delivery. [View it here](${videoUrl})`,
          ).catch(() => {});
        }
        return {
          ok: true,
          content: `Video generated but could not download it for delivery. View it here: ${videoUrl}`,
          label: "Video generated (download failed)",
          detail: JSON.stringify({ videoUrl, ...detailMeta() }),
        };
      }

      const { sendDiscordVideo, editDiscordMessage } = await import("../../discord/manager");
      const sent = await sendDiscordVideo(ctx.userId, discordChannelId, buf, "video.mp4", caption);
      if (!sent) {
        if (discordPlaceholderId) {
          await editDiscordMessage(
            ctx.userId,
            discordChannelId,
            discordPlaceholderId,
            "❌ Video generated but failed to send — please try again.",
          ).catch(() => {});
        }
        return {
          ok: false,
          content: `Video generated but failed to send to Discord. View it here: ${videoUrl}`,
          label: "Video generated (Discord send failed)",
          detail: JSON.stringify({ videoUrl, ...detailMeta() }),
        };
      }

      // Update the placeholder to confirm the video is ready
      if (discordPlaceholderId) {
        await editDiscordMessage(
          ctx.userId,
          discordChannelId,
          discordPlaceholderId,
          "✅ Your video is ready — see below!",
        ).catch(() => {});
      }

      console.log(`[generate_video] Video sent to Discord user=${ctx.userId} duration=${duration ?? "default"}`);
      return {
        ok: true,
        content: caption
          ? `Video sent to Discord with caption: "${caption}".`
          : "Video sent to Discord.",
        label: "Video sent to Discord",
        detail: JSON.stringify({ videoUrl, ...detailMeta() }),
      };
    }

    console.log(`[generate_video] Generated video for in-app user=${ctx.userId} duration=${duration ?? "default"}`);
    return {
      ok: true,
      content: caption
        ? `Here's your generated video — "${caption}".`
        : "Here's the generated video.",
      label: "Video generated",
      detail: JSON.stringify({ videoUrl, ...detailMeta() }),
    };
  },
};
