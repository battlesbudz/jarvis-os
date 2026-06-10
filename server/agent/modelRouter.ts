import type OpenAI from "openai";
import type { ProviderName } from "./providers";
import {
  getGlobalFallbackChain,
  queryWithFallback,
  queryWithFallbackStreaming,
  type FallbackChainEntry,
} from "./providers/fallback";
import type { ProviderChunk, ProviderResponseFormat, ProviderTurnResult } from "./providers/base";
import { getProviderEnvValue, hasCodexOAuthProvider, hasDirectOpenAIProvider, hasProviderEnvValue } from "./providers/env";
import {
  getProviderStatus,
  type ProviderAuthType,
  type ProviderStatus,
} from "./providers/modelProviderAuthProfiles";
import { DEFAULT_CODEX_OAUTH_MODEL, getCodexOAuthModel } from "./runtimeModel";

export type ModelTier = "prime" | "smart" | "cheap" | "free";
export type TaskComplexity = "trivial" | "easy" | "medium" | "hard";
export type TaskPrivacyLevel = "public" | "internal" | "sensitive";
export type ModelExecutionTier = "cheap" | "balanced" | "smart";

export interface ModelRoutingOptions {
  enabled?: boolean;
  /**
   * Force a tier for controlled callers, e.g. a background job that has
   * already been reviewed by the prime agent and is known to be safe.
   */
  forceTier?: ModelTier;
  /**
   * Treat explicit model args as authoritative by default. Set this true only
   * for orchestrator-controlled delegation where prime Jarvis is intentionally
   * asking the router to override the default model.
   */
  allowOverrideExplicitModel?: boolean;
  /**
   * Free models should normally receive no tool access. Callers can loosen this
   * for hand-picked read-only tools later.
   */
  maxToolCountForFree?: number;
  privacyLevel?: TaskPrivacyLevel;
  taskType?: string;
  cheapModel?: string;
  maxInputChars?: number;
  allowWithTools?: boolean;
}

export interface ModelRoutingInput {
  requestedModel: string;
  explicitModel: boolean;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  toolCount: number;
  hasAndroidTools?: boolean;
  routing?: ModelRoutingOptions;
}

export interface ModelRoutingDecision {
  model: string;
  tier: ModelTier;
  complexity: TaskComplexity;
  privacyLevel: TaskPrivacyLevel;
  delegated: boolean;
  reason: string;
}

export interface RoutedModelTurnParams {
  tier: ModelExecutionTier;
  requestedModel?: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: "auto" | "required" | "none";
  maxCompletionTokens: number;
  responseFormat?: ProviderResponseFormat;
  stream?: boolean;
  userId?: string;
  signal?: AbortSignal;
  logPrefix?: string;
}

interface PreparedModelTurn {
  chain: FallbackChainEntry[];
  routedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

interface SelectedModelRoute {
  chain: FallbackChainEntry[];
  isExplicit: boolean;
}

interface SelectedModelPreferenceState {
  model: string | null;
  isExplicit: boolean;
}

type ProviderStatusResolver = (input: { userId: string }) => Promise<ProviderStatus>;
type UserSelectedModelResolver = (input: { userId: string }) => Promise<string | null | SelectedModelPreferenceState>;

let providerStatusResolverForTesting: ProviderStatusResolver | null = null;
let userSelectedModelResolverForTesting: UserSelectedModelResolver | null = null;

export function _setOpenAIProviderStatusResolverForTesting(
  resolver: ProviderStatusResolver | null,
): void {
  providerStatusResolverForTesting = resolver;
}

export function _setUserSelectedModelResolverForTesting(
  resolver: UserSelectedModelResolver | null,
): void {
  userSelectedModelResolverForTesting = resolver;
}

export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  prime: DEFAULT_CODEX_OAUTH_MODEL,
  smart: DEFAULT_CODEX_OAUTH_MODEL,
  cheap: DEFAULT_CODEX_OAUTH_MODEL,
  free: DEFAULT_CODEX_OAUTH_MODEL,
};

