import type { ExecuteRuntimeEventResult } from "./runtimeTypes";

export type RuntimeOwnedGoldenWorkflowId =
  | "general-answer"
  | "memory-lookup"
  | "email-draft-reply"
  | "next-meeting-brief";

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

function isSafeReadOnlyAnswer(runtime: ExecuteRuntimeEventResult): boolean {
  return (
    runtime.decision.responseMode === "answer" &&
    runtime.gateResult.outcome === "inline_answer" &&
    !runtime.decision.approval.required &&
    hasOnlyReadOnlyGeneralTools(runtime)
  );
}

export function matchRuntimeOwnedGoldenWorkflow(
  runtime: ExecuteRuntimeEventResult,
): RuntimeOwnedGoldenWorkflowMatch | null {
  if (
    runtime.decision.intent === "general" &&
    runtime.decision.riskTier === "T0" &&
    isSafeReadOnlyAnswer(runtime)
  ) {
    return {
      workflowId: "general-answer",
      owner: "core_runtime",
      reason: "General read-only answer matches the runtime-owned golden workflow allowlist boundary.",
    };
  }

  if (runtime.decision.intent === "memory_query" && isSafeReadOnlyAnswer(runtime)) {
    return {
      workflowId: "memory-lookup",
      owner: "core_runtime",
      reason: "Memory lookup matches a runtime-owned read-only golden workflow boundary.",
    };
  }

  if (runtime.decision.intent === "email_draft" && isSafeReadOnlyAnswer(runtime)) {
    return {
      workflowId: "email-draft-reply",
      owner: "core_runtime",
      reason: "Email draft reply matches a runtime-owned draft-only golden workflow boundary.",
    };
  }

  if (runtime.decision.intent === "calendar_query" && isSafeReadOnlyAnswer(runtime)) {
    return {
      workflowId: "next-meeting-brief",
      owner: "core_runtime",
      reason: "Next meeting brief matches a runtime-owned read-only golden workflow boundary.",
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
