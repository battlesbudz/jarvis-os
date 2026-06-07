import assert from "node:assert/strict";
import { buildRuntimeApprovalPreview } from "../index";
import { parseRuntimeDecision } from "../../protocol";

{
  const preview = buildRuntimeApprovalPreview(parseRuntimeDecision({
    decisionId: "decision-no-approval",
    eventId: "event-no-approval",
    userId: "user-1",
    intent: "memory_query",
    confidence: 0.9,
    riskTier: "T0",
    responseMode: "answer",
    tools: [],
    approval: {
      required: false,
      status: "not_required",
    },
    modelRoute: {
      provider: "runtime-test",
      model: "deterministic",
      reason: "No approval test.",
    },
    trace: {
      traceId: "trace-no-approval",
      source: "runtime",
    },
    createdAt: "2026-06-08T13:00:00.000Z",
  }));

  assert.equal(preview, null);
  console.log("OK: Runtime approval preview returns null when approval is not required");
}

{
  const preview = buildRuntimeApprovalPreview(parseRuntimeDecision({
    decisionId: "decision-approval",
    eventId: "event-approval",
    userId: "user-1",
    intent: "email_action",
    confidence: 0.9,
    riskTier: "T3",
    responseMode: "approval_required",
    tools: [
      {
        toolName: "send_email",
        status: "approval_required",
        riskTier: "T3",
        approvalRequired: true,
        reason: "Send email requires approval.",
        argsPreview: {
          to: "bill@example.com",
          accessToken: "secret-token",
        },
      },
    ],
    approval: {
      required: true,
      status: "pending",
      gateId: "gate-email",
      reason: "Email send needs user confirmation.",
    },
    modelRoute: {
      provider: "runtime-test",
      model: "deterministic",
      reason: "Approval test.",
    },
    trace: {
      traceId: "trace-approval",
      source: "runtime",
    },
    createdAt: "2026-06-08T13:00:00.000Z",
  }));

  assert.ok(preview);
  assert.equal(preview.approvalId, "gate-email");
  assert.equal(preview.responseMode, "approval_required");
  assert.equal(preview.tools[0]?.toolName, "send_email");
  assert.equal((preview.tools[0]?.argsPreview as { accessToken?: string }).accessToken, "[redacted]");
  assert.equal((preview.tools[0]?.argsPreview as { to?: string }).to, "bill@example.com");
  console.log("OK: Runtime approval preview redacts approval tool args");
}

console.log("\nAll Runtime Approval Preview assertions passed.");
