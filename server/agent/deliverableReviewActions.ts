import { and, eq } from "drizzle-orm";
import { deliverables } from "@shared/schema";
import type { db as dbType } from "../db";
import {
  getDeliverableReviewActionPolicy,
  type DeliverableReviewAction,
  type ReviewLoopDeliverableInput,
} from "./reviewLoop";

type Db = typeof dbType;

export type DeliverableReviewActionResult =
  | { ok: true; deliverable: typeof deliverables.$inferSelect }
  | { ok: false; status: number; error: string };

export async function loadDeliverableForReviewAction(
  db: Db,
  userId: string,
  deliverableId: string,
  action: DeliverableReviewAction,
): Promise<DeliverableReviewActionResult> {
  const [deliverable] = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.id, deliverableId), eq(deliverables.userId, userId)))
    .limit(1);

  if (!deliverable) {
    return { ok: false, status: 404, error: "Deliverable not found" };
  }

  const policy = getDeliverableReviewActionPolicy(deliverable as ReviewLoopDeliverableInput, action);
  if (!policy.allowed) {
    return {
      ok: false,
      status: 400,
      error: policy.reason || "This deliverable action is not allowed",
    };
  }

  return { ok: true, deliverable };
}
