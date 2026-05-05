import type OpenAI from "openai";
import type { ProviderName } from "./providers";
import { getGlobalFallbackChain, queryWithFallback, type FallbackChainEntry } from "./providers/fallback";
import type { ProviderTurnResult } from "./providers/base";

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
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: "auto" | "required" | "none";
  maxCompletionTokens: number;
  stream?: boolean;
  signal?: AbortSignal;
  logPrefix?: string;
}

export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  prime: process.env.JARVIS_PRIME_MODEL ?? "claude-opus-4-6",
  smart: process.env.JARVIS_SMART_MODEL ?? "gpt-4.1-mini",
  cheap: process.env.JARVIS_CHEAP_MODEL ?? "gpt-4o-mini",
  free: process.env.JARVIS_FREE_MODEL ?? "openrouter/openrouter/auto",
};

function hasEnvValue(...names: string[]): boolean {
  return names.some((name) => !!process.env[name]?.trim());
}

function pushUnique(chain: FallbackChainEntry[], entry: FallbackChainEntry): void {
  const key = `${entry.providerName}:${entry.model}`;
  if (!chain.some((item) => `${item.providerName}:${item.model}` === key)) {
    chain.push(entry);
  }
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
    if ((provider === "openai" || provider === "claude" || provider === "openai-compatible") && model) {
      return { providerName: provider, model };
    }
  }

  if (raw.startsWith("openai/")) {
    return { providerName: "openai", model: raw.slice("openai/".length) };
  }
  if (raw.startsWith("claude/")) {
    return { providerName: "claude", model: raw.slice("claude/".length) };
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

function modelForEntry(entry: FallbackChainEntry): string {
  return entry.model;
}

export function routeModelForTask(input: ModelRoutingInput): ModelRoutingDecision {
  const text = getLastUserText(input.messages);
  const complexity = classifyTaskComplexity(text);
  const privacyLevel = input.routing?.privacyLevel ?? classifyTaskPrivacy(text);

  if (!isRoutingEnabled(input.routing)) {
    return {
      model: input.requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: false,
      reason: "model routing disabled",
    };
  }

  if (input.explicitModel && !input.routing?.allowOverrideExplicitModel) {
    return {
      model: input.requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: false,
      reason: "explicit model preserved",
    };
  }

  if (input.hasAndroidTools) {
    return {
      model: input.requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: false,
      reason: "android/tool-control tasks stay on prime model",
    };
  }

  const maxInputChars = input.routing?.maxInputChars ?? Number(process.env.JARVIS_MODEL_ROUTING_MAX_CHARS || 6000);
  const inputChars = messageTextSize(input.messages);
  if (inputChars > maxInputChars) {
    return {
      model: input.requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: false,
      reason: `input too large (${inputChars} chars)`,
    };
  }

  const tier = input.routing?.forceTier ?? chooseTier(complexity, privacyLevel);
  if (tier === "free") {
    const maxToolCount = input.routing?.maxToolCountForFree ?? 0;
    if (input.toolCount > maxToolCount && !input.routing?.allowWithTools) {
      return {
        model: input.requestedModel,
        tier: "prime",
        complexity,
        privacyLevel,
        delegated: false,
        reason: "free model blocked because tools are available",
      };
    }
  }

  const freeEntry = tier === "free"
    ? parseModelSpec(input.routing?.cheapModel) ?? getModelRouteChain("cheap")[0]
    : null;
  if (tier === "free" && !freeEntry) {
    return {
      model: input.requestedModel,
      tier: "prime",
      complexity,
      privacyLevel,
      delegated: false,
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

  const envEntry = envModelForExecutionTier(tier);
  if (envEntry) pushUnique(chain, envEntry);

  const hasOpenAICompatible = hasEnvValue("OPENAI_COMPATIBLE_BASE_URL");
  const hasOpenRouter = hasEnvValue("OPENROUTER_API_KEY");
  const hasGroq = hasEnvValue("GROQ_API_KEY");
  const hasTogether = hasEnvValue("TOGETHER_API_KEY");
  const hasFireworks = hasEnvValue("FIREWORKS_API_KEY");
  const hasCerebras = hasEnvValue("CEREBRAS_API_KEY");
  const hasNvidia = hasEnvValue("NVIDIA_API_KEY");
  const hasDeepSeek = hasEnvValue("DEEPSEEK_API_KEY");
  const hasClaude = hasEnvValue("AI_INTEGRATIONS_ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_BASE_URL");
  const hasOpenAI = hasEnvValue("AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY");

  const compatibleModel =
    process.env.OPENAI_COMPATIBLE_MODEL
      ? `openai-compatible/${process.env.OPENAI_COMPATIBLE_MODEL}`
      : "openai-compatible/auto-fastest";
  const openRouterModel =
    tier === "smart"
      ? process.env.OPENROUTER_SMART_MODEL || process.env.OPENROUTER_MODEL || "openrouter/auto"
      : process.env.OPENROUTER_CHEAP_MODEL || process.env.OPENROUTER_MODEL || "openrouter/auto";
  const groqModel =
    tier === "smart"
      ? process.env.GROQ_SMART_MODEL || process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
      : process.env.GROQ_CHEAP_MODEL || process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  const openaiModel =
    tier === "smart"
      ? process.env.JARVIS_OPENAI_SMART_MODEL || "gpt-4.1"
      : process.env.JARVIS_OPENAI_BALANCED_MODEL || "gpt-4.1-mini";
  const claudeModel =
    tier === "smart"
      ? process.env.JARVIS_CLAUDE_SMART_MODEL || "claude-3-5-sonnet-latest"
      : process.env.JARVIS_CLAUDE_CHEAP_MODEL || "claude-3-5-haiku-latest";

  if (tier === "cheap") {
    if (hasGroq) pushUnique(chain, { providerName: "openai-compatible", model: `groq/${groqModel}` });
    if (hasOpenRouter) pushUnique(chain, { providerName: "openai-compatible", model: `openrouter/${openRouterModel}` });
    if (hasTogether) pushUnique(chain, { providerName: "openai-compatible", model: `together/${process.env.TOGETHER_MODEL || "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"}` });
    if (hasFireworks) pushUnique(chain, { providerName: "openai-compatible", model: `fireworks/${process.env.FIREWORKS_MODEL || "accounts/fireworks/models/llama-v3p1-8b-instruct"}` });
    if (hasCerebras) pushUnique(chain, { providerName: "openai-compatible", model: `cerebras/${process.env.CEREBRAS_MODEL || "llama3.1-8b"}` });
    if (hasNvidia) pushUnique(chain, { providerName: "openai-compatible", model: `nvidia/${process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct"}` });
    if (hasDeepSeek) pushUnique(chain, { providerName: "openai-compatible", model: `deepseek/${process.env.DEEPSEEK_MODEL || "deepseek-chat"}` });
    if (hasOpenAICompatible) pushUnique(chain, { providerName: "openai-compatible", model: compatibleModel });
    if (hasClaude) pushUnique(chain, { providerName: "claude", model: claudeModel });
    if (hasOpenAI) pushUnique(chain, { providerName: "openai", model: "gpt-4.1-mini" });
    return chain;
  }

  if (tier === "smart") {
    if (hasClaude) pushUnique(chain, { providerName: "claude", model: claudeModel });
    if (hasOpenAI) pushUnique(chain, { providerName: "openai", model: openaiModel });
    if (hasOpenRouter) pushUnique(chain, { providerName: "openai-compatible", model: `openrouter/${openRouterModel}` });
    if (hasGroq) pushUnique(chain, { providerName: "openai-compatible", model: `groq/${groqModel}` });
    if (hasDeepSeek) pushUnique(chain, { providerName: "openai-compatible", model: `deepseek/${process.env.DEEPSEEK_MODEL || "deepseek-chat"}` });
    if (hasOpenAICompatible) pushUnique(chain, { providerName: "openai-compatible", model: compatibleModel });
    return chain;
  }

  if (hasOpenRouter) pushUnique(chain, { providerName: "openai-compatible", model: `openrouter/${openRouterModel}` });
  if (hasGroq) pushUnique(chain, { providerName: "openai-compatible", model: `groq/${groqModel}` });
  if (hasDeepSeek) pushUnique(chain, { providerName: "openai-compatible", model: `deepseek/${process.env.DEEPSEEK_MODEL || "deepseek-chat"}` });
  if (hasOpenAICompatible) pushUnique(chain, { providerName: "openai-compatible", model: compatibleModel });
  if (hasOpenAI) pushUnique(chain, { providerName: "openai", model: openaiModel });
  if (hasClaude) pushUnique(chain, { providerName: "claude", model: claudeModel });
  return chain;
}

export function getModelRouteChain(tier: ModelExecutionTier): FallbackChainEntry[] {
  const globalChain = getGlobalFallbackChain();
  if (globalChain) return globalChain;
  return configuredProviderEntries(tier);
}

export async function routeModelTurn(params: RoutedModelTurnParams): Promise<ProviderTurnResult> {
  const chain = getModelRouteChain(params.tier);
  if (chain.length === 0) {
    throw new Error(
      "No model providers configured. Add OpenRouter, Groq, Anthropic, OpenAI, or another OpenAI-compatible provider variable.",
    );
  }

  const logPrefix = params.logPrefix ?? `[ModelRouter:${params.tier}]`;
  console.log(
    `${logPrefix} route tier=${params.tier} candidates=${chain
      .map((entry) => `${entry.providerName}(${entry.model})`)
      .join(" -> ")}`,
  );

  return queryWithFallback(
    chain,
    {
      model: chain[0].model,
      messages: params.messages,
      tools: params.tools,
      toolChoice: params.toolChoice ?? "none",
      maxCompletionTokens: params.maxCompletionTokens,
      stream: params.stream ?? false,
      signal: params.signal,
    },
    logPrefix,
  );
}
