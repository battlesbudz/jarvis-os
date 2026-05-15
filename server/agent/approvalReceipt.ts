export type ApprovalReceiptScope = "top_level_action";

export interface ApprovalReceipt {
  gateId: string;
  userId: string;
  toolName: string;
  scope: ApprovalReceiptScope;
  originalUserText: string;
  createdAt: string;
  expiresAt?: string;
}

export interface ApprovalReceiptToolCall {
  userId?: string;
  toolName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIsoDateLike(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function createApprovalReceipt(input: {
  gateId: string;
  userId: string;
  toolName: string;
  originalUserText: string;
  expiresAt?: Date | string | null;
}): ApprovalReceipt {
  const expiresAt =
    input.expiresAt instanceof Date
      ? input.expiresAt.toISOString()
      : typeof input.expiresAt === "string"
        ? input.expiresAt
        : undefined;

  return {
    gateId: input.gateId,
    userId: input.userId,
    toolName: input.toolName,
    scope: "top_level_action",
    originalUserText: input.originalUserText,
    createdAt: new Date().toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function normalizeApprovalReceipt(value: unknown): ApprovalReceipt | undefined {
  if (!isRecord(value)) return undefined;

  const gateId = typeof value.gateId === "string" ? value.gateId.trim() : "";
  const userId = typeof value.userId === "string" ? value.userId.trim() : "";
  const toolName = typeof value.toolName === "string" ? value.toolName.trim() : "";
  const scope = value.scope;
  const originalUserText =
    typeof value.originalUserText === "string" ? value.originalUserText.trim() : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt.trim() : "";
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt.trim() : undefined;

  if (!gateId || !userId || !toolName || scope !== "top_level_action" || !originalUserText) {
    return undefined;
  }
  if (!createdAt || !isIsoDateLike(createdAt)) return undefined;
  if (expiresAt && !isIsoDateLike(expiresAt)) return undefined;

  return {
    gateId,
    userId,
    toolName,
    scope,
    originalUserText,
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function approvalReceiptCoversToolCall(
  receiptValue: unknown,
  call: ApprovalReceiptToolCall,
  now: Date = new Date(),
): boolean {
  const receipt = normalizeApprovalReceipt(receiptValue);
  if (!receipt) return false;
  if (!call.userId || call.userId !== receipt.userId) return false;
  if (call.toolName !== receipt.toolName) return false;
  if (receipt.expiresAt && Date.parse(receipt.expiresAt) < now.getTime()) return false;
  return true;
}
