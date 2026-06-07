import { randomUUID } from "crypto";
import type { JarvisMindTrace } from "../../agent/mindTrace";
import {
  parseRuntimeDecision,
  type RuntimeDecision,
  type RuntimeRiskTier,
  type RuntimeResponseMode,
  type ToolIntent,
} from "./schemas";

function mapRiskTier(trace: JarvisMindTrace): RuntimeRiskTier {
  if (trace.errors.length > 0 || trace.blockedSetupIssues.length > 0) return "T2";
  if (trace.approval.required) return "T3";
  if (trace.jobCreated) return "T2";
  if (trace.deliverableCreated) return "T1";
  if (trace.riskLevel === "high") return "T3";
  if (trace.riskLevel === "medium") return "T1";
  return "T0";
}

function mapResponseMode(trace: JarvisMindTrace): RuntimeResponseMode {
  if (trace.errors.length > 0 || trace.blockedSetupIssues.length > 0) return "degraded";
  if (trace.approval.required) return "approval_required";
  if (trace.jobCreated) return "queue";
  return "answer";
}

function mapToolRisk(traceRisk: RuntimeRiskTier, approvalRequired: boolean): RuntimeRiskTier {
  if (approvalRequired) return "T3";
  return traceRisk === "T0" ? "T0" : "T1";
}

function mapTools(trace: JarvisMindTrace, decisionRisk: RuntimeRiskTier): ToolIntent[] {
  return trace.toolsCalled.map((tool) => ({
    toolName: tool.name,
    status: tool.approvalRequired ? "approval_required" : tool.status === "ok" ? "executed" : tool.status === "blocked" ? "blocked_by_policy" : "failed",
    riskTier: mapToolRisk(decisionRisk, tool.approvalRequired),
    approvalRequired: tool.approvalRequired,
    reason: tool.error ?? `Existing Mind Trace tool status: ${tool.status}`,
    argsPreview: tool.argsPreview,
  }));
}

export interface RuntimeDecisionFromMindTraceOptions {
  eventId?: string;
  decisionId?: string;
  userId?: string;
  model?: string;
  provider?: string;
}

export function runtimeDecisionFromMindTrace(
  trace: JarvisMindTrace,
  options: RuntimeDecisionFromMindTraceOptions = {},
): RuntimeDecision {
  const userId = options.userId ?? "unknown-user";
  const riskTier = mapRiskTier(trace);
  const responseMode = mapResponseMode(trace);
  const decision = {
    decisionId: options.decisionId ?? randomUUID(),
    eventId: options.eventId ?? trace.traceId,
    userId,
    intent: trace.taskTypeDetected,
    confidence: trace.errors.length > 0 ? 0.35 : trace.uncertaintyNotes.length > 0 ? 0.65 : 0.8,
    riskTier,
    responseMode,
    tools: mapTools(trace, riskTier),
    approval: {
      required: trace.approval.required,
      status: trace.approval.required ? "pending" : "not_required",
      gateId: trace.approval.gateId ?? null,
      reason: trace.approval.required ? "Existing Mind Trace marked this flow as approval-required." : undefined,
    },
    modelRoute: {
      provider: options.provider ?? "legacy-harness",
      model: options.model ?? "existing-route",
      reason: `Adapted from existing Mind Trace route: ${trace.routeChosen}`,
      fallbackAllowed: true,
    },
    trace: {
      traceId: trace.traceId,
      source: "existing_mind_trace",
      routeChosen: trace.routeChosen,
      taskTypeDetected: trace.taskTypeDetected,
    },
    errors: [
      ...trace.errors.map((message) => ({
        code: "mind_trace_error",
        message,
        severity: "error" as const,
        recoverable: true,
      })),
      ...trace.blockedSetupIssues.map((message) => ({
        code: "blocked_setup",
        message,
        severity: "blocked" as const,
        recoverable: true,
      })),
    ],
    createdAt: trace.createdAt,
  };

  return parseRuntimeDecision(decision);
}

