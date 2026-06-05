/**
 * hitlApproval.ts — SDK Human-in-the-Loop Approval (Jarvis-controlled)
 *
 * ⚠️ DEPRECATED: SDK no longer has its own approval system.
 *
 * All SDK approval requests go through Jarvis's approval system:
 * - SDK cannot create its own approval gates
 * - SDK cannot have independent approval receipts
 * - All approval flows through Jarvis's agentApproval.ts
 *
 * This file is kept for backwards compatibility but all approvals
 * should go through server/agent/sdkGateway.ts.
 *
 * @deprecated Use server/agent/sdkGateway.ts instead
 */

import type { AgentSdkRunStore } from "./runStore";

export const AGENT_SDK_HITL_AGENT_ID = "jarvis-sdk-gateway"; // Jarvis owns approval

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

/**
 * @deprecated SDK no longer creates its own approval gates
 * All approval requests should go through Jarvis's sdkGateway
 */
export async function requestTelegramApprovalForPendingCall(
  pending: AgentSdkPendingApproval,
  deps: HitlApprovalDeps,
): Promise<string> {
  console.warn(
    "[SDK HITL] DEPRECATED: SDK approval should go through server/agent/sdkGateway.ts. " +
    "Jarvis owns the approval system, not the SDK."
  );

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

  // All approvals go through Jarvis's system (not SDK's own system)
  const gate = await deps.requestApproval({
    agentId: AGENT_SDK_HITL_AGENT_ID,
    userId: pending.userId,
    toolName: pending.toolName,
    toolArgs: {
      ...args,
      __agentSdkRunId: pending.runId,
      __agentSdkToolCallId: pending.toolCallId,
      __jarvisAgentSdkRun: true,
      // Removed __agentSdkPrototype — Jarvis owns approval
    },
    description,
    initiatedBy: "jarvis",  // Jarvis initiates, not SDK
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
    agentName: "Jarvis SDK Gateway",
    userId: pending.userId,
    toolName: pending.toolName,
    description,
    originChannel: approvalNotificationOrigin(pending.originChannel),
    originChannelId: pending.originChannelId,
  });

  return gate.id;
}
