import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type {
  ExpiredWorkingContextRow,
  PlannedMemoryRecord,
  WorkingContextRecord,
  WorkingContextDeps,
} from "../writePipeline";

process.env.DATABASE_URL = "postgres://localhost/jarvis_memory_write_pipeline_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";

const now = new Date("2026-06-26T12:00:00.000Z");

async function loadPipeline() {
  return import("../writePipeline");
}

async function testWorkingContextRecordShape(): Promise<void> {
  const { buildWorkingContextRecord, WORKING_CONTEXT_TTL_MS } = await loadPipeline();
  const record = buildWorkingContextRecord({
    userId: "user-123",
    scopeType: "chat",
    scopeId: "jarvis-app",
    activeGoal: "Stabilize local Gemma",
    currentStep: "Run diagnostics",
    lastEventId: "evt-1",
    content: "Phone Gemma is validating GPU standard 512.",
    now,
  });

  assert.equal(record.userId, "user-123");
  assert.equal(record.scopeType, "chat");
  assert.equal(record.scopeId, "jarvis-app");
  assert.equal(record.activeGoal, "Stabilize local Gemma");
  assert.equal(record.currentStep, "Run diagnostics");
  assert.equal(record.lastEventId, "evt-1");
  assert.equal(record.state, "active");
  assert.equal(new Date(record.expiresAt).getTime(), now.getTime() + WORKING_CONTEXT_TTL_MS);
  console.log("OK: working context records carry owner, scope, step, event, update time, and expiry");
}

async function testWorkingContextPersistsThroughDeps(): Promise<void> {
  const { upsertWorkingContext } = await loadPipeline();
  const writes: WorkingContextRecord[] = [];
  const record = await upsertWorkingContext({
    userId: "user-123",
    scopeType: "device",
    scopeId: "galaxy-fold6",
    activeGoal: "Open YouTube",
    currentStep: "Search field focused",
    lastEventId: "daemon-evt-1",
    content: "YouTube is open and ready for search input.",
    now,
  }, {
    async upsertWorkingContext(next) {
      writes.push(next);
      return next;
    },
  });

  assert.equal(record.scopeType, "device");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.currentStep, "Search field focused");
  console.log("OK: working context writes go through a structured lifecycle dependency");
}

async function testExpiredWorkingContextCompactsIntoRecentContext(): Promise<void> {
  const { compactExpiredWorkingContext } = await loadPipeline();
  const expired: ExpiredWorkingContextRow = {
    id: "wc-1",
    userId: "user-123",
    scopeType: "chat",
    scopeId: "jarvis-app",
    activeGoal: "Stabilize local Gemma",
    currentStep: "Check diagnostic results",
    lastEventId: "evt-expired",
    content: "The last diagnostic passed identity and math but failed YouTube search.",
    updatedAt: "2026-06-25T12:00:00.000Z",
    claimUpdatedAt: "2026-06-26T12:00:00.000Z",
    expiresAt: "2026-06-26T11:59:00.000Z",
  };
  const inserted: PlannedMemoryRecord[] = [];
  const stale: Array<{ id: string; memoryId: string; claimUpdatedAt: Date | string }> = [];
  const deps: WorkingContextDeps = {
    async upsertWorkingContext(record) {
      return record;
    },
    async listExpiredWorkingContext() {
      return [expired];
    },
    async insertRecentContextMemory(record) {
      inserted.push(record);
      return { id: "recent-1" };
    },
    async markWorkingContextStale(id, memoryId, claimUpdatedAt) {
      stale.push({ id, memoryId, claimUpdatedAt });
    },
  };

  const result = await compactExpiredWorkingContext({ now }, deps);

  assert.deepEqual(result, { scanned: 1, compacted: 1, memoryIds: ["recent-1"] });
  assert.equal(inserted[0]?.tier, "short_term");
  assert.equal(inserted[0]?.memoryType, "contextual");
  assert.equal(inserted[0]?.pendingReview, false);
  assert.equal(inserted[0]?.reviewStatus, "active");
  assert.match(inserted[0]?.content ?? "", /Recent chat context/);
  assert.deepEqual(stale, [{ id: "wc-1", memoryId: "recent-1", claimUpdatedAt: "2026-06-26T12:00:00.000Z" }]);
  console.log("OK: expired working context compacts into recent short-term context");
}

