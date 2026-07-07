import { RESOURCE_PAUSED_STATUS } from "./voiceRuntimeResourceCore";

type JsonRecord = Record<string, unknown>;

export interface ReviewLoopJobInput {
  id: string;
  agentType: string;
  title: string;
  prompt: string;
  input: unknown;
  status: string;
  result?: unknown;
  error?: string | null;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}

export interface ReviewLoopDeliverableInput {
  id: string;
  agentType: string;
  type: string;
  title: string;
  summary?: string | null;
  body: string;
  meta: unknown;
  status: string;
  triageStatus?: string | null;
  triageNote?: string | null;
  driveLink?: string | null;
  createdAt: Date | string;
  actedAt?: Date | string | null;
}

export interface JobReviewState {
  stage: "queued" | "in_progress" | "needs_retry" | "review_ready" | "reviewed" | "cancelled";
  label: string;
  nextAction: string;
  canCancel: boolean;
  canRetry: boolean;
  preview: string;
  originChannel?: string;
  autonomyPolicy: boolean;
}

export interface DeliverableReviewState {
  stage: "needs_review" | "approval_required" | "reviewed" | "discarded";
  label: string;
  nextAction: string;
  canApprove: boolean;
  canEdit: boolean;
  canRevise: boolean;
  canDiscard: boolean;
  canReject: boolean;
  canSaveToDrive: boolean;
  preview: string;
  approvalGateId?: string;
}

export type DeliverableReviewAction =
  | "approve"
  | "reject"
  | "edit"
  | "revise"
  | "discard"
  | "save_to_drive";

export interface DeliverableReviewActionPolicy {
  allowed: boolean;
  reason?: string;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function previewText(...candidates: Array<unknown>): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (normalized) return normalized.slice(0, 280);
  }
  return "";
}

export function buildJobReviewState(job: ReviewLoopJobInput): JobReviewState {
  const input = asRecord(job.input);
  const originChannel = typeof input.originChannel === "string" ? input.originChannel : undefined;
  const autonomyPolicy = input.autonomyPolicy === true;
  const preview = previewText(job.error, job.prompt, job.title);

  if (job.status === "queued") {
    return {
      stage: "queued",
      label: "Queued",
      nextAction: "Wait or cancel",
      canCancel: true,
      canRetry: false,
      preview,
      originChannel,
      autonomyPolicy,
    };
  }

  if (job.status === RESOURCE_PAUSED_STATUS) {
    return {
      stage: "in_progress",
      label: "Paused for voice",
      nextAction: "Wait for voice to finish or cancel",
      canCancel: true,
      canRetry: false,
      preview,
      originChannel,
      autonomyPolicy,
    };
  }

  if (job.status === "running" || job.status === "cancelling") {
    return {
      stage: "in_progress",
      label: job.status === "cancelling" ? "Cancelling" : "Running",
      nextAction: job.status === "cancelling" ? "Waiting for cancellation" : "Wait or cancel",
      canCancel: job.status === "running",
      canRetry: false,
      preview,
      originChannel,
      autonomyPolicy,
    };
  }

  if (job.status === "failed") {
    return {
      stage: "needs_retry",
      label: "Failed",
      nextAction: "Retry job",
      canCancel: false,
      canRetry: true,
      preview,
      originChannel,
      autonomyPolicy,
    };
  }

  if (job.status === "cancelled") {
    return {
      stage: "cancelled",
      label: "Cancelled",
      nextAction: "Retry if still needed",
      canCancel: false,
      canRetry: true,
      preview,
      originChannel,
      autonomyPolicy,
    };
  }

  if (job.status === "complete") {
    return {
      stage: "review_ready",
      label: "Ready for review",
      nextAction: "Open deliverable",
      canCancel: false,
      canRetry: false,
      preview,
      originChannel,
      autonomyPolicy,
    };
  }

  return {
    stage: "reviewed",
    label: "Reviewed",
    nextAction: "No action needed",
    canCancel: false,
    canRetry: false,
    preview,
    originChannel,
    autonomyPolicy,
  };
}

export function buildDeliverableReviewState(deliverable: ReviewLoopDeliverableInput): DeliverableReviewState {
  const meta = asRecord(deliverable.meta);
  const preview = previewText(deliverable.summary, deliverable.body, deliverable.title);
  const isPending = deliverable.status === "pending_approval";
  const isApprovalGate = deliverable.type === "approval_gate";
  const approvalGateId = typeof meta.gateId === "string" ? meta.gateId : undefined;

  if (isPending && isApprovalGate) {
    return {
      stage: "approval_required",
      label: "Approval required",
      nextAction: "Approve or decline",
      canApprove: true,
      canEdit: false,
      canRevise: false,
      canDiscard: false,
      canReject: true,
      canSaveToDrive: false,
      preview,
      approvalGateId,
    };
  }

  if (isPending) {
    return {
      stage: "needs_review",
      label: "Needs review",
      nextAction: "Approve, revise, edit, or discard",
      canApprove: true,
      canEdit: true,
      canRevise: true,
      canDiscard: true,
      canReject: false,
      canSaveToDrive: true,
      preview,
      approvalGateId,
    };
  }

  if (deliverable.status === "discarded" || deliverable.status === "rejected") {
    return {
      stage: "discarded",
      label: deliverable.status === "rejected" ? "Declined" : "Discarded",
      nextAction: "No action needed",
      canApprove: false,
      canEdit: false,
      canRevise: false,
      canDiscard: false,
      canReject: false,
      canSaveToDrive: false,
      preview,
      approvalGateId,
    };
  }

  return {
    stage: "reviewed",
    label: "Reviewed",
    nextAction: "No action needed",
    canApprove: false,
    canEdit: false,
    canRevise: false,
    canDiscard: false,
    canReject: false,
    canSaveToDrive: deliverable.status === "approved" && deliverable.type !== "approval_gate",
    preview,
    approvalGateId,
  };
}

export function getDeliverableReviewActionPolicy(
  deliverable: ReviewLoopDeliverableInput,
  action: DeliverableReviewAction,
): DeliverableReviewActionPolicy {
  const isApprovalGate = deliverable.type === "approval_gate";
  const isPending = deliverable.status === "pending_approval";
  const isApproved = deliverable.status === "approved";

  if (isApprovalGate) {
    if (isPending && (action === "approve" || action === "reject")) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Approval requests can only use approve or decline.",
    };
  }

  if (action === "reject") {
    if (isPending) return { allowed: true };
    return {
      allowed: false,
      reason: "Only pending deliverables can be declined.",
    };
  }

  if (action === "save_to_drive") {
    if (isPending || isApproved) return { allowed: true };
    return {
      allowed: false,
      reason: "Only pending or approved deliverables can be saved to Drive.",
    };
  }

  if (!isPending) {
    return {
      allowed: false,
      reason: "Only pending deliverables can be reviewed.",
    };
  }

  return { allowed: true };
}

export function attachJobReviewState<T extends ReviewLoopJobInput>(job: T): T & { review: JobReviewState } {
  return { ...job, review: buildJobReviewState(job) };
}

export function attachDeliverableReviewState<T extends ReviewLoopDeliverableInput>(
  deliverable: T,
): T & { review: DeliverableReviewState } {
  return { ...deliverable, review: buildDeliverableReviewState(deliverable) };
}
