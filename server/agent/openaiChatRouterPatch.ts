import { createRequire } from "node:module";
import { Completions } from "openai/resources/chat/completions";
import OpenAI from "openai";
import { routeModelTurn } from "./modelRouter";
import { getUserIdFromChatBody } from "./routedChatCompletion";
import "./providers/envAliases";
import { hasDirectOpenAIProvider, hasNonOpenAIRoutableProvider } from "./providers/env";

type ChatCreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParams;
type ChatCreateOptions = { signal?: AbortSignal };
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;
type ChatCompletionFinishReason = NonNullable<ChatCompletion["choices"][number]["finish_reason"]>;

const ROUTER_PATCHED = Symbol.for("jarvis.openaiChatRouterPatched");
const CLIENT_POST_PATCHED = Symbol.for("jarvis.openaiClientPostRouterPatched");
const CLIENT_METHOD_PATCHED = Symbol.for("jarvis.openaiClientMethodRouterPatched");
let routingDepth = 0;
const require = createRequire(import.meta.url);

function routingExplicitlyDisabled(): boolean {
  const raw = process.env.JARVIS_MODEL_ROUTING?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "disabled" || raw === "no";
}

function routingEnabled(): boolean {
  const raw = process.env.JARVIS_MODEL_ROUTING?.trim().toLowerCase();
  if (routingExplicitlyDisabled()) return false;
  if (raw === "1" || raw === "true" || raw === "enabled" || raw === "yes") return true;
  // Prefer the router whenever an alternate provider is configured. Otherwise an
  // exhausted direct OpenAI key can bypass OpenRouter/Groq/etc. and break chat.
  return hasNonOpenAIRoutableProvider();
}

function isProviderModelSpec(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("anthropic/") ||
    normalized.startsWith("google/") ||
    normalized.startsWith("openai/") ||
    normalized.startsWith("openai-compatible/") ||
    normalized.startsWith("modelrelay/") ||
    normalized.startsWith("openrouter/") ||
    normalized.startsWith("groq/") ||
    normalized.startsWith("together/") ||
    normalized.startsWith("fireworks/") ||
    normalized.startsWith("cerebras/") ||
    normalized.startsWith("nvidia/") ||
    normalized.startsWith("deepseek/")
  );
}

function shouldRoute(body: unknown): body is ChatCreateBody {
  if (routingExplicitlyDisabled()) return false;
  if (routingDepth > 0) return false;
  if (!body || typeof body !== "object") return false;
  const model = (body as { model?: unknown }).model;
  if (typeof model !== "string") return false;
  if (isProviderModelSpec(model)) return true;
  return routingEnabled() && model.startsWith("gpt-");
}

