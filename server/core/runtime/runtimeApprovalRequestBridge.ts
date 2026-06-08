import type { ApprovalGate, ApprovalRequest } from "../../agent/agentApproval";
import { redactRuntimeDecision, type RuntimeDecision, type ToolIntent } from "../protocol";
import { buildRuntimeApprovalWorkflowFromGate, type RuntimeApprovalWorkflow } from "./runtimeApprovalWorkflow";

export interface RuntimeApprovalRequestOptions {
  agentId: string;
  initiatedBy?: ApprovalRequest["initiatedBy"];
  ttlMs?: number;
  workerJobId?: string;
  description?: string;
}

export interface RuntimeApprovalBridgeDeps {
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalGate>;
}

export interface RuntimeApprovalBridgeResult {
  gate: ApprovalGate;
  workflow: RuntimeApprovalWorkflow;
}

function approvalTool(decision: RuntimeDecision): ToolIntent | undefined {
  return decision.tools.find((tool) => tool.approvalRequired || tool.status === "approval_required")
    ?? decision.tools[0];
}

function toolSummary(tools: ToolIntent[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    toolName: tool.toolName,
    status: tool.status,
    riskTier: tool.riskTier,
    approvalRequired: tool.approvalRequired,
    reason: tool.reason,
  }));
}

function descriptionForDecision(decision: RuntimeDecision, tool: ToolIntent | undefined, override?: string): string {
  if (override) return override;
  return [
    `Runtime approval required for ${tool?.toolName ?? decision.intent}.`,
    decision.approval.reason ?? "Core Runtime marked this decision as approval-required.",
  ].join(" ");
}

export function runtimeApprovalRequestFromDecision(
  decision: RuntimeDecision,
  options: RuntimeApprovalRequestOptions,
): ApprovalRequest | null {
  if (!decision.approval.required) {
    return null;
  }

  const redacted = redactRuntimeDecision(decision);
  const tool = approvalTool(redacted);
  return {
    agentId: options.agentId,
    userId: redacted.userId,
    toolName: tool?.toolName ?? "runtime_approval",
    toolArgs: {
      runtimeApproval: true,
      runtimeDecisionId: redacted.decisionId,
      runtimeEventId: redacted.eventId,
      runtimeIntent: redacted.intent,
      runtimeResponseMode: redacted.responseMode,
      runtimeRiskTier: redacted.riskTier,
      runtimeApprovalId: redacted.approval.gateId,
      runtimeResumeOwner: "legacy_route",
      runtimeTools: toolSummary(redacted.tools),
      argsPreview: tool?.argsPreview ?? {},
    },
    description: descriptionForDecision(redacted, tool, options.description),
    initiatedBy: options.initiatedBy ?? "user",
    ttlMs: options.ttlMs,
    workerJobId: options.workerJobId,
  };
}

async function defaultRequestApproval(request: ApprovalRequest): Promise<ApprovalGate> {
  const approval = await import("../../agent/agentApproval");
  return approval.requestApproval(request);
}

export async function openRuntimeApprovalGate(
  decision: RuntimeDecision,
  options: RuntimeApprovalRequestOptions,
  deps: RuntimeApprovalBridgeDeps = {},
): Promise<RuntimeApprovalBridgeResult | null> {
  const request = runtimeApprovalRequestFromDecision(decision, options);
  if (!request) return null;

  const requestApproval = deps.requestApproval ?? defaultRequestApproval;
  const gate = await requestApproval(request);
  return {
    gate,
    workflow: buildRuntimeApprovalWorkflowFromGate(gate),
  };
}

export function resumeRuntimeApprovalFromGate(gate: ApprovalGate): RuntimeApprovalWorkflow {
  return buildRuntimeApprovalWorkflowFromGate(gate);
}
