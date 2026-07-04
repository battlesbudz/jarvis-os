import { spawn } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { telegramLinks, channelLinks } from "@shared/schema";
import { sendVoice } from "../../integrations/telegram";
import { textToSpeech, elevenlabsTts } from "../../integrations/audioClient";
import type { AgentTool } from "../types";

/**
 * In-memory store for short-lived audio files served to WhatsApp via Twilio.
 * Twilio requires a publicly accessible URL for media messages; we generate a
 * one-time token, store the MP3 buffer here for 5 minutes, and expose it via
 * GET /api/tts/temp/:token. The buffer is evicted after first read or on TTL.
 */
interface TempAudioEntry {
  buffer: Buffer;
  mimeType: string;
  expiresAt: number;
}
const tempAudioStore = new Map<string, TempAudioEntry>();

/** Store an audio buffer and return a one-time serving token. */
export function storeTempAudio(buffer: Buffer, mimeType = "audio/mpeg"): string {
  const token = randomUUID();
  tempAudioStore.set(token, { buffer, mimeType, expiresAt: Date.now() + 5 * 60_000 });
  // Passive expiry sweep — remove tokens older than 5 minutes
  for (const [k, v] of tempAudioStore) {
    if (Date.now() > v.expiresAt) tempAudioStore.delete(k);
  }
  return token;
}

/** Retrieve and consume a stored audio buffer (one-time read). Returns null if expired/unknown. */
export function consumeTempAudio(token: string): TempAudioEntry | null {
  const entry = tempAudioStore.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    tempAudioStore.delete(token);
    return null;
  }
  tempAudioStore.delete(token); // one-time read
  return entry;
}

export type TtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | string;

/** OpenAI voice IDs — anything else is treated as an ElevenLabs voice ID. */
const OPENAI_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

/**
 * ElevenLabs premade voices available to all users.
 * Key = user-facing name, value = ElevenLabs voice_id.
 */
export const ELEVENLABS_VOICES: Record<string, string> = {
  "Sarah": "EXAVITQu4vr4xnSDxMaL",
  "Laura": "FGY2WhTYpPnrIDTdsKH5",
  "Charlie": "IKne3meq5aSn9XLyUdCD",
  "George": "JBFqnCBsd6RMkjVDRZzb",
  "Callum": "N2lVS1w4EtoT3dr4eOWO",
  "River": "SAz9YHcvj6GT2YYXdXww",
  "Alice": "Xb7hH8MSUJpSbSDYk0k2",
  "Matilda": "XrExE9yKIg1WjnnlVkGX",
  "Jessica": "cgSgspJ2msm6clMCkdW9",
  "Eric": "cjVigY5qzO86Huf0OWal",
  "Brian": "nPczCjzI2devNBz1zQrb",
  "Daniel": "onwK4e9ZLuTAKqWW03F9",
  "Adam": "pNInz6obpgDQGcFmaJgB",
};

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

/** Read the user's TTS preference (voice name, enabled flag, latency tier). */
export async function getUserTtsPrefs(userId: string): Promise<{ enabled: boolean; voice: TtsVoice; latencyTier: 0 | 1 | 2 | 3 | 4 }> {
  try {
    const rows = await db
      .select({ data: schema.userPreferences.data })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    const data = (rows[0]?.data as Record<string, unknown>) || {};
    const rawTier = data.ttsLatencyTier;
    const latencyTier: 0 | 1 | 2 | 3 | 4 =
      (typeof rawTier === "number" && [0, 1, 2, 3, 4].includes(rawTier))
        ? rawTier as 0 | 1 | 2 | 3 | 4
        : 2;
    return {
      enabled: data.ttsEnabled === true,
      voice: (data.ttsVoice as TtsVoice) || "nova",
      latencyTier,
    };
  } catch {
    return { enabled: false, voice: "nova", latencyTier: 2 };
  }
}

/** Persist TTS preference update for a user. */
export async function setUserTtsPref(
  userId: string,
  patch: Partial<{ enabled: boolean; voice: TtsVoice; latencyTier: 0 | 1 | 2 | 3 | 4 }>,
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
  if (patch.latencyTier !== undefined) updated.ttsLatencyTier = patch.latencyTier;
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
  /** Public base URL of this server — required for WhatsApp media delivery via Twilio. */
  serverBaseUrl?: string;
}

export type SpeakResult = { ok: boolean; error?: string; messageId?: number };

/** Look up the WhatsApp address for a user (needed to send Twilio media messages). */
async function getWhatsAppAddress(userId: string): Promise<string | null> {
  try {
    const rows = await db.select({ address: channelLinks.address })
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "whatsapp")))
      .limit(1);
    return rows[0]?.address ?? null;
  } catch {
    return null;
  }
}

/** Send an MP3 audio buffer to a WhatsApp number via Twilio media message. */
async function sendWhatsAppAudio(
  toAddress: string,
  mp3Buffer: Buffer,
  serverBaseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return { ok: false, error: "Twilio not configured" };
  }

  // Store MP3 temporarily and build a public URL for Twilio to fetch
  const token = storeTempAudio(mp3Buffer, "audio/mpeg");
  const mediaUrl = `${serverBaseUrl.replace(/\/$/, "")}/api/tts/temp/${token}`;

  const to = toAddress.startsWith("whatsapp:") ? toAddress : `whatsapp:${toAddress}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const params = new URLSearchParams({
    From: TWILIO_FROM,
    To: to,
    MediaUrl: mediaUrl,
    Body: "",
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json() as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      return { ok: false, error: `Twilio error: ${data.message || res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Generate a voice message from text and deliver it to the appropriate channel.
 * - "telegram"  → Telegram sendVoice (round audio bubble)
 * - "whatsapp"  → Twilio WhatsApp media message (MP3, requires public server URL)
 * - "discord"   → OGG file attachment in the Discord channel (requires discordChannelId)
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
): Promise<SpeakResult> {
  const channelRaw = (options?.channel || "telegram").toLowerCase();
  const isDiscord = channelRaw.startsWith("discord");
  const isWhatsApp = channelRaw === "whatsapp";

  const snippedText = text.slice(0, 4000);
  const isElevenLabsVoice = !OPENAI_VOICES.has(voice);
  if (isElevenLabsVoice && !process.env.ELEVENLABS_API_KEY) {
    return { ok: false, error: "ElevenLabs voice selected but ELEVENLABS_API_KEY is not configured" };
  }
  const mp3 = isElevenLabsVoice
    ? await elevenlabsTts(snippedText, voice)
    : await textToSpeech(snippedText, voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer", "mp3");

  if (isWhatsApp) {
    const address = await getWhatsAppAddress(userId);
    if (!address) {
      return { ok: false, error: "User has no linked WhatsApp account" };
    }
    const serverBaseUrl = options?.serverBaseUrl || process.env.SERVER_BASE_URL || "";
    if (!serverBaseUrl) {
      return { ok: false, error: "WhatsApp TTS requires SERVER_BASE_URL to be configured" };
    }
    return sendWhatsAppAudio(address, mp3, serverBaseUrl);
  }

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

  if (channelRaw !== "telegram") {
    return { ok: false, error: `TTS delivery not supported for channel: ${channelRaw}` };
  }

  // Telegram
  const chatId = await getTelegramChatId(userId);
  if (!chatId) {
    return { ok: false, error: "User has no linked Telegram account" };
  }
  const sent = await sendVoice(chatId, ogg);
  if (!sent.ok) {
    return { ok: false, error: sent.error ?? "Failed to deliver voice note via Telegram" };
  }
  return { ok: true, messageId: sent.messageId };
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
