import assert from "node:assert/strict";
import {
  executeRuntimeReadOnly,
  isRuntimeOwnedGoldenWorkflowAllowed,
  matchRuntimeOwnedGoldenWorkflow,
} from "../index";

const now = new Date("2026-06-08T17:00:00.000Z");

function event(message: string, eventId = "event-runtime-owned-workflow") {
  return {
    eventId,
    source: "app",
    userId: "user-runtime-owned-workflow",
    message,
    createdAt: now.toISOString(),
  };
}

{
  const runtime = executeRuntimeReadOnly({
    event: event("What can you do?"),
    now,
  });
  const match = matchRuntimeOwnedGoldenWorkflow(runtime);

  assert.equal(match?.workflowId, "general-answer");
  assert.equal(match?.owner, "core_runtime");
  assert.equal(isRuntimeOwnedGoldenWorkflowAllowed("general-answer", []), false);
  assert.equal(isRuntimeOwnedGoldenWorkflowAllowed("general-answer", ["general-answer"]), true);
  console.log("OK: Runtime-owned golden workflow matcher recognizes explicit general-answer boundary");
}

{
  const runtime = executeRuntimeReadOnly({
    event: event("What memory do you have about morning planning?", "event-runtime-owned-memory"),
    now,
  });

  assert.equal(matchRuntimeOwnedGoldenWorkflow(runtime), null);
  console.log("OK: Runtime-owned golden workflow matcher excludes non-general read-only workflows");
}

{
  const runtime = executeRuntimeReadOnly({
    event: event("Send this email to Bill.", "event-runtime-owned-approval"),
    now,
  });

  assert.equal(matchRuntimeOwnedGoldenWorkflow(runtime), null);
  console.log("OK: Runtime-owned golden workflow matcher excludes approval-required workflows");
}

console.log("\nAll Runtime-Owned Golden Workflow assertions passed.");
