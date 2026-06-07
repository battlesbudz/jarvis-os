import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const memorySearchSource = fs.readFileSync(path.join(repoRoot, "server/agent/tools/memorySearch.ts"), "utf8");
const promptContextSource = fs.readFileSync(path.join(repoRoot, "server/memory/promptContext.ts"), "utf8");
const runNamedAgentSource = fs.readFileSync(path.join(repoRoot, "server/agent/runNamedAgent.ts"), "utf8");
const planGenerationSource = fs.readFileSync(path.join(repoRoot, "server/services/planGenerationService.ts"), "utf8");

assert.match(memorySearchSource, /retrieveMemoryContext/, "memory_search should route through Memory OS");
assert.doesNotMatch(
  memorySearchSource,
  /import\s+\{[^}]*retrieveRelevantMemories/,
  "memory_search should not import raw canonical retrieval directly",
);

assert.match(promptContextSource, /retrieveMemoryContext/, "coach prompt context should route through Memory OS");
assert.doesNotMatch(
  promptContextSource,
  /import\s+\{[^}]*retrieveRelevantMemories/,
  "prompt context should not import raw canonical retrieval directly",
);

assert.match(
  planGenerationSource,
  /buildAiContextSections/,
  "daily command planning should continue to load prompt context through the shared context builder",
);

assert.match(runNamedAgentSource, /retrieveMemoryContext/, "named agent first-turn global context should route through Memory OS");
assert.match(runNamedAgentSource, /agent_sdk_context/, "named agent Memory OS calls should identify the Agent SDK context caller");

console.log("OK: Memory OS facade is the routed read path for tool, coach, daily command, and agent context");
