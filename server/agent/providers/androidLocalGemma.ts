import type OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { ANDROID_LOCAL_GEMMA_MODEL } from "@shared/modelProviderCatalog";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";

type DaemonOpResult = { ok: boolean; data?: unknown; error?: string };

type AndroidLocalGemmaDaemonOp = (
  userId: string,
  op: {
    type: "android_local_model_generate";
    requestId?: string;
    model: string;
    prompt: string;
    contextTokens?: number;
    maxTokens?: number;
    backend?: string;
    temperature?: number;
  } | {
    type: "android_local_model_cancel";
    requestId?: string;
  },
  timeoutMs: number,
) => Promise<DaemonOpResult>;

let daemonOpForTesting: AndroidLocalGemmaDaemonOp | null = null;

const DEFAULT_PHONE_GEMMA_TIMEOUT_MS = 60_000;
const DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS = 1024;
const DEFAULT_PHONE_GEMMA_MAX_COMPLETION_TOKENS = 128;

type LocalGemmaStructuredOutput =
  | { type: "final"; content: string }
  | { type: "tool_calls"; toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] };

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function phoneGemmaTimeoutMs(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_TIMEOUT_MS", DEFAULT_PHONE_GEMMA_TIMEOUT_MS, 10_000, 120_000);
}

function phoneGemmaContextTokens(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS", DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS, 512, 4096);
}

function phoneGemmaMaxCompletionTokens(requested: number | undefined): number {
  const ceiling = intEnv("ANDROID_LOCAL_GEMMA_MAX_COMPLETION_TOKENS", DEFAULT_PHONE_GEMMA_MAX_COMPLETION_TOKENS, 16, 512);
  const wanted = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : ceiling;
  return Math.min(ceiling, Math.max(1, wanted));
}

function shouldCancelTimedOutGeneration(result: DaemonOpResult): boolean {
  return !result.ok && /timeout/i.test(result.error || "");
}

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

function messageForPrompt(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): string {
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
}

function promptFromMessages(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  return messages
    .map(messageForPrompt)
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
}

function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeToolArguments(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "{}";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return "{}";
}

function generatedToolCallId(index: number): string {
  return `phone_gemma_call_${Date.now().toString(36)}_${index}`;
}

function parseLocalGemmaStructuredOutput(raw: string): LocalGemmaStructuredOutput {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return { type: "final", content: raw.trim() };
  }

  const data = parsed as Record<string, unknown>;
  const type = typeof data.type === "string" ? data.type : "";
  if (type === "final") {
    return { type: "final", content: String(data.content ?? data.text ?? "").trim() };
  }

  const rawToolCalls = Array.isArray(data.tool_calls)
    ? data.tool_calls
    : Array.isArray(data.toolCalls)
      ? data.toolCalls
      : [];
  if (type === "tool_calls" || rawToolCalls.length > 0) {
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = rawToolCalls
      .map((toolCall, index) => {
        if (!toolCall || typeof toolCall !== "object") return null;
        const item = toolCall as Record<string, unknown>;
        const functionData = item.function && typeof item.function === "object"
          ? item.function as Record<string, unknown>
          : item;
        const name = typeof functionData.name === "string" ? functionData.name.trim() : "";
        if (!name) return null;
        return {
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : generatedToolCallId(index),
          type: "function" as const,
          function: {
            name,
            arguments: normalizeToolArguments(functionData.arguments),
          },
        };
      })
      .filter((toolCall): toolCall is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => !!toolCall);

    return { type: "tool_calls", toolCalls };
  }

  return { type: "final", content: raw.trim() };
}

function toolSpecsForPrompt(tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined): Array<Record<string, unknown>> {
  return tools?.flatMap((tool) => {
    if (tool.type !== "function") return [];
    return [{
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }];
  }) ?? [];
}

