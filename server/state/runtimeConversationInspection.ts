import type OpenAI from "openai";

import type { ProviderTurnResult } from "../agent/providers/base";
import type { FallbackChainEntry } from "../agent/providers/fallback";

type ConversationInspectionIntent =
  | { kind: "previous_user_message" }
  | { kind: "previous_assistant_message" }
  | { kind: "repeat_previous_assistant_message" };

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

function latestUserText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function cleanQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/['`\u2018\u2019]/g, "")
    .replace(/[?!.;,:\-\u2013\u2014]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function messageHasStrictJsonOnlyWording(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): boolean {
  if (message.role !== "system" && message.role !== "developer") return false;
  const text = cleanQuestion(textFromContent(message.content));
  if (!text.includes("json")) return false;
  return /\b(?:return|respond|reply|output)\s+(?:with\s+)?only\s+(?:(?:a|the)\s+)?(?:single\s+)?(?:valid\s+)?json(?:\s+(?:object|array|document|payload))?\b/.test(text)
    || /\b(?:return|respond|reply|output)\s+(?:with\s+)?(?:valid\s+)?json\s+only\b/.test(text)
    || /\b(?:return|respond|reply|output)\s+json\s+only\b/.test(text)
    || /\b(?:return|respond|reply|output)\s+(?:(?:a|the)\s+)?(?:single\s+)?(?:valid\s+)?json(?:\s+(?:object|array|document|payload))?\s+only\b/.test(text)
    || /\bonly\s+(?:(?:a|the)\s+)?(?:single\s+)?(?:valid\s+)?json(?:\s+(?:object|array|document|payload))?\b/.test(text);
}

export function hasPromptOnlyStrictJsonConversationContract(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): boolean {
  return messages.some(messageHasStrictJsonOnlyWording);
}

function messageHasShortcutBlockingInstruction(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): boolean {
  if (message.role !== "system" && message.role !== "developer") return false;
  const text = cleanQuestion(textFromContent(message.content));
  if (!text) return false;
  if (messageHasExplicitShortcutBlockingConstraint(message, text)) return true;
  if (isKnownSafeJarvisConversationInstruction(text)) return false;
  return true;
}

function messageHasExplicitShortcutBlockingConstraint(
  message: OpenAI.Chat.Completions.ChatCompletionMessageParam,
  text: string,
): boolean {
  return messageHasStrictJsonOnlyWording(message) ||
    /\b(?:answer|respond|reply|output)\b.{0,80}\b(?:french|spanish|german|italian|portuguese|chinese|japanese|korean|json|xml|yaml|markdown)\b/.test(text) ||
    /\b(?:do not|dont|never)\s+(?:quote|repeat|reveal|disclose)\b/.test(text);
}

function isKnownSafeJarvisConversationInstruction(text: string): boolean {
  return isKnownSafeStandardConversationInstruction(text) ||
    isKnownSafeLeanConversationInstruction(text);
}

function isKnownSafeStandardConversationInstruction(text: string): boolean {
  return text === "you are jarvis the jarvis chat runtime you can take actions on the users behalf using the available tools respond naturally and do not mention tool calls or functions to the user";
}

function isKnownSafeLeanConversationInstruction(text: string): boolean {
  return text === [
    "you are jarvis the jarvis chat runtime",
    "answer the users latest message directly and keep it concise",
    "use only the context included in this request do not invent memories files user data live research or tool results",
    "if the user asks for current information or an action and a relevant tool is available use it if the needed tool or api is unavailable say that plainly",
  ].join(" ");
}

export function hasShortcutBlockingConversationInstruction(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): boolean {
  return messages.some(messageHasShortcutBlockingInstruction);
}

function classifyConversationInspectionIntent(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): ConversationInspectionIntent | null {
  const text = cleanQuestion(latestUserText(messages));
  if (!text) return null;
  if (/^(?:hey\s+jarvis\s+)?what (?:was|is) my last message$/.test(text)) {
    return { kind: "previous_user_message" };
  }
  if (/^(?:hey\s+jarvis\s+)?what did i (?:just )?(?:say|ask)$/.test(text)) {
    return { kind: "previous_user_message" };
  }
  if (/^(?:hey\s+jarvis\s+)?what (?:was|is) (?:your|the assistant(?:s)?) last (?:message|response|reply)$/.test(text)) {
    return { kind: "previous_assistant_message" };
  }
  if (
    /^(?:hey\s+jarvis\s+)?(?:please\s+)?(?:say|repeat) (?:that|it)(?: again)?(?: please)?$/.test(text) ||
    /^(?:hey\s+jarvis\s+)?(?:can|could|would|will) you (?:please )?(?:say|repeat) (?:that|it)(?: again)?(?: please)?$/.test(text) ||
    /^(?:hey\s+jarvis\s+)?(?:please\s+)?repeat (?:yourself|your last (?:message|response|reply))(?: please)?$/.test(text) ||
    /^(?:hey\s+jarvis\s+)?(?:can|could|would|will) you (?:please )?repeat (?:yourself|your last (?:message|response|reply)|what you (?:just )?said)(?: please)?$/.test(text) ||
    /^(?:hey\s+jarvis\s+)?(?:please\s+)?repeat what you (?:just )?said(?: please)?$/.test(text) ||
    /^(?:hey\s+jarvis\s+)?what did you (?:just )?say$/.test(text)
  ) {
    return { kind: "repeat_previous_assistant_message" };
  }
  return null;
}

function findPriorMessageText(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  role: "user" | "assistant",
): { found: boolean; text: string | null } {
  let skippedCurrentUserQuestion = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "user" && !skippedCurrentUserQuestion) {
      skippedCurrentUserQuestion = true;
      continue;
    }
    if (message.role !== role) continue;
    const text = textFromContent(message.content).trim();
    return { found: true, text: text || null };
  }
  return { found: false, text: null };
}

