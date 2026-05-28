import type { ApprovalGate, ApprovalRequest } from "./agentApproval";
import type { ApprovalReceipt } from "./approvalReceipt";
import { withApprovalMarkerForTool } from "./approvalMarkers";
import { notifyApprovalRequest as notifyApprovalRequestForGate } from "./approvalNotifications";
import { approvalReceiptCoversToolCall } from "./approvalReceipt";
import { requiresApproval as defaultRequiresApproval } from "./approvalToolRisk";

type OnBeforeToolResult = {
  allowed: boolean;
  reason?: string;
  params?: Record<string, unknown>;
};

type OnBeforeTool = (
  toolName: string,
  toolArgs: Record<string, unknown>,
) => Promise<OnBeforeToolResult>;

export interface SystemApprovalNotification {
  gateId: string;
  agentId: string;
  agentName: string;
  userId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  platform?: string;
  channelId?: string;
}

export interface SystemApprovalGateDeps {
  requiresApproval?: (toolName: string) => boolean;
  requestApproval?: (req: ApprovalRequest) => Promise<ApprovalGate>;
  awaitApproval?: (gateId: string, ttlMs?: number, signal?: AbortSignal) => Promise<boolean>;
  notifyApprovalRequest?: (payload: SystemApprovalNotification) => Promise<void>;
}

export interface SystemApprovalGateOptions {
  agentId: string;
  agentName: string;
  userId?: string;
  platform?: string;
  channelId?: string;
  initiatedBy?: "user" | "jarvis";
  signal?: AbortSignal;
  timeoutMs?: number;
  approvalReceipt?: ApprovalReceipt;
  deps?: SystemApprovalGateDeps;
}

async function defaultNotifyApprovalRequest(payload: SystemApprovalNotification): Promise<void> {
  await notifyApprovalRequestForGate({
    gateId: payload.gateId,
    agentId: payload.agentId,
    agentName: payload.agentName,
    userId: payload.userId,
    toolName: payload.toolName,
    description: payload.description,
    originChannel: payload.platform,
    originChannelId: payload.channelId,
  });
}

async function defaultRequestApproval(req: ApprovalRequest): Promise<ApprovalGate> {
  const { requestApproval } = await import("./agentApproval");
  return requestApproval(req);
}

async function defaultAwaitApproval(gateId: string, ttlMs?: number, signal?: AbortSignal): Promise<boolean> {
  const { awaitApproval } = await import("./agentApproval");
  return awaitApproval(gateId, ttlMs, signal);
}

export function createSystemApprovalOnBeforeTool(opts: SystemApprovalGateOptions): OnBeforeTool {
  const deps = {
    requiresApproval: opts.deps?.requiresApproval ?? defaultRequiresApproval,
    requestApproval: opts.deps?.requestApproval ?? defaultRequestApproval,
    awaitApproval: opts.deps?.awaitApproval ?? defaultAwaitApproval,
    notifyApprovalRequest: opts.deps?.notifyApprovalRequest ?? defaultNotifyApprovalRequest,
  };

  return async (toolName, toolArgs) => {
    const params = toolArgs ?? {};

    if (!deps.requiresApproval(toolName)) {
      return { allowed: true, params };
    }

    if (approvalReceiptCoversToolCall(opts.approvalReceipt, { userId: opts.userId, toolName })) {
      return { allowed: true, params: withApprovalMarkerForTool(toolName, params) };
    }

    if (!opts.userId) {
      return {
        allowed: false,
        reason: `Approval requires a user before ${toolName} can run`,
      };
    }

    try {
      const gate = await deps.requestApproval({
        agentId: opts.agentId,
        userId: opts.userId,
        toolName,
        toolArgs: params,
        description: `Agent "${opts.agentName}" wants to run tool: ${toolName}`,
        ttlMs: opts.timeoutMs,
        initiatedBy: opts.initiatedBy ?? "user",
      });

      if (gate.status === "approved") {
        return { allowed: true, params: withApprovalMarkerForTool(toolName, params) };
      }

      try {
        await deps.notifyApprovalRequest({
          gateId: gate.id,
          agentId: opts.agentId,
          agentName: opts.agentName,
          userId: opts.userId,
          toolName,
          toolArgs: params,
          description: gate.description,
          platform: opts.platform,
          channelId: opts.channelId,
        });
      } catch (notifyErr) {
        console.warn("[SystemApprovalGate] approval notification failed:", notifyErr);
      }

      const approved = await deps.awaitApproval(gate.id, opts.timeoutMs, opts.signal);
      return approved
        ? { allowed: true, params: withApprovalMarkerForTool(toolName, params) }
        : { allowed: false, reason: "User did not approve this action" };
    } catch (err) {
      console.error(`[SystemApprovalGate] approval gate error for ${toolName}:`, err);
      return {
        allowed: false,
        reason: `Approval gate failed for ${toolName}`,
      };
    }
  };
}
