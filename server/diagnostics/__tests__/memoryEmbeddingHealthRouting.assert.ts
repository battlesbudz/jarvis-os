import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const diagnosticsSource = fs.readFileSync(path.join(repoRoot, "server/diagnostics/diagnosticsService.ts"), "utf8");
const runnerSource = fs.readFileSync(path.join(repoRoot, "scripts/run-agent-tests.mjs"), "utf8");

assert.match(
  diagnosticsSource,
  /MemoryEmbeddingHealthReport/,
  "diagnostics health report should expose the memory embedding health contract",
);
assert.match(
  diagnosticsSource,
  /getMemoryEmbeddingHealth/,
  "runHealthCheck should collect memory embedding health",
);
assert.match(
  diagnosticsSource,
  /memoryEmbeddingHealth\.status === "down"/,
  "memory embedding health should be able to mark the memory subsystem down",
);
assert.match(
  diagnosticsSource,
  /memoryEmbeddingHealth\.status === "degraded"/,
  "memory embedding health should be able to mark the memory subsystem degraded",
);
assert.match(
  runnerSource,
  /server\/memory\/__tests__\/embeddingHealth\.test\.ts/,
  "the memory embedding health test should run in the agent test suite",
);
assert.match(
  runnerSource,
  /server\/diagnostics\/__tests__\/memoryEmbeddingHealthRouting\.assert\.ts/,
  "the diagnostics memory embedding health routing assertion should run in the agent test suite",
);

console.log("OK: diagnostics health routes memory embedding health into the health dashboard contract");
