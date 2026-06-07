import assert from "node:assert/strict";
import { tryRunRuntimeDryRun } from "../index";

const event = {
  eventId: "event-guarded-dry-run",
  source: "app" as const,
  userId: "user-1",
  message: "What can you do?",
  createdAt: "2026-06-08T13:00:00.000Z",
};

{
  const result = tryRunRuntimeDryRun({ event, now: new Date(event.createdAt) }, {});

  assert.equal("disabled" in result, true);
  if ("disabled" in result) {
    assert.match(result.reason, /disabled/);
  }
  console.log("OK: Guarded runtime dry run returns disabled result when flag is off");
}

{
  const result = tryRunRuntimeDryRun(
    { event, now: new Date(event.createdAt) },
    { JARVIS_RUNTIME_DRY_RUN: "1" },
  );

  assert.equal("disabled" in result, false);
  if (!("disabled" in result)) {
    assert.equal(result.report.status, "ready");
  }
  console.log("OK: Guarded runtime dry run executes preview when dry-run flag is enabled");
}

{
  assert.throws(
    () => tryRunRuntimeDryRun(
      { event, now: new Date(event.createdAt) },
      { JARVIS_RUNTIME_DRY_RUN: "1", JARVIS_RUNTIME_LIVE_EXECUTION: "1" },
    ),
    /not supported/,
  );
  console.log("OK: Guarded runtime dry run fails closed when live execution flag is enabled");
}

console.log("\nAll Guarded Runtime Dry Run assertions passed.");
