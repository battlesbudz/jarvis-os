export const ROUTER_PLACEHOLDER_OPENAI_API_KEY = "jarvis-router-key";

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
export function getProviderEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = cleanEnvValue(process.env[name]);
    if (value) return value;
  }
  return undefined;
}

export function hasProviderEnvValue(...names: string[]): boolean {
  return !!getProviderEnvValue(...names);
}

function setAlias(canonical: string, ...aliases: string[]): void {
  if (getProviderEnvValue(canonical)) return;
  const value = getProviderEnvValue(...aliases);
  if (value) process.env[canonical] = value;
}

export function isRouterPlaceholderOpenAIKey(value: string | undefined): boolean {
  return cleanEnvValue(value) === ROUTER_PLACEHOLDER_OPENAI_API_KEY;
}

export function isDirectOpenAIDisabled(): boolean {
  const value = cleanEnvValue(process.env.JARVIS_DISABLE_DIRECT_OPENAI);
  return value === "1" || value === "true";
}

export function hasDirectOpenAIProvider(): boolean {
  if (isDirectOpenAIDisabled()) return false;
  const key = getProviderEnvValue("AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY");
  return !!key && !isRouterPlaceholderOpenAIKey(key);
}

export function hasNonOpenAIRoutableProvider(): boolean {
  return (
    hasCodexOAuthProvider() ||
    hasProviderEnvValue("ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_API_KEY") ||
    hasProviderEnvValue("GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY") ||
    hasProviderEnvValue("OPENAI_COMPATIBLE_BASE_URL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_BASE_URL") ||
    hasProviderEnvValue("OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENROUTER_API_KEY") ||
    hasProviderEnvValue("GROQ_API_KEY", "AI_INTEGRATIONS_GROQ_API_KEY") ||
    hasProviderEnvValue("TOGETHER_API_KEY", "AI_INTEGRATIONS_TOGETHER_API_KEY") ||
    hasProviderEnvValue("FIREWORKS_API_KEY", "AI_INTEGRATIONS_FIREWORKS_API_KEY") ||
    hasProviderEnvValue("CEREBRAS_API_KEY", "AI_INTEGRATIONS_CEREBRAS_API_KEY") ||
    hasProviderEnvValue("NVIDIA_API_KEY", "AI_INTEGRATIONS_NVIDIA_API_KEY") ||
    hasProviderEnvValue("DEEPSEEK_API_KEY", "AI_INTEGRATIONS_DEEPSEEK_API_KEY") ||
    hasProviderEnvValue("MODEL_RELAY_BASE_URL", "MODELRELAY_BASE_URL")
  );
}

export function hasAnyRoutableProvider(): boolean {
  return hasDirectOpenAIProvider() || hasNonOpenAIRoutableProvider();
}

export function isCodexOAuthProviderEnabled(): boolean {
  const enabled = getProviderEnvValue("JARVIS_CODEX_OAUTH_ENABLED", "CHATGPT_CODEX_OAUTH_ENABLED");
  const testOverrideAllowed = getProviderEnvValue("JARVIS_TEST_ALLOW_DIRECT_PROVIDER") === "true";
  if (testOverrideAllowed && (enabled === "false" || enabled === "0")) return false;
  return true;
}

export function hasCodexOAuthProvider(): boolean {
  return isCodexOAuthProviderEnabled();
}

export function getCodexOAuthCommand(): string {
  return getProviderEnvValue("JARVIS_CODEX_COMMAND", "CODEX_COMMAND") ?? "codex";
}

export function applyProviderEnvAliases(): void {
  setAlias("AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY");
  setAlias("AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_BASE_URL");

  setAlias("OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENROUTER_API_KEY");
  setAlias("OPENROUTER_BASE_URL", "AI_INTEGRATIONS_OPENROUTER_BASE_URL");
  setAlias("OPENROUTER_MODEL", "AI_INTEGRATIONS_OPENROUTER_MODEL");
  setAlias("OPENROUTER_CHEAP_MODEL", "AI_INTEGRATIONS_OPENROUTER_CHEAP_MODEL");
  setAlias("OPENROUTER_SMART_MODEL", "AI_INTEGRATIONS_OPENROUTER_SMART_MODEL");

  setAlias("GROQ_API_KEY", "AI_INTEGRATIONS_GROQ_API_KEY");
  setAlias("GROQ_BASE_URL", "AI_INTEGRATIONS_GROQ_BASE_URL");
  setAlias("GROQ_MODEL", "AI_INTEGRATIONS_GROQ_MODEL");
  setAlias("GROQ_CHEAP_MODEL", "AI_INTEGRATIONS_GROQ_CHEAP_MODEL");
  setAlias("GROQ_SMART_MODEL", "AI_INTEGRATIONS_GROQ_SMART_MODEL");

  setAlias("TOGETHER_API_KEY", "AI_INTEGRATIONS_TOGETHER_API_KEY");
  setAlias("TOGETHER_BASE_URL", "AI_INTEGRATIONS_TOGETHER_BASE_URL");
  setAlias("TOGETHER_MODEL", "AI_INTEGRATIONS_TOGETHER_MODEL");

  setAlias("FIREWORKS_API_KEY", "AI_INTEGRATIONS_FIREWORKS_API_KEY");
  setAlias("FIREWORKS_BASE_URL", "AI_INTEGRATIONS_FIREWORKS_BASE_URL");
  setAlias("FIREWORKS_MODEL", "AI_INTEGRATIONS_FIREWORKS_MODEL");

  setAlias("CEREBRAS_API_KEY", "AI_INTEGRATIONS_CEREBRAS_API_KEY");
  setAlias("CEREBRAS_BASE_URL", "AI_INTEGRATIONS_CEREBRAS_BASE_URL");
  setAlias("CEREBRAS_MODEL", "AI_INTEGRATIONS_CEREBRAS_MODEL");

  setAlias("NVIDIA_API_KEY", "AI_INTEGRATIONS_NVIDIA_API_KEY");
  setAlias("NVIDIA_BASE_URL", "AI_INTEGRATIONS_NVIDIA_BASE_URL");
  setAlias("NVIDIA_MODEL", "AI_INTEGRATIONS_NVIDIA_MODEL");

  setAlias("DEEPSEEK_API_KEY", "AI_INTEGRATIONS_DEEPSEEK_API_KEY");
  setAlias("DEEPSEEK_BASE_URL", "AI_INTEGRATIONS_DEEPSEEK_BASE_URL");
  setAlias("DEEPSEEK_MODEL", "AI_INTEGRATIONS_DEEPSEEK_MODEL");

  setAlias("OPENAI_COMPATIBLE_API_KEY", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_API_KEY");
  setAlias("OPENAI_COMPATIBLE_BASE_URL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_BASE_URL");
  setAlias("OPENAI_COMPATIBLE_MODEL", "AI_INTEGRATIONS_OPENAI_COMPATIBLE_MODEL");
}

export function getOpenAIClientConfig(): { apiKey: string; baseURL?: string } {
  applyProviderEnvAliases();
  if (isDirectOpenAIDisabled()) {
    return {
      apiKey: ROUTER_PLACEHOLDER_OPENAI_API_KEY,
      baseURL: undefined,
    };
  }
  return {
    apiKey:
      getProviderEnvValue("AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY") ??
      ROUTER_PLACEHOLDER_OPENAI_API_KEY,
    baseURL: getProviderEnvValue("AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_BASE_URL"),
  };
}
