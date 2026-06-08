import type { ExecuteRuntimeEventResult } from "./runtimeTypes";

export type RuntimeOwnedGoldenWorkflowId = "general-answer";

export interface RuntimeOwnedGoldenWorkflowMatch {
  workflowId: RuntimeOwnedGoldenWorkflowId;
  owner: "core_runtime";
  reason: string;
}

const READ_ONLY_GENERAL_TOOLS = new Set(["read_context", "draft_only"]);

function hasOnlyReadOnlyGeneralTools(runtime: ExecuteRuntimeEventResult): boolean {
  return runtime.decision.tools.every((tool) => (
    READ_ONLY_GENERAL_TOOLS.has(tool.toolName) &&
    !tool.approvalRequired &&
    tool.status !== "approval_required"
  ));
}

export function matchRuntimeOwnedGoldenWorkflow(
  runtime: ExecuteRuntimeEventResult,
): RuntimeOwnedGoldenWorkflowMatch | null {
  if (
    runtime.decision.intent === "general" &&
    runtime.decision.responseMode === "answer" &&
    runtime.decision.riskTier === "T0" &&
    runtime.gateResult.outcome === "inline_answer" &&
    !runtime.decision.approval.required &&
    hasOnlyReadOnlyGeneralTools(runtime)
  ) {
    return {
      workflowId: "general-answer",
      owner: "core_runtime",
      reason: "General read-only answer matches the runtime-owned golden workflow allowlist boundary.",
    };
  }

  return null;
}

export function isRuntimeOwnedGoldenWorkflowAllowed(
  workflowId: RuntimeOwnedGoldenWorkflowId,
  allowedWorkflowIds: string[],
): boolean {
  return allowedWorkflowIds.includes(workflowId);
}
