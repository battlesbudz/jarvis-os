import { spawn } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { telegramLinks } from "@shared/schema";
import { sendVoice } from "../../integrations/telegram";
import { textToSpeech } from "../../replit_integrations/audio/client";
import type { AgentTool } from "../types";

export type TtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

/** Convert MP3 buffer → OGG-Opus buffer (required for Telegram voice bubbles). */
async function mp3ToOggOpus(mp3Buffer: Buffer): Promise<Buffer> {
  const inputPath = join(tmpdir(), `tts-in-${randomUUID()}.mp3`);
  const outputPath = join(tmpdir(), `tts-out-${randomUUID()}.ogg`);
  try {
    await writeFile(inputPath, mp3Buffer);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-i", inputPath,
        "-c:a", "libopus",
        "-b:a", "64k",
        "-vbr", "on",
        "-application", "voip",
        "-y",
        outputPath,
      ]);
      ff.stderr.on("data", () => {});
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      ff.on("error", reject);
    });
    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/** Look up the Telegram chatId for a user (needed to send voice notes). */
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

/** Read the user's TTS preference (voice name, enabled flag). */
export async function getUserTtsPrefs(userId: string): Promise<{ enabled: boolean; voice: TtsVoice }> {
  try {
    const rows = await db
      .select({ data: schema.userPreferences.data })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    const data = (rows[0]?.data as Record<string, unknown>) || {};
    return {
      enabled: data.ttsEnabled === true,
      voice: (data.ttsVoice as TtsVoice) || "nova",
    };
  } catch {
    return { enabled: false, voice: "nova" };
  }
}

/** Persist TTS preference update for a user. */
export async function setUserTtsPref(
  userId: string,
  patch: Partial<{ enabled: boolean; voice: TtsVoice }>,
): Promise<void> {
  const existing = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const current = (existing[0]?.data as Record<string, unknown>) || {};
  const updated: Record<string, unknown> = { ...current };
  if (patch.enabled !== undefined) updated.ttsEnabled = patch.enabled;
  if (patch.voice !== undefined) updated.ttsVoice = patch.voice;
  await db
    .insert(schema.userPreferences)
    .values({ userId, data: updated })
    .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { data: updated } });
}

/**
 * Get the list of channels for which the user has enabled TTS voice delivery.
 * Possible values: "telegram", "discord".
 * Backward-compat: if ttsChannels is absent but legacy ttsEnabled=true, returns ["telegram"].
 */
export async function getUserTtsChannels(userId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ data: schema.userPreferences.data })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    const data = (rows[0]?.data as Record<string, unknown>) || {};
    if (Array.isArray(data.ttsChannels)) return data.ttsChannels as string[];
    if (data.ttsEnabled === true) return ["telegram"];
    return [];
  } catch {
    return [];
  }
}

/** Persist the ttsChannels array for a user. */
export async function setTtsChannels(userId: string, channels: string[]): Promise<void> {
  const existing = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const current = (existing[0]?.data as Record<string, unknown>) || {};
  const updated: Record<string, unknown> = { ...current, ttsChannels: channels };
  await db
    .insert(schema.userPreferences)
    .values({ userId, data: updated })
    .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { data: updated } });
}

export interface SpeakOptions {
  channel?: string;
  discordChannelId?: string;
}

/**
 * Generate a voice message from text and deliver it to the appropriate channel.
 * - "telegram" → Telegram sendVoice (round audio bubble)
 * - "discord" (requires discordChannelId) → OGG file attachment in the Discord channel
 * - anything else → returns error (graceful fallback, no crash)
 *
 * Uses dynamic import for the Discord manager to avoid a circular dependency chain:
 *   tts.ts → manager.ts → coachAgent.ts → tools/index.ts → tts.ts
 */
