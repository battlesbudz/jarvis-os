import type { RuntimeToolPreflightResult } from "./runtimeToolPreflight";

export type RuntimePreviewStatus = "ready" | "needs_approval" | "blocked" | "degraded";

export interface RuntimePreviewReport {
  status: RuntimePreviewStatus;
  eventId: string;
  userId: string;
  intent: string;
  responseMode: RuntimeToolPreflightResult["decision"]["responseMode"];
  riskTier: RuntimeToolPreflightResult["decision"]["riskTier"];
  gateOutcome: RuntimeToolPreflightResult["gateResult"]["outcome"];
  readyToolCount: number;
  blockedToolCount: number;
  approvalRequired: boolean;
  reasons: string[];
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons.filter(Boolean))];
}

export function summarizeRuntimePreview(result: RuntimeToolPreflightResult): RuntimePreviewReport {
  const approvalTools = result.toolPreflight.blocked.filter((tool) => tool.status === "approval_required");
  const policyBlockedTools = result.toolPreflight.blocked.filter((tool) => tool.status === "blocked_by_policy");
  const hasBlockedDecision = result.decision.responseMode === "blocked" || result.decision.errors.some((error) => error.severity === "blocked");
  const hasDegradedDecision = result.decision.responseMode === "degraded" || result.decision.errors.some((error) => error.severity === "error");

  let status: RuntimePreviewStatus = "ready";
  if (hasBlockedDecision || policyBlockedTools.length > 0) {
    status = "blocked";
  } else if (result.decision.approval.required || approvalTools.length > 0) {
    status = "needs_approval";
  } else if (hasDegradedDecision || result.toolPreflight.blocked.length > 0) {
    status = "degraded";
  }

  return {
    status,
    eventId: result.event.eventId,
    userId: result.event.userId,
    intent: result.decision.intent,
    responseMode: result.decision.responseMode,
    riskTier: result.decision.riskTier,
    gateOutcome: result.gateResult.outcome,
    readyToolCount: result.toolPreflight.ready.length,
    blockedToolCount: result.toolPreflight.blocked.length,
    approvalRequired: result.decision.approval.required || approvalTools.length > 0,
    reasons: uniqueReasons([
      ...result.gateResult.reasons,
      ...result.decision.errors.map((error) => error.message),
      ...result.toolPreflight.blocked.map((tool) => tool.reason),
    ]),
  };
}
