import assert from "node:assert/strict";
import { runRuntimeEvent } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

async function main() {
  const decision = await runRuntimeEvent(
    {
      eventId: "runtime-event-memory",
      source: "app",
      userId: "user-1",
      message: "What memory do you have about morning planning?",
      createdAt: now.toISOString(),
    },
    { now },
  );

  assert.equal(decision.intent, "memory_query");
  assert.equal(decision.responseMode, "answer");
  assert.equal(decision.approval.required, false);
  assert.ok(decision.tools.every((tool) => tool.status !== "executed"));
  console.log("OK: runRuntimeEvent returns a structured read-only runtime decision");

  const daemonDecision = await runRuntimeEvent(
    {
      eventId: "runtime-event-daemon",
      source: "daemon",
      userId: "user-1",
      message: "Open my phone and tap Instagram.",
      createdAt: now.toISOString(),
    },
    { now },
  );

  assert.equal(daemonDecision.intent, "daemon_action");
  assert.equal(daemonDecision.responseMode, "approval_required");
  assert.equal(daemonDecision.approval.required, true);
  assert.ok(daemonDecision.tools.some((tool) => tool.status === "approval_required"));
  assert.ok(daemonDecision.tools.every((tool) => tool.status !== "executed"));
  console.log("OK: runRuntimeEvent keeps daemon actions approval-gated and preview-only");

  console.log("\nAll runRuntimeEvent assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
