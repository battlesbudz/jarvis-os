import { redactRuntimeDecision, type RuntimeDecision } from "../protocol";
import {
  runtimeDecisionFromApprovalGate,
  type RuntimeApprovalGateSnapshot,
} from "./runtimeApprovalGateBridge";
import { buildRuntimeApprovalPreview, type RuntimeApprovalPreview } from "./runtimeApprovalPreview";

export type RuntimeApprovalWorkflowStatus = "pending_approval" | "ready_to_resume" | "rejected" | "blocked";

export interface RuntimeApprovalWorkflow {
  workflowId: string;
  status: RuntimeApprovalWorkflowStatus;
  approvalId: string;
  eventId: string;
  decisionId: string;
  userId: string;
  intent: string;
  riskTier: RuntimeDecision["riskTier"];
  preview: RuntimeApprovalPreview | null;
  resume: {
    ready: boolean;
    owner: "legacy_route";
    toolName?: string;
    reason: string;
    executedByRuntime: false;
  };
  createdAt: string;
}

function statusFromDecision(decision: RuntimeDecision): RuntimeApprovalWorkflowStatus {
  switch (decision.approval.status) {
    case "approved":
      return "ready_to_resume";
    case "rejected":
      return "rejected";
    case "blocked":
      return "blocked";
    default:
      return "pending_approval";
  }
}

function resumeForDecision(decision: RuntimeDecision): RuntimeApprovalWorkflow["resume"] {
  const tool = decision.tools[0];
  if (decision.approval.status === "approved") {
    return {
      ready: true,
      owner: "legacy_route",
      toolName: tool?.toolName,
      reason: "Approval is complete; existing route/tool owner may resume execution.",
      executedByRuntime: false,
    };
  }

  if (decision.approval.status === "rejected") {
    return {
      ready: false,
      owner: "legacy_route",
      toolName: tool?.toolName,
      reason: "Approval was rejected; workflow cannot resume.",
      executedByRuntime: false,
    };
  }

  if (decision.approval.status === "blocked") {
    return {
      ready: false,
      owner: "legacy_route",
      toolName: tool?.toolName,
      reason: "Approval is blocked or expired; workflow cannot resume.",
      executedByRuntime: false,
    };
  }

  return {
    ready: false,
    owner: "legacy_route",
    toolName: tool?.toolName,
    reason: "Workflow is waiting for approval before it can resume.",
    executedByRuntime: false,
  };
}

export function buildRuntimeApprovalWorkflow(decision: RuntimeDecision): RuntimeApprovalWorkflow | null {
  if (!decision.approval.required) {
    return null;
  }

  const redacted = redactRuntimeDecision(decision);
  const approvalId = redacted.approval.gateId ?? `approval-${redacted.decisionId}`;
  return {
    workflowId: `approval-workflow-${approvalId}`,
    status: statusFromDecision(redacted),
    approvalId,
    eventId: redacted.eventId,
    decisionId: redacted.decisionId,
    userId: redacted.userId,
    intent: redacted.intent,
    riskTier: redacted.riskTier,
    preview: redacted.approval.status === "pending" ? buildRuntimeApprovalPreview(redacted) : null,
    resume: resumeForDecision(redacted),
    createdAt: redacted.createdAt,
  };
}

export function buildRuntimeApprovalWorkflowFromGate(gate: RuntimeApprovalGateSnapshot): RuntimeApprovalWorkflow {
  const workflow = buildRuntimeApprovalWorkflow(runtimeDecisionFromApprovalGate(gate));
  if (!workflow) {
    throw new Error("Approval workflow expected an approval-required gate.");
  }
  return workflow;
}
