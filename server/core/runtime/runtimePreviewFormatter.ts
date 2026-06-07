import type { RuntimeApprovalPreview } from "./runtimeApprovalPreview";
import type { RuntimePreviewReport } from "./runtimePreviewReport";

export interface FormatRuntimePreviewInput {
  report: RuntimePreviewReport;
  approvalPreview?: RuntimeApprovalPreview | null;
}

export function formatRuntimePreview(input: FormatRuntimePreviewInput): string {
  const lines = [
    `Runtime preview: ${input.report.status}`,
    `Intent: ${input.report.intent}`,
    `Risk: ${input.report.riskTier}`,
    `Response: ${input.report.responseMode}`,
    `Tools: ${input.report.readyToolCount} ready, ${input.report.blockedToolCount} blocked`,
  ];

  if (input.approvalPreview) {
    lines.push(`Approval: ${input.approvalPreview.approvalId}`);
    lines.push(`Approval reason: ${input.approvalPreview.reason}`);
  }

  if (input.report.reasons.length > 0) {
    lines.push(`Reasons: ${input.report.reasons.join(" | ")}`);
  }

  return lines.join("\n");
}
