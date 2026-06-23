/**
 * BaseProvider — abstract interface for model providers.
 *
 * Every provider (OpenAI, Claude, …) must implement this interface.
 * The harness is provider-agnostic: it calls `provider.query(...)` and
 * receives a unified stream of ProviderChunk values via an async generator,
 * regardless of which SDK is underneath.
 *
 * Message format convention:
 *   All providers accept messages in the OpenAI ChatCompletionMessageParam
 *   format as the canonical interchange format. Providers that use a different
 *   wire format (e.g. Anthropic) convert internally before each API call.
 *
 * Consumer pattern:
 *   Use the `accumulateTurn()` helper to collect all chunks into a
 *   ProviderTurnResult (text + tool calls + finish reason).
 */

import type OpenAI from "openai";

export type ProviderResponseFormat =
  OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];

export interface ProviderQueryParams {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice: "auto" | "required" | "none";
  maxCompletionTokens: number;
  responseFormat?: ProviderResponseFormat;
  preferredAuthType?: "api_key" | "oauth";
  /** When true, the provider should emit fine-grained text deltas in real time. */
  stream: boolean;
  /** User-scoped runtimes, such as the desktop daemon, need this to find the right connection. */
  userId?: string;
  signal?: AbortSignal;
}

export function isJsonObjectResponseFormat(responseFormat: ProviderResponseFormat | undefined): boolean {
  return !!responseFormat
    && typeof responseFormat === "object"
    && (responseFormat as { type?: unknown }).type === "json_object";
}

// ── Chunk types (discriminated union) ──────────────────────────────────────────

export type ProviderChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_args"; index: number; args: string }
  | { type: "finish"; reason: string | null };

// ── Accumulated result ─────────────────────────────────────────────────────────

export interface ProviderTurnResult {
  textContent: string;
  /** Individual text deltas emitted during the turn (empty for non-streaming). */
  textChunks: string[];
  toolCallList: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  finishReason: string | null;
  providerName?: string;
  model?: string;
  fallbackUsed?: boolean;
}

// ── Accumulator helper ─────────────────────────────────────────────────────────

/**
 * Drains a provider's async generator into a ProviderTurnResult.
 * The harness calls this so it can continue working with the accumulated
 * result rather than managing streaming state itself.
 */
export async function accumulateTurn(
  gen: AsyncGenerator<ProviderChunk>,
  onChunk?: (chunk: ProviderChunk) => void | Promise<void>,
): Promise<ProviderTurnResult> {
  let textContent = "";
  const textChunks: string[] = [];
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
  const toolCallOrder: number[] = [];
  let finishReason: string | null = null;

  for await (const chunk of gen) {
    if (onChunk) await onChunk(chunk);
    switch (chunk.type) {
      case "text":
        textContent += chunk.delta;
        textChunks.push(chunk.delta);
        break;
      case "tool_call_start":
        if (!toolCallMap.has(chunk.index)) {
          toolCallMap.set(chunk.index, { id: chunk.id, name: chunk.name, args: "" });
          toolCallOrder.push(chunk.index);
        }
        break;
      case "tool_call_args": {
        const acc = toolCallMap.get(chunk.index);
        if (acc) acc.args += chunk.args;
        break;
      }
      case "finish":
        finishReason = chunk.reason;
        break;
    }
  }

  const toolCallList: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] =
    toolCallOrder.map((idx) => {
      const acc = toolCallMap.get(idx)!;
      return {
        id: acc.id,
        type: "function" as const,
        function: { name: acc.name, arguments: acc.args || "{}" },
      };
    });

  return { textContent, textChunks, toolCallList, finishReason };
}

// ── Base class ─────────────────────────────────────────────────────────────────

export abstract class BaseProvider {
  abstract initialize(): Promise<void>;
  abstract cleanup(): Promise<void>;

  /**
   * Async generator that yields ProviderChunk values for a single model turn.
   *
   * Implementations should:
   * - Yield `text` chunks as text tokens arrive (streaming) or as one batch
   *   (non-streaming).
   * - Yield `tool_call_start` followed by one or more `tool_call_args` chunks
   *   for each tool the model requests.
   * - Yield a single `finish` chunk as the last item.
   * - Honour `params.signal` for cancellation.
   */
  abstract query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk>;

  /**
   * Abort a running query by its run ID.
   * Override in providers that maintain per-run AbortControllers beyond
   * the caller-supplied AbortSignal (e.g. for server-initiated cancellation).
   */
  abort(_runId: string): void {
    // Default: no-op. Callers drive cancellation via params.signal.
  }
}
