import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { deliverables, users } from "@shared/schema";
import type { db as dbType } from "../../db";
import { loadDeliverableForReviewAction } from "../deliverableReviewActions";

if (!process.env.DATABASE_URL) {
  console.log("server/agent/__tests__/deliverableReviewActions.test.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

type Db = typeof dbType;

async function insertDeliverable(db: Db, userId: string, values: {
  type: string;
  status?: string;
  title?: string;
  body?: string;
  meta?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(deliverables)
    .values({
      userId,
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
  const username = `__deliverable_review_${Date.now()}`;
  const [user] = await db
    .insert(users)
    .values({ username })
    .returning({ id: users.id });

  try {
    const approvalGate = await insertDeliverable(db, user.id, {
      type: "approval_gate",
      body: "Jarvis wants to send an email.",
      meta: { gateId: "db_gate_1" },
    });

    for (const action of ["edit", "revise", "discard", "save_to_drive"] as const) {
      const result = await loadDeliverableForReviewAction(db, user.id, approvalGate.id, action);
      assert.equal(result.ok, false, `approval gate rejects ${action}`);
      assert.match(result.ok ? "" : result.error, /approve or decline/i);
    }

    const approveGate = await loadDeliverableForReviewAction(db, user.id, approvalGate.id, "approve");
    assert.equal(approveGate.ok, true, "approval gate allows approve");
    const rejectGate = await loadDeliverableForReviewAction(db, user.id, approvalGate.id, "reject");
    assert.equal(rejectGate.ok, true, "approval gate allows reject");

    const [gateAfterInvalidActions] = await db
      .select({ status: deliverables.status, title: deliverables.title, driveLink: deliverables.driveLink })
      .from(deliverables)
      .where(eq(deliverables.id, approvalGate.id))
      .limit(1);
    assert.equal(gateAfterInvalidActions.status, "pending_approval");
    assert.equal(gateAfterInvalidActions.title, approvalGate.title);
    assert.equal(gateAfterInvalidActions.driveLink, null);

    const normalDeliverable = await insertDeliverable(db, user.id, {
      type: "document",
      title: "Draft operating plan",
      body: "Original operating plan.",
    });

    for (const action of ["approve", "edit", "revise", "discard", "save_to_drive"] as const) {
      const result = await loadDeliverableForReviewAction(db, user.id, normalDeliverable.id, action);
      assert.equal(result.ok, true, `normal pending deliverable allows ${action}`);
    }

    const rejectNormal = await loadDeliverableForReviewAction(db, user.id, normalDeliverable.id, "reject");
    assert.equal(rejectNormal.ok, false, "normal deliverables reject decline action");
    assert.match(rejectNormal.ok ? "" : rejectNormal.error, /approval requests/i);

    const approvedDeliverable = await insertDeliverable(db, user.id, {
      type: "document",
      status: "approved",
      title: "Accepted operating plan",
      body: "Accepted body.",
    });

    const editApproved = await loadDeliverableForReviewAction(db, user.id, approvedDeliverable.id, "edit");
    assert.equal(editApproved.ok, false, "approved deliverables cannot be edited after review");
    assert.match(editApproved.ok ? "" : editApproved.error, /only pending/i);

    const saveApproved = await loadDeliverableForReviewAction(db, user.id, approvedDeliverable.id, "save_to_drive");
    assert.equal(saveApproved.ok, true, "approved normal deliverables can still be saved to Drive");

    console.log("All deliverable review action DB assertions passed.");
  } finally {
    await db.delete(deliverables).where(eq(deliverables.userId, user.id));
    await db.delete(users).where(and(eq(users.id, user.id), eq(users.username, username)));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
