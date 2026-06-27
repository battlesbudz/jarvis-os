import type OpenAI from "openai";
import { routeModelTurn, type ModelExecutionTier, type RoutedModelTurnParams } from "./modelRouter";
import type { ProviderTurnResult } from "./providers/base";
import type { RuntimeExplanation } from "../core/runtime/runtimeExplanation";
import { classifyRuntimeMemoryInspectionIntent } from "../state/runtimeMemoryInspection";

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
  disableRuntimeStateCard?: boolean;
}

export interface RoutedOpenAIChatShimOptions extends Pick<RoutedChatCompletionOptions, "disableRuntimeStateCard"> {
  runner?: RouteRunner;
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

function messageContentText(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]): string {
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

function requestsRuntimeStateContext(text: string): boolean {
  return /\b(?:who am i|what do you know about me|what(?:'s| is) my name)\b/.test(text)
    || /\b(?:my|current|active|connected|available)\s+(?:active\s+)?(?:tasks?|goals?|profile|identity|memories|memory|state|context|tools?|accounts?|capabilities|model)\b/.test(text)
    || /\bwhat\s+(?:tools?|accounts?|capabilities|model)\b/.test(text)
    || /\bis\s+(?:phone gemma|local gemma|the local model|jarvis)\s+working\b/.test(text);
}

function isPayloadLikeUserText(text: string): boolean {
  return /(?:^|\n)\s*(?:user|assistant|agent|system|tool):\s+/i.test(text)
    || /^\s*(?:source|source text|transcript|conversation|payload)\s*[:\n]/i.test(text);
}

function directlyRequestsRuntimeStateContext(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  text: string,
): boolean {
  if (isPayloadLikeUserText(text)) return false;
  return requestsRuntimeStateContext(text) || Boolean(classifyRuntimeMemoryInspectionIntent(messages));
}

function normalizeMessageText(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): string {
  return messageContentText(message.content).replace(/\s+/g, " ").toLowerCase();
}

function hasStrictJsonOnlyWording(text: string): boolean {
  if (!text.includes("json")) return false;
  const jsonTarget = /json(?:\s+(?:object|array|document|payload))?\b/;
  return new RegExp(
    String.raw`\b(?:return|respond|reply|output)\s+(?:with\s+)?only\s+(?:(?:a|the)\s+)?(?:single\s+)?(?:valid\s+)?${jsonTarget.source}`,
  ).test(text)
    || /\b(?:return|respond|reply|output)\s+[^.]{0,80}\bjson\s+only\b/.test(text)
    || new RegExp(String.raw`\bonly\s+(?:(?:a|the)\s+)?(?:single\s+)?(?:valid\s+)?${jsonTarget.source}`).test(text);
}

function hasInternalStructuredInstruction(text: string): boolean {
  return /\b(?:extract|classify|label|parse|lint|revise|summari[sz]e)\b/.test(text)
    || /\bscore\s+(?:this|the|each|every|request|source|transcript|conversation|payload)\b/.test(text)
    || /\b(?:from|using|of)\s+(?:(?:this|the)\s+)?(?:transcript|source|payload|conversation)\b/.test(text)
    || /\b(?:transcript|source|payload|conversation)\s+(?:text|content)\b/.test(text);
}

export function isStrictJsonOnlyRequest(body: ChatCreateBody): boolean {
  const normalizedMessages = body.messages.map((message) => ({
    role: String(message.role),
    text: normalizeMessageText(message),
  }));
  const instructionTexts = normalizedMessages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.text)
    .filter(hasStrictJsonOnlyWording);
  const lastUserText = [...normalizedMessages].reverse().find((message) => message.role === "user")?.text ?? "";
  if (
    !instructionTexts.some(hasInternalStructuredInstruction) &&
    directlyRequestsRuntimeStateContext(body.messages, lastUserText)
  ) {
    return false;
  }
  const candidateTexts = instructionTexts.length > 0 ? instructionTexts : [lastUserText].filter(hasStrictJsonOnlyWording);
  if (candidateTexts.length === 0) return false;
  return !candidateTexts.some(requestsRuntimeStateContext);
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
    disableRuntimeStateCard: options.disableRuntimeStateCard ?? isStrictJsonOnlyRequest(body),
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
  shimOptions: RoutedOpenAIChatShimOptions = {},
): Pick<OpenAI, "chat"> {
  return {
    chat: {
      completions: {
        create: (body: ChatCreateBody, requestOptions?: { signal?: AbortSignal }) =>
          createRoutedChatCompletion(
            body,
            {
              signal: requestOptions?.signal,
              tier,
              logPrefix,
              disableRuntimeStateCard: shimOptions.disableRuntimeStateCard,
            },
            shimOptions.runner,
          ),
      },
    },
  } as Pick<OpenAI, "chat">;
}
