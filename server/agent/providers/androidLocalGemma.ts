import type OpenAI from "openai";
import { ANDROID_LOCAL_GEMMA_MODEL } from "@shared/modelProviderCatalog";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";

type DaemonOpResult = { ok: boolean; data?: unknown; error?: string };

type AndroidLocalGemmaDaemonOp = (
  userId: string,
  op: {
    type: "android_local_model_generate";
    model: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
  },
  timeoutMs: number,
) => Promise<DaemonOpResult>;

let daemonOpForTesting: AndroidLocalGemmaDaemonOp | null = null;

export function _setAndroidLocalGemmaDaemonOpForTesting(fn: AndroidLocalGemmaDaemonOp | null): void {
  daemonOpForTesting = fn;
}

function normalizeAndroidLocalGemmaModel(model: string): string {
  const raw = model?.trim() || ANDROID_LOCAL_GEMMA_MODEL;
  return raw.startsWith("android-local-gemma/")
    ? raw.slice("android-local-gemma/".length)
    : raw;
}

function textFromContent(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function promptFromMessages(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  return messages
    .map((message) => {
      if (message.role === "tool") {
        return `tool(${message.tool_call_id}): ${textFromContent(message.content)}`;
      }
      const content = textFromContent(message.content);
      if (message.role === "assistant" && message.tool_calls?.length) {
        const calls = message.tool_calls
          .filter((call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => call.type === "function")
          .map((call) => `${call.function.name}(${call.function.arguments || "{}"})`)
          .join("\n");
        return `assistant: ${content}\nassistant tool calls:\n${calls}`.trim();
      }
      return `${message.role}: ${content}`;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
}

function textFromDaemonData(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  for (const key of ["text", "content", "reply", "output"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function finishReasonFromDaemonData(data: unknown): string | null {
  if (!data || typeof data !== "object") return "stop";
  const reason = (data as Record<string, unknown>).finishReason;
  return reason === "length" || reason === "tool_calls" || reason === "stop" ? reason : "stop";
}

async function sendAndroidLocalGemmaOp(
  userId: string,
  op: Parameters<AndroidLocalGemmaDaemonOp>[1],
  timeoutMs: number,
): Promise<DaemonOpResult> {
  if (daemonOpForTesting) return daemonOpForTesting(userId, op, timeoutMs);
  const { sendDaemonOp } = await import("../../daemon/bridge");
  return sendDaemonOp(userId, op, timeoutMs);
}

export class AndroidLocalGemmaProvider extends BaseProvider {
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    if (!params.userId) {
      throw new Error("Android Local Gemma requires an authenticated user and the Jarvis Android app device control connection.");
    }
    if (params.toolChoice === "required") {
      throw new Error("Android Local Gemma does not support required tool calls yet.");
    }

    const prompt = promptFromMessages(params.messages).trim();
    if (!prompt) {
      throw new Error("Android Local Gemma received an empty prompt.");
    }

    const result = await sendAndroidLocalGemmaOp(
      params.userId,
      {
        type: "android_local_model_generate",
        model: normalizeAndroidLocalGemmaModel(params.model),
        prompt,
        maxTokens: params.maxCompletionTokens,
      },
      120_000,
    );

    if (!result.ok) {
      throw new Error(result.error || "Android Local Gemma generation failed.");
    }

    const text = textFromDaemonData(result.data);
    if (!text.trim()) {
      throw new Error("Android Local Gemma returned no response text.");
    }

    yield { type: "text", delta: text };
    yield { type: "finish", reason: finishReasonFromDaemonData(result.data) };
  }
}
