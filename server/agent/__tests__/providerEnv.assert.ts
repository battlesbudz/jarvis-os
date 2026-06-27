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
import { _shouldDisableRuntimeStateCardForTesting, _shouldRouteOpenAIChatForTesting } from "../openaiChatRouterPatch";
import { resolveRuntimeAgentModel } from "../runtimeModel";
import { _clearProviderCacheForTesting } from "../providers";

const CODEX_ROUTE = {
  providerName: "chatgpt-codex-oauth",
  model: "chatgpt-codex-oauth/auto",
} as const;

const ENV_KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "JARVIS_MODEL_PROVIDER",
  "JARVIS_AI_PROVIDER",
  "JARVIS_MODEL_ROUTING",
  "JARVIS_CODEX_OAUTH_ENABLED",
  "CHATGPT_CODEX_OAUTH_ENABLED",
  "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
  "JARVIS_CODEX_COMMAND",
  "CODEX_COMMAND",
  "JARVIS_CODEX_OAUTH_MODEL",
  "CHATGPT_CODEX_OAUTH_MODEL",
  "ANTHROPIC_API_KEY",
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
  "AI_INTEGRATIONS_OPENROUTER_API_KEY",
  "AI_INTEGRATIONS_OPENROUTER_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "AI_INTEGRATIONS_OPENAI_COMPATIBLE_API_KEY",
  "AI_INTEGRATIONS_OPENAI_COMPATIBLE_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_COMPATIBLE_MODEL",
  "OPENAI_COMPATIBLE_API_KEY",
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_COMPATIBLE_MODEL",
  "GROQ_API_KEY",
  "PROVIDER_FALLBACK_CHAIN",
  "JARVIS_DISABLE_DIRECT_OPENAI",
  "JARVIS_CHEAP_MODEL",
  "JARVIS_BALANCED_MODEL",
  "JARVIS_DEFAULT_MODEL",
  "JARVIS_OPENAI_SMART_MODEL",
  "JARVIS_OPENAI_BALANCED_MODEL",
  "JARVIS_CLAUDE_SMART_MODEL",
  "JARVIS_CLAUDE_CHEAP_MODEL",
];

function withCleanEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.PROVIDER_FALLBACK_CHAIN = "";

  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  _clearProviderCacheForTesting();

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    _clearProviderCacheForTesting();
  }
}

withCleanEnv({ OPENAI_API_KEY: "sk-openai" }, () => {
  applyProviderEnvAliases();
  assert.equal(process.env.AI_INTEGRATIONS_OPENAI_API_KEY, "sk-openai");
  assert.equal(hasDirectOpenAIProvider(), true);
  assert.equal(getOpenAIClientConfig().apiKey, "sk-openai");
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain[0], CODEX_ROUTE);
  console.log("OK: standard OPENAI_API_KEY config does not override Codex OAuth routing");
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
  assert.deepEqual(chain[0], CODEX_ROUTE);
  assert.equal(chain.some((entry) => entry.providerName !== "chatgpt-codex-oauth"), false);
  console.log("OK: Railway OpenRouter alias does not override Codex OAuth routing");
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
  assert.deepEqual(chain, [CODEX_ROUTE]);
  assert.equal(resolveRuntimeAgentModel("gpt-4o-mini"), "chatgpt-codex-oauth/auto");
  console.log("OK: explicit ChatGPT/Codex OAuth provider is the only model route even when other keys exist");
});

withCleanEnv({
  JARVIS_MODEL_PROVIDER: "chatgpt-codex-oauth",
  JARVIS_CODEX_COMMAND: "codex-test",
}, () => {
  assert.equal(resolveRuntimeAgentModel("anthropic/claude-sonnet-4-5"), "anthropic/claude-sonnet-4-5");
  assert.equal(resolveRuntimeAgentModel("google/gemini-2.5-pro"), "google/gemini-2.5-pro");
  assert.equal(resolveRuntimeAgentModel("openai/gpt-4.1-mini"), "openai/gpt-4.1-mini");
  assert.equal(resolveRuntimeAgentModel("openai-compatible/llama-local"), "openai-compatible/llama-local");
  console.log("OK: explicit user-selected provider models survive Codex OAuth default routing");
});

withCleanEnv({
  JARVIS_CODEX_OAUTH_ENABLED: "false",
  JARVIS_TEST_ALLOW_DIRECT_PROVIDER: "true",
  ANTHROPIC_API_KEY: "sk-anthropic",
}, () => {
  assert.equal(hasCodexOAuthProvider(), false);
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "anthropic/claude-sonnet-4-5" }), true);
  console.log("OK: OpenAI chat patch routes explicit Anthropic models when only Anthropic env auth is configured");
});

