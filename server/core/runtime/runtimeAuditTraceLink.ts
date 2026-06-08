import type { JarvisMindTrace } from "../../agent/mindTrace";
import type { MindTraceRef } from "../protocol";
import type { RuntimeAuditEvent } from "./runtimeAuditEvent";

export type RuntimeAuditTraceLinkSource = MindTraceRef["source"] | "orchestration_trace";

export interface RuntimeAuditTraceLinkTraceInput {
  traceId: string;
  source?: RuntimeAuditTraceLinkSource;
  routeChosen?: string;
  taskTypeDetected?: string;
}

export interface RuntimeAuditTraceLink {
  linkId: string;
  auditId: string;
  eventId: string;
  decisionId: string;
  userId: string;
  traceId: string;
  traceSource: RuntimeAuditTraceLinkSource;
  status: RuntimeAuditEvent["status"];
  intent: string;
  riskTier: RuntimeAuditEvent["riskTier"];
  approvalRequired: boolean;
  routeChosen?: string;
  taskTypeDetected?: string;
  createdAt: string;
  previewOnly: true;
}

export function runtimeTraceInputFromMindTrace(trace: JarvisMindTrace): RuntimeAuditTraceLinkTraceInput {
  return {
    traceId: trace.traceId,
    source: "existing_mind_trace",
    routeChosen: trace.routeChosen,
    taskTypeDetected: trace.taskTypeDetected,
  };
}

function normalizeTraceInput(
  input: RuntimeAuditTraceLinkTraceInput | JarvisMindTrace,
): RuntimeAuditTraceLinkTraceInput {
  if ("traceId" in input && "routeChosen" in input && "taskTypeDetected" in input && "decision" in input) {
    return runtimeTraceInputFromMindTrace(input);
  }

  return input;
}

export function buildRuntimeAuditTraceLink(input: {
  audit: RuntimeAuditEvent;
  trace: RuntimeAuditTraceLinkTraceInput | JarvisMindTrace;
  createdAt?: string;
}): RuntimeAuditTraceLink {
  const trace = normalizeTraceInput(input.trace);
  const traceSource = trace.source ?? "orchestration_trace";
  const createdAt = input.createdAt ?? input.audit.createdAt;

  return {
    linkId: `runtime-link-${input.audit.auditId}-${trace.traceId}`,
    auditId: input.audit.auditId,
    eventId: input.audit.eventId,
    decisionId: input.audit.decisionId,
    userId: input.audit.userId,
    traceId: trace.traceId,
    traceSource,
    status: input.audit.status,
    intent: input.audit.intent,
    riskTier: input.audit.riskTier,
    approvalRequired: input.audit.approvalRequired,
    routeChosen: trace.routeChosen,
    taskTypeDetected: trace.taskTypeDetected,
    createdAt,
    previewOnly: true,
  };
}

export function formatRuntimeAuditTraceLink(link: RuntimeAuditTraceLink): string {
  return [
    `Runtime audit trace link: ${link.status}`,
    `Audit: ${link.auditId}`,
    `Trace: ${link.traceId} (${link.traceSource})`,
    `Event: ${link.eventId}`,
    `Decision: ${link.decisionId}`,
    `Risk: ${link.riskTier}`,
    `Approval: ${link.approvalRequired ? "required" : "not_required"}`,
  ].join("\n");
}
