import { getProviderEnvValue, hasCodexOAuthProvider, isDirectOpenAIDisabled } from "./providers/env";

export const DEFAULT_CODEX_OAUTH_MODEL = "chatgpt-codex-oauth/auto";

export function getCodexOAuthModel(): string {
  return getProviderEnvValue("JARVIS_CODEX_OAUTH_MODEL", "CHATGPT_CODEX_OAUTH_MODEL") ?? DEFAULT_CODEX_OAUTH_MODEL;
}

export function isCodexOAuthModel(model: string | undefined | null): boolean {
  const normalized = String(model ?? "").trim().toLowerCase();
  return (
    normalized.startsWith("chatgpt-codex-oauth/") ||
    normalized.startsWith("codex-oauth/") ||
    normalized === "chatgpt-codex-oauth" ||
    normalized === "codex-oauth"
  );
}

export function isExplicitProviderModel(model: string | undefined | null): boolean {
  const normalized = String(model ?? "").trim().toLowerCase();
  return (
    normalized.startsWith("anthropic/") ||
    normalized.startsWith("google/") ||
    normalized.startsWith("openai-compatible/") ||
    normalized.startsWith("modelrelay/") ||
    normalized.startsWith("openrouter/") ||
    normalized.startsWith("groq/") ||
    normalized.startsWith("together/") ||
    normalized.startsWith("fireworks/") ||
    normalized.startsWith("cerebras/") ||
    normalized.startsWith("nvidia/") ||
    normalized.startsWith("deepseek/")
  );
}

export function resolveRuntimeAgentModel(requestedModel: string): string {
  const normalized = requestedModel.trim().toLowerCase();
  if (isCodexOAuthModel(normalized)) {
    return requestedModel;
  }
  if (isExplicitProviderModel(normalized)) {
    return requestedModel;
  }

  const explicitProvider = getProviderEnvValue("JARVIS_MODEL_PROVIDER", "JARVIS_AI_PROVIDER");
  const shouldForceCodex =
    explicitProvider === "chatgpt-codex-oauth" ||
    hasCodexOAuthProvider() ||
    (isDirectOpenAIDisabled() &&
      (normalized.startsWith("gpt-") ||
        normalized.startsWith("o1") ||
        normalized.startsWith("o3") ||
        normalized.startsWith("o4")));

  if (!shouldForceCodex || !hasCodexOAuthProvider()) return requestedModel;
  return getCodexOAuthModel();
}
