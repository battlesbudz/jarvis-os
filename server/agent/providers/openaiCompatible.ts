/**
 * OpenAICompatibleProvider - generic adapter for local or third-party routers
 * that expose an OpenAI-compatible Chat Completions API.
 *
 * Model string convention:
 *   openrouter/<model-id>         -> OpenRouter's OpenAI-compatible API
 *   groq/<model-id>               -> Groq's OpenAI-compatible API
 *   together/<model-id>           -> Together's OpenAI-compatible API
 *   fireworks/<model-id>          -> Fireworks' OpenAI-compatible API
 *   cerebras/<model-id>           -> Cerebras' OpenAI-compatible API
 *   nvidia/<model-id>             -> NVIDIA's OpenAI-compatible API
 *   deepseek/<model-id>           -> DeepSeek's OpenAI-compatible API
 *   openai-compatible/<model-id>  -> OPENAI_COMPATIBLE_BASE_URL
 *
 * This keeps Jarvis's canonical provider contract intact while allowing cheap
 * or free model workers to sit behind OpenRouter, Groq, Together, Ollama,
 * LM Studio, vLLM, or any other /v1/chat/completions server.
 */

import OpenAI from "openai";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";
import { getProviderEnvValue } from "./env";
import {
  getProviderCredential,
  type GetProviderCredentialInput,
  type ProviderCredential,
} from "./modelProviderAuthProfiles";

type RelayTarget = {
  baseURL: string;
  apiKey: string;
  model: string;
};
type OpenAICompatibleClientConfig = { baseURL: string; apiKey: string };
type OpenAICompatibleClientFactory = (config: OpenAICompatibleClientConfig) => OpenAI;
type OpenAICompatibleCredentialResolver = (
  input: GetProviderCredentialInput,
) => Promise<ProviderCredential | null>;

type OpenAICompatiblePrefix =
  | "modelrelay"
  | "openai-compatible"
  | "openrouter"
  | "groq"
  | "together"
  | "fireworks"
  | "cerebras"
  | "nvidia"
  | "deepseek";

const MODELRELAY_PREFIX = "modelrelay/";
const OPENAI_COMPATIBLE_PREFIX = "openai-compatible/";
const PROVIDER_PREFIXES: Array<{ prefix: OpenAICompatiblePrefix; marker: string }> = [
  { prefix: "modelrelay", marker: MODELRELAY_PREFIX },
  { prefix: "openai-compatible", marker: OPENAI_COMPATIBLE_PREFIX },
  { prefix: "openrouter", marker: "openrouter/" },
  { prefix: "groq", marker: "groq/" },
  { prefix: "together", marker: "together/" },
  { prefix: "fireworks", marker: "fireworks/" },
  { prefix: "cerebras", marker: "cerebras/" },
  { prefix: "nvidia", marker: "nvidia/" },
  { prefix: "deepseek", marker: "deepseek/" },
];

let openAICompatibleProviderClientFactoryForTesting: OpenAICompatibleClientFactory | null = null;
let openAICompatibleCredentialResolverForTesting: OpenAICompatibleCredentialResolver | null = null;

export function _setOpenAICompatibleProviderClientFactoryForTesting(
  factory: OpenAICompatibleClientFactory | null,
): void {
  openAICompatibleProviderClientFactoryForTesting = factory;
}

export function _setOpenAICompatibleCredentialResolverForTesting(
  resolver: OpenAICompatibleCredentialResolver | null,
): void {
  openAICompatibleCredentialResolverForTesting = resolver;
}

