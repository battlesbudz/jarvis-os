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
  const match = matchRuntimeOwnedGoldenWorkflow(runtime);

  assert.equal(match?.workflowId, "memory-lookup");
  assert.equal(isRuntimeOwnedGoldenWorkflowAllowed("memory-lookup", ["general-answer"]), false);
  assert.equal(isRuntimeOwnedGoldenWorkflowAllowed("memory-lookup", ["memory-lookup"]), true);
  console.log("OK: Runtime-owned golden workflow matcher recognizes memory lookup boundary");
}

{
  const runtime = executeRuntimeReadOnly({
    event: event("Draft a reply to this email.", "event-runtime-owned-email-draft"),
    now,
  });
  const match = matchRuntimeOwnedGoldenWorkflow(runtime);

  assert.equal(match?.workflowId, "email-draft-reply");
  console.log("OK: Runtime-owned golden workflow matcher recognizes draft-only email boundary");
}

{
  const runtime = executeRuntimeReadOnly({
    event: event("Prepare me for my next meeting.", "event-runtime-owned-meeting"),
    now,
  });
  const match = matchRuntimeOwnedGoldenWorkflow(runtime);

  assert.equal(match?.workflowId, "next-meeting-brief");
  console.log("OK: Runtime-owned golden workflow matcher recognizes next-meeting brief boundary");
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