function providerTurnResult(text: string, route: FallbackChainEntry | undefined): ProviderTurnResult {
  return {
    textContent: text,
    textChunks: [text],
    toolCallList: [],
    finishReason: "stop",
    providerName: "jarvis-runtime",
    model: route?.model,
    fallbackUsed: false,
  };
}

const utf8Encoder = new TextEncoder();

function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

function estimateShortcutTokens(text: string): number {
  return Math.ceil(utf8ByteLength(text) / 2);
}

function truncateForEstimatedTokenBudget(text: string, budget: number): string {
  if (estimateShortcutTokens(text) <= budget) return text;
  if (budget < 2) return "";

  const contentBudget = budget - estimateShortcutTokens("...");
  let output = "";
  let usedBytes = 0;
  for (const character of text) {
    const characterBytes = utf8ByteLength(character);
    if (Math.ceil((usedBytes + characterBytes) / 2) > contentBudget) break;
    output += character;
    usedBytes += characterBytes;
  }

  const trimmed = output.trimEnd();
  return trimmed ? `${trimmed}...` : "";
}

function boundedQuote(prefix: string, text: string, maxCompletionTokens: number | undefined): string {
  const budget = Math.max(0, maxCompletionTokens ?? 128);
  const quoteBudget = budget - estimateShortcutTokens(prefix);
  const quote = truncateForEstimatedTokenBudget(text, quoteBudget);
  return quote ? `${prefix}${quote}` : "";
}

function boundedFixedResponse(text: string, maxCompletionTokens: number | undefined): string {
  return estimateShortcutTokens(text) <= (maxCompletionTokens ?? 128) ? text : "";
}

export function answerRuntimeConversationInspectionQuestion(input: {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  route: FallbackChainEntry | undefined;
  maxCompletionTokens?: number;
}): ProviderTurnResult | null {
  const intent = classifyConversationInspectionIntent(input.messages);
  if (!intent) return null;

  const isPreviousUserMessage = intent.kind === "previous_user_message";
  const isRepeatRequest = intent.kind === "repeat_previous_assistant_message";
  const role = isPreviousUserMessage ? "user" : "assistant";
  const priorMessage = findPriorMessageText(input.messages, role);
  if (!priorMessage.found) {
    const response = boundedFixedResponse(
      isPreviousUserMessage
        ? "There is no previous user message in this conversation context."
        : isRepeatRequest
          ? "There is no previous assistant message in this conversation context to repeat."
          : "There is no previous assistant message in this conversation context.",
      input.maxCompletionTokens,
    );
    return response ? providerTurnResult(response, input.route) : null;
  }

  if (!priorMessage.text) {
    const response = boundedFixedResponse(
      isPreviousUserMessage
        ? "Your last message did not include any text I can quote from this conversation context."
        : isRepeatRequest
          ? "My previous message did not include any text I can repeat from this conversation context."
          : "My last message did not include any text I can quote from this conversation context.",
      input.maxCompletionTokens,
    );
    return response ? providerTurnResult(response, input.route) : null;
  }

  const response = isPreviousUserMessage
    ? boundedQuote("Your last message was: ", priorMessage.text, input.maxCompletionTokens)
    : isRepeatRequest
      ? boundedQuote("", priorMessage.text, input.maxCompletionTokens)
      : boundedQuote("My last message was: ", priorMessage.text, input.maxCompletionTokens);
  return response ? providerTurnResult(response, input.route) : null;
}