function createOpenAICompatibleClient(config: OpenAICompatibleClientConfig): OpenAI {
  return openAICompatibleProviderClientFactoryForTesting
    ? openAICompatibleProviderClientFactoryForTesting(config)
    : new OpenAI(config);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeBaseURL(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  return trimTrailingSlash(raw);
}

function stripKnownPrefix(model: string): { prefix: OpenAICompatiblePrefix; model: string } {
  for (const { prefix, marker } of PROVIDER_PREFIXES) {
    if (model.startsWith(marker)) {
      return { prefix, model: model.slice(marker.length) };
    }
  }
  return { prefix: "openai-compatible", model };
}

function resolveRelayTargetFromPrefix(parsed: { prefix: OpenAICompatiblePrefix; model: string }): RelayTarget {
  switch (parsed.prefix) {
    case "openrouter":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("OPENROUTER_BASE_URL", "AI_INTEGRATIONS_OPENROUTER_BASE_URL"),
          "https://openrouter.ai/api/v1",
        ),
        apiKey: getProviderEnvValue("OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENROUTER_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("OPENROUTER_MODEL", "AI_INTEGRATIONS_OPENROUTER_MODEL") || "openrouter/auto",
      };
    case "groq":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("GROQ_BASE_URL", "AI_INTEGRATIONS_GROQ_BASE_URL"),
          "https://api.groq.com/openai/v1",
        ),
        apiKey: getProviderEnvValue("GROQ_API_KEY", "AI_INTEGRATIONS_GROQ_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("GROQ_MODEL", "AI_INTEGRATIONS_GROQ_MODEL") || "llama-3.1-8b-instant",
      };
    case "together":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("TOGETHER_BASE_URL", "AI_INTEGRATIONS_TOGETHER_BASE_URL"),
          "https://api.together.xyz/v1",
        ),
        apiKey: getProviderEnvValue("TOGETHER_API_KEY", "AI_INTEGRATIONS_TOGETHER_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("TOGETHER_MODEL", "AI_INTEGRATIONS_TOGETHER_MODEL") || "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      };
    case "fireworks":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("FIREWORKS_BASE_URL", "AI_INTEGRATIONS_FIREWORKS_BASE_URL"),
          "https://api.fireworks.ai/inference/v1",
        ),
        apiKey: getProviderEnvValue("FIREWORKS_API_KEY", "AI_INTEGRATIONS_FIREWORKS_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("FIREWORKS_MODEL", "AI_INTEGRATIONS_FIREWORKS_MODEL") || "accounts/fireworks/models/llama-v3p1-8b-instruct",
      };
    case "cerebras":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("CEREBRAS_BASE_URL", "AI_INTEGRATIONS_CEREBRAS_BASE_URL"),
          "https://api.cerebras.ai/v1",
        ),
        apiKey: getProviderEnvValue("CEREBRAS_API_KEY", "AI_INTEGRATIONS_CEREBRAS_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("CEREBRAS_MODEL", "AI_INTEGRATIONS_CEREBRAS_MODEL") || "llama3.1-8b",
      };
    case "nvidia":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("NVIDIA_BASE_URL", "AI_INTEGRATIONS_NVIDIA_BASE_URL"),
          "https://integrate.api.nvidia.com/v1",
        ),
        apiKey: getProviderEnvValue("NVIDIA_API_KEY", "AI_INTEGRATIONS_NVIDIA_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("NVIDIA_MODEL", "AI_INTEGRATIONS_NVIDIA_MODEL") || "meta/llama-3.1-8b-instruct",
      };
    case "deepseek":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("DEEPSEEK_BASE_URL", "AI_INTEGRATIONS_DEEPSEEK_BASE_URL"),
          "https://api.deepseek.com",
        ),
        apiKey: getProviderEnvValue("DEEPSEEK_API_KEY", "AI_INTEGRATIONS_DEEPSEEK_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("DEEPSEEK_MODEL", "AI_INTEGRATIONS_DEEPSEEK_MODEL") || "deepseek-chat",
      };
    case "modelrelay":
      return {
        baseURL: normalizeBaseURL(
          process.env.MODEL_RELAY_BASE_URL ?? process.env.MODELRELAY_BASE_URL,
          "http://127.0.0.1:7352/v1",
        ),
        apiKey: process.env.MODEL_RELAY_API_KEY ?? process.env.MODELRELAY_API_KEY ?? "no-key",
        model: parsed.model || "auto-fastest",
      };
    case "openai-compatible":
      return {
        baseURL: normalizeBaseURL(
          getProviderEnvValue("OPENAI_COMPATIBLE_BASE_URL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_BASE_URL"),
          "http://127.0.0.1:7352/v1",
        ),
        apiKey: getProviderEnvValue("OPENAI_COMPATIBLE_API_KEY", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_API_KEY") ?? "no-key",
        model: parsed.model || getProviderEnvValue("OPENAI_COMPATIBLE_MODEL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_MODEL") || "auto-fastest",
      };
  }
}

