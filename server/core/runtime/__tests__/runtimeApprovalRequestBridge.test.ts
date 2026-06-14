import assert from "node:assert/strict";
import type { ApprovalGate, ApprovalRequest } from "../../../agent/agentApproval";
import { parseRuntimeDecision } from "../../protocol";
import {
  openRuntimeApprovalGate,
  resumeRuntimeApprovalFromGate,
  runtimeApprovalRequestFromDecision,
} from "../index";

const now = new Date("2026-06-08T18:00:00.000Z");

function approvalDecision() {
  return parseRuntimeDecision({
    decisionId: "decision-runtime-approval-bridge",
    eventId: "event-runtime-approval-bridge",
    userId: "user-runtime-approval-bridge",
    intent: "email_action",
    confidence: 0.9,
    riskTier: "T4",
    responseMode: "approval_required",
    tools: [
      {
        toolName: "send_email",
        status: "approval_required",
        riskTier: "T4",
        approvalRequired: true,
        reason: "Sending email requires user approval.",
        argsPreview: {
          to: "sam@example.com",
          token: "secret-token",
        },
      },
    ],
    approval: {
      required: true,
      status: "pending",
      gateId: "runtime-gate-email",
      reason: "Email send requires approval.",
    },
    modelRoute: {
      provider: "runtime-gate",
      model: "deterministic-test",
      reason: "Test approval bridge.",
      fallbackAllowed: false,
    },
    trace: {
      traceId: "trace-runtime-approval-bridge",
      source: "runtime",
      routeChosen: "communications",
      taskTypeDetected: "email_action",
    },
    createdAt: now.toISOString(),
  });
}

function nonApprovalDecision() {
  return parseRuntimeDecision({
    ...approvalDecision(),
    decisionId: "decision-runtime-no-approval",
    eventId: "event-runtime-no-approval",
    responseMode: "answer",
    tools: [],
    approval: {
      required: false,
      status: "not_required",
    },
  });
}

function gateFromRequest(request: ApprovalRequest, status: ApprovalGate["status"] = "pending"): ApprovalGate {
  return {
    id: "gate-runtime-created",
    agentId: request.agentId,
    userId: request.userId,
    toolName: request.toolName,
    toolArgs: request.toolArgs,
    description: request.description,
    status,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    resolvedAt: status === "pending" ? undefined : now,
    resolvedBy: status === "pending" ? undefined : request.userId,
  };
}

async function run(): Promise<void> {
  {
  const request = runtimeApprovalRequestFromDecision(approvalDecision(), {
    agentId: "coach",
    ttlMs: 60_000,
  });

  assert.ok(request);
  assert.equal(request.agentId, "coach");
  assert.equal(request.userId, "user-runtime-approval-bridge");
  assert.equal(request.toolName, "send_email");
  assert.equal(request.initiatedBy, "user");
  assert.equal(request.ttlMs, 60_000);
  assert.equal(request.toolArgs.runtimeApproval, true);
  assert.equal(request.toolArgs.runtimeDecisionId, "decision-runtime-approval-bridge");
  assert.equal(request.toolArgs.runtimeResumeOwner, "legacy_route");
  assert.doesNotMatch(JSON.stringify(request), /secret-token/);
  assert.match(JSON.stringify(request), /\[redacted\]/);
  console.log("OK: Runtime approval bridge builds a redacted existing approval request");
  }

  {
  const request = runtimeApprovalRequestFromDecision(nonApprovalDecision(), {
    agentId: "coach",
  });

  assert.equal(request, null);
  console.log("OK: Runtime approval bridge ignores non-approval decisions");
  }

  {
  let captured: ApprovalRequest | undefined;
  const result = await openRuntimeApprovalGate(
    approvalDecision(),
    {
      agentId: "coach",
      description: "Custom approval card text.",
    },
    {
      requestApproval: async (request) => {
        captured = request;
        return gateFromRequest(request);
      },
    },
  );

  assert.ok(result);
  assert.equal(captured?.description, "Custom approval card text.");
  assert.equal(result.gate.status, "pending");
  assert.equal(result.workflow.status, "pending_approval");
  assert.equal(result.workflow.preview?.approvalId, "gate-runtime-created");
  assert.equal(result.workflow.resume.ready, false);
  assert.equal(result.workflow.resume.executedByRuntime, false);
  console.log("OK: Runtime approval bridge opens existing approval gates and returns pending workflow preview");
  }

  {
  const request = runtimeApprovalRequestFromDecision(approvalDecision(), {
    agentId: "coach",
  });
  assert.ok(request);
  const workflow = resumeRuntimeApprovalFromGate(gateFromRequest(request, "approved"));

  assert.equal(workflow.status, "ready_to_resume");
  assert.equal(workflow.resume.ready, true);
  assert.equal(workflow.resume.owner, "legacy_route");
  assert.equal(workflow.resume.toolName, "send_email");
  assert.equal(workflow.resume.executedByRuntime, false);
  console.log("OK: Runtime approval bridge resumes approved gates as legacy-owner handoffs only");
  }

  console.log("\nAll Runtime Approval Request Bridge assertions passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
