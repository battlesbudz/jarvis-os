import assert from "node:assert/strict";
import { RUNTIME_GOLDEN_DRY_RUN_FIXTURES, runRuntimeDryRun } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

for (const fixture of RUNTIME_GOLDEN_DRY_RUN_FIXTURES) {
  const result = runRuntimeDryRun({
    event: {
      eventId: `event-${fixture.id}`,
      source: "app",
      userId: "user-1",
      message: fixture.message,
      createdAt: now.toISOString(),
    },
    now,
  });

  assert.equal(result.report.intent, fixture.expectedIntent, `${fixture.id} intent`);
  assert.equal(result.report.status, fixture.expectedStatus, `${fixture.id} status`);
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
