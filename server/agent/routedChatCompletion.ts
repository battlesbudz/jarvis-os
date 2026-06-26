import type OpenAI from "openai";
import { routeModelTurn, type ModelExecutionTier, type RoutedModelTurnParams } from "./modelRouter";
import type { ProviderTurnResult } from "./providers/base";
import type { RuntimeExplanation } from "../core/runtime/runtimeExplanation";

type ChatCreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParams;
type RouteRunner = (params: RoutedModelTurnParams) => Promise<ProviderTurnResult>;

export type RuntimeExplainedChatCompletion = OpenAI.Chat.Completions.ChatCompletion & {
  runtimeExplanation?: RuntimeExplanation;
};

export interface RoutedChatCompletionOptions {
  signal?: AbortSignal;
  tier?: ModelExecutionTier;
  logPrefix?: string;
  userId?: string;
}

function maxTokensFromBody(body: ChatCreateBody): number {
  const raw = Number(body.max_completion_tokens ?? body.max_tokens ?? 1024);
  if (!Number.isFinite(raw) || raw <= 0) return 1024;
  return Math.round(raw);
}

function toolChoiceFromBody(body: ChatCreateBody): "auto" | "required" | "none" {
  if (body.tool_choice === "required") return "required";
  if (body.tool_choice === "none") return "none";
  return body.tools?.length ? "auto" : "none";
}

export function getUserIdFromChatBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const user = (body as { user?: unknown }).user;
  if (typeof user === "string" && user.trim()) return user.trim();
  const metadata = (body as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const meta = metadata as { userId?: unknown; jarvisUserId?: unknown };
  const metaUser = meta.userId ?? meta.jarvisUserId;
  return typeof metaUser === "string" && metaUser.trim() ? metaUser.trim() : undefined;
}

export async function createRoutedChatCompletion(
  body: ChatCreateBody,
  options: RoutedChatCompletionOptions = {},
  runner: RouteRunner = routeModelTurn,
): Promise<RuntimeExplainedChatCompletion> {
  const result = await runner({
    tier: options.tier ?? "cheap",
    requestedModel: String(body.model),
    messages: body.messages,
    tools: body.tools,
    toolChoice: toolChoiceFromBody(body),
    maxCompletionTokens: maxTokensFromBody(body),
    responseFormat: body.response_format,
    stream: false,
    userId: options.userId ?? getUserIdFromChatBody(body),
    signal: options.signal,
    logPrefix: options.logPrefix,
  });

  return {
    id: `jarvis-routed-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model ?? String(body.model),
    choices: [
      {
        index: 0,
        finish_reason: (result.finishReason as OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"]) ?? "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: result.textContent || null,
          refusal: null,
          tool_calls: result.toolCallList.length ? result.toolCallList : undefined,
        },
      },
    ],
    runtimeExplanation: result.runtimeExplanation,
  } as RuntimeExplainedChatCompletion;
}

export function createRoutedOpenAIChatShim(
  logPrefix: string,
  tier: ModelExecutionTier = "balanced",
): Pick<OpenAI, "chat"> {
  return {
    chat: {
      completions: {
        create: (body: ChatCreateBody, options?: { signal?: AbortSignal }) =>
          createRoutedChatCompletion(body, {
            signal: options?.signal,
            tier,
            logPrefix,
          }),
      },
    },
  } as Pick<OpenAI, "chat">;
}
