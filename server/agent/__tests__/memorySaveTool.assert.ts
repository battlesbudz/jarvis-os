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
const databaseSource = fs.readFileSync(path.join(root, "server/db.ts"), "utf8");
const schemaSource = fs.readFileSync(path.join(root, "shared/schema.ts"), "utf8");

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
  /corrected_by_memory_id = \$\{created\.id\}/.test(memorySearchSource) &&
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
    /SELECT id, pending_review, review_status, corrected_by_memory_id[\s\S]*ORDER BY id[\s\S]*FOR UPDATE/.test(memorySearchSource) &&
    /supersedes_memory_id = ANY\(\$\{correctionTargets\}::varchar\[\]\)[\s\S]*pending_review = TRUE[\s\S]*review_status = 'pending'/.test(memorySearchSource) &&
    /corrected_by_memory_id = \$\{duplicateId\}/.test(memorySearchSource) &&
    /supersededMemoryIds: correctionTargets/.test(memorySearchSource),
  "an approved duplicate should atomically retire pending proposals and complete an immediate correction",
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
  /WHEN supersedes_memory_id = \$\{supersedesMemoryId \|\| null\}[\s\S]*review_status IN \('active', 'kept', 'edited'\) THEN 0[\s\S]*WHEN supersedes_memory_id = \$\{supersedesMemoryId \|\| null\}[\s\S]*review_status = 'pending' THEN 1/.test(memorySearchSource),
  "duplicate lookup should prioritize a completed correction, then a pending correction for the requested source",
);

assert.ok(
  /pending_review = TRUE AND review_status = 'pending'[\\s\\S]*supersedes_memory_id = \\${supersedesMemoryId \\|\\| null}/.test(memorySearchSource) &&
    /Memory correction is already awaiting review/.test(memorySearchSource) &&
    /memoryWriteStatus: "pending_review"/.test(memorySearchSource) &&
    /pendingReview: true/.test(memorySearchSource),
  "pending correction retries should preserve the review item and report that it is awaiting approval",
);

assert.ok(
  /onConflictDoNothing\(\)/.test(memorySearchSource) &&
    /existingPendingResult/.test(memorySearchSource) &&
    /normalizeForDedup\(existingPending\.content\) === normalized/.test(memorySearchSource) &&
    /A different correction for this memory is already awaiting review/.test(memorySearchSource),
  "concurrent pending corrections should reuse the correction enforced by the database",
);

assert.ok(
  /const inserted = await db\.transaction/.test(memorySearchSource) &&
    /SELECT id[\s\S]*id = ANY\(\$\{plan\.supersedeMemoryIds\}::varchar\[\]\)[\s\S]*ORDER BY id[\s\S]*FOR UPDATE[\s\S]*const \[created\] = await tx\.insert/.test(memorySearchSource) &&
    /SET review_status = 'discarded'[\s\S]*supersedes_memory_id = ANY\(\$\{plan\.supersedeMemoryIds\}::varchar\[\]\)[\s\S]*pending_review = TRUE[\s\S]*review_status = 'pending'/.test(memorySearchSource) &&
    /UPDATE user_memories[\s\S]*corrected_by_memory_id = \$\{created\.id\}/.test(memorySearchSource) &&
    /superseded\.rows[\s\S]*plan\.supersedeMemoryIds\.length[\s\S]*throw new MemoryCorrectionConflictError/.test(memorySearchSource) &&
    /err instanceof MemoryCorrectionConflictError/.test(memorySearchSource),
  "all fresh corrections should lock their sources before insert, and immediate corrections should retire pending proposals atomically",
);

assert.ok(
  /user_memories_pending_correction_source_uidx/.test(databaseSource) &&
    /LOCK TABLE user_memories IN SHARE ROW EXCLUSIVE MODE/.test(databaseSource) &&
    /user_memories\.pending_review = TRUE/.test(databaseSource) &&
    /user_memories\.review_status = 'pending'/.test(databaseSource) &&
    /source_memory\.corrected_by_memory_id <> user_memories\.id/.test(databaseSource) &&
    /user_memories_pending_correction_source_uidx/.test(schemaSource),
  "pending correction uniqueness should be enforced while safely cleaning pre-fix duplicates",
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
