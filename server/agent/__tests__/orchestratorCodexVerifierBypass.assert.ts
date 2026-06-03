import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCodexOAuthModel } from "../runtimeModel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

assert.equal(isCodexOAuthModel("chatgpt-codex-oauth/auto"), true);
assert.equal(isCodexOAuthModel("codex-oauth/auto"), true);
assert.equal(isCodexOAuthModel("gpt-4.1-mini"), false);

const orchestratorSource = readFileSync(
  path.join(projectRoot, "server/agent/orchestrator.ts"),
  "utf8",
);

assert.match(
  orchestratorSource,
  /function shouldBypassOrchestratorVerifier/,
  "orchestrator should define a Codex OAuth verifier bypass gate",
);
assert.match(
  orchestratorSource,
  /if\s*\(\s*shouldBypassOrchestratorVerifier\(orchestratorModel\)\s*\)/,
  "sub-task verification should bypass before opening a Codex OAuth verifier turn",
);
assert.match(
  orchestratorSource,
  /passed:\s*null,\s*reason:\s*["']Codex OAuth verifier bypassed/,
  "background job verification should fail open instead of spending a Codex OAuth verifier turn",
);

console.log("OK: Codex OAuth verifier bypass contract is present.");
