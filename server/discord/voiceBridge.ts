/**
 * Discord Voice Bridge — Jarvis joins voice channels, listens, and speaks back.
 *
 * Architecture per guild session:
 *   Discord voice channel
 *     ↑↓  @discordjs/voice (receive/send Opus audio)
 *   VoiceReceiver → prism.opus.Decoder → PCM → WAV → Whisper STT → transcript
 *   transcript → runCoachAgent → text reply
 *   text reply → ElevenLabs TTS (fallback: OpenAI TTS) → MP3 buffer → AudioPlayer
 *
 * One VoiceSession per guild.  Sessions are in-memory; they are cleaned up on
 * disconnect or on server restart.
 */

import { VoiceConnectionStatus, AudioPlayerStatus, EndBehaviorType, StreamType, joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, getVoiceConnection } from "@discordjs/voice";
import type { VoiceConnection, AudioPlayer, AudioResource } from "@discordjs/voice";
import { Readable } from "stream";
import { Client, ChannelType, type TextChannel } from "discord.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VoiceSession {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  userId: string;
  /** Discord snowflake of the integration owner — only their audio is processed. */
  ownerDiscordUserId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  /** Serialises utterance processing so concurrent speakers don't race. */
  processingQueue: Promise<void>;
}

// ── State ────────────────────────────────────────────────────────────────────

const activeSessions = new Map<string, VoiceSession>();

// ── Public API ───────────────────────────────────────────────────────────────

/** Returns a snapshot of all active guild → session mappings. */
export function getActiveSessions(): Map<string, VoiceSession> {
  return activeSessions;
}

export function getVoiceSessionStatus(guildId: string): {
  active: boolean;
  voiceChannelId?: string;
  userId?: string;
} {
  const s = activeSessions.get(guildId);
  if (!s) return { active: false };
  return { active: true, voiceChannelId: s.voiceChannelId, userId: s.userId };
}

/**
 * Join a Discord voice channel and start a new VoiceSession.
 * Callers must pass the discord.js Client that is already logged in for the guild.
 */
export async function joinVoiceSession(
  client: Client,
  guildId: string,
  voiceChannelId: string,
  textChannelId: string,
  userId: string,
  ownerDiscordUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (activeSessions.has(guildId)) {
    return { ok: false, error: "Jarvis is already in a voice session in this server. Use `/voice leave` first." };
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { ok: false, error: "Guild not found in client cache." };

  const channel = guild.channels.cache.get(voiceChannelId);
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
    return { ok: false, error: "That channel is not a voice channel." };
  }

  const player = createAudioPlayer();

  let connection: VoiceConnection;
  try {
    connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
  } catch (err) {
    console.error("[VoiceBridge] joinVoiceChannel error:", err);
    return { ok: false, error: "Failed to join voice channel. Make sure the bot has Connect and Speak permissions." };
  }

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    return { ok: false, error: "Timed out connecting to the voice channel." };
  }

  connection.subscribe(player);

  const session: VoiceSession = {
    guildId,
    voiceChannelId,
    textChannelId,
    userId,
    ownerDiscordUserId,
    connection,
    player,
    processingQueue: Promise.resolve(),
  };
  activeSessions.set(guildId, session);

  attachReceiverHandlers(session, client);
  attachConnectionHandlers(session, client);

  console.log(`[VoiceBridge] Session started — guild=${guildId} voice=${voiceChannelId}`);
  return { ok: true };
}

/**
 * Leave the voice session for a guild and clean up all resources.
 */
