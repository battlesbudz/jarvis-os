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
 * Generate a voice message from text and deliver it to the user's Telegram
 * as a round audio bubble. Falls back to a text note if Telegram is not linked
 * or TTS generation fails.
 */
export async function speakToUser(
  userId: string,
  text: string,
  voice: TtsVoice = "nova",
): Promise<{ ok: boolean; error?: string }> {
  const chatId = await getTelegramChatId(userId);
  if (!chatId) {
    return { ok: false, error: "User has no linked Telegram account" };
  }

  const snippedText = text.slice(0, 4000);
  const mp3 = await textToSpeech(snippedText, voice, "mp3");
  const ogg = await mp3ToOggOpus(mp3);
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
    "Convert text to a voice note and send it to the user's Telegram as a round audio bubble. Use for morning plans, coaching messages, or any content the user would benefit from hearing rather than reading. The user must have Telegram linked. Text is trimmed to 4000 chars.",
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

    try {
      const result = await speakToUser(ctx.userId, text, voice);
      if (!result.ok) {
        return {
          ok: false,
          content: `Voice delivery failed: ${result.error}`,
          label: "speak: delivery failed",
        };
      }

      console.log(
        `[${ctx.channel || "Agent"}] speak — ${text.length} chars, voice=${voice}, user=${ctx.userId}`,
      );

      return {
        ok: true,
        content: `Voice note delivered to Telegram (${text.length} chars, voice: ${voice}).`,
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