async function testDefaultCompactionEmbedsRecentContext(): Promise<void> {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/memory/writePipeline.ts"), "utf8");
  assert.match(
    source,
    /insertRecentContextMemory\(record\)[\s\S]*backfillEmbedding\(inserted\.id, record\.content\)/,
    "default working context compaction should embed recent context before retrieval",
  );
  console.log("OK: compacted working context is embedded immediately when embeddings are available");
}

async function testDefaultCompactionClaimsExpiredContextBeforeInsert(): Promise<void> {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/memory/writePipeline.ts"), "utf8");
  assert.match(
    source,
    /FOR UPDATE SKIP LOCKED[\s\S]*SET state = 'compacting'/,
    "default working context compaction should atomically claim expired rows before inserting memories",
  );
  assert.match(
    source,
    /SELECT id, updated_at AS original_updated_at[\s\S]*candidates\.original_updated_at AS context_updated_at[\s\S]*wc\.updated_at AS claim_updated_at/,
    "default working context compaction should preserve the original context update timestamp for the compacted memory",
  );
  assert.match(
    source,
    /markWorkingContextStale\(row\.id, inserted\.id, row\.claimUpdatedAt\)[\s\S]*eq\(memoryWorkingContext\.state, "compacting"\)[\s\S]*eq\(memoryWorkingContext\.updatedAt, claimUpdatedAtDate\)/,
    "default working context finalization should only mark rows claimed by the current compaction worker",
  );
  console.log("OK: expired working context is claimed before compaction inserts");
}

async function testWorkingContextMigrationsAddReviewColumnsBeforeIndex(): Promise<void> {
  const migrationPaths = [
    "migrations/0012_memory_working_context.sql",
    "server/migrations/014_memory_working_context.sql",
  ];
  for (const migrationPath of migrationPaths) {
    const source = fs.readFileSync(path.resolve(process.cwd(), migrationPath), "utf8");
    const pendingReviewIndex = source.indexOf("ADD COLUMN IF NOT EXISTS pending_review");
    const reviewStatusIndex = source.indexOf("ADD COLUMN IF NOT EXISTS review_status");
    const userReviewIndex = source.indexOf("CREATE INDEX IF NOT EXISTS user_memories_user_review_idx");

    assert.ok(pendingReviewIndex >= 0, `${migrationPath} should add pending_review`);
    assert.ok(reviewStatusIndex >= 0, `${migrationPath} should add review_status`);
    assert.ok(userReviewIndex >= 0, `${migrationPath} should create the review-status index`);
    assert.ok(reviewStatusIndex < userReviewIndex, `${migrationPath} should add review_status before indexing it`);
  }
  console.log("OK: working context migrations add review columns before review-status indexes");
}

async function testPendingApprovalRequiresPendingStatus(): Promise<void> {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/memory/writePipeline.ts"), "utf8");
  assert.match(
    source,
    /AND review_status = 'pending'/,
    "individual memory approval should only match pending review rows",
  );
  console.log("OK: stale keep/edit requests cannot approve discarded memories");
}

