import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import { agentJobs, deliverables, users } from "@shared/schema";
import type { db as dbType } from "../../db";
import type { ApprovalGate } from "../agentApproval";

if (!process.env.DATABASE_URL) {
  console.log("server/agent/__tests__/missionControlQueuePanel.test.ts: DATABASE_URL not set - skipped");
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

async function insertReviewItem(db: Db, userId: string, values: {
  title: string;
  type?: string;
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
      type: values.type ?? "approval_gate",
      title: values.title,
      summary: "Short review summary.",
      body: values.body ?? "Review this queued action.",
      meta: values.meta ?? {},
      status: "pending_approval",
    })
    .returning();
  return row;
}

async function run(): Promise<void> {
  const { db } = await import("../../db");
  const { authMiddleware, generateToken } = await import("../../auth");
  const { registerMissionControlQueueRoutes } = await import("../../routes/missionControlQueueRoutes");
  const { registerDeliverableReviewRoutes } = await import("../deliverableReviewHttpRoutes");

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);

  const approvedGateIds: string[] = [];
  const rejectedGateIds: string[] = [];
  const approvalGate: ApprovalGate = {
    id: "mission_control_gate",
    agentId: "coach",
    userId: "",
    toolName: "send_email",
    toolArgs: { topLevelAutonomy: true, userText: "Send the queued email", channelName: "Mission Control" },
    description: "Send the queued email",
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };

  registerMissionControlQueueRoutes(app, { db });
  registerDeliverableReviewRoutes(app, {
    db,
    approveGate: async (gateId) => {
      approvedGateIds.push(gateId);
    },
    rejectGate: async (gateId) => {
      rejectedGateIds.push(gateId);
    },
    getGate: async (gateId) => gateId === approvalGate.id ? approvalGate : undefined,
    handleJarvisApprovalDecision: async () => ({ handled: false }),
    isAgentSdkApprovalGate: async () => false,
    resumeAgentSdkRunFromApprovalGate: async () => undefined,
    continueTopLevelApproval: async (gate) => ({
      continued: true,
      reason: `continued ${gate.id}`,
      jobId: "continued_job",
      agentType: "email",
      isDuplicate: false,
    }),
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  const username = `__mission_control_queue_${Date.now()}`;
  const [user] = await db
    .insert(users)
    .values({ username })
    .returning({ id: users.id });
  const token = generateToken(user.id);
  approvalGate.userId = user.id;

  try {
    const [queuedJob] = await db
      .insert(agentJobs)
      .values({
        userId: user.id,
        agentType: "ephemeral_agent_task",
        title: "Extract meeting action items",
        prompt: "Extract action items and owners from the uploaded meeting notes, then return a reviewable handoff.",
        input: {
          workerType: "goal_task",
          workerRuntime: {
            progress: { currentStep: "Queued", percent: 15 },
          },
        },
        status: "queued",
      })
      .returning();

    const approveItem = await insertReviewItem(db, user.id, {
      title: "Approve queued email",
      meta: { gateId: approvalGate.id },
      jobId: queuedJob.id,
    });
    const rejectItem = await insertReviewItem(db, user.id, {
      title: "Reject queued browser action",
      meta: { gateId: "reject_gate" },
    });

    const panel = await requestJson(port, "GET", "/api/mission-control/queue-panel", token);
    assert.equal(panel.status, 200, "queue panel route succeeds");
    const body = panel.body as {
      reviewItems?: { id: string; title: string; type: string; jobId?: string | null }[];
      activeJobs?: { id: string; title: string; status: string; input?: { workerType?: string; workerRuntime?: { progress?: { currentStep?: string; percent?: number } } } }[];
    };
    const activeJob = body.activeJobs?.find((job) => job.id === queuedJob.id);
    assert.ok(activeJob, "queue panel includes active worker jobs");
    assert.equal(activeJob?.status, "queued");
    assert.equal(activeJob?.input?.workerType, "goal_task");
    assert.equal(activeJob?.input?.workerRuntime?.progress?.currentStep, "Queued");
    assert.equal(activeJob?.input?.workerRuntime?.progress?.percent, 15);
    const reviewItem = body.reviewItems?.find((item) => item.id === approveItem.id);
    assert.ok(reviewItem, "queue panel includes pending review items");
    assert.equal(reviewItem?.type, "approval_gate");
    assert.equal(reviewItem?.jobId, queuedJob.id);
    console.log("OK: Mission Control queue panel exposes active workers and pending reviews");

    const approve = await requestJson(port, "POST", `/api/deliverables/${approveItem.id}/approve`, token);
    assert.equal(approve.status, 200, "Mission Control approve action can approve a review item");
    assert.equal(approvedGateIds[0], approvalGate.id);

    const reject = await requestJson(port, "POST", `/api/deliverables/${rejectItem.id}/reject`, token);
    assert.equal(reject.status, 200, "Mission Control reject action can reject a review item");
    assert.equal(rejectedGateIds[0], "reject_gate");

    const cancel = await requestJson(port, "POST", `/api/mission-control/agent-jobs/${queuedJob.id}/cancel`, token);
    assert.equal(cancel.status, 200, "Mission Control cancel action can cancel queued worker jobs");
    assert.equal(cancel.body.status, "cancelled");
    const [cancelledJob] = await db
      .select({ status: agentJobs.status })
      .from(agentJobs)
      .where(eq(agentJobs.id, queuedJob.id))
      .limit(1);
    assert.equal(cancelledJob.status, "cancelled");
    console.log("OK: Mission Control queue actions approve, reject, and cancel real rows");
  } finally {
    await db.delete(deliverables).where(eq(deliverables.userId, user.id));
    await db.delete(agentJobs).where(eq(agentJobs.userId, user.id));
    await db.delete(users).where(and(eq(users.id, user.id), eq(users.username, username)));
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
