import assert from "node:assert/strict";
import { executeRuntimeEvent } from "../index";

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
  const result = executeRuntimeEvent({
    event: event("What can you do?"),
    now,
  });

  assert.equal(result.gateResult.outcome, "inline_answer");
  assert.equal(result.decision.riskTier, "T0");
  assert.equal(result.decision.responseMode, "answer");
  assert.equal(result.decision.approval.required, false);
  assert.ok(result.contextPacket.sources.some((source) => source.label === "always_on_kernel"));
  assert.ok(result.decision.tools.every((tool) => tool.status === "proposed"));
  console.log("OK: Runtime Gate maps a general question to a read-only inline answer");
}

{
  const result = executeRuntimeEvent({
    event: event("What memory do you have about morning planning?", "event-memory"),
    now,
  });

  assert.equal(result.gateResult.taskType, "memory_query");
  assert.equal(result.decision.intent, "memory_query");
  assert.equal(result.decision.riskTier, "T0");
  assert.equal(result.decision.responseMode, "answer");
  assert.ok(result.contextPacket.sources.some((source) => source.kind === "memory"));
  console.log("OK: Runtime Gate turns a memory query into a ContextPacket and RuntimeDecision");
}

{
  const result = executeRuntimeEvent({
    event: event("Send this email to Bill.", "event-email"),
    now,
  });

  assert.equal(result.gateResult.outcome, "needs_approval");
  assert.equal(result.decision.intent, "email_action");
  assert.equal(result.decision.riskTier, "T3");
  assert.equal(result.decision.responseMode, "approval_required");
  assert.equal(result.decision.approval.required, true);
  assert.ok(result.decision.tools.some((tool) => tool.status === "approval_required"));
  assert.ok(result.decision.tools.every((tool) => tool.status !== "executed"));
  console.log("OK: Runtime Gate preserves approval boundary for external email actions");
}

{
  const result = executeRuntimeEvent({
    event: event("Open my phone and tap Instagram.", "event-daemon"),
    now,
  });

  assert.equal(result.gateResult.outcome, "needs_approval");
  assert.equal(result.decision.intent, "daemon_action");
  assert.equal(result.decision.riskTier, "T3");
  assert.equal(result.decision.responseMode, "approval_required");
  assert.equal(result.decision.approval.status, "pending");
  assert.ok(result.contextPacket.sources.some((source) => source.label === "daemon_context"));
  console.log("OK: Runtime Gate keeps daemon/device actions approval-gated");
}

{
  const result = executeRuntimeEvent({
    event: {
      source: "app",
      message: "Missing required user and event identifiers.",
      createdAt: now.toISOString(),
    },
    now,
  });

  assert.equal(result.gateResult.outcome, "blocked");
  assert.equal(result.decision.responseMode, "blocked");
  assert.equal(result.decision.riskTier, "T5");
  assert.equal(result.decision.errors[0]?.code, "INVALID_RUNTIME_EVENT");
  console.log("OK: Runtime Gate fails closed for invalid events");
}

console.log("\nAll Runtime Gate preview assertions passed.");