export async function speakToUser(
  userId: string,
  text: string,
  voice: TtsVoice = "nova",
  options?: SpeakOptions,
): Promise<{ ok: boolean; error?: string }> {
  const channelRaw = (options?.channel || "telegram").toLowerCase();
  const isDiscord = channelRaw.startsWith("discord");

  const snippedText = text.slice(0, 4000);
  const mp3 = await textToSpeech(snippedText, voice, "mp3");
  const ogg = await mp3ToOggOpus(mp3);

  if (isDiscord) {
    const { discordChannelId } = options || {};
    if (!discordChannelId) {
      return { ok: false, error: "Discord channel ID not available for audio delivery" };
    }
    const { sendDiscordAudio } = await import("../../discord/manager");
    const sent = await sendDiscordAudio(userId, discordChannelId, ogg);
    if (!sent) {
      return { ok: false, error: "Failed to deliver voice note via Discord" };
    }
    return { ok: true };
  }

  // Default: Telegram
  const chatId = await getTelegramChatId(userId);
  if (!chatId) {
    return { ok: false, error: "User has no linked Telegram account" };
  }
  const sent = await sendVoice(chatId, ogg);
  if (!sent) {
    return { ok: false, error: "Failed to deliver voice note via Telegram" };
  }
  return { ok: true };
}

const VALID_VOICES: TtsVoice[] = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

export const speakTool: AgentTool = {
  name: "speak",
  description:
    "Convert text to a voice note and deliver it to the user's current channel as audio. " +
    "On Telegram: sends a round audio bubble. On Discord: posts an OGG file attachment that plays inline. " +
    "Other channels fall back gracefully to text. Delivery depends on the user having TTS enabled for the current channel " +
    "(Profile → Discord settings for Discord; /tts on in Telegram). " +
    "Use for morning plans, coaching messages, or content the user would benefit from hearing. Text is trimmed to 4000 chars.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to speak aloud — will be converted to audio verbatim",
      },
      voice: {
        type: "string",
        description:
          "Voice style: alloy (neutral), echo (male), fable (expressive), onyx (deep), nova (warm female, default), shimmer (gentle female)",
      },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    const text = String(args.text || "").trim();
    if (!text) {
      return { ok: false, content: "No text provided.", label: "speak: no text" };
    }

    const rawVoice = String(args.voice || "nova").toLowerCase().trim() as TtsVoice;
    const voice: TtsVoice = VALID_VOICES.includes(rawVoice) ? rawVoice : "nova";

    const channelRaw = (ctx.channel || "telegram").toLowerCase();
    const channelKey = channelRaw.startsWith("discord") ? "discord" : channelRaw;

    try {
      const enabledChannels = await getUserTtsChannels(ctx.userId);
      if (!enabledChannels.includes(channelKey)) {
        const hint = channelKey === "discord"
          ? "Enable voice replies for Discord in Profile → Discord settings."
          : "Enable voice mode with /tts on in Telegram.";
        return {
          ok: false,
          content: `Voice delivery not enabled for ${channelKey}. ${hint}`,
          label: `speak: TTS disabled for ${channelKey}`,
        };
      }

      const result = await speakToUser(ctx.userId, text, voice, {
        channel: ctx.channel,
        discordChannelId: ctx.discordChannelId,
      });

      if (!result.ok) {
        return {
          ok: false,
          content: `Voice delivery failed: ${result.error}`,
          label: "speak: delivery failed",
        };
      }

      console.log(
        `[${ctx.channel || "Agent"}] speak — ${text.length} chars, voice=${voice}, channel=${channelKey}, user=${ctx.userId}`,
      );

      return {
        ok: true,
        content: `Voice note delivered to ${channelKey === "discord" ? "Discord" : "Telegram"} (${text.length} chars, voice: ${voice}).`,
        label: `Voice note sent (${voice})`,
        detail: `${text.slice(0, 60)}…`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[speak tool] error:", err);
      return { ok: false, content: `speak failed: ${msg}`, label: "speak: error", detail: msg };
    }
  },
};
