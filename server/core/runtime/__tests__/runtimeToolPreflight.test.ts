import assert from "node:assert/strict";
import { previewRuntimeToolPreflight } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

function event(message: string, eventId = "event-1") {
  return {
    eventId,
    source: "app",
    userId: "user-1",
    message,
    createdAt: now.toISOString(),
  };
}

{
  const result = previewRuntimeToolPreflight({
    event: event("What memory do you have about morning planning?", "event-memory-preflight"),
    now,
  });

  assert.equal(result.decision.intent, "memory_query");
  assert.equal(result.gateResult.outcome, "inline_answer");
  assert.ok(result.toolPreflight.ready.length > 0);
  assert.equal(result.toolPreflight.blocked.length, 0);
  assert.ok(result.toolPreflight.tools.every((tool) => tool.status === "ready"));
  console.log("OK: Runtime preflight marks virtual read-only intents ready");
}

{
  const result = previewRuntimeToolPreflight({
    event: event("Send this email to Bill.", "event-email-preflight"),
    now,
    policy: {
      approvalRequiredTools: ["approval_gated_action"],
    },
  });

  assert.equal(result.decision.responseMode, "approval_required");
  assert.equal(result.gateResult.outcome, "needs_approval");
  assert.ok(result.toolPreflight.blocked.some((tool) => tool.status === "approval_required"));
  assert.ok(result.toolPreflight.tools.every((tool) => tool.status !== "ready" || !tool.intent.approvalRequired));
  console.log("OK: Runtime preflight preserves approval-required tool intents");
}

{
  const result = previewRuntimeToolPreflight({
    event: event("Research the latest cannabis licensing updates.", "event-research-preflight"),
    now,
    policy: {
      blockedTools: ["search"],
    },
  });

  assert.equal(result.decision.responseMode, "queue");
  assert.ok(result.toolPreflight.blocked.some((tool) => tool.intent.toolName === "search"));
  assert.equal(
    result.toolPreflight.blocked.find((tool) => tool.intent.toolName === "search")?.status,
    "blocked_by_policy",
  );
  console.log("OK: Runtime preflight applies policy blocks to runtime tool intents");
}

{
  const result = previewRuntimeToolPreflight({
    event: event("Fix this bug in the repo and run the tests.", "event-code-preflight"),
    now,
  });

  assert.equal(result.decision.intent, "code_work");
  assert.equal(result.decision.responseMode, "approval_required");
  assert.ok(result.toolPreflight.tools.some((tool) => tool.intent.toolName === "local_patch"));
  assert.ok(result.toolPreflight.tools.some((tool) => tool.intent.toolName === "run_checks"));
  assert.ok(result.toolPreflight.tools.every((tool) => tool.status !== "blocked_by_policy"));
  console.log("OK: Runtime preflight recognizes code-work virtual tool allowances");
}

{
  const result = previewRuntimeToolPreflight({
    event: {
      source: "app",
      message: "Invalid runtime event.",
      createdAt: now.toISOString(),
    },
    now,
  });

  assert.equal(result.decision.responseMode, "blocked");
  assert.equal(result.toolPreflight.tools.length, 0);
  assert.equal(result.toolPreflight.ready.length, 0);
  assert.equal(result.toolPreflight.blocked.length, 0);
  console.log("OK: Runtime preflight keeps invalid-event fail-closed path tool-free");
}

console.log("\nAll Runtime Tool Preflight preview assertions passed.");
