import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const memoryCapabilitySource = fs.readFileSync(
  path.join(root, "server/capabilities/memoryCapability.ts"),
  "utf8",
);
const toolIndexSource = fs.readFileSync(
  path.join(root, "server/agent/tools/index.ts"),
  "utf8",
);
const memorySearchSource = fs.readFileSync(
  path.join(root, "server/agent/tools/memorySearch.ts"),
  "utf8",
);
const profileMemoryRoutesSource = fs.readFileSync(
  path.join(root, "server/routes/profileMemoryRoutes.ts"),
  "utf8",
);

assert.ok(
  /memorySaveTool/.test(memoryCapabilitySource),
  "memory capability should expose memory_save",
);

assert.ok(
  /memorySaveTool/.test(toolIndexSource),
  "tool index should export memorySaveTool for compatibility",
);

assert.ok(
  /name:\s*"memory_save"/.test(memorySearchSource),
  "memorySearch tool module should define memory_save",
);

assert.ok(
  /planMemoryWrite/.test(memorySearchSource) &&
    /isMemoryReviewEnabledForUser/.test(memorySearchSource) &&
    /reviewEnabled/.test(memorySearchSource) &&
    /pendingReview:\s*plan\.record\.pendingReview/.test(memorySearchSource) &&
    /reviewStatus:\s*plan\.record\.reviewStatus/.test(memorySearchSource),
  "memory_save should route explicit remembers through the deterministic review pipeline and review-gate setting",
);

assert.ok(
  /supersedes_memory_id/.test(memorySearchSource) &&
    /supersedesMemoryId:\s*plan\.record\.supersedesMemoryId/.test(memorySearchSource) &&
    /memory_id=\$\{memory\.id\}/.test(memorySearchSource) &&
    /returned by memory_search or memory_get/.test(memorySearchSource),
  "memory_save should preserve correction/supersession metadata and expose retrievable memory ids",
);

assert.ok(
  /memory_get/.test(memorySearchSource) &&
    /review_status IN \('active', 'kept', 'edited'\)/.test(memorySearchSource),
  "memory_get should not expose superseded, stale, archived, or rejected memories",
);

assert.ok(
  /markMemoriesSuperseded/.test(memorySearchSource) &&
    /JARVIS_BRAIN_PROJECTION/.test(memorySearchSource) &&
    /projectApprovedMemories\(ctx\.userId,\s*\{[\s\S]*memoryIds: \[inserted\?\.id, \.\.\.plan\.supersedeMemoryIds\]/.test(memorySearchSource),
  "active manual saves should supersede corrected memories and keep targeted brain projection feature-gated",
);

assert.ok(
  /duplicateLifecycleFilter/.test(memorySearchSource) &&
    /plan\.record\.pendingReview/.test(memorySearchSource) &&
    /review_status NOT IN \('discarded', 'rejected', 'superseded', 'stale', 'archived'\)/.test(memorySearchSource) &&
    /pending_review = FALSE/.test(memorySearchSource) &&
    /review_status IN \('active', 'kept', 'edited'\)/.test(memorySearchSource),
  "active memory saves should not be blocked by stale pending duplicate rows",
);

assert.ok(
  /refreshApprovedMemoryDerivedContext/.test(profileMemoryRoutesSource) &&
    /projectApprovedMemories\(userId,\s*\{[\s\S]*memoryIds/.test(profileMemoryRoutesSource) &&
    /JARVIS_BRAIN_PROJECTION === "1"/.test(profileMemoryRoutesSource) &&
    /await refreshApprovedMemoryDerivedContext\(userId,\s*\[id, result\.supersededMemoryId\]/.test(profileMemoryRoutesSource) &&
    /await refreshApprovedMemoryDerivedContext\(userId,\s*\[\.\.\.result\.memoryIds, \.\.\.result\.supersededMemoryIds\]\)/.test(profileMemoryRoutesSource),
  "profile memory approvals should refresh targeted SOUL/G-Brain context while keeping projection feature-gated",
);

console.log("memory_save tool exposure assertions passed");
