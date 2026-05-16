import assert from "node:assert/strict";
import {
  buildDeliverableReviewState,
  buildJobReviewState,
  getDeliverableReviewActionPolicy,
} from "../reviewLoop";

{
  const review = buildJobReviewState({
    id: "job_running",
    agentType: "deep_research",
    title: "Research CRM options",
    prompt: "Research CRM options and make a report",
    input: { originChannel: "App Chat", autonomyPolicy: true },
    status: "running",
    result: null,
    error: null,
    createdAt: new Date("2026-05-16T10:00:00.000Z"),
    startedAt: new Date("2026-05-16T10:02:00.000Z"),
    completedAt: null,
  });

  assert.equal(review.stage, "in_progress");
  assert.equal(review.label, "Running");
  assert.equal(review.originChannel, "App Chat");
  assert.equal(review.autonomyPolicy, true);
  assert.equal(review.canCancel, true);
  assert.equal(review.canRetry, false);
  assert.equal(review.nextAction, "Wait or cancel");
  assert.equal(review.preview, "Research CRM options and make a report");
}

{
  const review = buildJobReviewState({
    id: "job_failed",
    agentType: "research",
    title: "Research vendors",
    prompt: "Research vendors",
    input: {},
    status: "failed",
    result: null,
    error: "Provider timed out after 120 seconds while collecting sources.",
    createdAt: new Date("2026-05-16T10:00:00.000Z"),
    startedAt: null,
    completedAt: new Date("2026-05-16T10:03:00.000Z"),
  });

  assert.equal(review.stage, "needs_retry");
  assert.equal(review.label, "Failed");
  assert.equal(review.canCancel, false);
  assert.equal(review.canRetry, true);
  assert.equal(review.nextAction, "Retry job");
  assert.match(review.preview, /Provider timed out/);
}

{
  const review = buildDeliverableReviewState({
    id: "deliv_1",
    agentType: "writing",
    type: "document",
    title: "Draft plan",
    summary: "A concise operating plan.",
    body: "Full body that should not be used when a summary exists.",
    meta: {},
    status: "pending_approval",
    triageStatus: "needs_attention",
    triageNote: null,
    driveLink: null,
    createdAt: new Date("2026-05-16T10:00:00.000Z"),
    actedAt: null,
  });

  assert.equal(review.stage, "needs_review");
  assert.equal(review.label, "Needs review");
  assert.equal(review.canApprove, true);
  assert.equal(review.canEdit, true);
  assert.equal(review.canRevise, true);
  assert.equal(review.canDiscard, true);
  assert.equal(review.canReject, false);
  assert.equal(review.canSaveToDrive, true);
  assert.equal(review.nextAction, "Approve, revise, edit, or discard");
  assert.equal(review.preview, "A concise operating plan.");
}

{
  const review = buildDeliverableReviewState({
    id: "gate_1",
    agentType: "coach",
    type: "approval_gate",
    title: "Approval required",
    summary: null,
    body: "Top-level external action needs approval.",
    meta: { gateId: "gate_123" },
    status: "pending_approval",
    triageStatus: "needs_attention",
    triageNote: null,
    driveLink: null,
    createdAt: new Date("2026-05-16T10:00:00.000Z"),
    actedAt: null,
  });

  assert.equal(review.stage, "approval_required");
  assert.equal(review.label, "Approval required");
  assert.equal(review.canApprove, true);
  assert.equal(review.canReject, true);
  assert.equal(review.canRevise, false);
  assert.equal(review.canEdit, false);
  assert.equal(review.canSaveToDrive, false);
  assert.equal(review.nextAction, "Approve or decline");
  assert.equal(review.approvalGateId, "gate_123");
}

{
  const approvalGate = {
    id: "gate_action_policy",
    agentType: "coach",
    type: "approval_gate",
    title: "Approval required",
    summary: null,
    body: "Send an external email?",
    meta: { gateId: "gate_456" },
    status: "pending_approval",
    triageStatus: "needs_attention",
    triageNote: null,
    driveLink: null,
    createdAt: new Date("2026-05-16T10:00:00.000Z"),
    actedAt: null,
  };

  assert.equal(getDeliverableReviewActionPolicy(approvalGate, "approve").allowed, true);
  assert.equal(getDeliverableReviewActionPolicy(approvalGate, "reject").allowed, true);
  assert.equal(getDeliverableReviewActionPolicy(approvalGate, "edit").allowed, false);
  assert.equal(getDeliverableReviewActionPolicy(approvalGate, "revise").allowed, false);
  assert.equal(getDeliverableReviewActionPolicy(approvalGate, "discard").allowed, false);
  assert.equal(getDeliverableReviewActionPolicy(approvalGate, "save_to_drive").allowed, false);
  assert.match(getDeliverableReviewActionPolicy(approvalGate, "discard").reason, /approve or decline/i);
}

{
  const normalDeliverable = {
    id: "doc_action_policy",
    agentType: "writing",
    type: "document",
    title: "Draft plan",
    summary: "A concise operating plan.",
    body: "Full body.",
    meta: {},
    status: "pending_approval",
    triageStatus: "needs_attention",
    triageNote: null,
    driveLink: null,
    createdAt: new Date("2026-05-16T10:00:00.000Z"),
    actedAt: null,
  };

  assert.equal(getDeliverableReviewActionPolicy(normalDeliverable, "approve").allowed, true);
  assert.equal(getDeliverableReviewActionPolicy(normalDeliverable, "edit").allowed, true);
  assert.equal(getDeliverableReviewActionPolicy(normalDeliverable, "revise").allowed, true);
  assert.equal(getDeliverableReviewActionPolicy(normalDeliverable, "discard").allowed, true);
  assert.equal(getDeliverableReviewActionPolicy(normalDeliverable, "save_to_drive").allowed, true);
  assert.equal(getDeliverableReviewActionPolicy(normalDeliverable, "reject").allowed, false);
  assert.match(getDeliverableReviewActionPolicy(normalDeliverable, "reject").reason, /approval requests/i);
}

{
  const approvedDeliverable = {
    id: "approved_action_policy",
    agentType: "writing",
    type: "document",
    title: "Accepted plan",
    summary: "Accepted.",
    body: "Accepted body.",
    meta: {},
    status: "approved",
    triageStatus: "auto_handled",
    triageNote: null,
    driveLink: null,
    createdAt: new Date("2026-05-16T10:00:00.000Z"),
    actedAt: new Date("2026-05-16T10:05:00.000Z"),
  };

  assert.equal(getDeliverableReviewActionPolicy(approvedDeliverable, "approve").allowed, false);
  assert.equal(getDeliverableReviewActionPolicy(approvedDeliverable, "edit").allowed, false);
  assert.equal(getDeliverableReviewActionPolicy(approvedDeliverable, "revise").allowed, false);
  assert.equal(getDeliverableReviewActionPolicy(approvedDeliverable, "discard").allowed, false);
  assert.equal(getDeliverableReviewActionPolicy(approvedDeliverable, "save_to_drive").allowed, true);
}

console.log("All autonomy review loop assertions passed.");
