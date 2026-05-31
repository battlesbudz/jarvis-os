import { Blob } from "node:buffer";
import { getProviderEnvValue, isDirectOpenAIDisabled } from "./agent/providers/env";
import type { AudioFormat } from "./replit_integrations/audio/client";
import { speechToText } from "./replit_integrations/audio/client";
import { isWorkerOnline, queueAudioTranscriptionJob } from "./lib/localWorkerQueue";

export type TelegramVoiceTranscriptionSource = "groq" | "local-worker" | "openai";
export type TelegramVoiceTranscriptionFailure =
  | "cloud_unavailable"
  | "local_worker_required"
  | "empty_transcript";

export interface TelegramVoiceTranscriptionResult {
  ok: boolean;
  text: string;
  source?: TelegramVoiceTranscriptionSource;
  failure?: TelegramVoiceTranscriptionFailure;
  errors: string[];
}

interface TranscriptionDeps {
  getGroqApiKey: () => string | undefined;
  transcribeWithGroq: (audioBuffer: Buffer, format: AudioFormat) => Promise<string>;
  isWorkerOnline: typeof isWorkerOnline;
  queueAudioTranscriptionJob: typeof queueAudioTranscriptionJob;
  isDirectOpenAIDisabled: typeof isDirectOpenAIDisabled;
  speechToText: typeof speechToText;
}

const DEFAULT_GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";

function safeAudioFormat(format: AudioFormat): Exclude<AudioFormat, "unknown"> {
  return format === "unknown" ? "ogg" : format;
}

function mimeForAudioFormat(format: AudioFormat): string {
  const safe = safeAudioFormat(format);
  return safe === "m4a" ? "audio/mp4" : `audio/${safe}`;
}

function getGroqTranscriptionModel(): string {
  return (
    getProviderEnvValue("GROQ_TRANSCRIPTION_MODEL", "GROQ_STT_MODEL", "AI_INTEGRATIONS_GROQ_TRANSCRIPTION_MODEL") ||
    DEFAULT_GROQ_TRANSCRIPTION_MODEL
  );
}

export async function transcribeWithGroq(audioBuffer: Buffer, format: AudioFormat): Promise<string> {
  const apiKey = getProviderEnvValue("GROQ_API_KEY", "AI_INTEGRATIONS_GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const safeFormat = safeAudioFormat(format);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: mimeForAudioFormat(safeFormat) }), `telegram-voice.${safeFormat}`);
  form.append("model", getGroqTranscriptionModel());
  form.append("response_format", "json");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq transcription failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json().catch(() => null) as { text?: unknown } | null;
  return typeof data?.text === "string" ? data.text.trim() : "";
}

function defaultDeps(): TranscriptionDeps {
  return {
    getGroqApiKey: () => getProviderEnvValue("GROQ_API_KEY", "AI_INTEGRATIONS_GROQ_API_KEY"),
    transcribeWithGroq,
    isWorkerOnline,
    queueAudioTranscriptionJob,
    isDirectOpenAIDisabled,
    speechToText,
  };
}

export async function transcribeTelegramAudio(
  input: {
    audioBuffer: Buffer;
    format: AudioFormat;
    userId?: string | null;
  },
  deps: Partial<TranscriptionDeps> = {},
): Promise<TelegramVoiceTranscriptionResult> {
  const resolved = { ...defaultDeps(), ...deps };
  const errors: string[] = [];

  if (resolved.getGroqApiKey()) {
    try {
      const text = await resolved.transcribeWithGroq(input.audioBuffer, input.format);
      if (text.trim()) return { ok: true, text: text.trim(), source: "groq", errors };
      errors.push("Groq returned an empty transcript.");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (input.userId && resolved.isWorkerOnline(input.userId, "audio-transcription")) {
    try {
      const segments = await resolved.queueAudioTranscriptionJob(
        input.userId,
        input.audioBuffer.toString("base64"),
        safeAudioFormat(input.format),
      );
      const text = segments.map((segment) => segment.text).join(" ").trim();
      if (text) return { ok: true, text, source: "local-worker", errors };
      errors.push("Local worker returned an empty transcript.");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!resolved.isDirectOpenAIDisabled()) {
    try {
      const text = await resolved.speechToText(input.audioBuffer, input.format);
      if (text.trim()) return { ok: true, text: text.trim(), source: "openai", errors };
      errors.push("OpenAI transcription returned an empty transcript.");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const failure = errors.some((error) => /empty transcript/i.test(error))
    ? "empty_transcript"
    : resolved.isDirectOpenAIDisabled()
      ? "local_worker_required"
      : "cloud_unavailable";

  return { ok: false, text: "", failure, errors };
}