function pushUnique(chain: FallbackChainEntry[], entry: FallbackChainEntry): void {
  const key = `${entry.providerName}:${entry.model}`;
  if (!chain.some((item) => `${item.providerName}:${item.model}` === key)) {
    chain.push(entry);
  }
}

function strictCodexOAuthEntry(): FallbackChainEntry | null {
  if (!hasCodexOAuthProvider()) return null;
  return {
    providerName: "chatgpt-codex-oauth",
    model: getCodexOAuthModel(),
  };
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
    .join("\n");
}

function parseModelSpec(spec: string | undefined): FallbackChainEntry | null {
  const raw = spec?.trim();
  if (!raw) return null;

  const colonIdx = raw.indexOf(":");
  if (colonIdx > 0) {
    const provider = raw.slice(0, colonIdx).trim() as ProviderName;
    const model = raw.slice(colonIdx + 1).trim();
    if ((provider === "openai" || provider === "openai-compatible" || provider === "chatgpt-codex-oauth" || provider === "anthropic" || provider === "google") && model) {
      return { providerName: provider, model };
    }
  }

  if (raw.startsWith("anthropic/")) {
    return { providerName: "anthropic", model: raw.slice("anthropic/".length) };
  }
  if (raw.startsWith("google/")) {
    return { providerName: "google", model: raw.slice("google/".length) };
  }
  if (raw.startsWith("openai/")) {
    return { providerName: "openai", model: raw.slice("openai/".length) };
  }
  if (
    raw.startsWith("chatgpt-codex-oauth/") ||
    raw.startsWith("codex-oauth/")
  ) {
    return { providerName: "chatgpt-codex-oauth", model: raw };
  }
  if (
    raw.startsWith("modelrelay/") ||
    raw.startsWith("openai-compatible/") ||
    raw.startsWith("openrouter/") ||
    raw.startsWith("groq/") ||
    raw.startsWith("together/") ||
    raw.startsWith("fireworks/") ||
    raw.startsWith("cerebras/") ||
    raw.startsWith("nvidia/") ||
    raw.startsWith("deepseek/")
  ) {
    return { providerName: "openai-compatible", model: raw };
  }

  return { providerName: "openai-compatible", model: `openai-compatible/${raw}` };
}

function parseRequestedModelSpec(spec: string | undefined): FallbackChainEntry | null {
  const raw = spec?.trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();

  const colonIdx = normalized.indexOf(":");
  if (colonIdx > 0) {
    const provider = normalized.slice(0, colonIdx).trim();
    if (
      provider === "openai" ||
      provider === "openai-compatible" ||
      provider === "chatgpt-codex-oauth" ||
      provider === "anthropic" ||
      provider === "google"
    ) {
      return parseModelSpec(raw);
    }
  }

  if (
    normalized.startsWith("openai/") ||
    normalized.startsWith("anthropic/") ||
    normalized.startsWith("google/") ||
    normalized.startsWith("chatgpt-codex-oauth/") ||
    normalized.startsWith("codex-oauth/") ||
    normalized.startsWith("modelrelay/") ||
    normalized.startsWith("openai-compatible/") ||
    normalized.startsWith("openrouter/") ||
    normalized.startsWith("groq/") ||
    normalized.startsWith("together/") ||
    normalized.startsWith("fireworks/") ||
    normalized.startsWith("cerebras/") ||
    normalized.startsWith("nvidia/") ||
    normalized.startsWith("deepseek/")
  ) {
    return parseModelSpec(raw);
  }

  return null;
}

function envModelForExecutionTier(tier: ModelExecutionTier): FallbackChainEntry | null {
  const specific =
    tier === "cheap"
      ? process.env.JARVIS_CHEAP_MODEL
      : tier === "smart"
        ? process.env.JARVIS_SMART_MODEL
        : process.env.JARVIS_BALANCED_MODEL;

  return parseModelSpec(specific ?? process.env.JARVIS_DEFAULT_MODEL);
}

export function getLastUserText(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") return textFromContent(msg.content).trim();
  }
  return "";
}