export function leaveVoiceSession(guildId: string): boolean {
  const session = activeSessions.get(guildId);
  if (!session) return false;
  destroySession(session);
  return true;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function destroySession(session: VoiceSession): void {
  activeSessions.delete(session.guildId);
  try { session.player.stop(true); } catch { }
  const conn = getVoiceConnection(session.guildId);
  if (conn && conn.state.status !== VoiceConnectionStatus.Destroyed) {
    try { conn.destroy(); } catch { }
  }
  console.log(`[VoiceBridge] Session ended — guild=${session.guildId}`);
}

function attachConnectionHandlers(session: VoiceSession, client: Client): void {
  const { connection, guildId } = session;

  let reconnectAttempted = false;

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (!activeSessions.has(guildId)) return;

    if (!reconnectAttempted) {
      reconnectAttempted = true;
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        reconnectAttempted = false;
        return;
      } catch {
        // Reconnect failed
      }
    }

    console.warn(`[VoiceBridge] Connection lost for guild=${guildId} — cleaning up.`);
    const currentSession = activeSessions.get(guildId);
    if (currentSession) {
      destroySession(currentSession);
      sendToTextChannel(client, currentSession.textChannelId,
        "⚠️ Jarvis was disconnected from the voice channel. Use `/voice join` to reconnect.").catch(() => {});
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    activeSessions.delete(guildId);
  });
}

function attachReceiverHandlers(session: VoiceSession, client: Client): void {
  const receiver = session.connection.receiver;

  receiver.speaking.on("start", (discordUserId: string) => {
    const s = activeSessions.get(session.guildId);
    if (!s) return;

    // Only process audio from the integration owner — ignore all other channel members
    // to prevent privilege escalation (running coachAgent under the owner's identity).
    if (discordUserId !== s.ownerDiscordUserId) {
      console.log(`[VoiceBridge] Ignoring audio from non-owner speaker ${discordUserId} in guild ${s.guildId}`);
      return;
    }

    // Interrupt: stop current playback if Jarvis is speaking
    if (s.player.state.status === AudioPlayerStatus.Playing) {
      s.player.stop(true);
      console.log(`[VoiceBridge] Interrupt from user ${discordUserId} — stopped playback`);
    }

    const opusStream = receiver.subscribe(discordUserId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 },
    });

    const opusChunks: Buffer[] = [];
    opusStream.on("data", (chunk: Buffer) => opusChunks.push(chunk));
    opusStream.on("end", () => {
      const currentSession = activeSessions.get(session.guildId);
      if (!currentSession || opusChunks.length === 0) return;

      currentSession.processingQueue = currentSession.processingQueue.then(async () => {
        const refreshed = activeSessions.get(session.guildId);
        if (!refreshed) return;
        await processVoiceUtterance(refreshed, opusChunks, client).catch((err) => {
          console.error("[VoiceBridge] processVoiceUtterance error:", err);
        });
      });
    });
    opusStream.on("error", (err) => {
      console.error("[VoiceBridge] opus stream error:", err);
    });
  });
}

async function processVoiceUtterance(
  session: VoiceSession,
  opusChunks: Buffer[],
  client: Client,
): Promise<void> {
  const { guildId, textChannelId, userId } = session;

  let transcript: string;
  try {
    const wavBuffer = await opusChunksToWav(opusChunks);
    const { speechToText } = await import("../replit_integrations/audio/client");
    transcript = (await speechToText(wavBuffer, "wav")).trim();
    console.log(`[VoiceBridge] STT result for guild=${guildId}: "${transcript.slice(0, 80)}"`);
  } catch (sttErr) {
    console.error("[VoiceBridge] STT error:", sttErr);
    await sendToTextChannel(client, textChannelId, "⚠️ Couldn't transcribe that — please try again.");
    return;
  }

  if (!transcript) return;

  await sendToTextChannel(client, textChannelId, `🎤 *"${transcript}"*`);

  let replyText: string;
  try {
    const { runCoachAgent } = await import("../channels/coachAgent");
    const result = await runCoachAgent({
      userId,
      userText: transcript,
      channelName: "Discord Voice",
    });
    replyText = result.reply?.trim() || "I didn't have a response for that.";
  } catch (agentErr) {
    console.error("[VoiceBridge] coachAgent error:", agentErr);
    replyText = "Sorry, I ran into an issue processing that.";
  }

  await sendToTextChannel(client, textChannelId, replyText);

  const refreshed = activeSessions.get(guildId);
  if (!refreshed) return;

  let audioBuffer: Buffer | null = null;
  try {
    audioBuffer = await generateTtsAudio(userId, replyText);
  } catch (ttsErr) {
    console.error("[VoiceBridge] TTS error (non-fatal — text was already sent):", ttsErr);
  }

  if (audioBuffer && activeSessions.has(guildId)) {
    await playAudioBuffer(refreshed, audioBuffer);
  }
}

