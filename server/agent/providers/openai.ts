/**
 * OpenAIProvider — implements BaseProvider using the OpenAI Chat Completions API.
 *
 * Extracted from harness.ts: contains the streaming and non-streaming completion
 * logic that previously lived inline as `runStreamingTurn` and bare
 * `openai.chat.completions.create(...)` calls.
 *
 * Streaming behaviour:
 *   Text deltas are yielded as fine-grained `text` chunks so that callers can
 *   progressively update live-edit UIs. Tool-call deltas are accumulated and
 *   emitted via `tool_call_start` / `tool_call_args` chunks.
 */

import OpenAI from "openai";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";
import { getOpenAIClientConfig } from "./env";
import {
  getProviderCredential,
  isOpenAIAuthTypeFallbackEnabled,
  type GetProviderCredentialInput,
  type ProviderAuthType,
  type ProviderCredential,
} from "./modelProviderAuthProfiles";

type OpenAIClientConfig = { apiKey: string; baseURL?: string };
type OpenAIClientFactory = (config: OpenAIClientConfig) => OpenAI;
type OpenAIProviderCredentialResolver = (
  input: GetProviderCredentialInput,
) => Promise<ProviderCredential | null>;

let openAIClientFactoryForTesting: OpenAIClientFactory | null = null;
let openAIProviderCredentialResolverForTesting: OpenAIProviderCredentialResolver | null = null;

export function _setOpenAIProviderClientFactoryForTesting(factory: OpenAIClientFactory | null): void {
  openAIClientFactoryForTesting = factory;
}

export function _setOpenAIProviderCredentialResolverForTesting(
  resolver: OpenAIProviderCredentialResolver | null,
): void {
  openAIProviderCredentialResolverForTesting = resolver;
}

function createOpenAIClient(config: OpenAIClientConfig): OpenAI {
  return openAIClientFactoryForTesting ? openAIClientFactoryForTesting(config) : new OpenAI(config);
}

function getPreferredOpenAIAuthType(): ProviderAuthType | undefined {
  const value = process.env.JARVIS_OPENAI_PREFERRED_AUTH_TYPE?.trim().toLowerCase();
  if (value === "oauth" || value === "api_key") return value;
  return undefined;
}

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    // Client is created in the constructor; nothing async to do.
  }

  async cleanup(): Promise<void> {
    // No persistent resources to release.
  }

  private getEnvClient(): OpenAI {
    if (!this.client) {
      this.client = createOpenAIClient(getOpenAIClientConfig());
    }
    return this.client;
  }

  private async getClient(params: ProviderQueryParams): Promise<OpenAI> {
    if (!params.userId) return this.getEnvClient();

    const resolver = openAIProviderCredentialResolverForTesting ?? getProviderCredential;
    const credential = await resolver({
      userId: params.userId,
      provider: "openai",
      preferredAuthType: getPreferredOpenAIAuthType(),
      allowAuthTypeFallback: isOpenAIAuthTypeFallbackEnabled(),
    });

    if (!credential) return this.getEnvClient();

    return createOpenAIClient({
      ...getOpenAIClientConfig(),
      apiKey: credential.credential,
    });
  }

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    if (params.stream) {
      yield* this._streamTurn(params);
    } else {
      yield* this._completeTurn(params);
    }
  }

  // ── Non-streaming path ────────────────────────────────────────────────────

  private async *_completeTurn(
    params: ProviderQueryParams,
  ): AsyncGenerator<ProviderChunk> {
    const client = await this.getClient(params);
    const completion = await client.chat.completions.create(
      {
        model: params.model,
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

  // ── Streaming path ────────────────────────────────────────────────────────

  private async *_streamTurn(
    params: ProviderQueryParams,
  ): AsyncGenerator<ProviderChunk> {
    const client = await this.getClient(params);
    const stream = await client.chat.completions.create(
      {
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tools ? params.toolChoice : undefined,
        max_completion_tokens: params.maxCompletionTokens,
        stream: true,
      },
      { signal: params.signal },
    );

    // Tool-call fields arrive fragmented across many chunks (id, name, and
    // arguments each arrive in separate deltas). We accumulate them all here
    // before emitting — matching the behaviour of the original runStreamingTurn
    // in harness.ts — to avoid losing partial fields.
    // Text deltas ARE yielded in real time so callers can drive live-edit UIs.
    const toolCallAccum = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    const toolCallOrder: number[] = [];
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const fr = chunk.choices[0]?.finish_reason;
      if (fr) finishReason = fr;

      // Text: yield immediately so callers see real-time token updates.
      if (delta?.content) {
        yield { type: "text", delta: delta.content };
      }

      // Tool calls: accumulate across all chunks, emit after the stream ends.
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

    // Emit accumulated tool calls now that all fragments have been gathered.
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