export function classifyTaskPrivacy(text: string): TaskPrivacyLevel {
  const lower = text.toLowerCase();
  const sensitiveSignals = [
    "password",
    "token",
    "api key",
    "secret",
    "medical",
    "diagnosis",
    "therapy",
    "legal",
    "lawsuit",
    "tax",
    "bank",
    "ssn",
    "social security",
    "private email",
    "confidential",
  ];
  if (sensitiveSignals.some((s) => lower.includes(s))) return "sensitive";
  if (/\b(email|calendar|meeting|client|customer|contract|invoice)\b/i.test(text)) return "internal";
  return "public";
}

export function classifyTaskComplexity(text: string): TaskComplexity {
  const trimmed = text.trim();
  if (!trimmed) return "easy";
  const lower = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/).filter(Boolean).length;

  if (/\b(strategy|architecture|debug|root cause|diagnose|implement|refactor|design|research deeply|compare options)\b/.test(lower)) {
    return "hard";
  }

  if (/\b(plan|analyze|synthesize|prioritize|draft an email|write a proposal|summarize this article|research)\b/.test(lower)) {
    return words > 80 ? "hard" : "medium";
  }

  if (/^(title|tag|label)\b/.test(lower) && words <= 8) return "trivial";

  if (/\b(rewrite|summarize|classify|tag|title|extract|format|clean up|spellcheck|grammar|make this shorter)\b/.test(lower)) {
    return words > 250 ? "medium" : "easy";
  }

  if (words <= 30) return "trivial";
  if (words <= 120) return "easy";
  if (words <= 300) return "medium";
  return "hard";
}

function isRoutingEnabled(opts?: ModelRoutingOptions): boolean {
  if (opts?.enabled != null) return opts.enabled;
  return process.env.JARVIS_MODEL_ROUTING === "1" || process.env.JARVIS_MODEL_ROUTING === "true";
}

function chooseTier(complexity: TaskComplexity, privacyLevel: TaskPrivacyLevel): ModelTier {
  if (privacyLevel === "sensitive") return "prime";
  if (complexity === "trivial" || complexity === "easy") return "free";
  if (complexity === "medium") return "cheap";
  return "prime";
}

function messageTextSize(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, message) => sum + textFromContent(message.content).length, 0);
}

function hasToolMessages(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  return messages.some((message) => message.role === "tool");
}

function toolSchemaTextSize(tools?: OpenAI.Chat.Completions.ChatCompletionTool[]): number {
  if (!tools?.length) return 0;
  try {
    return JSON.stringify(tools).length;
  } catch {
    return tools.length * 1000;
  }
}

function needsPersonalJarvisContext(text: string): boolean {
  const lower = text.toLowerCase();
  const personalSignals = [
    "my task", "my tasks", "my plan", "my plans", "my goal", "my goals",
    "my memory", "my memories", "remember", "about me", "who am i",
    "what do you know about me", "commitment", "commitments", "calendar",
    "schedule", "meeting", "email", "gmail", "inbox", "telegram", "discord",
    "slack", "profile", "dashboard", "stats", "xp", "habit", "habits",
    "document", "documents", "file", "files", "code", "repo", "repository",
    "screen", "phone", "daemon",
  ];
  return personalSignals.some((signal) => lower.includes(signal));
}

function likelyNeedsToolAccess(text: string): boolean {
  const actionObjectSignals = [
    /\b(create|make|draft|write|generate|add|schedule)\b.{0,40}\b(task|todo|reminder|calendar|event|meeting|email|gmail|message|notification|document|file|app|site|website|page|feature|code|repo|repository|image|photo|video)\b/i,
    /\b(build|edit|fix|implement|code|deploy|commit|push|open|tap|screenshot|send|notify)\b/i,
  ];
  if (actionObjectSignals.some((pattern) => pattern.test(text))) return true;

  return /\b(weather|forecast|temperature|rain|search|look up|current|today|tomorrow|news|stock|sports|calendar|meeting|email|gmail|phone|daemon)\b/i.test(text);
}

