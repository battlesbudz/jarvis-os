import { redactRuntimeDecision, type RuntimeDecision } from "../protocol";

export interface RuntimeApprovalPreview {
  approvalId: string;
  eventId: string;
  userId: string;
  intent: string;
  riskTier: RuntimeDecision["riskTier"];
  responseMode: RuntimeDecision["responseMode"];
  reason: string;
  tools: Array<{
    toolName: string;
    riskTier: RuntimeDecision["riskTier"];
    reason?: string;
    argsPreview?: unknown;
  }>;
}

function approvalIdForDecision(decision: RuntimeDecision): string {
  return decision.approval.gateId ?? `approval-${decision.decisionId}`;
}

export function buildRuntimeApprovalPreview(decision: RuntimeDecision): RuntimeApprovalPreview | null {
  if (!decision.approval.required) {
    return null;
  }

  const redacted = redactRuntimeDecision(decision);
  const approvalTools = redacted.tools.filter((tool) => tool.approvalRequired || tool.status === "approval_required");

  return {
    approvalId: approvalIdForDecision(redacted),
    eventId: redacted.eventId,
    userId: redacted.userId,
    intent: redacted.intent,
    riskTier: redacted.riskTier,
    responseMode: redacted.responseMode,
    reason: redacted.approval.reason ?? "Runtime decision requires approval before continuing.",
    tools: approvalTools.map((tool) => ({
      toolName: tool.toolName,
      riskTier: tool.riskTier,
      reason: tool.reason,
      argsPreview: tool.argsPreview,
    })),
  };
}
