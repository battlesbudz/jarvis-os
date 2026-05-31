import type { AgentSdkRunStore } from "./runStore";

export const AGENT_SDK_HITL_AGENT_ID = "jarvis-agent-sdk-hitl";

export interface AgentSdkPendingApproval {
  runId: string;
  userId: string;
  originChannel: string;
  originChannelId?: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface HitlApprovalDeps {
  store: AgentSdkRunStore;
  requestApproval: (input: {
    agentId: string;
    userId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    description: string;
    initiatedBy: "user" | "jarvis";
  }) => Promise<{ id: string }>;
  notifyApprovalRequest: (payload: {
    gateId: string;
    agentId: string;
    agentName: string;
    userId: string;
    toolName: string;
    description: string;
    originChannel?: string;
    originChannelId?: string;
  }) => Promise<unknown>;
}

function approvalNotificationOrigin(originChannel: string): string {
  return originChannel.toLowerCase().startsWith("telegram") ? originChannel : "telegram";
}

export async function requestTelegramApprovalForPendingCall(
  pending: AgentSdkPendingApproval,
  deps: HitlApprovalDeps,
): Promise<string> {
  const args = pending.arguments;
  const to = String(args.to || "");
  const subject = String(args.subject || "");
  const body = String(args.body || "");
  const description = [
    "Jarvis drafted an email and wants approval before sending.",
    "",
    `To: ${to}`,
    `Subject: ${subject}`,
    "",
    body.slice(0, 1200),
  ].join("\n");

  const gate = await deps.requestApproval({
    agentId: AGENT_SDK_HITL_AGENT_ID,
    userId: pending.userId,
    toolName: pending.toolName,
    toolArgs: {
      ...args,
      __agentSdkRunId: pending.runId,
      __agentSdkToolCallId: pending.toolCallId,
      __jarvisAgentSdkRun: true,
      __agentSdkPrototype: true,
    },
    description,
    initiatedBy: "user",
  });

  const record = await deps.store.load(pending.runId);
  if (record) {
    record.meta.status = "awaiting_approval";
    record.meta.pendingToolCallId = pending.toolCallId;
    record.meta.gateId = gate.id;
    record.meta.updatedAt = new Date().toISOString();
    await deps.store.save(record);
  }

  await deps.notifyApprovalRequest({
    gateId: gate.id,
    agentId: AGENT_SDK_HITL_AGENT_ID,
    agentName: "Jarvis Agent SDK",
    userId: pending.userId,
    toolName: pending.toolName,
    description,
    originChannel: approvalNotificationOrigin(pending.originChannel),
    originChannelId: pending.originChannelId,
  });

  return gate.id;
}