function buildLeanSystemPrompt(): string {
  return [
    "You are GamePlan Coach, Jarvis's chat persona.",
    "Answer the user's latest message directly and keep it concise.",
    "Use only the context included in this request. Do not invent memories, files, user data, live research, or tool results.",
    "If the user asks for current information or an action and a relevant tool is available, use it. If the needed tool or API is unavailable, say that plainly.",
  ].join("\n");
}

function maybeUseLeanContext(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  logPrefix: string,
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (process.env.JARVIS_LEAN_CONTEXT === "0") return messages;

  const inputChars = messageTextSize(messages);
  const toolChars = toolSchemaTextSize(tools);
  const totalChars = inputChars + toolChars;
  const maxChars = Number(process.env.JARVIS_LEAN_CONTEXT_CHAR_LIMIT || 12000);
  if (totalChars <= maxChars) return messages;

  if (hasToolMessages(messages)) return messages;

  const lastUserText = getLastUserText(messages);
  const complexity = classifyTaskComplexity(lastUserText);
  const lastUserWordCount = lastUserText.split(/\s+/).filter(Boolean).length;
  const isShortPlanningAnswer =
    complexity === "medium" &&
    lastUserWordCount <= 40 &&
    /\b(plan|outline|checklist|bullet|bullets|steps)\b/i.test(lastUserText);
  if (complexity !== "trivial" && complexity !== "easy" && !isShortPlanningAnswer) return messages;
  if (needsPersonalJarvisContext(lastUserText)) return messages;
  if (tools?.length && likelyNeedsToolAccess(lastUserText)) return messages;

  const historyLimit = Math.max(1, Number(process.env.JARVIS_LEAN_CONTEXT_HISTORY_MESSAGES || 4));
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const leanMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildLeanSystemPrompt() },
    ...nonSystemMessages.slice(-historyLimit),
  ];

  const leanChars = messageTextSize(leanMessages);
  console.log(
    `${logPrefix} lean_context: ${inputChars} chars + ${toolChars} tool chars -> ${leanChars} chars for ${complexity} non-tool request`,
  );

  return leanMessages;
}

function modelForEntry(entry: FallbackChainEntry): string {
  return entry.model;
}

export function routeModelForTask(input: ModelRoutingInput): ModelRoutingDecision {
  const text = getLastUserText(input.messages);
  const complexity = classifyTaskComplexity(text);
  const privacyLevel = input.routing?.privacyLevel ?? classifyTaskPrivacy(text);
  const requestedModel = input.requestedModel;

  if (requestedModel) {
    return {
      model: requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: false,
      reason: input.explicitModel ? "selected model preserved" : "global selected model preserved",
    };
  }

  if (!isRoutingEnabled(input.routing)) {
    return {
      model: requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: requestedModel !== input.requestedModel,
      reason: "model routing disabled",
    };
  }

  if (input.explicitModel && !input.routing?.allowOverrideExplicitModel) {
    return {
      model: requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: requestedModel !== input.requestedModel,
      reason: requestedModel === input.requestedModel ? "explicit model preserved" : "explicit model replaced by Codex OAuth runtime",
    };
  }

  if (input.hasAndroidTools) {
    return {
      model: requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: requestedModel !== input.requestedModel,
      reason: "android/tool-control tasks stay on prime model",
    };
  }

  const maxInputChars = input.routing?.maxInputChars ?? Number(process.env.JARVIS_MODEL_ROUTING_MAX_CHARS || 6000);
  const inputChars = messageTextSize(input.messages);
  if (inputChars > maxInputChars) {
    return {
      model: requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: requestedModel !== input.requestedModel,
      reason: `input too large (${inputChars} chars)`,
    };
  }

  const tier = input.routing?.forceTier ?? chooseTier(complexity, privacyLevel);
  if (tier === "free") {
    const maxToolCount = input.routing?.maxToolCountForFree ?? 0;
    if (input.toolCount > maxToolCount && !input.routing?.allowWithTools) {
      return {
        model: requestedModel,
        tier: "prime",
        complexity,
        privacyLevel,
        delegated: requestedModel !== input.requestedModel,
        reason: "free model blocked because tools are available",
      };
    }
  }

  const freeEntry = tier === "free"
    ? getModelRouteChain("cheap")[0] ?? parseModelSpec(input.routing?.cheapModel)
    : null;
  if (tier === "free" && !freeEntry) {
    return {
      model: requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: requestedModel !== input.requestedModel,
      reason: "no free/cheap provider configured",
    };
  }

  const model = tier === "free" ? modelForEntry(freeEntry!) : DEFAULT_TIER_MODELS[tier];

  return {
    model,
    tier,
    complexity,
    privacyLevel,
    delegated: model !== input.requestedModel,
    reason: `routed ${complexity}/${privacyLevel} task to ${tier} tier`,
  };
}

