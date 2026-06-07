import type { RuntimeDryRunResult } from "./runtimeDryRun";

export interface RuntimeAuditEvent {
  auditId: string;
  eventId: string;
  decisionId: string;
  userId: string;
  status: RuntimeDryRunResult["report"]["status"];
  intent: string;
  riskTier: RuntimeDryRunResult["report"]["riskTier"];
  responseMode: RuntimeDryRunResult["report"]["responseMode"];
  approvalRequired: boolean;
  readyToolCount: number;
  blockedToolCount: number;
  createdAt: string;
}

export function buildRuntimeAuditEvent(result: RuntimeDryRunResult, createdAt = new Date().toISOString()): RuntimeAuditEvent {
  return {
    auditId: `audit-${result.preview.decision.decisionId}`,
    eventId: result.preview.event.eventId,
    decisionId: result.preview.decision.decisionId,
    userId: result.preview.event.userId,
    status: result.report.status,
    intent: result.report.intent,
    riskTier: result.report.riskTier,
    responseMode: result.report.responseMode,
    approvalRequired: result.report.approvalRequired,
    readyToolCount: result.report.readyToolCount,
    blockedToolCount: result.report.blockedToolCount,
    createdAt,
  };
}
