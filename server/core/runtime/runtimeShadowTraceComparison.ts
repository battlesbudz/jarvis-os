import type { JarvisMindTrace } from "../../agent/mindTrace";
import {
  runtimeDecisionFromMindTrace,
  type RuntimeDecision,
  type RuntimeRiskTier,
} from "../protocol";

export type RuntimeShadowTraceComparisonStatus = "aligned" | "diverged" | "degraded";

export interface RuntimeShadowTraceComparison {
  status: RuntimeShadowTraceComparisonStatus;
  shadow: {
    decisionId: string;
    intent: string;
    responseMode: RuntimeDecision["responseMode"];
    riskTier: RuntimeRiskTier;
    approvalRequired: boolean;
    routeChosen?: string;
  };
  trace: {
    traceId: string;
    intent: string;
    responseMode: RuntimeDecision["responseMode"];
    riskTier: RuntimeRiskTier;
    approvalRequired: boolean;
    routeChosen?: string;
  };
  matches: {
    intent: boolean;
    responseMode: boolean;
    riskTier: boolean;
    approvalRequired: boolean;
  };
  notes: string[];
}

function riskIndex(risk: RuntimeRiskTier): number {
  return ["T0", "T1", "T2", "T3", "T4", "T5"].indexOf(risk);
}

function statusFromMatches(
  matches: RuntimeShadowTraceComparison["matches"],
  shadowRisk: RuntimeRiskTier,
  traceRisk: RuntimeRiskTier,
): RuntimeShadowTraceComparisonStatus {
  if (Object.values(matches).every(Boolean)) return "aligned";
  if (riskIndex(shadowRisk) < riskIndex(traceRisk)) return "degraded";
  if (!matches.approvalRequired) return "degraded";
  return "diverged";
}

function comparisonNotes(comparison: Omit<RuntimeShadowTraceComparison, "status" | "notes">): string[] {
  const notes: string[] = [];
  if (!comparison.matches.intent) {
    notes.push(`Intent differs: shadow=${comparison.shadow.intent} trace=${comparison.trace.intent}.`);
  }
  if (!comparison.matches.responseMode) {
    notes.push(`Response mode differs: shadow=${comparison.shadow.responseMode} trace=${comparison.trace.responseMode}.`);
  }
  if (!comparison.matches.riskTier) {
    notes.push(`Risk differs: shadow=${comparison.shadow.riskTier} trace=${comparison.trace.riskTier}.`);
  }
  if (!comparison.matches.approvalRequired) {
    notes.push(`Approval differs: shadow=${comparison.shadow.approvalRequired} trace=${comparison.trace.approvalRequired}.`);
  }
  return notes.length > 0 ? notes : ["Runtime shadow decision matches the adapted Mind Trace contract."];
}

export function compareRuntimeShadowWithMindTrace(input: {
  shadowDecision: RuntimeDecision;
  mindTrace: JarvisMindTrace;
  userId?: string;
}): RuntimeShadowTraceComparison {
  const traceDecision = runtimeDecisionFromMindTrace(input.mindTrace, {
    userId: input.userId ?? input.shadowDecision.userId,
  });
  const base = {
    shadow: {
      decisionId: input.shadowDecision.decisionId,
      intent: input.shadowDecision.intent,
      responseMode: input.shadowDecision.responseMode,
      riskTier: input.shadowDecision.riskTier,
      approvalRequired: input.shadowDecision.approval.required,
      routeChosen: input.shadowDecision.trace.routeChosen,
    },
    trace: {
      traceId: input.mindTrace.traceId,
      intent: traceDecision.intent,
      responseMode: traceDecision.responseMode,
      riskTier: traceDecision.riskTier,
      approvalRequired: traceDecision.approval.required,
      routeChosen: traceDecision.trace.routeChosen,
    },
    matches: {
      intent: input.shadowDecision.intent === traceDecision.intent,
      responseMode: input.shadowDecision.responseMode === traceDecision.responseMode,
      riskTier: input.shadowDecision.riskTier === traceDecision.riskTier,
      approvalRequired: input.shadowDecision.approval.required === traceDecision.approval.required,
    },
  };

  return {
    ...base,
    status: statusFromMatches(base.matches, base.shadow.riskTier, base.trace.riskTier),
    notes: comparisonNotes(base),
  };
}

export function formatRuntimeShadowTraceComparison(comparison: RuntimeShadowTraceComparison): string {
  return [
    `Runtime shadow trace comparison: ${comparison.status}`,
    `Intent: ${comparison.shadow.intent} / ${comparison.trace.intent}`,
    `Response: ${comparison.shadow.responseMode} / ${comparison.trace.responseMode}`,
    `Risk: ${comparison.shadow.riskTier} / ${comparison.trace.riskTier}`,
    `Approval: ${comparison.shadow.approvalRequired ? "required" : "not_required"} / ${comparison.trace.approvalRequired ? "required" : "not_required"}`,
    `Notes: ${comparison.notes.join(" | ")}`,
  ].join("\n");
}