async function playAudioBuffer(session: VoiceSession, mp3Buffer: Buffer): Promise<void> {
  const { player } = session;

  const readable = Readable.from([mp3Buffer]);
  const resource: AudioResource = createAudioResource(readable, {
    inputType: StreamType.Arbitrary,
  });

  player.play(resource);

  try {
    await entersState(player, AudioPlayerStatus.Idle, 60_000);
  } catch {
    player.stop(true);
  }
}

async function generateTtsAudio(userId: string, text: string): Promise<Buffer> {
  const trimmed = text.slice(0, 4000);

  const OPENAI_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);
  const { getUserTtsPrefs } = await import("../agent/tools/tts");
  const prefs = await getUserTtsPrefs(userId);
  const voice = (prefs.voice as string) || "nova";
  const isOpenAiVoice = OPENAI_VOICES.has(voice);

  if (!isOpenAiVoice && process.env.ELEVENLABS_API_KEY) {
    try {
      const { elevenlabsTts } = await import("../replit_integrations/audio/client");
      return await elevenlabsTts(trimmed, voice);
    } catch (err) {
      console.warn("[VoiceBridge] ElevenLabs TTS failed, falling back to OpenAI:", err instanceof Error ? err.message : err);
    }
  }

  const { textToSpeech } = await import("../replit_integrations/audio/client");
  const openaiVoice = isOpenAiVoice ? (voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer") : "nova";
  return await textToSpeech(trimmed, openaiVoice, "mp3");
}

/**
 * Minimal typing for prism-media's Opus decoder.
 * prism-media ships no bundled type declarations, so we declare only what we use.
 */
interface PrismLike {
  opus: {
    Decoder: new (options: { rate: number; channels: number; frameSize: number }) => NodeJS.ReadWriteStream;
  };
}

/**
 * Decode raw Opus RTP frames to a WAV buffer (s16le, 48 kHz, stereo).
 * Uses prism-media's Opus decoder to get raw PCM, then prepends a WAV header.
 */
async function opusChunksToWav(opusChunks: Buffer[]): Promise<Buffer> {
  const prism = (await import("prism-media")) as unknown as PrismLike;
  const SAMPLE_RATE = 48000;
  const CHANNELS = 2;
  const FRAME_SIZE = 960;

  return new Promise<Buffer>((resolve, reject) => {
    const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: FRAME_SIZE });
    const pcmChunks: Buffer[] = [];

    decoder.on("data", (chunk: Buffer) => pcmChunks.push(chunk));
    decoder.on("end", () => {
      const pcm = Buffer.concat(pcmChunks);
      resolve(buildWavBuffer(pcm, SAMPLE_RATE, CHANNELS));
    });
    decoder.on("error", reject);

    for (const chunk of opusChunks) {
      decoder.write(chunk);
    }
    decoder.end();
  });
}

function buildWavBuffer(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitDepth = 16;
  const byteRate = sampleRate * channels * bitDepth / 8;
  const blockAlign = channels * bitDepth / 8;
  const dataLen = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(dataLen + 36, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcm]);
}

async function sendToTextChannel(client: Client, channelId: string, text: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const chunks = splitChunks(text, 1900);
      for (const chunk of chunks) {
        await (channel as TextChannel).send(chunk);
      }
    }
  } catch (err) {
    console.warn("[VoiceBridge] sendToTextChannel failed:", err instanceof Error ? err.message : err);
  }
}

function splitChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}
