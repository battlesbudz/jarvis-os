import assert from "node:assert/strict";
import {
  buildRuntimeApprovalPreviewFromGate,
  runtimeDecisionFromApprovalGate,
} from "../index";
import type { RuntimeApprovalGateSnapshot } from "../runtimeApprovalGateBridge";

function gate(overrides: Partial<RuntimeApprovalGateSnapshot> = {}): RuntimeApprovalGateSnapshot {
  return {
    id: "gate_email_1",
    agentId: "agent_1",
    userId: "user_1",
    toolName: "send_email",
    toolArgs: {
      to: "bill@example.com",
      accessToken: "secret-token",
    },
    description: "Send email to Bill.",
    status: "pending",
    createdAt: new Date("2026-06-08T13:00:00.000Z"),
    initiatedBy: "user",
    ...overrides,
  };
}

async function main(): Promise<void> {
  {
    const decision = runtimeDecisionFromApprovalGate(gate());
    assert.equal(decision.intent, "email_action");
    assert.equal(decision.responseMode, "approval_required");
    assert.equal(decision.approval.status, "pending");
    assert.equal(decision.approval.gateId, "gate_email_1");
    assert.equal(decision.tools[0]?.status, "approval_required");
    console.log("OK: approval gate bridge creates pending runtime approval decisions");
  }

  {
    const preview = buildRuntimeApprovalPreviewFromGate(gate());
    assert.equal(preview.approvalId, "gate_email_1");
    assert.equal(preview.tools[0]?.toolName, "send_email");
    assert.equal((preview.tools[0]?.argsPreview as { accessToken?: string }).accessToken, "[redacted]");
    assert.equal((preview.tools[0]?.argsPreview as { to?: string }).to, "bill@example.com");
    console.log("OK: approval gate bridge reuses runtime redaction for previews");
  }

  {
    const decision = runtimeDecisionFromApprovalGate(gate({
      id: "gate_expired_1",
      status: "expired",
      toolName: "daemon_action",
      description: "Run a desktop shell command.",
    }));
    assert.equal(decision.intent, "daemon_action");
    assert.equal(decision.approval.status, "blocked");
    assert.equal(decision.tools[0]?.status, "blocked_by_policy");
    console.log("OK: approval gate bridge maps expired gates to blocked previews");
  }

  console.log("\nAll runtime approval gate bridge assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
