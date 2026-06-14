import type { ApprovalGate } from "../../agent/agentApproval";
import { parseRuntimeDecision, type ApprovalRequirement, type RuntimeDecision, type RuntimeRiskTier } from "../protocol";
import { buildRuntimeApprovalPreview, type RuntimeApprovalPreview } from "./runtimeApprovalPreview";
import { runtimeProtocolSafeId } from "./runtimeContextPacketAdapter";

export type RuntimeApprovalGateSnapshot = Pick<
  ApprovalGate,
  "id" | "agentId" | "userId" | "toolName" | "toolArgs" | "description" | "status" | "createdAt"
> & {
  initiatedBy?: string | null;
};

function approvalStatusForGate(status: RuntimeApprovalGateSnapshot["status"]): ApprovalRequirement["status"] {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "expired":
      return "blocked";
    default:
      return "pending";
  }
}

function riskTierForGate(gate: RuntimeApprovalGateSnapshot): RuntimeRiskTier {
  const name = gate.toolName.toLowerCase();
  if (/delete|remove|send|transfer|publish|post|deploy|shell|file_write/.test(name)) {
    return "T4";
  }
  return "T3";
}

function intentForGate(gate: RuntimeApprovalGateSnapshot): string {
  const name = gate.toolName.toLowerCase();
  if (/mail|email|gmail|outlook/.test(name)) return "email_action";
  if (/calendar/.test(name)) return "calendar_action";
  if (/daemon|android|desktop|shell|file/.test(name)) return "daemon_action";
  if (/memory/.test(name)) return "memory_action";
  return "approval_action";
}

export function runtimeDecisionFromApprovalGate(gate: RuntimeApprovalGateSnapshot): RuntimeDecision {
  const riskTier = riskTierForGate(gate);
  const approvalStatus = approvalStatusForGate(gate.status);
  return parseRuntimeDecision({
    decisionId: runtimeProtocolSafeId("decision-gate", gate.id),
    eventId: runtimeProtocolSafeId("event-gate", gate.id),
    userId: gate.userId,
    intent: intentForGate(gate),
    confidence: 0.85,
    riskTier,
    responseMode: approvalStatus === "approved" ? "degraded" : "approval_required",
    tools: [
      {
        toolName: gate.toolName,
        status: approvalStatus === "approved" ? "proposed" : approvalStatus === "rejected" || approvalStatus === "blocked" ? "blocked_by_policy" : "approval_required",
        riskTier,
        approvalRequired: true,
        reason: gate.description,
        argsPreview: gate.toolArgs,
      },
    ],
    approval: {
      required: true,
      status: approvalStatus,
      gateId: gate.id,
      reason: gate.description,
    },
    modelRoute: {
      provider: "existing-approval-gate",
      model: "deterministic-approval-bridge",
      reason: `Adapted existing approval gate for ${gate.toolName}.`,
      fallbackAllowed: false,
    },
    trace: {
      traceId: runtimeProtocolSafeId("trace-gate", gate.id),
      source: "runtime",
      routeChosen: "approval_gate_bridge",
      taskTypeDetected: intentForGate(gate),
    },
    createdAt: gate.createdAt.toISOString(),
  });
}

export function buildRuntimeApprovalPreviewFromGate(gate: RuntimeApprovalGateSnapshot): RuntimeApprovalPreview {
  const preview = buildRuntimeApprovalPreview(runtimeDecisionFromApprovalGate(gate));
  if (!preview) {
    throw new Error("Approval gate bridge expected an approval preview.");
  }
  return preview;
}
