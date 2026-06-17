import assert from "node:assert/strict";
import {
  ANDROID_LOCAL_GEMMA_MODEL,
  CODEX_OAUTH_MODEL,
  MODEL_OPTIONS,
  MODEL_PROVIDER_CATALOG,
  getModelsForCategory,
  isValidModelForCategory,
} from "@shared/modelProviderCatalog";

const providerIds = MODEL_PROVIDER_CATALOG.map((provider) => provider.id);
assert.deepEqual(providerIds, ["openai", "anthropic", "google", "local-llama", "android-local-gemma"]);

assert.equal(isValidModelForCategory(CODEX_OAUTH_MODEL, "chat"), true);
assert.equal(isValidModelForCategory("anthropic/claude-sonnet-4-5", "planning"), true);
assert.equal(isValidModelForCategory("google/gemini-2.5-pro", "research"), true);
assert.equal(isValidModelForCategory("openai-compatible/llama-local", "chat"), true);
assert.equal(isValidModelForCategory(ANDROID_LOCAL_GEMMA_MODEL, "chat"), true);
assert.equal(isValidModelForCategory("google/gemini-2.5-pro", "orchestrator"), true);
assert.equal(isValidModelForCategory("anthropic/claude-sonnet-4-5", "orchestrator"), true);
assert.equal(isValidModelForCategory("openai-compatible/llama-local", "orchestrator"), true);
assert.equal(isValidModelForCategory(ANDROID_LOCAL_GEMMA_MODEL, "orchestrator"), true);

for (const category of ["chat", "planning", "memory", "research", "orchestrator"] as const) {
  assert.ok(getModelsForCategory(category).length > 0, `${category} has selectable models`);
}

for (const model of MODEL_OPTIONS) {
  assert.ok(providerIds.includes(model.provider), `${model.value} has a known provider`);
  assert.ok(model.categories.length > 0, `${model.value} has at least one category`);
  for (const category of ["chat", "planning", "memory", "research", "orchestrator"] as const) {
    assert.ok(model.categories.includes(category), `${model.value} is globally selectable for ${category}`);
  }
}

console.log("OK: model provider catalog exposes globally selectable OpenAI, Claude, Gemini, Local Llama, and Phone Gemma options");
