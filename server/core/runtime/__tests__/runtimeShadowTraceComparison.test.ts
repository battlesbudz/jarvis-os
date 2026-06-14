import assert from "node:assert/strict";
import { buildMindTrace } from "../../../agent/mindTrace";
import { runtimeDecisionFromMindTrace } from "../../../core/protocol";
import {
  compareRuntimeShadowWithMindTrace,
  formatRuntimeShadowTraceComparison,
  runRuntimeEvent,
} from "../index";

async function main(): Promise<void> {
  const now = new Date("2026-06-08T13:00:00.000Z");

  {
    const trace = buildMindTrace({
      traceId: "trace-shadow-memory",
      userId: "user-shadow",
      userRequest: "What memory do you have about morning planning?",
      channel: "appchat",
      now,
    });
    const shadowDecision = await runRuntimeEvent({
      eventId: "event-shadow-memory",
      source: "app",
      userId: "user-shadow",
      message: "What memory do you have about morning planning?",
      channel: "appchat",
      createdAt: now.toISOString(),
    }, { now });
    const comparison = compareRuntimeShadowWithMindTrace({ shadowDecision, mindTrace: trace });

    assert.equal(comparison.status, "aligned");
    assert.deepEqual(comparison.matches, {
      intent: true,
      responseMode: true,
      riskTier: true,
      approvalRequired: true,
    });
    assert.match(formatRuntimeShadowTraceComparison(comparison), /aligned/);
    console.log("OK: runtime shadow comparison aligns matching memory traces");
  }

  {
    const trace = buildMindTrace({
      traceId: "trace-shadow-email",
      userId: "user-shadow",
      userRequest: "Send this email to Bill.",
      channel: "appchat",
      now,
      toolsCalled: [
        {
          name: "send_email",
          status: "blocked",
          approvalRequired: true,
          error: "Approval required before sending email.",
        },
      ],
    });
    const unsafeShadowDecision = runtimeDecisionFromMindTrace(trace, {
      userId: "user-shadow",
      decisionId: "decision-shadow-email",
    });
    const memoryTrace = buildMindTrace({
      traceId: "trace-shadow-mismatch",
      userId: "user-shadow",
      userRequest: "What memory do you have about morning planning?",
      channel: "appchat",
      now,
    });
    const comparison = compareRuntimeShadowWithMindTrace({
      shadowDecision: unsafeShadowDecision,
      mindTrace: memoryTrace,
    });

    assert.equal(comparison.status, "degraded");
    assert.equal(comparison.matches.intent, false);
    assert.equal(comparison.matches.approvalRequired, false);
    assert.match(formatRuntimeShadowTraceComparison(comparison), /Approval differs/);
    console.log("OK: runtime shadow comparison flags approval and intent mismatches");
  }

  console.log("\nAll runtime shadow trace comparison assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
