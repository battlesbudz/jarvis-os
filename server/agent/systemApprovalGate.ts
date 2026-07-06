import type { ApprovalGate, ApprovalRequest } from "./agentApproval";
import type { ApprovalReceipt } from "./approvalReceipt";
import { withApprovalMarkerForTool } from "./approvalMarkers";
import { notifyApprovalRequest as notifyApprovalRequestForGate } from "./approvalNotifications";
import { approvalReceiptCoversToolCall } from "./approvalReceipt";
import { requiresApproval as defaultRequiresApproval } from "./approvalToolRisk";
import { getModelProvider } from "@shared/modelProviderCatalog";

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
  workerJobId?: string;
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

function requiresSystemApproval(
  toolName: string,
  params: Record<string, unknown>,
  requiresApproval: (toolName: string) => boolean,
): boolean {
  if (toolName === "queue_background_job" && params.task_scoped_cloud === true) return true;
  return requiresApproval(toolName);
}

function catalogProviderLabel(providerId: string): string {
  const provider = getModelProvider(providerId);
  return provider?.shortLabel || provider?.label || providerId || "the selected cloud provider";
}

function systemApprovalDescription(agentName: string, toolName: string, params: Record<string, unknown>): string {
  if (toolName === "queue_background_job" && params.task_scoped_cloud === true) {
    const providerLabel = catalogProviderLabel(String(params.cloud_provider_id || "").trim());
    const authType = params.cloud_provider_auth_type === "api_key" ? "API key" : "subscription";
    const budget = Number(params.cloud_budget_usd);
    const budgetText = Number.isFinite(budget) && budget > 0 ? ` Budget: $${(Math.round(budget * 100) / 100).toFixed(2)}.` : "";
    return (
      `Agent "${agentName}" wants to start a separate cloud background job using ${providerLabel} via ${authType}.` +
      `${budgetText} The live chat model stays unchanged, and the cloud worker cannot directly control the phone or write MemoryOS.`
    );
  }
  return `Agent "${agentName}" wants to run tool: ${toolName}`;
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

    if (!requiresSystemApproval(toolName, params, deps.requiresApproval)) {
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
        description: systemApprovalDescription(opts.agentName, toolName, params),
        ttlMs: opts.timeoutMs,
        initiatedBy: opts.initiatedBy ?? "user",
        workerJobId: opts.workerJobId,
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
