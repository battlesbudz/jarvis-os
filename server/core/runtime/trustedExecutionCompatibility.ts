import type { AuthorityValidationResult } from "./trustedExecutionTypes";

export interface TrustedExecutionReceipt {
  authorityId: string;
  stepKey: string;
  attemptId: string;
  fenceToken: number;
  userId: string;
  toolName: string;
  action: string;
  targetFingerprint: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
}

export interface TrustedExecutionToolCall {
  userId?: string;
  toolName: string;
}

export function createTrustedExecutionReceipt(input: TrustedExecutionReceipt): TrustedExecutionReceipt {
  const receipt = normalizeTrustedExecutionReceipt(input);
  if (!receipt) throw new Error("Trusted Execution receipt requires a bounded current step and fencing token.");
  return receipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeTrustedExecutionReceipt(value: unknown): TrustedExecutionReceipt | undefined {
  if (!isRecord(value)) return undefined;
  const receipt = value as Partial<TrustedExecutionReceipt>;
  if (
    typeof receipt.authorityId !== "string" || !receipt.authorityId.trim()
    || typeof receipt.stepKey !== "string" || !receipt.stepKey.trim()
    || typeof receipt.attemptId !== "string" || !receipt.attemptId.trim()
    || !Number.isSafeInteger(receipt.fenceToken) || Number(receipt.fenceToken) < 1
    || typeof receipt.userId !== "string" || !receipt.userId.trim()
    || typeof receipt.toolName !== "string" || !receipt.toolName.trim()
    || typeof receipt.action !== "string" || !receipt.action.trim()
    || typeof receipt.targetFingerprint !== "string" || !receipt.targetFingerprint.trim()
    || typeof receipt.idempotencyKey !== "string" || !receipt.idempotencyKey.trim()
    || typeof receipt.issuedAt !== "string" || Number.isNaN(Date.parse(receipt.issuedAt))
    || typeof receipt.expiresAt !== "string" || Number.isNaN(Date.parse(receipt.expiresAt))
  ) return undefined;
  return receipt as TrustedExecutionReceipt;
}

export function trustedExecutionReceiptCoversToolCall(
  receiptValue: unknown,
  call: TrustedExecutionToolCall,
  now: Date = new Date(),
): boolean {
  const receipt = normalizeTrustedExecutionReceipt(receiptValue);
  if (!receipt || !call.userId) return false;
  return receipt.userId === call.userId
    && receipt.toolName === call.toolName
    && Date.parse(receipt.issuedAt) <= now.getTime()
    && Date.parse(receipt.expiresAt) >= now.getTime();
}

export type ApprovalCompatibilityDecision =
  | { mode: "legacy_approval"; reason: string }
  | { mode: "trusted_execution"; reason: string; receipt: TrustedExecutionReceipt }
  | { mode: "block"; reason: string };

/**
 * Migration seam for approval-aware tools. With the feature disabled or with no
 * central receipt, the existing approval path remains authoritative. A caller
 * that references central authority without a current, valid server-owned step
 * receipt fails closed instead of falling back to a reusable legacy approval.
 */
export function resolveApprovalCompatibility(input: {
  trustedExecutionEnabled: boolean;
  authorityReferenced: boolean;
  receipt?: unknown;
  call: TrustedExecutionToolCall;
  authorityValidation?: AuthorityValidationResult;
  now?: Date;
}): ApprovalCompatibilityDecision {
  if (!input.trustedExecutionEnabled) {
    return { mode: "legacy_approval", reason: "Trusted Execution is disabled for this adapter." };
  }
  if (!input.authorityReferenced) {
    return { mode: "block", reason: "This enabled adapter must resolve central authority before an approval-aware tool call." };
  }
  if (!input.authorityValidation?.valid) {
    return { mode: "block", reason: "The referenced Trusted Execution authority is not valid for this call." };
  }
  const receipt = normalizeTrustedExecutionReceipt(input.receipt);
  if (!receipt || !trustedExecutionReceiptCoversToolCall(receipt, input.call, input.now)) {
    return { mode: "block", reason: "The Trusted Execution step receipt is missing, expired, or outside this tool call." };
  }
  if (input.authorityValidation.authorityId !== receipt.authorityId
    || input.authorityValidation.stepKey !== receipt.stepKey
    || input.authorityValidation.action !== receipt.action
    || input.authorityValidation.targetFingerprint !== receipt.targetFingerprint) {
    return { mode: "block", reason: "The Trusted Execution validation does not cover the supplied step receipt." };
  }
  return { mode: "trusted_execution", reason: "A current central authority step covers this approval-aware tool call.", receipt };
}
