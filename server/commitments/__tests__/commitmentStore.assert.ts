import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  canonicalCommitmentDedupeKey,
  createOrMergeCommitment,
  isPersonalCommitment,
  MAX_COMMITMENT_HISTORY_REVISIONS,
  resolveCommitmentSemantics,
  scopedCommitmentDedupeKey,
  type CommitmentRepository,
  type StoredCommitment,
} from "../commitmentStore";

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

function testCommitmentStorageContract(): void {
  const schema = read("shared/schema.ts");
  const boot = read("server/db.ts");
  const rootMigration = read("migrations/0016_commitment_semantics.sql");
  const serverMigration = read("server/migrations/018_commitment_semantics.sql");

  for (const field of [
    'commitmentKind: varchar("commitment_kind")',
    'signalLevel: varchar("signal_level")',
    'dedupeKey: varchar("dedupe_key")',
    'sourceType: varchar("source_type")',
    'updatedAt: timestamp("updated_at")',
    'history: jsonb("history")',
  ]) {
    assert.ok(schema.includes(field), `commitments schema should include ${field}`);
  }

  for (const source of [boot, rootMigration, serverMigration]) {
    assert.match(source, /CREATE EXTENSION IF NOT EXISTS pgcrypto/);
    assert.match(source, /commitment_kind VARCHAR NOT NULL DEFAULT 'user_commitment'/);
    assert.match(source, /signal_level VARCHAR NOT NULL DEFAULT 'normal'/);
    assert.match(source, /dedupe_key VARCHAR/);
    assert.match(source, /source_type VARCHAR NOT NULL DEFAULT 'legacy'/);
    assert.match(source, /history JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    assert.match(source, /commitments_pending_personal_updated_idx/);
    assert.match(source, /commitments_pending_dedupe_idx/);
    assert.match(source, /'kind:' \|\| commitment_kind/);
    assert.match(source, /topic:content_/);
    assert.match(source, /jsonb_array_elements/);
    assert.match(source, /kind:\[\^:\]\+:topic:content_/);
    assert.match(source, /updated_at IS NULL/);
    assert.match(source, /ELSE 'legacy_import'/);
  }

  const repository = read("server/commitments/dbCommitmentRepository.ts");
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /personalCommitmentCondition/);
  assert.match(repository, /pendingPersonalCommitmentCondition/);

  for (const relPath of [
    "server/agent/tools/manageTasks.ts",
    "server/channels/coachAgent.ts",
    "server/goalScheduler.ts",
    "server/routes.ts",
    "server/routes/coachSessionRoutes.ts",
    "server/routes/coachReviewRoutes.ts",
    "server/routes/commitmentRoutes.ts",
    "server/telegramRoutes.ts",
  ]) {
    assert.match(
      read(relPath),
      /listPendingPersonalCommitments|pendingPersonalCommitmentCondition|personalCommitmentCondition/,
      `${relPath} should use the canonical personal commitment filter`,
    );
  }

  const groundedEvidence = read("server/state/groundedEvidencePacket.ts");
  assert.match(groundedEvidence, /isPersonalCommitment/);
  assert.doesNotMatch(groundedEvidence, /commitmentIncidentKey/);
  const commitmentRoutes = read("server/routes/commitmentRoutes.ts");
  assert.match(commitmentRoutes, /listPendingCommitmentsForReview/);
  assert.match(commitmentRoutes, /req\.query\.scope/);
  assert.match(commitmentRoutes, /updateCommitmentInDb/);
  assert.match(commitmentRoutes, /commitmentKind/);
  const manageTasks = read("server/agent/tools/manageTasks.ts");
  assert.match(manageTasks, /resolveCommitmentSemantics/);
  assert.match(manageTasks, /Optional add_commitment classification override/);
  assert.doesNotMatch(manageTasks, /commitment_kind and signal_level are required/);
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /JARVIS_TEST_DATABASE_URL/);
  assert.match(ci, /pgvector\/pgvector:pg16/);
  const testRunner = read("scripts/run-agent-tests.mjs");
  assert.match(testRunner, /scripts\/prepare-test-database\.ts/);
  const testDatabasePreparer = read("scripts/prepare-test-database.ts");
  assert.match(testDatabasePreparer, /JARVIS_TEST_DATABASE_URL/);
  assert.match(testDatabasePreparer, /drizzle-kit/);
  assert.match(testDatabasePreparer, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(testDatabasePreparer, /\[drizzleCli, "push", "--force"\]/);
  assert.match(testDatabasePreparer, /await import\("\.\.\/server\/db"\)/);
  console.log("OK: commitment storage and read paths enforce the typed contract");
}

function testSourceAwareCommitmentSemantics(): void {
  assert.deepEqual(resolveCommitmentSemantics({
    content: "Investigate the repeated service health alert.",
    sourceType: "heartbeat/crew",
  }), {
    commitmentKind: "operational_incident",
    signalLevel: "normal",
    sourceType: "heartbeat_crew",
  });

  assert.deepEqual(resolveCommitmentSemantics({
    content: "Acknowledge an informational phone notification.",
    sourceType: "android notification",
  }), {
    commitmentKind: "notification",
    signalLevel: "low",
    sourceType: "android_notification",
  });

  assert.deepEqual(resolveCommitmentSemantics({
    content: "Review the production checklist tomorrow.",
    sourceType: "heartbeat/crew",
    commitmentKind: "user_task",
    signalLevel: "normal",
  }), {
    commitmentKind: "user_task",
    signalLevel: "normal",
    sourceType: "heartbeat_crew",
  });

  console.log("OK: commitment semantics use typed source metadata instead of product phrases");
}

