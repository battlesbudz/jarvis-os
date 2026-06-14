import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GLOBAL_MODEL_SELECTION_EXPLICIT_KEY,
  GLOBAL_MODEL_PREFERENCE_KEY,
  MODEL_DEFAULTS,
  ORCHESTRATOR_MODELS,
  buildGlobalModelPreferences,
  isValidModelForCategory,
  resolveGlobalModelPreference,
} from "../../lib/modelPrefs";
import { DEFAULT_TIER_MODELS } from "../modelRouter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

const CODEX_MODEL = "chatgpt-codex-oauth/auto";
const GEMINI_MODEL = "google/gemini-2.5-pro";
const CLAUDE_MODEL = "anthropic/claude-sonnet-4-5";

assert.equal(MODEL_DEFAULTS.orchestrator, CODEX_MODEL);
assert.ok(ORCHESTRATOR_MODELS.some((model) => model.value === GEMINI_MODEL));
assert.ok(ORCHESTRATOR_MODELS.some((model) => model.value === CLAUDE_MODEL));
assert.equal(isValidModelForCategory(CODEX_MODEL, "orchestrator"), true);
assert.equal(isValidModelForCategory(GEMINI_MODEL, "orchestrator"), true);
assert.equal(isValidModelForCategory(CLAUDE_MODEL, "orchestrator"), true);
console.log("OK: orchestrator accepts every globally selected provider model");

const globalPrefs = buildGlobalModelPreferences(GEMINI_MODEL);
assert.equal(globalPrefs[GLOBAL_MODEL_PREFERENCE_KEY], GEMINI_MODEL);
assert.equal(globalPrefs[GLOBAL_MODEL_SELECTION_EXPLICIT_KEY], "true");
for (const category of ["chat", "planning", "memory", "research", "orchestrator"] as const) {
  assert.equal(globalPrefs[category], GEMINI_MODEL, `${category} follows the selected global model`);
}
assert.equal(resolveGlobalModelPreference({ chat: GEMINI_MODEL }), GEMINI_MODEL);
assert.equal(resolveGlobalModelPreference({ planning: CLAUDE_MODEL }), CLAUDE_MODEL);
assert.equal(resolveGlobalModelPreference({ chat: CODEX_MODEL }), null);
assert.equal(resolveGlobalModelPreference({ [GLOBAL_MODEL_PREFERENCE_KEY]: CODEX_MODEL }), CODEX_MODEL);
assert.equal(
  resolveGlobalModelPreference({ [GLOBAL_MODEL_PREFERENCE_KEY]: CODEX_MODEL, orchestrator: GEMINI_MODEL }),
  GEMINI_MODEL,
);
console.log("OK: legacy per-category selections are promoted into one global selected model");

assert.equal(DEFAULT_TIER_MODELS.prime, CODEX_MODEL);
assert.equal(DEFAULT_TIER_MODELS.smart, CODEX_MODEL);
assert.equal(DEFAULT_TIER_MODELS.cheap, CODEX_MODEL);
console.log("OK: routed model tiers retain Codex OAuth only as the no-user-selection default");

const routerSource = readFileSync(path.join(projectRoot, "server/agent/modelRouter.ts"), "utf-8");
assert.equal(
  routerSource.includes("hasCodexOAuthProvider() ? getCodexOAuthModel() : input.requestedModel"),
  false,
  "routeModelForTask must not silently replace selected providers with Codex OAuth",
);
assert.match(
  routerSource,
  /getUserSelectedModelRouteChain/,
  "routeModelTurn must load the user's selected global provider before environment fallbacks",
);

const harnessSource = readFileSync(path.join(projectRoot, "server/agent/harness.ts"), "utf-8");
assert.match(
  harnessSource,
  /getSelectedModelPreference\(context\.userId\)/,
  "runAgent must prefer the user's selected provider over agent defaults or hardcoded modelOpt values",
);

for (const relativePath of [
  "server/agent/orchestrator.ts",
  "server/agent/qualityLoop.ts",
  "server/routes/planGenerationRoutes.ts",
  "server/routes/integrationRoutes.ts",
]) {
  const source = readFileSync(path.join(projectRoot, relativePath), "utf-8");
  assert.equal(
    source.includes("anthropicClient"),
    false,
    `${relativePath} must not import or call the Anthropic client`,
  );
  assert.equal(
    source.includes("new OpenAI("),
    false,
    `${relativePath} must not bypass the selected-provider router with a direct OpenAI client`,
  );
}
console.log("OK: active orchestrator hot paths stay provider-router based");

console.log("\nAll global selected-provider routing assertions passed.");