function userCredentialProviderForPrefix(prefix: OpenAICompatiblePrefix): string | null {
  switch (prefix) {
    case "modelrelay":
    case "openai-compatible":
      return "local-llama";
    default:
      return null;
  }
}

async function resolveRelayTarget(model: string, userId?: string): Promise<RelayTarget> {
  const parsed = stripKnownPrefix(model);
  const envTarget = resolveRelayTargetFromPrefix(parsed);
  const credentialProvider = userCredentialProviderForPrefix(parsed.prefix);
  if (!userId || !credentialProvider) return envTarget;

  const resolver = openAICompatibleCredentialResolverForTesting ?? getProviderCredential;
  const credential = await resolver({
    userId,
    provider: credentialProvider,
    preferredAuthType: "api_key",
    allowAuthTypeFallback: false,
  });
  if (!credential?.credential) return envTarget;
  return { ...envTarget, apiKey: credential.credential };
}

export class OpenAICompatibleProvider extends BaseProvider {
  private clients = new Map<string, OpenAI>();

  async initialize(): Promise<void> {
    // Clients are created lazily per baseURL/apiKey pair.
  }

  async cleanup(): Promise<void> {
    this.clients.clear();
  }

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    if (params.stream) {
      yield* this._streamTurn(params);
    } else {
      yield* this._completeTurn(params);
    }
  }

  private getClient(target: RelayTarget): OpenAI {
    const key = `${target.baseURL}\n${target.apiKey}`;
    const cached = this.clients.get(key);
    if (cached) return cached;
    const client = createOpenAICompatibleClient({ baseURL: target.baseURL, apiKey: target.apiKey });
    this.clients.set(key, client);
    return client;
  }

  private async *_completeTurn(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    const target = await resolveRelayTarget(params.model, params.userId);
    const client = this.getClient(target);
    const completion = await client.chat.completions.create(
      {
        model: target.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tools ? params.toolChoice : undefined,
        max_completion_tokens: params.maxCompletionTokens,
      },
      { signal: params.signal },
    );

    const choice = completion.choices[0];
    const msg = choice?.message;

    if (msg?.content) {
      yield { type: "text", delta: msg.content };
    }

    const toolCalls = msg?.tool_calls ?? [];
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      if (tc.type !== "function") continue;
      yield { type: "tool_call_start", index: i, id: tc.id, name: tc.function.name };
      if (tc.function.arguments) {
        yield { type: "tool_call_args", index: i, args: tc.function.arguments };
      }
    }

    yield { type: "finish", reason: choice?.finish_reason ?? null };
  }

  private async *_streamTurn(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    const target = await resolveRelayTarget(params.model, params.userId);
    const client = this.getClient(target);
    const stream = await client.chat.completions.create(
      {
        model: target.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tools ? params.toolChoice : undefined,
        max_completion_tokens: params.maxCompletionTokens,
        stream: true,
      },
      { signal: params.signal },
    );

    const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();
    const toolCallOrder: number[] = [];
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const fr = chunk.choices[0]?.finish_reason;
      if (fr) finishReason = fr;

      if (delta?.content) {
        yield { type: "text", delta: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccum.has(idx)) {
            toolCallAccum.set(idx, { id: "", name: "", args: "" });
            toolCallOrder.push(idx);
          }
          const acc = toolCallAccum.get(idx)!;
          if (tc.id) acc.id += tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }
    }

    for (const idx of toolCallOrder) {
      const acc = toolCallAccum.get(idx)!;
      yield { type: "tool_call_start", index: idx, id: acc.id, name: acc.name };
      if (acc.args) {
        yield { type: "tool_call_args", index: idx, args: acc.args };
      }
    }

    yield { type: "finish", reason: finishReason };
  }
}