withCleanEnv({
  JARVIS_CODEX_OAUTH_ENABLED: "false",
  JARVIS_TEST_ALLOW_DIRECT_PROVIDER: "true",
  GEMINI_API_KEY: "gemini-key",
}, () => {
  assert.equal(hasCodexOAuthProvider(), false);
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "google/gemini-2.5-pro" }), true);
  console.log("OK: OpenAI chat patch routes explicit Gemini models when only Gemini env auth is configured");
});

withCleanEnv({
  JARVIS_CODEX_OAUTH_ENABLED: "false",
  JARVIS_TEST_ALLOW_DIRECT_PROVIDER: "true",
}, () => {
  assert.equal(hasCodexOAuthProvider(), false);
  assert.equal(hasNonOpenAIRoutableProvider(), false);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "anthropic/claude-sonnet-4-5", user: "user-claude" }), true);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "google/gemini-2.5-pro", user: "user-gemini" }), true);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "openai/gpt-4.1-mini", user: "user-openai" }), true);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "gpt-4o-mini", user: "user-openai" }), true);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "gpt-4o-mini" }), false);
  console.log("OK: OpenAI chat patch routes user-scoped GPT calls without env auth so selected profiles can resolve");
});

assert.equal(
  _shouldDisableRuntimeStateCardForTesting({
    model: "gpt-4o-mini",
    user: "user-json-sdk",
    messages: [
      { role: "system", content: "Extract facts from this source. Respond with valid JSON only." },
      { role: "user", content: "Source text" },
    ],
  }),
  true,
);
assert.equal(
  _shouldDisableRuntimeStateCardForTesting({
    model: "gpt-4o-mini",
    user: "user-json-sdk",
    messages: [
      { role: "system", content: "Extract facts from this source. Return ONLY the JSON object." },
      { role: "user", content: "Source text" },
    ],
  }),
  true,
);
assert.equal(
  _shouldDisableRuntimeStateCardForTesting({
    model: "gpt-4o-mini",
    user: "user-json-sdk",
    messages: [{ role: "user", content: "Show me a JSON example." }],
  }),
  false,
);
console.log("OK: OpenAI chat patch disables runtime state cards for strict JSON-only SDK calls");

withCleanEnv({ JARVIS_CODEX_OAUTH_ENABLED: "true", JARVIS_DEFAULT_MODEL: "chatgpt-codex-oauth/auto" }, () => {
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain[0], CODEX_ROUTE);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "chatgpt-codex-oauth/auto" }), true);
  assert.equal(_shouldRouteOpenAIChatForTesting({ model: "codex-oauth/auto" }), true);
  console.log("OK: ChatGPT/Codex OAuth model specs resolve to the Codex OAuth provider");
});

withCleanEnv({ JARVIS_CODEX_OAUTH_ENABLED: "false", OPENAI_API_KEY: "sk-openai" }, () => {
  assert.equal(hasCodexOAuthProvider(), true);
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain, [CODEX_ROUTE]);
  console.log("OK: production disable flags do not turn off Codex OAuth routing");
});

withCleanEnv({ JARVIS_MODEL_PROVIDER: "openai", OPENAI_API_KEY: "sk-openai", AI_INTEGRATIONS_OPENROUTER_API_KEY: "or-key" }, () => {
  applyProviderEnvAliases();
  assert.equal(hasDirectOpenAIProvider(), true);
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  const chain = getModelRouteChain("balanced");
  assert.deepEqual(chain[0], CODEX_ROUTE);
  assert.equal(chain.some((entry) => entry.providerName === "openai"), false);
  console.log("OK: alternate providers and provider overrides are ignored while Codex OAuth is enabled");
});

withCleanEnv({ OPENAI_API_KEY: "sk-openai", GROQ_API_KEY: "groq-key", JARVIS_DISABLE_DIRECT_OPENAI: "true" }, () => {
  applyProviderEnvAliases();
  assert.equal(hasDirectOpenAIProvider(), false);
  const chain = getModelRouteChain("balanced");
  assert.equal(chain.some((entry) => entry.providerName === "openai"), false);
  assert.deepEqual(chain[0], CODEX_ROUTE);
  console.log("OK: direct OpenAI fallback is disabled and Codex OAuth remains selected");
});

withCleanEnv({ ANTHROPIC_API_KEY: "sk-anthropic", JARVIS_MODEL_PROVIDER: "claude", JARVIS_DISABLE_DIRECT_OPENAI: "true" }, () => {
  applyProviderEnvAliases();
  assert.equal(hasNonOpenAIRoutableProvider(), true);
  const chain = getModelRouteChain("smart");
  assert.deepEqual(chain[0], CODEX_ROUTE);
  assert.equal(chain.some((entry) => String(entry.providerName) === "claude"), false);
  console.log("OK: legacy ANTHROPIC_API_KEY is ignored for routing");
});

console.log("\nAll provider environment assertions passed.");
