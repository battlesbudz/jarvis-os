import assert from "node:assert/strict";
import {
  ROUTER_PLACEHOLDER_OPENAI_API_KEY,
  applyProviderEnvAliases,
  getCodexOAuthCommand,
  getOpenAIClientConfig,
  getProviderEnvValue,
  hasCodexOAuthProvider,
  hasDirectOpenAIProvider,
  hasNonOpenAIRoutableProvider,
} from "../providers/env";
import { getModelRouteChain } from "../modelRouter";
import { resolveRuntimeAgentModel } from "../runtimeModel";

const ENV_KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "JARVIS_MODEL_PROVIDER",
  "JARVIS_AI_PROVIDER",
  "JARVIS_CODEX_OAUTH_ENABLED",
  "CHATGPT_CODEX_OAUTH_ENABLED",
  "JARVIS_CODEX_COMMAND",
  "CODEX_COMMAND",
  "JARVIS_CODEX_OAUTH_MODEL",
  "CHATGPT_CODEX_OAUTH_MODEL",
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_INTEGRATIONS_OPENROUTER_API_KEY",
  "AI_INTEGRATIONS_OPENROUTER_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "GROQ_API_KEY",
  "PROVIDER_FALLBACK_CHAIN",
  "JARVIS_DISABLE_DIRECT_OPENAI",
  "JARVIS_CHEAP_MODEL",
  "JARVIS_BALANCED_MODEL",
  "JARVIS_DEFAULT_MODEL",
];

function withCleanEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

withCleanEnv({ OPENAI_API_KEY: "sk-openai" }, () => {
  applyProviderEnvAliases();
  assert.equal(process.env.AI_INTEGRATIONS_OPENAI_API_KEY, "sk-openai");
  assert.equal(hasDirectOpenAIProvider(), true);
  assert.equal(getOpenAIClientConfig().apiKey, "sk-openai");
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain[0], { providerName: "openai", model: "gpt-4.1-mini" });
  console.log("OK: standard OPENAI_API_KEY config is accepted by direct OpenAI and the router");
});

withCleanEnv({ AI_INTEGRATIONS_OPENROUTER_API_KEY: "or-key" }, () => {
  applyProviderEnvAliases();
  assert.equal(process.env.OPENROUTER_API_KEY, "or-key");
  assert.equal(process.env.AI_INTEGRATIONS_OPENAI_API_KEY, undefined);
  assert.equal(getProviderEnvValue("OPENROUTER_API_KEY"), "or-key");
  assert.equal(hasDirectOpenAIProvider(), false);
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  assert.equal(getOpenAIClientConfig().apiKey, ROUTER_PLACEHOLDER_OPENAI_API_KEY);
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain[0], {
    providerName: "openai-compatible",
    model: "openrouter/openrouter/auto",
  });
  assert.equal(chain.some((entry) => entry.providerName === "openai"), false);
  console.log("OK: Railway OpenRouter alias routes through openai-compatible without fake OpenAI fallback");
});

withCleanEnv({
  JARVIS_MODEL_PROVIDER: "chatgpt-codex-oauth",
  JARVIS_CODEX_COMMAND: "codex-test",
  OPENAI_API_KEY: "sk-openai",
  GROQ_API_KEY: "groq-key",
}, () => {
  assert.equal(hasCodexOAuthProvider(), true);
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  assert.equal(getCodexOAuthCommand(), "codex-test");
  const chain = getModelRouteChain("cheap");
  assert.deepEqual(chain, [{
    providerName: "chatgpt-codex-oauth",
    model: "chatgpt-codex-oauth/auto",
  }]);
  assert.equal(resolveRuntimeAgentModel("gpt-4o-mini"), "chatgpt-codex-oauth/auto");
  console.log("OK: explicit ChatGPT/Codex OAuth provider is the only model route even when other keys exist");
});

withCleanEnv({ JARVIS_CODEX_OAUTH_ENABLED: "true", JARVIS_DEFAULT_MODEL: "chatgpt-codex-oauth/auto" }, () => {
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain[0], {
    providerName: "chatgpt-codex-oauth",
    model: "chatgpt-codex-oauth/auto",
  });
  console.log("OK: ChatGPT/Codex OAuth model specs resolve to the Codex OAuth provider");
});

withCleanEnv({ OPENAI_API_KEY: "sk-openai", AI_INTEGRATIONS_OPENROUTER_API_KEY: "or-key" }, () => {
  applyProviderEnvAliases();
  assert.equal(hasDirectOpenAIProvider(), true);
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain[0], {
    providerName: "openai-compatible",
    model: "openrouter/openrouter/auto",
  });
  assert.equal(chain.some((entry) => entry.providerName === "openai"), true);
  console.log("OK: alternate provider is preferred when direct OpenAI is also configured");
});

withCleanEnv({ OPENAI_API_KEY: "sk-openai", GROQ_API_KEY: "groq-key", JARVIS_DISABLE_DIRECT_OPENAI: "true" }, () => {
  applyProviderEnvAliases();
  assert.equal(hasDirectOpenAIProvider(), false);
  const chain = getModelRouteChain("balanced");
  assert.equal(chain.some((entry) => entry.providerName === "openai"), false);
  assert.deepEqual(chain[0], {
    providerName: "openai-compatible",
    model: "groq/llama-3.1-8b-instant",
  });
  console.log("OK: direct OpenAI fallback can be disabled when the API quota is exhausted");
});

withCleanEnv({ ANTHROPIC_API_KEY: "sk-anthropic" }, () => {
  applyProviderEnvAliases();
  assert.equal(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY, "sk-anthropic");
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  const chain = getModelRouteChain("smart");
  assert.deepEqual(chain[0], {
    providerName: "claude",
    model: "claude-3-5-sonnet-latest",
  });
  console.log("OK: standard ANTHROPIC_API_KEY config is accepted by Claude routing");
});

console.log("\nAll provider environment assertions passed.");
