import assert from "node:assert/strict";
import { previewRuntimeToolPreflight, summarizeRuntimePreview } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

function event(message: string, eventId = "event-report") {
  return {
    eventId,
    source: "app",
    userId: "user-1",
    message,
    createdAt: now.toISOString(),
  };
}

{
  const report = summarizeRuntimePreview(previewRuntimeToolPreflight({
    event: event("What can you do?", "event-report-ready"),
    now,
  }));

  assert.equal(report.status, "ready");
  assert.equal(report.intent, "general");
  assert.equal(report.approvalRequired, false);
  assert.equal(report.blockedToolCount, 0);
  console.log("OK: Runtime preview report summarizes ready path");
}

{
  const report = summarizeRuntimePreview(previewRuntimeToolPreflight({
    event: event("Send this email to Bill.", "event-report-approval"),
    now,
  }));

  assert.equal(report.status, "needs_approval");
  assert.equal(report.responseMode, "approval_required");
  assert.equal(report.approvalRequired, true);
  assert.ok(report.blockedToolCount > 0);
  console.log("OK: Runtime preview report summarizes approval path");
}

{
  const report = summarizeRuntimePreview(previewRuntimeToolPreflight({
    event: event("Research the latest cannabis licensing updates.", "event-report-policy"),
    now,
    policy: {
      blockedTools: ["search"],
    },
  }));

  assert.equal(report.status, "blocked");
  assert.ok(report.reasons.some((reason) => reason.includes("blocked by runtime policy")));
  console.log("OK: Runtime preview report summarizes policy block path");
}

{
  const report = summarizeRuntimePreview(previewRuntimeToolPreflight({
    event: {
      source: "app",
      createdAt: now.toISOString(),
    },
    now,
  }));

  assert.equal(report.status, "blocked");
  assert.equal(report.intent, "invalid_event");
  assert.equal(report.riskTier, "T5");
  assert.ok(report.reasons.length > 0);
  console.log("OK: Runtime preview report summarizes invalid-event path");
}

console.log("\nAll Runtime Preview Report assertions passed.");
