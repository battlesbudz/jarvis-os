import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_DEFAULTS,
  ORCHESTRATOR_MODELS,
  isValidModelForCategory,
} from "../../lib/modelPrefs";
import { DEFAULT_TIER_MODELS } from "../modelRouter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

const CODEX_MODEL = "chatgpt-codex-oauth/auto";

assert.equal(MODEL_DEFAULTS.orchestrator, CODEX_MODEL);
assert.deepEqual(
  ORCHESTRATOR_MODELS.map((model) => model.value),
  [CODEX_MODEL],
);
assert.equal(isValidModelForCategory(CODEX_MODEL, "orchestrator"), true);
assert.equal(isValidModelForCategory("claude-opus-4-6", "orchestrator"), false);
console.log("OK: Codex OAuth is the only valid orchestrator preference");

assert.equal(DEFAULT_TIER_MODELS.prime, CODEX_MODEL);
assert.equal(DEFAULT_TIER_MODELS.smart, CODEX_MODEL);
assert.equal(DEFAULT_TIER_MODELS.cheap, CODEX_MODEL);
console.log("OK: routed model tiers default to Codex OAuth");

for (const relativePath of [
  "server/agent/orchestrator.ts",
  "server/agent/qualityLoop.ts",
]) {
  const source = readFileSync(path.join(projectRoot, relativePath), "utf-8");
  assert.equal(
    source.includes("anthropicClient"),
    false,
    `${relativePath} must not import or call the Anthropic client`,
  );
}
console.log("OK: active orchestrator hot paths avoid direct Anthropic client calls");

console.log("\nAll Codex-only orchestrator assertions passed.");