function configuredProviderEntries(tier: ModelExecutionTier): FallbackChainEntry[] {
  const chain: FallbackChainEntry[] = [];
  const strictCodex = strictCodexOAuthEntry();
  if (strictCodex) return [strictCodex];

  const envEntry = envModelForExecutionTier(tier);
  if (envEntry) pushUnique(chain, envEntry);

  const hasOpenAICompatible = hasProviderEnvValue("OPENAI_COMPATIBLE_BASE_URL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_BASE_URL");
  const hasOpenRouter = hasProviderEnvValue("OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENROUTER_API_KEY");
  const hasGroq = hasProviderEnvValue("GROQ_API_KEY", "AI_INTEGRATIONS_GROQ_API_KEY");
  const hasTogether = hasProviderEnvValue("TOGETHER_API_KEY", "AI_INTEGRATIONS_TOGETHER_API_KEY");
  const hasFireworks = hasProviderEnvValue("FIREWORKS_API_KEY", "AI_INTEGRATIONS_FIREWORKS_API_KEY");
  const hasCerebras = hasProviderEnvValue("CEREBRAS_API_KEY", "AI_INTEGRATIONS_CEREBRAS_API_KEY");
  const hasNvidia = hasProviderEnvValue("NVIDIA_API_KEY", "AI_INTEGRATIONS_NVIDIA_API_KEY");
  const hasDeepSeek = hasProviderEnvValue("DEEPSEEK_API_KEY", "AI_INTEGRATIONS_DEEPSEEK_API_KEY");
  const hasOpenAI = hasDirectOpenAIProvider();
  const hasCodexOAuth = hasCodexOAuthProvider();

  const compatibleModel =
    getProviderEnvValue("OPENAI_COMPATIBLE_MODEL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_MODEL")
      ? `openai-compatible/${getProviderEnvValue("OPENAI_COMPATIBLE_MODEL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_MODEL")}`
      : "openai-compatible/auto-fastest";
  const openRouterDefaultModel = getProviderEnvValue("OPENROUTER_MODEL", "AI_INTEGRATIONS_OPENROUTER_MODEL") || "openrouter/auto";
  const openRouterModel =
    tier === "smart"
      ? getProviderEnvValue("OPENROUTER_SMART_MODEL", "AI_INTEGRATIONS_OPENROUTER_SMART_MODEL") || openRouterDefaultModel
      : getProviderEnvValue("OPENROUTER_CHEAP_MODEL", "AI_INTEGRATIONS_OPENROUTER_CHEAP_MODEL") || openRouterDefaultModel;
  const groqDefaultModel = getProviderEnvValue("GROQ_MODEL", "AI_INTEGRATIONS_GROQ_MODEL");
  const groqModel =
    tier === "smart"
      ? getProviderEnvValue("GROQ_SMART_MODEL", "AI_INTEGRATIONS_GROQ_SMART_MODEL") || groqDefaultModel || "llama-3.3-70b-versatile"
      : getProviderEnvValue("GROQ_CHEAP_MODEL", "AI_INTEGRATIONS_GROQ_CHEAP_MODEL") || groqDefaultModel || "llama-3.1-8b-instant";

  const openaiModel =
    tier === "smart"
      ? process.env.JARVIS_OPENAI_SMART_MODEL || "gpt-4.1"
      : process.env.JARVIS_OPENAI_BALANCED_MODEL || "gpt-4.1-mini";
  const codexOAuthModel = getCodexOAuthModel();

  if (tier === "cheap") {
    if (hasCodexOAuth) pushUnique(chain, { providerName: "chatgpt-codex-oauth", model: codexOAuthModel });
    if (hasGroq) pushUnique(chain, { providerName: "openai-compatible", model: `groq/${groqModel}` });
    if (hasOpenRouter) pushUnique(chain, { providerName: "openai-compatible", model: `openrouter/${openRouterModel}` });
    if (hasTogether) pushUnique(chain, { providerName: "openai-compatible", model: `together/${getProviderEnvValue("TOGETHER_MODEL", "AI_INTEGRATIONS_TOGETHER_MODEL") || "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"}` });
    if (hasFireworks) pushUnique(chain, { providerName: "openai-compatible", model: `fireworks/${getProviderEnvValue("FIREWORKS_MODEL", "AI_INTEGRATIONS_FIREWORKS_MODEL") || "accounts/fireworks/models/llama-v3p1-8b-instruct"}` });
    if (hasCerebras) pushUnique(chain, { providerName: "openai-compatible", model: `cerebras/${getProviderEnvValue("CEREBRAS_MODEL", "AI_INTEGRATIONS_CEREBRAS_MODEL") || "llama3.1-8b"}` });
    if (hasNvidia) pushUnique(chain, { providerName: "openai-compatible", model: `nvidia/${getProviderEnvValue("NVIDIA_MODEL", "AI_INTEGRATIONS_NVIDIA_MODEL") || "meta/llama-3.1-8b-instruct"}` });
    if (hasDeepSeek) pushUnique(chain, { providerName: "openai-compatible", model: `deepseek/${getProviderEnvValue("DEEPSEEK_MODEL", "AI_INTEGRATIONS_DEEPSEEK_MODEL") || "deepseek-chat"}` });
    if (hasOpenAICompatible) pushUnique(chain, { providerName: "openai-compatible", model: compatibleModel });
    if (hasOpenAI) pushUnique(chain, { providerName: "openai", model: "gpt-4.1-mini" });
    return chain;
  }

  if (tier === "smart") {
    if (hasCodexOAuth) pushUnique(chain, { providerName: "chatgpt-codex-oauth", model: codexOAuthModel });
    if (hasOpenAI) pushUnique(chain, { providerName: "openai", model: openaiModel });
    if (hasOpenRouter) pushUnique(chain, { providerName: "openai-compatible", model: `openrouter/${openRouterModel}` });
    if (hasGroq) pushUnique(chain, { providerName: "openai-compatible", model: `groq/${groqModel}` });
    if (hasDeepSeek) pushUnique(chain, { providerName: "openai-compatible", model: `deepseek/${getProviderEnvValue("DEEPSEEK_MODEL", "AI_INTEGRATIONS_DEEPSEEK_MODEL") || "deepseek-chat"}` });
    if (hasOpenAICompatible) pushUnique(chain, { providerName: "openai-compatible", model: compatibleModel });
    return chain;
  }

  if (hasCodexOAuth) pushUnique(chain, { providerName: "chatgpt-codex-oauth", model: codexOAuthModel });
  if (hasOpenRouter) pushUnique(chain, { providerName: "openai-compatible", model: `openrouter/${openRouterModel}` });
  if (hasGroq) pushUnique(chain, { providerName: "openai-compatible", model: `groq/${groqModel}` });
  if (hasDeepSeek) pushUnique(chain, { providerName: "openai-compatible", model: `deepseek/${getProviderEnvValue("DEEPSEEK_MODEL", "AI_INTEGRATIONS_DEEPSEEK_MODEL") || "deepseek-chat"}` });
  if (hasOpenAICompatible) pushUnique(chain, { providerName: "openai-compatible", model: compatibleModel });
  if (hasOpenAI) pushUnique(chain, { providerName: "openai", model: openaiModel });
  return chain;
}