function toolPromptFromParams(params: ProviderQueryParams): string {
  const sections = params.messages.map((message, index) => {
    const name = "name" in message && typeof message.name === "string" ? ` (${message.name})` : "";
    return `Message ${index + 1} [${message.role}${name}]\n${messageForPrompt(message)}`;
  });

  return [
    "You are Jarvis running entirely through Android Local Gemma on the user's phone.",
    "You decide whether Jarvis should answer directly or request a local harness tool call.",
    "You do not execute tools yourself. Jarvis executes any tool call you request and sends the result back in the next message.",
    "Tool result messages are authoritative observations from Jarvis. Use them directly.",
    "Return ONLY one JSON object. Do not use markdown, code fences, or extra text.",
    "For tool use, return exactly:",
    `{"type":"tool_calls","tool_calls":[{"name":"tool_name","arguments":{"key":"value"}}]}`,
    "For a final answer, return exactly:",
    `{"type":"final","content":"your reply to the user"}`,
    params.toolChoice === "required"
      ? "A tool call is required for this turn. Do not return a final answer."
      : "Use tools only when they are necessary to satisfy the user's request.",
    "Available tools:",
    JSON.stringify(toolSpecsForPrompt(params.tools), null, 2),
    "",
    "Conversation:",
    sections.join("\n\n---\n\n"),
  ].join("\n");
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

function normalizeAndroidLocalGemmaError(error: string | undefined): string {
  if (error?.includes("LOCAL_MODEL_ENGINE_NOT_BUNDLED")) {
    return "Phone Gemma is selected, but this APK cannot run LiteRT-LM generation yet. Install a LiteRT-LM-enabled APK before using Android Local Gemma.";
  }
  if (
    error?.includes("LOCAL_MODEL_GENERATION_FAILED") &&
    (error.includes("Failed to invoke the compiled model") || error.includes("llm_litert_compiled_model_executor.cc:755"))
  ) {
    return `Phone Gemma could not finish local inference on this device. Jarvis stayed on the local phone model and did not use any other model. Details: ${error}`;
  }
  if (
    error?.includes("LOCAL_MODEL_GENERATION_FAILED") &&
    (error.includes("Failed to create LiteRT-LM engine") || error.includes("llm_litert_compiled_model_executor"))
  ) {
    return `Phone Gemma could not start the LiteRT-LM engine for the imported .litertlm model. Jarvis tried the device accelerator and CPU fallback; reimport ${ANDROID_LOCAL_GEMMA_MODEL.replace("android-local-gemma/", "")} as the official .litertlm file if this keeps happening. Details: ${error}`;
  }
  if (error?.includes("LOCAL_MODEL_DEVICE_MEMORY_LOW")) {
    return `Phone Gemma did not start because Android reported low available memory. Close other heavy apps, then try again. Details: ${error}`;
  }
  if (error?.includes("LOCAL_MODEL_BUSY")) {
    return "Phone Gemma is still working on the previous message. Wait for it to finish or tap Stop before sending another local-model message.";
  }
  if (error?.includes("LOCAL_MODEL_CANCELLED")) {
    return "Phone Gemma generation was cancelled before it finished.";
  }
  if (/daemon timeout/i.test(error || "")) {
    return "Phone Gemma timed out before returning a response. Jarvis asked the Android app to cancel that local generation so it does not keep slowing the phone down.";
  }
  return error || "Android Local Gemma generation failed.";
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

    const hasTools = !!params.tools?.length && params.toolChoice !== "none";
    const prompt = (hasTools ? toolPromptFromParams(params) : promptFromMessages(params.messages)).trim();
    if (!prompt) {
      throw new Error("Android Local Gemma received an empty prompt.");
    }

    const requestId = `phone-gemma-${randomUUID()}`;
    const result = await sendAndroidLocalGemmaOp(
      params.userId,
      {
        type: "android_local_model_generate",
        requestId,
        model: normalizeAndroidLocalGemmaModel(params.model),
        prompt,
        contextTokens: phoneGemmaContextTokens(),
        maxTokens: phoneGemmaMaxCompletionTokens(params.maxCompletionTokens),
      },
      phoneGemmaTimeoutMs(),
    );

    if (shouldCancelTimedOutGeneration(result)) {
      sendAndroidLocalGemmaOp(
        params.userId,
        { type: "android_local_model_cancel", requestId },
        5_000,
      ).catch(() => {});
    }

    if (!result.ok) {
      throw new Error(normalizeAndroidLocalGemmaError(result.error));
    }

    const text = textFromDaemonData(result.data);
    if (!text.trim()) {
      throw new Error("Phone Gemma finished without response text. The phone-local model may have been interrupted or run out of memory; retry after closing other apps.");
    }

    if (hasTools) {
      const parsed = parseLocalGemmaStructuredOutput(text);
      if (parsed.type === "tool_calls") {
        if (parsed.toolCalls.length === 0) {
          throw new Error("Phone Gemma returned a tool-call response without a valid local tool call.");
        }
        for (const [index, toolCall] of parsed.toolCalls.entries()) {
          yield {
            type: "tool_call_start",
            index,
            id: toolCall.id,
            name: toolCall.function.name,
          };
          yield {
            type: "tool_call_args",
            index,
            args: toolCall.function.arguments,
          };
        }
        yield { type: "finish", reason: "tool_calls" };
        return;
      }

      if (params.toolChoice === "required") {
        throw new Error("Phone Gemma returned a final answer when the local harness required a tool call. No cloud model was used.");
      }

      if (parsed.content.trim()) {
        yield { type: "text", delta: parsed.content };
        yield { type: "finish", reason: finishReasonFromDaemonData(result.data) };
        return;
      }
    }

    yield { type: "text", delta: text };
    yield { type: "finish", reason: finishReasonFromDaemonData(result.data) };
  }
}
