import assert from "node:assert/strict";
import {
  ROUTER_PLACEHOLDER_OPENAI_API_KEY,
  applyProviderEnvAliases,
  getOpenAIClientConfig,
  getProviderEnvValue,
  hasDirectOpenAIProvider,
  hasNonOpenAIRoutableProvider,
} from "../providers/env";
import { getModelRouteChain } from "../modelRouter";

const ENV_KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_INTEGRATIONS_OPENROUTER_API_KEY",
  "AI_INTEGRATIONS_OPENROUTER_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "GROQ_API_KEY",
  "PROVIDER_FALLBACK_CHAIN",
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
