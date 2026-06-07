import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import { agentJobs, deliverables, proactiveScheduleLog, userPreferences, users } from "@shared/schema";
import type { db as dbType } from "../../db";
import type { ApprovalGate } from "../agentApproval";
import type { SubmitJobInput } from "../jobClient";

if (!process.env.DATABASE_URL) {
  console.log("server/agent/__tests__/deliverableReviewHttpRoutes.test.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

type Db = typeof dbType;

async function requestJson(
  port: number,
  method: string,
  path: string,
  token: string,
  payload?: Record<string, unknown>,
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

async function insertDeliverable(db: Db, userId: string, values: {
  type: string;
  status?: string;
  title?: string;
  body?: string;
  meta?: Record<string, unknown>;
  jobId?: string;
}) {
  const [row] = await db
    .insert(deliverables)
    .values({
      userId,
      jobId: values.jobId,
      agentType: "coach",
      type: values.type,
      title: values.title ?? `${values.type} test`,
      summary: null,
      body: values.body ?? "Review me.",
      meta: values.meta ?? {},
      status: values.status ?? "pending_approval",
    })
    .returning();
  return row;
}

async function run(): Promise<void> {
  const { db } = await import("../../db");
  const { authMiddleware, generateToken } = await import("../../auth");
  const { registerDeliverableReviewRoutes } = await import("../deliverableReviewHttpRoutes");

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  const approvedGateIds: string[] = [];
  const rejectedGateIds: string[] = [];
  const submittedJobs: SubmitJobInput[] = [];
  const topLevelGate: ApprovalGate = {
    id: "http_gate_approve",
    agentId: "coach",
    userId: "",
    toolName: "send_email",
    toolArgs: {
      topLevelAutonomy: true,
      userText: "Send the follow-up email",
      channelName: "App Chat",
    },
    description: "Send the follow-up email",
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
  };
  registerDeliverableReviewRoutes(app, {
    db,
    approveGate: async (gateId) => {
      approvedGateIds.push(gateId);
    },
    rejectGate: async (gateId) => {
      rejectedGateIds.push(gateId);
    },
    getGate: async (gateId) => gateId === topLevelGate.id ? topLevelGate : undefined,
    handleJarvisApprovalDecision: async () => ({ handled: false }),
    isAgentSdkApprovalGate: async () => false,
    resumeAgentSdkRunFromApprovalGate: async () => undefined,
    continueTopLevelApproval: async (gate) => ({
      continued: true,
      reason: `continued ${gate.id}`,
      jobId: "continued_job_1",
      agentType: "email",
      isDuplicate: false,
    }),
    submitAgentJob: async (input) => {
      submittedJobs.push(input);
      return { id: "revision_job_1", isDuplicate: false };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  const username = `__deliverable_http_${Date.now()}`;
  const [user] = await db
    .insert(users)
    .values({ username })
    .returning({ id: users.id });
  const token = generateToken(user.id);
  topLevelGate.userId = user.id;

  try {
    const approvalGate = await insertDeliverable(db, user.id, {
      type: "approval_gate",
      body: "Jarvis wants to send an email.",
      meta: { gateId: "http_gate_1" },
    });

    const editGate = await requestJson(
      port,
      "PUT",
      `/api/deliverables/${approvalGate.id}`,
      token,
      { title: "Edited gate" },
    );
    assert.equal(editGate.status, 400, "HTTP route rejects editing approval gates");
    assert.match(String(editGate.body.error), /approve or decline/i);

    const approveGate = await insertDeliverable(db, user.id, {
      type: "approval_gate",
      body: "Jarvis wants to send the follow-up email.",
      meta: { gateId: topLevelGate.id },
    });
    const approveGateResponse = await requestJson(
      port,
      "POST",
      `/api/deliverables/${approveGate.id}/approve`,
      token,
    );
    assert.equal(approveGateResponse.status, 200, "HTTP route approves approval-gate deliverables");
    assert.equal(approvedGateIds[0], topLevelGate.id, "approval-gate approve resolves the backing gate");
    assert.deepEqual(approveGateResponse.body.continuation, {
      continued: true,
      reason: `continued ${topLevelGate.id}`,
      jobId: "continued_job_1",
      agentType: "email",
      isDuplicate: false,
    });
    const [approvedGateRow] = await db
      .select({ status: deliverables.status })
      .from(deliverables)
      .where(eq(deliverables.id, approveGate.id))
      .limit(1);
    assert.equal(approvedGateRow.status, "approved", "approval-gate approve marks deliverable approved");

    const rejectGate = await insertDeliverable(db, user.id, {
      type: "approval_gate",
      body: "Jarvis wants approval but should stop.",
      meta: { gateId: "http_gate_reject" },
    });
    const rejectGateResponse = await requestJson(
      port,
      "POST",
      `/api/deliverables/${rejectGate.id}/reject`,
      token,
    );
    assert.equal(rejectGateResponse.status, 200, "HTTP route rejects approval-gate deliverables");
    assert.equal(rejectedGateIds[0], "http_gate_reject", "approval-gate reject resolves the backing gate");
    const [rejectedGateRow] = await db
      .select({ status: deliverables.status })
      .from(deliverables)
      .where(eq(deliverables.id, rejectGate.id))
      .limit(1);
    assert.equal(rejectedGateRow.status, "rejected", "approval-gate reject marks deliverable rejected");

    const normalDeliverable = await insertDeliverable(db, user.id, {
      type: "document",
      title: "Draft operating plan",
      body: "Original operating plan.",
    });

    const editNormal = await requestJson(
      port,
      "PUT",
      `/api/deliverables/${normalDeliverable.id}`,
      token,
      { title: "Edited operating plan", body: "Edited body." },
    );
    assert.equal(editNormal.status, 200, "HTTP route allows editing normal pending deliverables");

    const discardNormal = await requestJson(
      port,
      "POST",
      `/api/deliverables/${normalDeliverable.id}/discard`,
      token,
    );
    assert.equal(discardNormal.status, 200, "HTTP route allows discarding normal pending deliverables");

    const approvedDeliverable = await insertDeliverable(db, user.id, {
      type: "document",
      status: "approved",
      title: "Accepted operating plan",
      body: "Accepted body.",
    });

    const editApproved = await requestJson(
      port,
      "PUT",
      `/api/deliverables/${approvedDeliverable.id}`,
      token,
      { title: "Should not change" },
    );
    assert.equal(editApproved.status, 400, "HTTP route rejects editing already-approved deliverables");
    assert.match(String(editApproved.body.error), /only pending/i);

    const [originalJob] = await db
      .insert(agentJobs)
      .values({
        userId: user.id,
        agentType: "planning",
        title: "Original operating plan",
        prompt: "Create the first operating plan",
        input: { retryCount: 2, originChannel: "App Chat", model: "test-model" },
        status: "complete",
      })
      .returning();
    const revisionSource = await insertDeliverable(db, user.id, {
      type: "document",
      title: "Plan that needs revision",
      body: "This plan needs more concrete operational actions.",
      jobId: originalJob.id,
    });
    const reviseResponse = await requestJson(
      port,
      "POST",
      `/api/deliverables/${revisionSource.id}/revise`,
      token,
      { instructions: "Add exact owners and next operational actions." },
    );
    assert.equal(reviseResponse.status, 200, "HTTP route queues revision jobs");
    assert.equal(reviseResponse.body.jobId, "revision_job_1");
    assert.equal(submittedJobs.length, 1, "revision route submits one new job");
    assert.equal(submittedJobs[0].userId, user.id);
    assert.equal(submittedJobs[0].agentType, "coach");
    assert.match(submittedJobs[0].title, /^Revision: Plan that needs revision/);
    assert.match(submittedJobs[0].prompt, /Return a complete replacement deliverable/);
    assert.match(submittedJobs[0].prompt, /Add exact owners and next operational actions/);
    assert.equal(submittedJobs[0].input?.revisionOfDeliverableId, revisionSource.id);
    assert.equal(submittedJobs[0].input?.revisionOfJobId, originalJob.id);
    assert.equal(submittedJobs[0].input?.revisionInstructions, "Add exact owners and next operational actions.");
    assert.equal(submittedJobs[0].input?.originChannel, "App Chat");
    assert.equal(submittedJobs[0].input?.retryCount, undefined, "revision route removes retryCount from inherited input");
    const [revisionSourceAfter] = await db
      .select({ status: deliverables.status, triageNote: deliverables.triageNote })
      .from(deliverables)
      .where(eq(deliverables.id, revisionSource.id))
      .limit(1);
    assert.equal(revisionSourceAfter.status, "discarded", "revision source is removed from pending review");
    assert.match(String(revisionSourceAfter.triageNote), /Revision requested: Add exact owners/);
    const [originalJobAfter] = await db
      .select({ status: agentJobs.status })
      .from(agentJobs)
      .where(eq(agentJobs.id, originalJob.id))
      .limit(1);
    assert.equal(originalJobAfter.status, "delivered", "revision route closes the original complete job");

    const revisionRoot = await insertDeliverable(db, user.id, {
      type: "document",
      status: "approved",
      title: "Revision family root",
      body: "Root body.",
    });
    const revisionOne = await insertDeliverable(db, user.id, {
      type: "document",
      status: "pending_approval",
      title: "Revision family first child",
      body: "First child body.",
      meta: {
        revisionOfDeliverableId: revisionRoot.id,
        revisionInstructions: "Tighten the plan.",
      },
    });
    const revisionSibling = await insertDeliverable(db, user.id, {
      type: "document",
      status: "pending_approval",
      title: "Revision family sibling child",
      body: "Sibling child body.",
      meta: {
        revisionOfDeliverableId: revisionRoot.id,
        revisionInstructions: "Try a different structure.",
      },
    });
    const revisionGrandchild = await insertDeliverable(db, user.id, {
      type: "document",
      status: "pending_approval",
      title: "Revision family grandchild",
      body: "Grandchild body.",
      meta: {
        revisionOfDeliverableId: revisionOne.id,
        revisionInstructions: "Add owners.",
      },
    });
    const unrelatedDeliverable = await insertDeliverable(db, user.id, {
      type: "document",
      status: "pending_approval",
      title: "Unrelated revision family",
      body: "Unrelated body.",
    });

    const revisionsResponse = await requestJson(
      port,
      "GET",
      `/api/deliverables/${revisionOne.id}/revisions`,
      token,
    );
    assert.equal(revisionsResponse.status, 200, "HTTP route returns deliverable revision comparisons");
    const comparison = revisionsResponse.body.comparison as {
      current: { id: string; isCurrent: boolean };
      original: { id: string; isOriginal: boolean } | null;
      revisions: Array<{ id: string; parentId: string | null; instructions: string | null }>;
      totalCount: number;
    };
    assert.equal(comparison.current.id, revisionOne.id, "revision comparison marks requested deliverable current");
    assert.equal(comparison.current.isCurrent, true);
    assert.equal(comparison.original?.id, revisionRoot.id, "revision comparison finds the original ancestor");
    assert.equal(comparison.original?.isOriginal, true);
    assert.equal(comparison.totalCount, 4, "revision comparison counts the whole revision family");
    const revisionIds = new Set(comparison.revisions.map((revision) => revision.id));
    assert.deepEqual(revisionIds, new Set([
      revisionRoot.id,
      revisionSibling.id,
      revisionGrandchild.id,
    ]), "revision comparison includes original, sibling, and descendant revisions");
    assert.equal(revisionIds.has(unrelatedDeliverable.id), false, "revision comparison excludes unrelated deliverables");
    const siblingSummary = comparison.revisions.find((revision) => revision.id === revisionSibling.id);
    assert.equal(siblingSummary?.parentId, revisionRoot.id, "sibling revision keeps parent metadata");
    assert.equal(siblingSummary?.instructions, "Try a different structure.");

    console.log("All deliverable review HTTP route assertions passed.");
  } finally {
    await db.delete(deliverables).where(eq(deliverables.userId, user.id));
    await db.delete(agentJobs).where(eq(agentJobs.userId, user.id));
    await db.delete(userPreferences).where(eq(userPreferences.userId, user.id));
    await db.delete(proactiveScheduleLog).where(eq(proactiveScheduleLog.userId, user.id));
    await db.delete(users).where(and(eq(users.id, user.id), eq(users.username, username)));
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