export function getModelRouteChain(tier: ModelExecutionTier): FallbackChainEntry[] {
  const strictCodex = strictCodexOAuthEntry();
  if (strictCodex) return [strictCodex];

  const globalChain = getGlobalFallbackChain();
  if (globalChain) return globalChain;
  return configuredProviderEntries(tier);
}

function openAIModelForExecutionTier(tier: ModelExecutionTier): string {
  if (tier === "smart") return process.env.JARVIS_OPENAI_SMART_MODEL || "gpt-4.1";
  return process.env.JARVIS_OPENAI_BALANCED_MODEL || "gpt-4.1-mini";
}

async function getUserOpenAIRouteChain(
  userId: string | undefined,
  tier: ModelExecutionTier,
  logPrefix: string,
): Promise<FallbackChainEntry[] | null> {
  if (!userId) return null;

  const resolver = providerStatusResolverForTesting ?? getProviderStatus;
  try {
    const status = await resolver({ userId });
    if (!status.openai.connected || !status.openai.defaultAuthType) return null;
    return [{ providerName: "openai", model: openAIModelForExecutionTier(tier) }];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} provider_auth_status_unavailable: ${message.slice(0, 160)}`);
    return null;
  }
}

function defaultRouteForProviderProfile(
  providerId: string,
  authType: ProviderAuthType | null,
  tier: ModelExecutionTier,
): FallbackChainEntry | null {
  if (!authType) return null;
  if (providerId === "google") {
    return { providerName: "google", model: "gemini-2.5-flash" };
  }
  if (providerId === "anthropic") {
    return { providerName: "anthropic", model: "claude-sonnet-4-5" };
  }
  if (providerId === "local-llama") {
    return { providerName: "openai-compatible", model: "openai-compatible/llama-local" };
  }
  if (providerId === "openai") {
    return { providerName: "openai", model: openAIModelForExecutionTier(tier) };
  }
  return null;
}

function isCodexOAuthRouteEntry(entry: FallbackChainEntry | null | undefined): boolean {
  if (!entry) return false;
  const model = entry.model.toLowerCase();
  return entry.providerName === "chatgpt-codex-oauth" ||
    model.startsWith("chatgpt-codex-oauth/") ||
    model.startsWith("codex-oauth/");
}

function isCodexOnlyRouteChain(chain: FallbackChainEntry[] | null | undefined): boolean {
  return !!chain && chain.length === 1 && isCodexOAuthRouteEntry(chain[0]);
}

function normalizeSelectedModelPreferenceState(
  value: string | null | SelectedModelPreferenceState,
): SelectedModelPreferenceState {
  if (value && typeof value === "object") return value;
  return { model: value, isExplicit: false };
}

async function getUserDefaultProviderProfileRouteChain(
  userId: string | undefined,
  tier: ModelExecutionTier,
  logPrefix: string,
): Promise<FallbackChainEntry[] | null> {
  if (!userId) return null;

  const resolver = providerStatusResolverForTesting ?? getProviderStatus;
  try {
    const status = await resolver({ userId });
    for (const providerId of ["google", "anthropic", "local-llama"]) {
      const provider = status.providers[providerId];
      if (!provider?.connected || !provider.defaultAuthType) continue;
      const route = defaultRouteForProviderProfile(providerId, provider.defaultAuthType, tier);
      // A connected provider profile is a user-level routing choice. Keep this
      // single-entry so runtime defaults cannot silently switch surfaces back
      // to Codex/OpenAI when the selected provider has a transient failure.
      if (route) return [route];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} provider_profile_status_unavailable: ${message.slice(0, 160)}`);
  }

  return null;
}

