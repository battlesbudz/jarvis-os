import type { ApprovalGate } from "./agentApproval";
import { createApprovalReceipt } from "./approvalReceipt";
import type { AgentJobType, SubmitJobInput, SubmitJobResult } from "./jobClient";

export interface ContinueTopLevelApprovalDeps {
  submitJob?: (input: SubmitJobInput) => Promise<SubmitJobResult>;
}

export interface ContinueTopLevelApprovalResult {
  continued: boolean;
  reason: string;
  jobId?: string;
  agentType?: AgentJobType;
  isDuplicate?: boolean;
}

async function defaultSubmitJob(input: SubmitJobInput): Promise<SubmitJobResult> {
  const { submitAgentJob } = await import("./jobClient");
  return submitAgentJob(input);
}

function getToolArgs(gate: ApprovalGate): Record<string, unknown> {
  return gate.toolArgs && typeof gate.toolArgs === "object" ? gate.toolArgs : {};
}

function isTopLevelAutonomyGate(gate: ApprovalGate): boolean {
  const args = getToolArgs(gate);
  return gate.agentId === "coach" && args.topLevelAutonomy === true && typeof args.userText === "string";
}

function inferContinuationAgentType(gate: ApprovalGate, userText: string): AgentJobType {
  if (gate.toolName === "send_email" || /\bemail\b|\bgmail\b|\breply\b/i.test(userText)) return "email";
  if (gate.toolName === "schedule_jarvis_task" || /\bschedule\b|\bcalendar\b|\bmeeting\b|\bplan\b/i.test(userText)) {
    return "planning";
  }
  if (gate.toolName === "code_change" || /\bcommit\b|\bdeploy\b|\bcode\b|\bgithub\b/i.test(userText)) {
    return "planning";
  }
  return "planning";
}

function deriveTitle(userText: string): string {
  const normalized = userText.replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
  return `Approved action: ${(normalized || "Jarvis action").slice(0, 70)}`;
}

function buildPrompt(gate: ApprovalGate, userText: string, channelName: string): string {
  return [
    `The user approved this top-level Jarvis action in approval gate ${gate.id}.`,
    `Original request: ${userText}`,
    `Original channel: ${channelName || "unknown"}`,
    "",
    "Continue through the normal Jarvis tool/capability path.",
    "Do not ask again for the same top-level approval. If important details are missing, ask for the missing details or draft a reviewable deliverable instead of guessing.",
    "For irreversible final sends, posts, deletes, purchases, deployments, or calendar changes, keep using the existing tool-specific safety checks and audit trail.",
  ].join("\n");
}

export async function continueTopLevelApproval(
  gate: ApprovalGate,
  deps: ContinueTopLevelApprovalDeps = {},
): Promise<ContinueTopLevelApprovalResult> {
  if (!isTopLevelAutonomyGate(gate)) {
    return { continued: false, reason: "Gate is not a top-level autonomy approval." };
  }

  const args = getToolArgs(gate);
  const userText = String(args.userText || "").trim();
  const channelName = typeof args.channelName === "string" ? args.channelName : "unknown";
  if (!userText) {
    return { continued: false, reason: "Gate is missing original user text." };
  }

  const agentType = inferContinuationAgentType(gate, userText);
  const submitJob = deps.submitJob ?? defaultSubmitJob;
  const job = await submitJob({
    userId: gate.userId,
    agentType,
    title: deriveTitle(userText),
    prompt: buildPrompt(gate, userText, channelName),
    input: {
      originApprovalGateId: gate.id,
      approvedTopLevelAction: true,
      originChannel: channelName,
      approvedToolName: gate.toolName,
      approvalReceipt: createApprovalReceipt({
        gateId: gate.id,
        userId: gate.userId,
        toolName: gate.toolName,
        originalUserText: userText,
        expiresAt: gate.expiresAt,
      }),
    },
  });

  return {
    continued: true,
    reason: job.isDuplicate ? "Continuation job already running." : "Continuation job queued.",
    jobId: job.id,
    agentType,
    isDuplicate: job.isDuplicate,
  };
}
