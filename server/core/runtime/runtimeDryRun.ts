import { buildRuntimeApprovalPreview, type RuntimeApprovalPreview } from "./runtimeApprovalPreview";
import { parseRuntimeDecision, type RuntimeDecision, type RuntimeRiskTier } from "../protocol";
import { summarizeRuntimePreview, type RuntimePreviewReport } from "./runtimePreviewReport";
import {
  previewRuntimePreflightFromAgentTools,
  previewRuntimeToolPreflight,
  type RuntimeAgentToolPreflightInput,
  type RuntimeToolPreflightInput,
  type RuntimeToolPreflightResult,
} from "./runtimeToolPreflight";

export interface RuntimeDryRunResult {
  preview: RuntimeToolPreflightResult;
  report: RuntimePreviewReport;
  approvalPreview: RuntimeApprovalPreview | null;
}

const RISK_ORDER: RuntimeRiskTier[] = ["T0", "T1", "T2", "T3", "T4", "T5"];

function maxRiskTier(base: RuntimeRiskTier, risks: RuntimeRiskTier[]): RuntimeRiskTier {
  return risks.reduce(
    (current, next) => (RISK_ORDER.indexOf(next) > RISK_ORDER.indexOf(current) ? next : current),
    base,
  );
}

function decisionForApprovalPreview(preview: RuntimeToolPreflightResult): RuntimeDecision {
  if (preview.decision.approval.required) {
    return preview.decision;
  }

  const approvalTools = preview.toolPreflight.blocked.filter((tool) => tool.status === "approval_required");
  if (approvalTools.length === 0) {
    return preview.decision;
  }

  return parseRuntimeDecision({
    ...preview.decision,
    riskTier: maxRiskTier(preview.decision.riskTier, approvalTools.map((tool) => tool.intent.riskTier)),
    responseMode: "approval_required",
    tools: preview.toolPreflight.tools.map((tool) => tool.intent),
    approval: {
      required: true,
      status: "pending",
      gateId: `gate-${preview.decision.decisionId}`,
      reason: "Tool preflight requires approval before execution.",
    },
  });
}

function dryRunFromPreview(preview: RuntimeToolPreflightResult): RuntimeDryRunResult {
  return {
    preview,
    report: summarizeRuntimePreview(preview),
    approvalPreview: buildRuntimeApprovalPreview(decisionForApprovalPreview(preview)),
  };
}

export function runRuntimeDryRun(input: RuntimeToolPreflightInput): RuntimeDryRunResult {
  return dryRunFromPreview(previewRuntimeToolPreflight(input));
}

export function runRuntimeDryRunFromAgentTools(input: RuntimeAgentToolPreflightInput): RuntimeDryRunResult {
  return dryRunFromPreview(previewRuntimePreflightFromAgentTools(input));
}
