import type OpenAI from "openai";

import type { FallbackChainEntry } from "../agent/providers/fallback";
import type { ProviderTurnResult } from "../agent/providers/base";
import {
  loadRuntimeProfileStateFromDb,
  type RuntimeProfileState,
} from "./stateCard";

type RuntimeIdentityIntent =
  | "assistant_identity"
  | "user_identity"
  | "active_model";

type RuntimeIdentityProfileResolver = (userId: string) => Promise<RuntimeProfileState | null>;

let runtimeIdentityProfileResolverForTesting: RuntimeIdentityProfileResolver | null = null;

export function _setRuntimeIdentityProfileResolverForTesting(
  resolver: RuntimeIdentityProfileResolver | null,
): void {
  runtimeIdentityProfileResolverForTesting = resolver;
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

function latestUserText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyRuntimeIdentityIntent(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): RuntimeIdentityIntent | null {
  const normalized = normalizeQuestion(latestUserText(messages));
  if (!normalized) return null;

  if (/^(?:who are you|what are you|what is your name|whats your name|are you jarvis|who is jarvis)$/.test(normalized)) {
    return "assistant_identity";
  }

  if (/^(?:who am i|what is my name|whats my name|what should you call me|what do you call me|do you know my name)$/.test(normalized)) {
    return "user_identity";
  }

  if (/^(?:what model are you using|which model are you using|what model are you on|what model profile are you using|what local model are you using|are you using gemma)$/.test(normalized)) {
    return "active_model";
  }

  return null;
}

export function runtimeModelLabelForRoute(entry: FallbackChainEntry | undefined): string {
  if (!entry) return "Unknown";

  if (entry.providerName === "android-local-gemma") return "Local";
  if (entry.providerName === "local-llama") return "Local";
  if (entry.providerName === "anthropic") return "Claude";
  if (entry.providerName === "google") return "Gemini";
  if (entry.providerName === "chatgpt-codex-oauth") return "Codex";
  if (entry.providerName === "openai") return "ChatGPT";
  if (entry.providerName === "openai-compatible") {
    const model = entry.model.toLowerCase();
    if (model.startsWith("deepseek/")) return "DeepSeek";
    if (model.startsWith("openrouter/")) return "OpenRouter";
    if (model.startsWith("groq/")) return "Groq";
    if (model.startsWith("modelrelay/")) return "ModelRelay";
    if (model.includes("llama") || model.includes("local")) return "Local";
    return "OpenAI-compatible";
  }

  const model = entry.model.toLowerCase();
  if (model.startsWith("anthropic/") || model.includes("claude")) return "Claude";
  if (model.startsWith("google/") || model.includes("gemini")) return "Gemini";
  if (model.startsWith("deepseek/")) return "DeepSeek";
  if (model.startsWith("modelrelay/")) return "ModelRelay";
  if (
    model.includes("llama") ||
    model.includes("local")
  ) {
    return "Local";
  }
  return "Unknown";
}

async function loadRuntimeIdentityProfile(userId: string): Promise<RuntimeProfileState | null> {
  const resolver = runtimeIdentityProfileResolverForTesting ?? loadRuntimeProfileStateFromDb;
  return resolver(userId);
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

export async function answerRuntimeIdentityQuestion(input: {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  userId?: string;
  route: FallbackChainEntry | undefined;
  assistantName?: string;
}): Promise<ProviderTurnResult | null> {
  const intent = classifyRuntimeIdentityIntent(input.messages);
  if (!intent) return null;

  const assistantName = input.assistantName?.trim() || "Jarvis";
  const activeModelLabel = runtimeModelLabelForRoute(input.route);

  if (intent === "assistant_identity") {
    return providerTurnResult(
      `I'm ${assistantName}. ${activeModelLabel} is the selected reasoning engine for this turn; it is not my identity.`,
      input.route,
    );
  }

  if (intent === "active_model") {
    return providerTurnResult(
      `I'm ${assistantName}. This turn is using ${activeModelLabel}.`,
      input.route,
    );
  }

  if (!input.userId?.trim()) {
    return providerTurnResult(
      "Authentication/runtime error: Jarvis needs a signed-in user before answering who the current user is.",
      input.route,
    );
  }
  let profile: RuntimeProfileState | null = null;
  try {
    profile = await loadRuntimeIdentityProfile(input.userId!.trim());
  } catch (error) {
    console.warn("[RuntimeIdentity] profile state unavailable:", error);
    return providerTurnResult(
      "Authentication/runtime error: I can see a signed-in Jarvis user, but profile state is unavailable right now.",
      input.route,
    );
  }
  const preferredName = profile?.preferredName?.trim();
  if (preferredName) {
    return providerTurnResult(
      `You are ${preferredName}. I know that from your Jarvis profile.`,
      input.route,
    );
  }

  return providerTurnResult(
    "I know your signed-in Jarvis account, but I don't have a preferred name saved yet. What should I call you?",
    input.route,
  );
}
