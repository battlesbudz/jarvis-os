import assert from "node:assert/strict";
import {
  buildRuntimeApprovalWorkflow,
  buildRuntimeApprovalWorkflowFromGate,
} from "../index";
import { parseRuntimeDecision } from "../../protocol";
import type { RuntimeApprovalGateSnapshot } from "../runtimeApprovalGateBridge";

function gate(overrides: Partial<RuntimeApprovalGateSnapshot> = {}): RuntimeApprovalGateSnapshot {
  return {
    id: "gate_email_workflow",
    agentId: "agent_1",
    userId: "user_1",
    toolName: "send_email",
    toolArgs: {
      to: "bill@example.com",
      accessToken: "secret-token",
    },
    description: "Send email to Bill.",
    status: "pending",
    createdAt: new Date("2026-06-08T17:00:00.000Z"),
    initiatedBy: "user",
    ...overrides,
  };
}

{
  const workflow = buildRuntimeApprovalWorkflowFromGate(gate());

  assert.equal(workflow.status, "pending_approval");
  assert.equal(workflow.approvalId, "gate_email_workflow");
  assert.ok(workflow.preview);
  assert.equal(workflow.preview.tools[0]?.toolName, "send_email");
  assert.equal((workflow.preview.tools[0]?.argsPreview as { accessToken?: string }).accessToken, "[redacted]");
  assert.equal(workflow.resume.ready, false);
  assert.equal(workflow.resume.executedByRuntime, false);
  assert.match(workflow.resume.reason, /waiting for approval/);
  console.log("OK: Runtime approval workflow creates redacted pending previews");
}

{
  const workflow = buildRuntimeApprovalWorkflowFromGate(gate({
    id: "gate_email_approved",
    status: "approved",
  }));

  assert.equal(workflow.status, "ready_to_resume");
  assert.equal(workflow.preview, null);
  assert.equal(workflow.resume.ready, true);
  assert.equal(workflow.resume.owner, "legacy_route");
  assert.equal(workflow.resume.toolName, "send_email");
  assert.equal(workflow.resume.executedByRuntime, false);
  assert.match(workflow.resume.reason, /existing route\/tool owner may resume/);
  console.log("OK: Runtime approval workflow resumes only as a legacy-owner handoff");
}

{
  const workflow = buildRuntimeApprovalWorkflowFromGate(gate({
    id: "gate_email_rejected",
    status: "rejected",
  }));

  assert.equal(workflow.status, "rejected");
  assert.equal(workflow.resume.ready, false);
  assert.match(workflow.resume.reason, /rejected/);
  console.log("OK: Runtime approval workflow does not resume rejected gates");
}

{
  const workflow = buildRuntimeApprovalWorkflowFromGate(gate({
    id: "gate_daemon_expired",
    status: "expired",
    toolName: "daemon_action",
  }));

  assert.equal(workflow.status, "blocked");
  assert.equal(workflow.resume.ready, false);
  assert.match(workflow.resume.reason, /blocked or expired/);
  console.log("OK: Runtime approval workflow blocks expired gates");
}

{
  const workflow = buildRuntimeApprovalWorkflow(parseRuntimeDecision({
    decisionId: "decision-no-approval-workflow",
    eventId: "event-no-approval-workflow",
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
      reason: "No approval workflow test.",
    },
    trace: {
      traceId: "trace-no-approval-workflow",
      source: "runtime",
    },
    createdAt: "2026-06-08T17:00:00.000Z",
  }));

  assert.equal(workflow, null);
  console.log("OK: Runtime approval workflow ignores non-approval decisions");
}

console.log("\nAll Runtime Approval Workflow assertions passed.");
