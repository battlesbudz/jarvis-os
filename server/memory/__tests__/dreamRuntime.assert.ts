import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(process.cwd(), "server/memory/dream.ts"), "utf8");

assert.match(
  source,
  /schema\.memoryWorkingContext[\s\S]*eq\(schema\.memoryWorkingContext\.state, "active"\)[\s\S]*gt\(schema\.memoryWorkingContext\.expiresAt, now\)/,
  "dream corpus should include active, unexpired working context",
);
assert.match(
  source,
  /LOCAL_RUNTIME_OBSERVATION_SCOPE_TYPE = "local_runtime_observation"[\s\S]*ne\(schema\.memoryWorkingContext\.scopeType, LOCAL_RUNTIME_OBSERVATION_SCOPE_TYPE\)/,
  "dream corpus should exclude ephemeral local runtime observations",
);
assert.match(
  source,
  /Active working context \(temporary, not durable memory\)/,
  "working context should be explicitly labeled temporary in the dream corpus",
);
assert.match(
  source,
  /function filterRawRestrictedWorkingContextRows[\s\S]*row\.activeGoal[\s\S]*row\.currentStep[\s\S]*row\.content[\s\S]*containsRawRestrictedContent\(promptText\)/,
  "working context should filter every prompt text field for raw restricted content",
);
assert.match(
  source,
  /const safeWorkingContextRows = filterRawRestrictedWorkingContextRows\(workingContextRows\);[\s\S]*for \(const row of safeWorkingContextRows\)/,
  "working context should use the full-row restricted-content filter before entering the dream prompt",
);
assert.match(
  source,
  /writeMemoryThroughPipeline\([\s\S]*trigger: "dream"[\s\S]*reviewEnabled: true/,
  "dream memory candidates should go through MemoryOS review policy",
);
assert.match(
  source,
  /const memoryType = input\.insight\.memoryType \|\| "contextual"/,
  "dream memory candidates without a model-supplied type should stay non-durable for review",
);
assert.match(
  source,
  /evaluateMemoryAutoReviewDecision\([\s\S]*sourceType: "dream_cycle"[\s\S]*if \(autoReviewDecision\.action !== "keep"\)/,
  "dream auto-keep should reuse the shared auto-review gates before approving pending memories",
);
assert.match(
  source,
  /keepPendingMemoryWrites\([\s\S]*High-confidence repeated dream memory was auto-kept/,
  "high-confidence repeated dream memories should be auto-kept through the review path",
);
assert.match(
  source,
  /schema\.deliverables[\s\S]*source: "dream_cycle_capability_proposal"/,
  "dream capability proposals should be reviewable deliverables, not actions",
);
assert.match(
  source,
  /JARVIS has not built or run anything\. Review this proposal before any implementation work starts\./,
  "dream capability proposals should clearly state that no action was taken",
);

console.log("OK: dream runtime consumes working context and keeps review queues separate");
