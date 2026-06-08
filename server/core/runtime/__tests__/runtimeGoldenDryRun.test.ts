import assert from "node:assert/strict";
import {
  executeRuntimeReadOnly,
  formatRuntimePreview,
  jarvisEventFromMessage,
  RUNTIME_GOLDEN_DRY_RUN_FIXTURES,
  runRuntimeDryRun,
} from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

assert.ok(RUNTIME_GOLDEN_DRY_RUN_FIXTURES.length >= 10, "runtime golden fixtures cover the documented workflow set");
const runtimeOwnedFixtures = RUNTIME_GOLDEN_DRY_RUN_FIXTURES.filter((fixture) => fixture.expectedRuntimeOwner === "core_runtime");
assert.deepEqual(
  runtimeOwnedFixtures.map((fixture) => fixture.id).sort(),
  ["email-draft-reply", "general-answer", "memory-lookup", "next-meeting-brief"],
  "runtime-owned golden fixtures stay limited to the migrated read-only batch",
);

for (const fixture of RUNTIME_GOLDEN_DRY_RUN_FIXTURES) {
  const event = jarvisEventFromMessage({
    eventId: `event-${fixture.id}`,
    source: fixture.source ?? "app",
    userId: "user-1",
    message: fixture.message,
    channel: fixture.channel,
    createdAt: now.toISOString(),
    metadata: fixture.metadata,
  });
  const result = runRuntimeDryRun({
    event,
    now,
  });

  assert.equal(result.report.intent, fixture.expectedIntent, `${fixture.id} intent`);
  assert.equal(result.report.status, fixture.expectedStatus, `${fixture.id} status`);
  if (fixture.expectedResponseMode) {
    assert.equal(result.report.responseMode, fixture.expectedResponseMode, `${fixture.id} response mode`);
  }
  if (fixture.expectedGateOutcome) {
    assert.equal(result.report.gateOutcome, fixture.expectedGateOutcome, `${fixture.id} gate outcome`);
  }
  if (fixture.expectedApprovalRequired !== undefined) {
    assert.equal(result.report.approvalRequired, fixture.expectedApprovalRequired, `${fixture.id} approval flag`);
  }
  if (fixture.expectedRuntimeOwner === "core_runtime") {
    const execution = executeRuntimeReadOnly({ event, now });
    assert.equal(execution.execution.status, "completed", `${fixture.id} runtime execution status`);
    assert.equal(execution.execution.owner, "core_runtime", `${fixture.id} runtime owner`);
    assert.equal(execution.execution.executedToolCount, 0, `${fixture.id} executed tool count`);
  }
  if (fixture.id === "diagnostics-route-approval-preview") {
    assert.equal(result.preview.event.channel, "settings-runtime-preview");
    assert.ok(result.approvalPreview, "diagnostics route fixture returns approval preview");
    assert.match(formatRuntimePreview(result), /Runtime preview: needs_approval/);
    assert.doesNotMatch(JSON.stringify(result.report), /should-not-leak/);
  }
  assert.equal(result.preview.decision.userId, "user-1");
  console.log(`OK: Runtime golden dry run fixture ${fixture.id}`);
}

{
  const result = runRuntimeDryRun({
    event: {
      source: "app",
      createdAt: now.toISOString(),
    },
    now,
  });

  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.intent, "invalid_event");
  console.log("OK: Runtime golden dry run covers invalid event fail-closed path");
}

console.log("\nAll Runtime Golden Dry Run assertions passed.");