async function testEditedApprovalRefreshesEmbedding(): Promise<void> {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/memory/writePipeline.ts"), "utf8");
  assert.match(
    source,
    /refreshApprovedMemoryEmbedding[\s\S]*backfillEmbedding\(memoryId, content\)/,
    "edited memory approvals should refresh embeddings for the updated content",
  );
  assert.match(
    source,
    /SET embedding = NULL,\s*embedding_vector = NULL/,
    "edited memory approvals should clear stale embeddings when refresh is unavailable",
  );
  assert.match(
    source,
    /if \(content\) \{[\s\S]*await refreshApprovedMemoryEmbedding\(input\.userId, row\.id, content\)/,
    "approvePendingMemoryWrite should refresh embeddings for Save & Keep edits",
  );
  console.log("OK: edited memory approvals refresh or clear stale embeddings");
}

async function testRecentContextMemoryShape(): Promise<void> {
  const { buildRecentContextMemory } = await loadPipeline();
  const memory = buildRecentContextMemory({
    id: "wc-2",
    userId: "user-123",
    scopeType: "surface",
    scopeId: "android",
    activeGoal: null,
    currentStep: "Awaiting approval",
    lastEventId: "evt-2",
    content: "Jarvis paused before a sensitive action.",
    updatedAt: now,
    expiresAt: now,
  }, now);

  assert.equal(memory.sourceType, "working_context");
  assert.equal(memory.sourceRef, "surface:android:evt-2");
  assert.equal(memory.tier, "short_term");
  assert.equal(memory.memoryType, "contextual");
  assert.ok(memory.expiresAt);
  console.log("OK: recent context packets keep compact provenance");
}

async function testExplicitRememberRequiresReview(): Promise<void> {
  const { planMemoryWrite } = await loadPipeline();
  const plan = planMemoryWrite({
    userId: "user-123",
    content: "The user prefers concise implementation updates.",
    trigger: "explicit_remember",
    category: "preferences",
    sourceType: "chat",
    sourceRef: "coach-chat",
    now,
  });

  assert.equal(plan.status, "review_required");
  assert.equal(plan.record?.pendingReview, true);
  assert.equal(plan.record?.reviewStatus, "pending");
  assert.equal(plan.record?.tier, "long_term");
  assert.equal(plan.record?.sourceType, "explicit_remember");
  assert.equal(plan.oneTimeReviewTip, true);
  console.log("OK: explicit remember requests create reviewable long-term memory writes");
}

async function testExplicitRememberHonorsDisabledReviewGate(): Promise<void> {
  const { planMemoryWrite } = await loadPipeline();
  const plan = planMemoryWrite({
    userId: "user-123",
    content: "The user prefers concise implementation updates.",
    trigger: "explicit_remember",
    category: "preferences",
    sourceType: "chat",
    sourceRef: "coach-chat",
    reviewEnabled: false,
    now,
  });

  assert.equal(plan.status, "auto_write_memory");
  assert.equal(plan.record?.pendingReview, false);
  assert.equal(plan.record?.reviewStatus, "active");
  assert.equal(plan.record?.sourceType, "chat");
  assert.equal(plan.oneTimeReviewTip, false);
  console.log("OK: explicit remember requests honor the disabled Memory Review gate");
}

async function testDiagnosticWritesAreExcluded(): Promise<void> {
  const { planMemoryWrite } = await loadPipeline();
  const plan = planMemoryWrite({
    userId: "user-123",
    content: "READY response passed.",
    trigger: "diagnostic",
    sourceType: "phone_gemma_diagnostic",
    now,
  });

  assert.equal(plan.status, "excluded");
  assert.equal(plan.record, null);
  assert.match(plan.reason, /Diagnostics and tests/);
  console.log("OK: diagnostics and tests are excluded from real memories");
}

async function testRawRestrictedSourceWritesAreExcluded(): Promise<void> {
  const { planMemoryWrite } = await loadPipeline();
  const plan = planMemoryWrite({
    userId: "user-123",
    content: "Checking account number 123456789 has an available balance of $1,234.56.",
    trigger: "inferred",
    sourceType: "plaid_transaction",
    sourceRef: "plaid-item-1",
    now,
  });

  assert.equal(plan.status, "excluded");
  assert.equal(plan.record, null);
  assert.match(plan.reason, /Raw restricted-source records/);

  const highLevelButUnapproved = planMemoryWrite({
    userId: "user-123",
    content: "Food delivery spending was higher than usual this week.",
    trigger: "inferred",
    sourceType: "plaid_transaction_rollup",
    sourceRef: "rollup-2026-06-26",
    now,
  });
  assert.equal(highLevelButUnapproved.status, "excluded");
  assert.equal(highLevelButUnapproved.record, null);

  const manualBankBalance = planMemoryWrite({
    userId: "user-123",
    content: "My bank balance is $5,000.",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(manualBankBalance.status, "excluded");
  assert.equal(manualBankBalance.record, null);

  const manualCheckingBalance = planMemoryWrite({
    userId: "user-123",
    content: "My current checking balance is $5,000.",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(manualCheckingBalance.status, "excluded");
  assert.equal(manualCheckingBalance.record, null);

  const manualTransactionRows = planMemoryWrite({
    userId: "user-123",
    content: "Transactions:\n2026-06-26 Starbucks -$5.00",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(manualTransactionRows.status, "excluded");
  assert.equal(manualTransactionRows.record, null);

  const manualCsvTransactionRows = planMemoryWrite({
    userId: "user-123",
    content: "Transactions:\n2026-06-26, Starbucks, -$5.00",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(manualCsvTransactionRows.status, "excluded");
  assert.equal(manualCsvTransactionRows.record, null);

  const manualCardEnding = planMemoryWrite({
    userId: "user-123",
    content: "My debit card ending in 1234 is for grocery purchases.",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(manualCardEnding.status, "excluded");
  assert.equal(manualCardEnding.record, null);

  const standaloneLastFour = planMemoryWrite({
    userId: "user-123",
    content: "The last four digits are 1234.",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(standaloneLastFour.status, "excluded");
  assert.equal(standaloneLastFour.record, null);

  const manualCheckingAccountHasAmount = planMemoryWrite({
    userId: "user-123",
    content: "My checking account has $5,000.",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(manualCheckingAccountHasAmount.status, "excluded");
  assert.equal(manualCheckingAccountHasAmount.record, null);

  const manualAmountInSavings = planMemoryWrite({
    userId: "user-123",
    content: "I have $5,000 in my savings account.",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(manualAmountInSavings.status, "excluded");
  assert.equal(manualAmountInSavings.record, null);

  const ordinaryCheckIn = planMemoryWrite({
    userId: "user-123",
    content: "The user prefers checking in at 9 before standup.",
    trigger: "explicit_remember",
    sourceType: "manual",
    now,
  });
  assert.equal(ordinaryCheckIn.status, "review_required");
  assert.equal(ordinaryCheckIn.record?.content, "The user prefers checking in at 9 before standup.");
  console.log("OK: raw restricted-source records are excluded from normal MemoryOS");
}

async function testApprovalEditsRejectRawRestrictedContent(): Promise<void> {
  const pipelineSource = fs.readFileSync(path.resolve(process.cwd(), "server/memory/writePipeline.ts"), "utf8");
  assert.match(
    pipelineSource,
    /approvePendingMemoryWrite[\s\S]*containsRawRestrictedContent\(rawContent\)[\s\S]*containsRawRestrictedContent\(content\)[\s\S]*Edited memory content contains raw restricted details[\s\S]*SELECT id, content, source_type, source_ref, sensitivity, provenance, supersedes_memory_id[\s\S]*hasRestrictedApprovalMetadata\(existingRow\)[\s\S]*Pending memory source is restricted[\s\S]*containsRawRestrictedContent\(existingContent\)[\s\S]*Pending memory content contains raw restricted details[\s\S]*UPDATE user_memories/,
    "Approval edits and keeps should reject raw restricted content before updating pending memories",
  );
  assert.match(
    pipelineSource,
    /keepPendingMemoryWrites[\s\S]*SELECT id, content, source_type, source_ref, sensitivity, provenance, supersedes_memory_id[\s\S]*safeMemoryIds[\s\S]*hasRestrictedApprovalMetadata\(row\)[\s\S]*containsRawRestrictedContent\(row\.content \?\? ""\)[\s\S]*UPDATE user_memories[\s\S]*AND id = ANY\(\$\{safeMemoryIds\}::varchar\[\]\)/,
    "Bulk approval should validate pending content before promoting memories",
  );
  console.log("OK: approval edits reject raw restricted details before DB updates");
}

async function testApprovedRestrictedSummariesCarryMetadata(): Promise<void> {
  const { planMemoryWrite } = await loadPipeline();
  const plan = planMemoryWrite({
    userId: "user-123",
    content: "The user's food delivery spending was higher than usual this week.",
    trigger: "inferred",
    sourceType: "plaid",
    sourceRef: "plaid-weekly-summary",
    restrictedSummaryApproved: true,
    provenance: [{
      sourceType: "plaid_transaction_rollup",
      sourceRef: "rollup-2026-06-26",
      restricted: true,
      label: "weekly spending rollup",
    }],
    now,
  });

  assert.equal(plan.status, "auto_write_memory");
  assert.equal(plan.record?.pendingReview, false);
  assert.equal(plan.record?.reviewStatus, "active");
  assert.equal(plan.record?.sourceType, "restricted_summary");
  assert.equal(plan.record?.sensitivity, "restricted_summary");
  assert.equal(plan.record?.provenance[0]?.restricted, true);
  assert.equal(plan.record?.provenance[0]?.sensitivity, "restricted_summary");
  assert.equal(plan.record?.provenance[0]?.sourceRef, "rollup-2026-06-26");
  console.log("OK: approved restricted summaries retain provenance and sensitivity metadata");
}

async function testApprovedRestrictedSummariesRejectRawDetails(): Promise<void> {
  const { planMemoryWrite } = await loadPipeline();
  const plan = planMemoryWrite({
    userId: "user-123",
    content: "Approved summary: routing number 021000021 appeared in the data.",
    trigger: "inferred",
    sourceType: "plaid",
    restrictedSummaryApproved: true,
    reviewEnabled: false,
    now,
  });

  assert.equal(plan.status, "excluded");
  assert.equal(plan.record, null);
  assert.match(plan.reason, /must not include raw account/);
  console.log("OK: approved restricted summaries still reject raw financial identifiers");
}

async function testConflictSupersessionIsPlannedForApproval(): Promise<void> {
  const { buildApprovedMemorySupersessions, buildMemoryApprovalResolution, planMemoryWrite } = await loadPipeline();
  const plan = planMemoryWrite({
    userId: "user-123",
    content: "Replit notifications are not generally important.",
    trigger: "explicit_remember",
    category: "preferences",
    supersedesMemoryId: "old-replit-memory",
    now,
  });

  assert.equal(plan.status, "review_required");
  assert.equal(plan.record?.supersedesMemoryId, "old-replit-memory");
  assert.deepEqual(plan.supersedeMemoryIds, ["old-replit-memory"]);

  const resolution = buildMemoryApprovalResolution({
    approvedMemoryId: "new-replit-memory",
    supersedesMemoryId: plan.record?.supersedesMemoryId,
  });
  assert.deepEqual(resolution, {
    approvedMemoryId: "new-replit-memory",
    supersedeMemoryIds: ["old-replit-memory"],
    correctedByMemoryId: "new-replit-memory",
  });
  assert.deepEqual(buildApprovedMemorySupersessions([
    { id: "new-replit-memory", supersedes_memory_id: "old-replit-memory" },
    { id: "standalone-memory", supersedes_memory_id: null },
  ]), [
    { approvedMemoryId: "new-replit-memory", supersedesMemoryId: "old-replit-memory" },
  ]);
  console.log("OK: approved corrections supersede older active memories");
}

async function main(): Promise<void> {
  await testWorkingContextRecordShape();
  await testWorkingContextPersistsThroughDeps();
  await testExpiredWorkingContextCompactsIntoRecentContext();
  await testDefaultCompactionEmbedsRecentContext();
  await testDefaultCompactionClaimsExpiredContextBeforeInsert();
  await testWorkingContextMigrationsAddReviewColumnsBeforeIndex();
  await testPendingApprovalRequiresPendingStatus();
  await testEditedApprovalRefreshesEmbedding();
  await testRecentContextMemoryShape();
  await testExplicitRememberRequiresReview();
  await testExplicitRememberHonorsDisabledReviewGate();
  await testDiagnosticWritesAreExcluded();
  await testRawRestrictedSourceWritesAreExcluded();
  await testApprovalEditsRejectRawRestrictedContent();
  await testApprovedRestrictedSummariesCarryMetadata();
  await testApprovedRestrictedSummariesRejectRawDetails();
  await testConflictSupersessionIsPlannedForApproval();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