function testCanonicalCommitmentKeys(): void {
  assert.equal(
    canonicalCommitmentDedupeKey("First wording", " Service Config / Missing Secret "),
    "topic:service_config_missing_secret",
  );
  assert.equal(
    canonicalCommitmentDedupeKey("  Review   the checklist tomorrow. "),
    canonicalCommitmentDedupeKey("review the CHECKLIST tomorrow."),
  );
  assert.notEqual(
    canonicalCommitmentDedupeKey("Review the checklist tomorrow."),
    canonicalCommitmentDedupeKey("Call the supplier tomorrow."),
  );
  assert.notEqual(
    scopedCommitmentDedupeKey("user_task", "Review the checklist.", "review-checklist"),
    scopedCommitmentDedupeKey("operational_incident", "Review the checklist.", "review-checklist"),
  );
  console.log("OK: commitment dedupe keys are stable and domain-independent");
}

function testPersonalCommitmentVisibility(): void {
  assert.equal(isPersonalCommitment({ commitmentKind: "user_commitment", signalLevel: "normal" }), true);
  assert.equal(isPersonalCommitment({ commitmentKind: "user_task", signalLevel: "normal" }), true);
  assert.equal(isPersonalCommitment({ commitmentKind: "operational_incident", signalLevel: "normal" }), false);
  assert.equal(isPersonalCommitment({ commitmentKind: "notification", signalLevel: "low" }), false);
  assert.equal(isPersonalCommitment({ commitmentKind: "user_commitment", signalLevel: "low" }), false);
  console.log("OK: personal commitment visibility is driven by stored types");
}

async function testCreateOrMergeCommitment(): Promise<void> {
  let stored: StoredCommitment | null = null;
  let inserts = 0;
  let updates = 0;
  const repository: CommitmentRepository = {
    async findPendingByDedupeKey(userId, dedupeKey) {
      return stored?.userId === userId && stored.dedupeKey === dedupeKey ? stored : null;
    },
    async insert(values) {
      inserts += 1;
      stored = { id: "commitment-1", ...values };
      return stored;
    },
    async update(id, values) {
      updates += 1;
      assert.equal(id, "commitment-1");
      assert.ok(stored);
      stored = { ...stored, ...values };
      return stored;
    },
  };

  const created = await createOrMergeCommitment({
    userId: "user-1",
    content: "Investigate the service configuration warning.",
    sourceType: "heartbeat/crew",
    commitmentKind: "operational_incident",
    signalLevel: "normal",
    dedupeKey: "service:missing_config",
    sourceMessage: "Added via heartbeat/crew",
  }, repository);
  const merged = await createOrMergeCommitment({
    userId: "user-1",
    content: "Verify the missing configuration and restart the affected service.",
    dueDate: "2026-07-13",
    sourceType: "heartbeat/crew",
    commitmentKind: "operational_incident",
    signalLevel: "normal",
    dedupeKey: "service:missing_config",
    sourceMessage: "Added via heartbeat/crew",
  }, repository);

  assert.equal(created.action, "created");
  assert.equal(merged.action, "merged");
  assert.equal(created.commitment.id, merged.commitment.id);
  assert.equal(inserts, 1);
  assert.equal(updates, 1);
  assert.equal(merged.commitment.content, "Investigate the service configuration warning.");
  assert.equal(merged.commitment.dueDate, "2026-07-13");
  assert.equal(merged.commitment.dedupeKey, "kind:operational_incident:topic:service_missing_config");
  assert.equal(merged.commitment.history.length, 1);
  assert.equal(merged.commitment.history[0]?.content, "Verify the missing configuration and restart the affected service.");
  const repeated = await createOrMergeCommitment({
    userId: "user-1",
    content: merged.commitment.content,
    dueDate: merged.commitment.dueDate,
    sourceType: "heartbeat/crew",
    commitmentKind: "operational_incident",
    signalLevel: "normal",
    dedupeKey: "service:missing_config",
    sourceMessage: "Added via heartbeat/crew",
  }, repository);
  assert.equal(repeated.commitment.history.length, 1, "identical repeats should not grow history");
  const proposedDateChange = await createOrMergeCommitment({
    userId: "user-1",
    content: "Move the service configuration work to next month.",
    dueDate: "2026-08-13",
    sourceType: "heartbeat/crew",
    commitmentKind: "operational_incident",
    signalLevel: "normal",
    dedupeKey: "service:missing_config",
    sourceMessage: "Added via heartbeat/crew",
  }, repository);
  assert.equal(proposedDateChange.commitment.dueDate, "2026-07-13", "dedupe must not overwrite a due date");
  assert.equal(proposedDateChange.commitment.history.at(-1)?.dueDate, "2026-08-13");

  let latest = proposedDateChange;
  for (let index = 0; index < MAX_COMMITMENT_HISTORY_REVISIONS + 5; index += 1) {
    latest = await createOrMergeCommitment({
      userId: "user-1",
      content: `Service configuration revision ${index + 1}.`,
      sourceType: "heartbeat/crew",
      commitmentKind: "operational_incident",
      signalLevel: "normal",
      dedupeKey: "service:missing_config",
      sourceMessage: "Added via heartbeat/crew",
    }, repository);
  }
  assert.equal(latest.commitment.history.length, MAX_COMMITMENT_HISTORY_REVISIONS);
  console.log("OK: commitment ingestion merges repeated typed topics instead of creating duplicates");
}

async function main(): Promise<void> {
  testCommitmentStorageContract();
  testSourceAwareCommitmentSemantics();
  testCanonicalCommitmentKeys();
  testPersonalCommitmentVisibility();
  await testCreateOrMergeCommitment();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
