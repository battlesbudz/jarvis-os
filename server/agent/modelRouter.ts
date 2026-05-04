import type OpenAI from "openai";

export type ModelTier = "prime" | "smart" | "cheap" | "free";
export type TaskComplexity = "trivial" | "easy" | "medium" | "hard";
export type TaskPrivacyLevel = "public" | "internal" | "sensitive";

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

export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  prime: process.env.JARVIS_PRIME_MODEL ?? "claude-opus-4-6",
  smart: process.env.JARVIS_SMART_MODEL ?? "gpt-4.1-mini",
  cheap: process.env.JARVIS_CHEAP_MODEL ?? "gpt-4o-mini",
  free: process.env.JARVIS_FREE_MODEL ?? "modelrelay/auto-fastest",
};

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

  const tier = input.routing?.forceTier ?? chooseTier(complexity, privacyLevel);
  if (tier === "free") {
    const maxToolCount = input.routing?.maxToolCountForFree ?? 0;
    if (input.toolCount > maxToolCount) {
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

  const model = DEFAULT_TIER_MODELS[tier];
  return {
    model,
    tier,
    complexity,
    privacyLevel,
    delegated: model !== input.requestedModel,
    reason: `routed ${complexity}/${privacyLevel} task to ${tier} tier`,
  };
}
