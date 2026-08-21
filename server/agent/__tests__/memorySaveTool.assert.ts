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
  /!plan\.record\.pendingReview && duplicateIsApproved/.test(memorySearchSource) &&
    /correctionTargets = plan\.supersedeMemoryIds\.filter/.test(memorySearchSource) &&
    /markMemoriesSuperseded\([\s\S]*ctx\.userId,[\s\S]*correctionTargets,[\s\S]*duplicateId/.test(memorySearchSource) &&
    /supersededMemoryIds: correctionTargets/.test(memorySearchSource),
  "an approved duplicate should complete an immediate correction without bypassing Memory Review",
);

assert.ok(
  /duplicateAlreadyCompletedCorrection/.test(memorySearchSource) &&
    /Memory correction already applied/.test(memorySearchSource) &&
    /supersededMemoryIds: \[duplicate\.supersedes_memory_id\]/.test(memorySearchSource),
  "a retry after correction approval should return the existing successful correction",
);

assert.ok(
  /const correctionTargets[\s\S]*if \(duplicateIsApproved && correctionTargets\.length > 0\)[\s\S]*corrected_by_memory_id = \$\{duplicateId\}[\s\S]*Memory correction already applied[\s\S]*if \(!plan\.record\.pendingReview && duplicateIsApproved/.test(memorySearchSource),
  "a completed immediate duplicate correction should be reused before applying the current Memory Review setting",
);

assert.ok(
  /SELECT id, pending_review, review_status, supersedes_memory_id/.test(memorySearchSource) &&
    /duplicateIsSamePendingCorrection/.test(memorySearchSource) &&
    /plan\.supersedeMemoryIds\.includes\(duplicate\.supersedes_memory_id!\)/.test(memorySearchSource),
  "a retried pending correction should reuse the existing review item for the same target",
);

assert.ok(
  /WHEN supersedes_memory_id = \$\{supersedesMemoryId \|\| null\} THEN 0/.test(memorySearchSource),
  "duplicate lookup should prioritize a pending correction for the requested source memory",
);

assert.ok(
  /pending_review = TRUE AND review_status = 'pending'[\\s\\S]*supersedes_memory_id = \\${supersedesMemoryId \\|\\| null}/.test(memorySearchSource) &&
    /Memory correction is already awaiting review/.test(memorySearchSource) &&
    /memoryWriteStatus: "pending_review"/.test(memorySearchSource) &&
    /pendingReview: true/.test(memorySearchSource),
  "pending correction retries should preserve the review item and report that it is awaiting approval",
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