export async function getUserSelectedModelRouteChain(
  userId: string | undefined,
  logPrefix: string,
): Promise<SelectedModelRoute | null> {
  if (!userId) return null;

  try {
    const resolver = userSelectedModelResolverForTesting ?? (async ({ userId: selectedUserId }) => {
      const { getSelectedModelPreferenceState } = await import("../lib/modelPrefs");
      return getSelectedModelPreferenceState(selectedUserId);
    });
    const selectedState = normalizeSelectedModelPreferenceState(await resolver({ userId }));
    const selectedModel = selectedState.model;
    const selectedEntry = parseRequestedModelSpec(selectedModel ?? undefined);
    if (selectedEntry) {
      return {
        chain: [selectedEntry],
        isExplicit: selectedState.isExplicit,
      };
    }
    if (selectedModel) {
      console.warn(`${logPrefix} selected_model_unroutable: ${selectedModel}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} selected_model_unavailable: ${message.slice(0, 160)}`);
  }

  return null;
}

export async function routeModelTurn(params: RoutedModelTurnParams): Promise<ProviderTurnResult> {
  const logPrefix = params.logPrefix ?? `[ModelRouter:${params.tier}]`;
  const prepared = await prepareModelTurn(params, logPrefix);

  return queryWithFallback(
    prepared.chain,
    {
      model: prepared.chain[0].model,
      messages: prepared.routedMessages,
      tools: prepared.routedMessages !== params.messages ? undefined : params.tools,
      toolChoice: prepared.routedMessages !== params.messages ? "none" : (params.toolChoice ?? "none"),
      maxCompletionTokens: params.maxCompletionTokens,
      responseFormat: params.responseFormat,
      stream: params.stream ?? false,
      userId: params.userId,
      signal: params.signal,
    },
    logPrefix,
  );
}

export async function streamModelTurn(
  params: RoutedModelTurnParams,
  onChunk: (chunk: ProviderChunk) => void | Promise<void>,
): Promise<ProviderTurnResult> {
  const logPrefix = params.logPrefix ?? `[ModelRouter:${params.tier}]`;
  const prepared = await prepareModelTurn(params, logPrefix);

  return queryWithFallbackStreaming(
    prepared.chain,
    {
      model: prepared.chain[0].model,
      messages: prepared.routedMessages,
      tools: prepared.routedMessages !== params.messages ? undefined : params.tools,
      toolChoice: prepared.routedMessages !== params.messages ? "none" : (params.toolChoice ?? "none"),
      maxCompletionTokens: params.maxCompletionTokens,
      responseFormat: params.responseFormat,
      stream: true,
      userId: params.userId,
      signal: params.signal,
    },
    logPrefix,
    onChunk,
  );
}

async function prepareModelTurn(
  params: RoutedModelTurnParams,
  logPrefix: string,
): Promise<PreparedModelTurn> {
  const routedMessages = maybeUseLeanContext(params.messages, logPrefix, params.tools);
  const leanContextApplied = routedMessages !== params.messages;
  const requestedEntry = parseRequestedModelSpec(params.requestedModel);
  const selectedRoute = await getUserSelectedModelRouteChain(params.userId, logPrefix);
  const selectedChain = selectedRoute?.chain ?? null;
  const requestedChain = requestedEntry ? [requestedEntry] : null;
  const selectedCodexIsStaleDefault = isCodexOnlyRouteChain(selectedChain) && !selectedRoute?.isExplicit;
  const chain = (!selectedCodexIsStaleDefault ? selectedChain : null)
    ?? (!isCodexOnlyRouteChain(requestedChain) ? requestedChain : null)
    ?? (await getUserDefaultProviderProfileRouteChain(params.userId, params.tier, logPrefix))
    ?? selectedChain
    ?? requestedChain
    ?? (await getUserOpenAIRouteChain(params.userId, params.tier, logPrefix))
    ?? getModelRouteChain(params.tier);
  if (chain.length === 0) {
    throw new Error(
      "No model providers configured. Enable ChatGPT/Codex OAuth or another explicitly approved provider variable.",
    );
  }

  console.log(
    `${logPrefix} route tier=${params.tier} candidates=${chain
      .map((entry) => `${entry.providerName}(${entry.model})`)
      .join(" -> ")}`,
  );

  if (leanContextApplied && params.tools?.length) {
    console.log(`${logPrefix} lean_context: omitted ${params.tools.length} tool schema(s)`);
  }

  return {
    chain,
    routedMessages,
  };
}
