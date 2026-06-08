import assert from "node:assert/strict";
import { executeRuntimeReadOnly } from "../index";

const now = new Date("2026-06-08T15:00:00.000Z");

function event(message: string, eventId = "event-readonly") {
  return {
    eventId,
    source: "app",
    userId: "user-readonly",
    message,
    createdAt: now.toISOString(),
  };
}

{
  const result = executeRuntimeReadOnly({
    event: event("What can you do?"),
    now,
  });

  assert.equal(result.execution.owner, "core_runtime");
  assert.equal(result.execution.mode, "read_only");
  assert.equal(result.execution.status, "completed");
  assert.equal(result.execution.intent, "general");
  assert.equal(result.execution.executedToolCount, 0);
  assert.deepEqual(result.execution.sideEffects, []);
  assert.match(result.execution.response, /Runtime handled this read-only general request/);
  assert.match(result.execution.response, /No tools were executed and no state was changed/);
  console.log("OK: Runtime read-only executor owns safe inline answers without side effects");
}

{
  const result = executeRuntimeReadOnly({
    event: event("What memory do you have about morning planning?", "event-readonly-memory"),
    now,
  });

  assert.equal(result.gateResult.outcome, "inline_answer");
  assert.equal(result.execution.status, "completed");
  assert.equal(result.execution.intent, "memory_query");
  assert.match(result.execution.response, /memory_context/);
  assert.equal(result.execution.executedToolCount, 0);
  console.log("OK: Runtime read-only executor can complete memory-shaped read-only decisions");
}

{
  const result = executeRuntimeReadOnly({
    event: event("Send this email to Bill.", "event-readonly-email"),
    now,
  });

  assert.equal(result.gateResult.outcome, "needs_approval");
  assert.equal(result.decision.approval.required, true);
  assert.equal(result.execution.status, "declined");
  assert.match(result.execution.reason, /requires approval/);
  assert.equal(result.execution.executedToolCount, 0);
  console.log("OK: Runtime read-only executor declines approval-required decisions");
}

{
  const result = executeRuntimeReadOnly({
    event: {
      source: "app",
      message: "Missing required user and event identifiers.",
      createdAt: now.toISOString(),
    },
    now,
  });

  assert.equal(result.gateResult.outcome, "blocked");
  assert.equal(result.execution.status, "blocked");
  assert.match(result.execution.reason, /blocked/);
  assert.equal(result.execution.executedToolCount, 0);
  console.log("OK: Runtime read-only executor stays blocked for invalid events");
}

console.log("\nAll Runtime Read-Only Executor assertions passed.");
