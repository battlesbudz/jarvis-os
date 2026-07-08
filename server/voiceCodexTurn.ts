import {
  isWorkerOnline as defaultIsWorkerOnline,
  queueAudioTranscriptionJob as defaultQueueAudioTranscriptionJob,
  type LocalJobSegment,
  type LocalWorkerCapability,
} from "./lib/localWorkerQueue";
import type { CoachReplyInput, CoachReplyResult } from "./channels/coachAgent";
import { isDirectOpenAIDisabled as defaultIsDirectOpenAIDisabled } from "./agent/providers/env";
import type { AudioFormat } from "./integrations/audioClient";
import { Buffer } from "node:buffer";

export type VoiceTurnAudioFormat = "wav" | "webm" | "ogg" | "mp3" | "m4a" | "mp4";
export type VoiceTurnAudioOutput = "device";

export interface CodexVoiceTurnInput {
  userId: string;
  text?: unknown;
  audioBase64?: unknown;
  mimeType?: unknown;
  sdkSessionId?: unknown;
}

export interface CodexVoiceTurnResult {
  transcript: string;
  reply: string;
  rawReply: string;
  sdkSessionId?: string;
  audioOutput: VoiceTurnAudioOutput;
}

export interface CodexVoiceTurnDeps {
  isWorkerOnline: (userId: string, capability?: LocalWorkerCapability) => boolean;
  queueAudioTranscriptionJob: (
    userId: string,
    audio: string,
    format: string,
    timeoutMs?: number,
  ) => Promise<LocalJobSegment[]>;
  isDirectOpenAIDisabled: () => boolean;
  speechToText: (audioBuffer: Buffer, format: AudioFormat) => Promise<string>;
  runCoachAgent: (input: CoachReplyInput) => Promise<CoachReplyResult>;
}

export class CodexVoiceTurnError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CodexVoiceTurnError";
  }
}

const DEFAULT_DEPS: CodexVoiceTurnDeps = {
  isWorkerOnline: defaultIsWorkerOnline,
  queueAudioTranscriptionJob: defaultQueueAudioTranscriptionJob,
  isDirectOpenAIDisabled: defaultIsDirectOpenAIDisabled,
  speechToText: async (audioBuffer, format) => {
    const { speechToText } = await import("./integrations/audioClient");
    return speechToText(audioBuffer, format);
  },
  runCoachAgent: async (input) => {
    const { runCoachAgent } = await import("./channels/coachAgent");
    return runCoachAgent(input);
  },
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizeBase64(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "").trim();
}

function mergeSegments(segments: LocalJobSegment[]): string {
  return segments
    .map((segment) => normalizeText(segment.text))
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function detectVoiceTurnAudioFormat(mimeType: unknown): VoiceTurnAudioFormat {
  const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("m4a") || mime.includes("aac")) return "m4a";
  return "wav";
}

export async function runCodexVoiceTurn(
  input: CodexVoiceTurnInput,
  deps: CodexVoiceTurnDeps = DEFAULT_DEPS,
): Promise<CodexVoiceTurnResult> {
  const userId = normalizeText(input.userId);
  if (!userId) {
    throw new CodexVoiceTurnError("MISSING_USER", "Authenticated user is required for a voice turn.", 401);
  }

  let transcript = normalizeText(input.text);
  const audioBase64 = normalizeBase64(input.audioBase64);

  if (!transcript) {
    if (!audioBase64) {
      throw new CodexVoiceTurnError("MISSING_VOICE_INPUT", "Send either text or audio for the voice turn.", 400);
    }

    const format = detectVoiceTurnAudioFormat(input.mimeType);
    if (deps.isWorkerOnline(userId, "audio-transcription")) {
      const segments = await deps.queueAudioTranscriptionJob(userId, audioBase64, format, 90_000);
      transcript = mergeSegments(segments);
    } else {
      if (deps.isDirectOpenAIDisabled()) {
        throw new CodexVoiceTurnError(
          "LOCAL_AUDIO_TRANSCRIPTION_UNAVAILABLE",
          "Local Whisper transcription is not online, and direct model transcription is disabled for Codex-only voice.",
          503,
        );
      }
      transcript = normalizeText(await deps.speechToText(Buffer.from(audioBase64, "base64"), format));
    }

    if (!transcript) {
      throw new CodexVoiceTurnError("EMPTY_TRANSCRIPT", "No speech was detected in that voice turn.", 422);
    }
  }

  const sdkSessionId = normalizeText(input.sdkSessionId) || undefined;
  const coachResult = await deps.runCoachAgent({
    userId,
    userText: transcript,
    channelName: "Voice",
    sdkSessionId,
  });

  return {
    transcript,
    reply: coachResult.reply,
    rawReply: coachResult.rawReply,
    sdkSessionId: coachResult.sdkSessionId,
    audioOutput: "device",
  };
}
