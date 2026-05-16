import assert from "node:assert/strict";
import {
  buildDeliverableReviewState,
  buildJobReviewState,
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
  assert.equal(review.nextAction, "Approve or decline");
  assert.equal(review.approvalGateId, "gate_123");
}

console.log("All autonomy review loop assertions passed.");