export function _shouldRouteOpenAIChatForTesting(body: unknown): boolean {
  return shouldRoute(body);
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
  routedModel?: string,
): ChatCompletion {
  return {
    id: `jarvis-routed-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: routedModel || String(body.model),
    choices: [
      {
        index: 0,
        finish_reason: (finishReason as ChatCompletionFinishReason | null) ?? "stop",
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

async function* toStream(text: string, routedModel: string): AsyncGenerator<ChatCompletionChunk> {
  yield {
    id: `jarvis-routed-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: routedModel,
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
    model: routedModel,
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

type OpenAIClientPatchProto = {
  [CLIENT_POST_PATCHED]?: boolean;
  [CLIENT_METHOD_PATCHED]?: boolean;
  post?: (path: string, opts?: { body?: unknown; stream?: boolean; signal?: AbortSignal }) => unknown;
  methodRequest?: (method: string, path: string, opts?: { body?: unknown; stream?: boolean; signal?: AbortSignal }) => unknown;
};

type OpenAIConstructor = {
  prototype: OpenAIClientPatchProto;
};

type CompletionsConstructor = {
  prototype: {
    [ROUTER_PATCHED]?: boolean;
    create: (body: ChatCreateBody, options?: ChatCreateOptions) => unknown;
  };
};

function routeBody(body: ChatCreateBody, signal: AbortSignal | undefined, logPrefix: string): Promise<unknown> {
  routingDepth++;
  return routeModelTurn({
    tier: tierForBody(body),
    requestedModel: String(body.model),
    messages: body.messages,
    tools: body.tools,
    toolChoice: (body.tool_choice === "required" ? "required" : body.tool_choice === "none" ? "none" : "auto"),
    maxCompletionTokens: Number(body.max_completion_tokens ?? 1024),
    stream: false,
    userId: getUserIdFromChatBody(body),
    signal,
    logPrefix,
  }).then((result) => {
    const routedModel = result.model ?? String(body.model);
    if (body.stream) return toStream(result.textContent, routedModel);
    return toCompletion(body, result.textContent, result.toolCallList, result.finishReason, routedModel);
  }).finally(() => {
    routingDepth--;
  });
}

function patchCompletions(ctor: CompletionsConstructor | undefined, logPrefix: string): boolean {
  const proto = ctor?.prototype;
  if (!proto || proto[ROUTER_PATCHED] || typeof proto.create !== "function") return false;

  const originalCreate = proto.create;
  proto.create = function patchedCreate(body: ChatCreateBody, options?: ChatCreateOptions): unknown {
    if (!shouldRoute(body)) {
      return originalCreate.call(this, body, options);
    }

    return routeBody(body, options?.signal, logPrefix);
  };
  proto[ROUTER_PATCHED] = true;
  return true;
}

function patchOpenAIClient(ctor: OpenAIConstructor | undefined, postLogPrefix: string, methodLogPrefix: string): boolean {
  const clientProto = ctor?.prototype;
  if (!clientProto) return false;

  let patched = false;

  if (!clientProto[CLIENT_POST_PATCHED] && typeof clientProto.post === "function") {
    const originalPost = clientProto.post;
    clientProto.post = function patchedPost(path: string, opts?: { body?: unknown; stream?: boolean; signal?: AbortSignal }): unknown {
      const body = opts?.body;
      if (path !== "/chat/completions" || !shouldRoute(body)) {
        return originalPost.call(this, path, opts);
      }

      return routeBody(body, opts?.signal, postLogPrefix);
    };
    clientProto[CLIENT_POST_PATCHED] = true;
    patched = true;
  }

  if (!clientProto[CLIENT_METHOD_PATCHED] && typeof clientProto.methodRequest === "function") {
    const originalMethodRequest = clientProto.methodRequest;
    clientProto.methodRequest = function patchedMethodRequest(method: string, path: string, opts?: { body?: unknown; stream?: boolean; signal?: AbortSignal }): unknown {
      const body = opts?.body;
      if (method !== "post" || path !== "/chat/completions" || !shouldRoute(body)) {
        return originalMethodRequest.call(this, method, path, opts);
      }

      return routeBody(body, opts?.signal, methodLogPrefix);
    };
    clientProto[CLIENT_METHOD_PATCHED] = true;
    patched = true;
  }

  return patched;
}

function optionalRequire(path: string): unknown {
  try {
    return require(path);
  } catch {
    return null;
  }
}

export function installOpenAIChatRouterPatch(): void {
  const cjsOpenAI = optionalRequire("openai") as { default?: OpenAIConstructor; OpenAI?: OpenAIConstructor } | null;
  const cjsCompletions = optionalRequire("openai/resources/chat/completions") as { Completions?: CompletionsConstructor } | null;

  const patched = [
    patchCompletions(Completions as unknown as CompletionsConstructor, "[OpenAIChatRouterPatch]"),
    patchCompletions(cjsCompletions?.Completions, "[OpenAIChatRouterPatch:cjs]"),
    patchOpenAIClient(OpenAI as unknown as OpenAIConstructor, "[OpenAIClientPostRouterPatch]", "[OpenAIClientMethodRouterPatch]"),
    patchOpenAIClient(cjsOpenAI?.default, "[OpenAIClientPostRouterPatch:cjs]", "[OpenAIClientMethodRouterPatch:cjs]"),
    patchOpenAIClient(cjsOpenAI?.OpenAI, "[OpenAIClientPostRouterPatch:cjs-named]", "[OpenAIClientMethodRouterPatch:cjs-named]"),
  ].some(Boolean);

  if (patched) console.log("[OpenAIChatRouterPatch] installed");
}

installOpenAIChatRouterPatch();
