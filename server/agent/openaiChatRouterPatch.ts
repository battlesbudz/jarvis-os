import { Completions } from "openai/resources/chat/completions";
import OpenAI from "openai";
import { routeModelTurn } from "./modelRouter";

type ChatCreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParams;
type ChatCreateOptions = { signal?: AbortSignal };
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

const ROUTER_PATCHED = Symbol.for("jarvis.openaiChatRouterPatched");
const CLIENT_POST_PATCHED = Symbol.for("jarvis.openaiClientPostRouterPatched");
let routingDepth = 0;

function routingEnabled(): boolean {
  const raw = process.env.JARVIS_MODEL_ROUTING?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "enabled" || raw === "yes";
}

function shouldRoute(completions: unknown, body: ChatCreateBody): boolean {
  if (!routingEnabled()) return false;
  if (routingDepth > 0) return false;
  if (typeof body.model !== "string") return false;

  // Only catch the app's ordinary direct OpenAI chat calls. Provider adapters
  // are invoked inside routeModelTurn(), so routingDepth prevents recursion
  // even when they use the OpenAI SDK against Groq/OpenRouter-compatible URLs.
  return body.model.startsWith("gpt-");
}

function shouldRouteBody(body: unknown): body is ChatCreateBody {
  if (!routingEnabled()) return false;
  if (routingDepth > 0) return false;
  if (!body || typeof body !== "object") return false;
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" && model.startsWith("gpt-");
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

  const clientProto = OpenAI.prototype as typeof OpenAI.prototype & {
    [CLIENT_POST_PATCHED]?: boolean;
    post: (path: string, opts?: { body?: unknown; stream?: boolean; signal?: AbortSignal }) => unknown;
  };
  if (!clientProto[CLIENT_POST_PATCHED]) {
    const originalPost = clientProto.post;
    clientProto.post = function patchedPost(path: string, opts?: { body?: unknown; stream?: boolean; signal?: AbortSignal }): unknown {
      const body = opts?.body;
      if (path !== "/chat/completions" || !shouldRouteBody(body)) {
        return originalPost.call(this, path, opts);
      }

      routingDepth++;
      const run = routeModelTurn({
        tier: tierForBody(body),
        messages: body.messages,
        tools: body.tools,
        toolChoice: (body.tool_choice === "required" ? "required" : body.tool_choice === "none" ? "none" : "auto"),
        maxCompletionTokens: Number(body.max_completion_tokens ?? 1024),
        stream: false,
        signal: opts?.signal,
        logPrefix: "[OpenAIClientPostRouterPatch]",
      }).then((result) => {
        if (body.stream) return toStream(result.textContent);
        return toCompletion(body, result.textContent, result.toolCallList, result.finishReason);
      }).finally(() => {
        routingDepth--;
      });

      return run;
    };
    clientProto[CLIENT_POST_PATCHED] = true;
  }
  console.log("[OpenAIChatRouterPatch] installed");
}

installOpenAIChatRouterPatch();
