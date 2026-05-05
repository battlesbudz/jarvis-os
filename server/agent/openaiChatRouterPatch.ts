import { Completions } from "openai/resources/chat/completions";
import type OpenAI from "openai";
import { routeModelTurn } from "./modelRouter";

type ChatCreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParams;
type ChatCreateOptions = { signal?: AbortSignal };
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

const ROUTER_PATCHED = Symbol.for("jarvis.openaiChatRouterPatched");
let routingDepth = 0;

function routingEnabled(): boolean {
  const raw = process.env.JARVIS_MODEL_ROUTING?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "enabled" || raw === "yes";
}

function isDirectOpenAIClient(completions: unknown): boolean {
  const baseURL = String((completions as { _client?: { baseURL?: unknown } })._client?.baseURL ?? "");
  return baseURL.includes("api.openai.com");
}

function shouldRoute(completions: unknown, body: ChatCreateBody): boolean {
  if (!routingEnabled()) return false;
  if (routingDepth > 0) return false;
  if (!isDirectOpenAIClient(completions)) return false;
  if (typeof body.model !== "string") return false;

  // Only catch the app's ordinary direct OpenAI chat calls. Provider adapters
  // use non-OpenAI base URLs and bypass this patch via isDirectOpenAIClient().
  return body.model.startsWith("gpt-");
}

function tierForBody(body: ChatCreateBody): "cheap" | "balanced" | "smart" {
  if (body.tools?.length) return "balanced";
  const tokens = Number(body.max_completion_tokens ?? 0);
  if (tokens > 2000) return "balanced";
  return "cheap";
}

function toCompletion(
  body: ChatCreateBody,
  text: string,
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[],
  finishReason: string | null,
): ChatCompletion {
  return {
    id: `jarvis-routed-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: String(body.model),
    choices: [
      {
        index: 0,
        finish_reason: (finishReason as ChatCompletion.Choice["finish_reason"]) ?? "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: text || null,
          refusal: null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        },
      },
    ],
  } as ChatCompletion;
}

async function* toStream(text: string): AsyncGenerator<ChatCompletionChunk> {
  yield {
    id: `jarvis-routed-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "jarvis-routed",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: text },
        finish_reason: null,
        logprobs: null,
      },
    ],
  } as ChatCompletionChunk;
  yield {
    id: `jarvis-routed-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "jarvis-routed",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
        logprobs: null,
      },
    ],
  } as ChatCompletionChunk;
}

export function installOpenAIChatRouterPatch(): void {
  const proto = Completions.prototype as typeof Completions.prototype & {
    [ROUTER_PATCHED]?: boolean;
    create: (body: ChatCreateBody, options?: ChatCreateOptions) => unknown;
  };
  if (proto[ROUTER_PATCHED]) return;

  const originalCreate = proto.create;
  proto.create = function patchedCreate(body: ChatCreateBody, options?: ChatCreateOptions): unknown {
    if (!shouldRoute(this, body)) {
      return originalCreate.call(this, body, options);
    }

    routingDepth++;
    const run = routeModelTurn({
      tier: tierForBody(body),
      messages: body.messages,
      tools: body.tools,
      toolChoice: (body.tool_choice === "required" ? "required" : body.tool_choice === "none" ? "none" : "auto"),
      maxCompletionTokens: Number(body.max_completion_tokens ?? 1024),
      stream: false,
      signal: options?.signal,
      logPrefix: "[OpenAIChatRouterPatch]",
    }).then((result) => {
      if (body.stream) return toStream(result.textContent);
      return toCompletion(body, result.textContent, result.toolCallList, result.finishReason);
    }).finally(() => {
      routingDepth--;
    });

    return run;
  };
  proto[ROUTER_PATCHED] = true;
  console.log("[OpenAIChatRouterPatch] installed");
}

installOpenAIChatRouterPatch();
