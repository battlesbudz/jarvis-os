import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { userDocuments } from "@shared/schema";
import type { db as dbType } from "../db";
import { loadDeliverableForReviewAction } from "./deliverableReviewActions";
import type { ApprovalGate } from "./agentApproval";
import type { SubmitJobInput, SubmitJobResult } from "./jobClient";
import type { ContinueTopLevelApprovalResult } from "./topLevelApprovalContinuation";

type Db = typeof dbType;

export interface DeliverableReviewRoutesDeps {
  db: Db;
  approveGate?: (gateId: string, userId: string) => Promise<void>;
  rejectGate?: (gateId: string, userId: string) => Promise<void>;
  getGate?: (gateId: string) => Promise<ApprovalGate | undefined>;
  continueTopLevelApproval?: (gate: ApprovalGate) => Promise<ContinueTopLevelApprovalResult>;
  handleJarvisApprovalDecision?: (input: { gate: ApprovalGate; approved: boolean; originChannelId?: string }) => Promise<{ handled: boolean; continuation?: unknown }>;
  isAgentSdkApprovalGate?: (gate: ApprovalGate) => boolean | Promise<boolean>;
  resumeAgentSdkRunFromApprovalGate?: (input: { gate: ApprovalGate; approved: boolean; originChannelId?: string }) => Promise<unknown>;
  submitAgentJob?: (input: SubmitJobInput) => Promise<SubmitJobResult>;
}

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;
type DeliverableRow = typeof schema.deliverables.$inferSelect;

function deliverableMeta(deliverable: DeliverableRow): Record<string, unknown> {
  const meta = deliverable.meta;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
}

function revisionParentId(deliverable: DeliverableRow): string | null {
  const value = deliverableMeta(deliverable).revisionOfDeliverableId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function compareDeliverableCreatedAt(left: DeliverableRow, right: DeliverableRow): number {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function revisionSummary(deliverable: DeliverableRow, currentId: string, originalId: string) {
  const meta = deliverableMeta(deliverable);
  return {
    id: deliverable.id,
    title: deliverable.title,
    body: deliverable.body,
    createdAt: deliverable.createdAt,
    status: deliverable.status,
    parentId: revisionParentId(deliverable),
    instructions: meta.revisionInstructions ?? null,
    isCurrent: deliverable.id === currentId,
    isOriginal: deliverable.id === originalId,
  };
}

async function defaultApproveGate(gateId: string, userId: string): Promise<void> {
  const { approveGate } = await import("./agentApproval");
  await approveGate(gateId, userId);
}

async function defaultRejectGate(gateId: string, userId: string): Promise<void> {
  const { rejectGate } = await import("./agentApproval");
  await rejectGate(gateId, userId);
}

async function defaultGetGate(gateId: string): Promise<ApprovalGate | undefined> {
  const { getGate } = await import("./agentApproval");
  return getGate(gateId);
}

async function defaultContinueTopLevelApproval(gate: ApprovalGate): Promise<ContinueTopLevelApprovalResult> {
  const { continueTopLevelApproval } = await import("./topLevelApprovalContinuation");
  return continueTopLevelApproval(gate);
}

async function defaultHandleJarvisApprovalDecision(input: { gate: ApprovalGate; approved: boolean; originChannelId?: string }): Promise<{ handled: boolean; continuation?: unknown }> {
  const { handlePrimeApprovalDecision } = await import("./autonomyRuntime");
  return handlePrimeApprovalDecision(input);
}

async function defaultIsAgentSdkApprovalGate(gate: ApprovalGate): Promise<boolean> {
  const { isAgentSdkApprovalGate } = await import("../../src/agent/agentRunner");
  return isAgentSdkApprovalGate(gate);
}

async function defaultResumeAgentSdkRunFromApprovalGate(input: { gate: ApprovalGate; approved: boolean; originChannelId?: string }): Promise<unknown> {
  const { resumeAgentSdkRunFromApprovalGate } = await import("../../src/agent/agentRunner");
  return resumeAgentSdkRunFromApprovalGate(input);
}

async function defaultSubmitAgentJob(input: SubmitJobInput): Promise<SubmitJobResult> {
  const { submitAgentJob } = await import("./jobQueue");
  return submitAgentJob(input);
}

async function resumeDirectEmailApprovalIfOwned(gate: ApprovalGate, approved: boolean): Promise<{ handled: boolean; continuation?: unknown }> {
  const { isDirectEmailApprovalGate, resumeDirectEmailApprovalGate } = await import("./directEmailApprovalRoute");
  if (!isDirectEmailApprovalGate(gate)) return { handled: false };
  const continuation = await resumeDirectEmailApprovalGate(gate, approved);
  return { handled: true, continuation };
}

export function registerDeliverableReviewRoutes(app: Express, deps: DeliverableReviewRoutesDeps): void {
  const { db } = deps;
  const approveGate = deps.approveGate ?? defaultApproveGate;
  const rejectGate = deps.rejectGate ?? defaultRejectGate;
  const getGate = deps.getGate ?? defaultGetGate;
  const continueTopLevelApproval = deps.continueTopLevelApproval ?? defaultContinueTopLevelApproval;
  const handleJarvisApprovalDecision = deps.handleJarvisApprovalDecision ?? defaultHandleJarvisApprovalDecision;
  const isAgentSdkApprovalGate = deps.isAgentSdkApprovalGate ?? defaultIsAgentSdkApprovalGate;
  const resumeAgentSdkRunFromApprovalGate = deps.resumeAgentSdkRunFromApprovalGate ?? defaultResumeAgentSdkRunFromApprovalGate;
  const submitAgentJob = deps.submitAgentJob ?? defaultSubmitAgentJob;

  app.post("/api/deliverables/:id/approve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const reviewAction = await loadDeliverableForReviewAction(db, userId, id, "approve");
      if (!reviewAction.ok) return res.status(reviewAction.status).json({ error: reviewAction.error });
      const d = reviewAction.deliverable;

      let resultExtra: Record<string, unknown> = {};

      if (d.type === "approval_gate") {
        const meta = (d.meta as { gateId?: string }) || {};
        const gate = meta.gateId ? await getGate(meta.gateId) : undefined;
        if (meta.gateId) await approveGate(meta.gateId, userId);
        const coreRuntimeApproval = gate ? await handleJarvisApprovalDecision({ gate, approved: true }).catch((err) => {
          console.error("[deliverables] Jarvis Core Runtime approval resume failed:", err);
          return { handled: false, continuation: undefined };
        }) : { handled: false, continuation: undefined };
        let continuation: unknown = coreRuntimeApproval.handled ? coreRuntimeApproval.continuation : undefined;
        if (!coreRuntimeApproval.handled && gate) {
          const directEmail = await resumeDirectEmailApprovalIfOwned(gate, true).catch((err) => {
            console.error("[deliverables] direct email approval resume failed:", err);
            return { handled: false, continuation: undefined };
          });
          if (directEmail.handled) continuation = directEmail.continuation;
        }
        const fallbackContinuation = continuation !== undefined
          ? continuation
          : gate && await isAgentSdkApprovalGate(gate)
            ? await resumeAgentSdkRunFromApprovalGate({ gate, approved: true }).catch((err) => {
                console.error("[deliverables] Agent SDK approval resume failed:", err);
                return { continued: false, reason: "Agent SDK resume failed after approval." };
              })
            : gate
              ? await continueTopLevelApproval(gate).catch((err) => {
                  console.error("[deliverables] top-level approval continuation failed:", err);
                  return { continued: false, reason: "Continuation failed after approval." };
                })
              : { continued: false, reason: "Approval gate not found." };
        await db
          .update(schema.deliverables)
          .set({ status: "approved", actedAt: new Date() })
          .where(eq(schema.deliverables.id, id));
        return res.json({ ok: true, continuation: fallbackContinuation });
      }

      if (d.type === "email_draft") {
        const meta = (d.meta as { to?: string; subject?: string; emailBody?: string }) || {};
        const to = meta.to?.trim() || "";
        if (!to || !to.includes("@")) {
          return res.status(400).json({ error: "Email draft missing valid recipient" });
        }
        const { getValidGoogleTokens } = await import("../userTokenStore");
        const tokens = await getValidGoogleTokens(userId);
        const token = tokens?.[0];
        if (!token) return res.status(400).json({ error: "Gmail not connected" });
        const { createGmailDraft } = await import("../integrations/gmail");
        const result = await createGmailDraft(token, to, meta.subject || d.title, meta.emailBody || d.body);
        resultExtra = { gmailDraftUrl: result.gmailUrl, gmailDraftId: result.draftId };
      } else {
        await db.insert(userDocuments).values({
          userId,
          name: d.title.slice(0, 200),
          mimeType: "text/markdown",
          sizeBytes: Buffer.byteLength(d.body, "utf8"),
          status: "ready",
          extractedText: d.body,
          summary: d.summary || null,
        });
      }

      await db
        .update(schema.deliverables)
        .set({ status: "approved", actedAt: new Date() })
        .where(eq(schema.deliverables.id, id));
      if (d.jobId) {
        await db
          .update(schema.agentJobs)
          .set({ status: "delivered" })
          .where(and(eq(schema.agentJobs.id, d.jobId), eq(schema.agentJobs.status, "complete")));
      }
      res.json({ ok: true, ...resultExtra });
    } catch (err) {
      console.error("Error approving deliverable:", err);
      res.status(500).json({ error: "Failed to approve deliverable" });
    }
  });

  app.post("/api/deliverables/:id/reject", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const reviewAction = await loadDeliverableForReviewAction(db, userId, id, "reject");
      if (!reviewAction.ok) return res.status(reviewAction.status).json({ error: reviewAction.error });
      const d = reviewAction.deliverable;
      let continuation: unknown = undefined;
      if (d.type === "approval_gate") {
        const meta = (d.meta as { gateId?: string }) || {};
        const gate = meta.gateId ? await getGate(meta.gateId) : undefined;
        if (meta.gateId) await rejectGate(meta.gateId, userId);
        const coreRuntimeApproval = gate ? await handleJarvisApprovalDecision({ gate, approved: false }).catch((err) => {
          console.error("[deliverables] Jarvis Core Runtime rejection resume failed:", err);
          return { handled: false, continuation: undefined };
        }) : { handled: false, continuation: undefined };
        if (coreRuntimeApproval.handled) {
          continuation = coreRuntimeApproval.continuation;
        } else if (gate) {
          const directEmail = await resumeDirectEmailApprovalIfOwned(gate, false).catch((err) => {
            console.error("[deliverables] direct email rejection resume failed:", err);
            return { handled: false, continuation: undefined };
          });
          if (directEmail.handled) continuation = directEmail.continuation;
          else if (await isAgentSdkApprovalGate(gate)) {
            continuation = await resumeAgentSdkRunFromApprovalGate({ gate, approved: false }).catch((err) => {
              console.error("[deliverables] Agent SDK rejection resume failed:", err);
              return { continued: false, reason: "Agent SDK resume failed after rejection." };
            });
          }
        } else if (gate && await isAgentSdkApprovalGate(gate)) {
          continuation = await resumeAgentSdkRunFromApprovalGate({ gate, approved: false }).catch((err) => {
            console.error("[deliverables] Agent SDK rejection resume failed:", err);
            return { continued: false, reason: "Agent SDK resume failed after rejection." };
          });
        }
      }
      await db
        .update(schema.deliverables)
        .set({ status: "rejected", actedAt: new Date() })
        .where(eq(schema.deliverables.id, id));
      if (d.jobId) {
        await db
          .update(schema.agentJobs)
          .set({ status: "delivered" })
          .where(and(eq(schema.agentJobs.id, d.jobId), eq(schema.agentJobs.status, "complete")));
      }
      res.json({ ok: true, continuation });
    } catch (err) {
      console.error("Error rejecting deliverable:", err);
      res.status(500).json({ error: "Failed to reject deliverable" });
    }
  });

  app.put("/api/deliverables/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { title, summary, body, meta } = req.body as {
        title?: unknown;
        summary?: unknown;
        body?: unknown;
        meta?: unknown;
      };
      const reviewAction = await loadDeliverableForReviewAction(db, userId, id, "edit");
      if (!reviewAction.ok) return res.status(reviewAction.status).json({ error: reviewAction.error });
      const existing = reviewAction.deliverable;
      const patch: Partial<typeof schema.deliverables.$inferInsert> = {};
      if (typeof title === "string" && title.trim().length > 0) patch.title = title.trim().slice(0, 300);
      if (typeof summary === "string") patch.summary = summary.slice(0, 1000);
      if (typeof body === "string" && body.trim().length > 0) patch.body = body.slice(0, 100_000);
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        patch.meta = { ...(existing.meta as Record<string, unknown>), ...(meta as Record<string, unknown>) };
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No editable fields provided" });
      }
      const [updated] = await db
        .update(schema.deliverables)
        .set(patch)
        .where(eq(schema.deliverables.id, id))
        .returning();
      res.json({ ok: true, deliverable: updated });
    } catch (err) {
      console.error("Error editing deliverable:", err);
      res.status(500).json({ error: "Failed to edit deliverable" });
    }
  });

  app.post("/api/deliverables/:id/revise", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const instructions = typeof req.body?.instructions === "string" ? req.body.instructions.trim() : "";
      if (!instructions) return res.status(400).json({ error: "Revision instructions are required" });

      const reviewAction = await loadDeliverableForReviewAction(db, userId, id, "revise");
      if (!reviewAction.ok) return res.status(reviewAction.status).json({ error: reviewAction.error });
      const d = reviewAction.deliverable;

      const [job] = d.jobId
        ? await db
            .select()
            .from(schema.agentJobs)
          .where(and(eq(schema.agentJobs.id, d.jobId), eq(schema.agentJobs.userId, userId)))
          .limit(1)
        : [];

      const baseInput = job?.input && typeof job.input === "object" && !Array.isArray(job.input)
        ? { ...(job.input as Record<string, unknown>) }
        : {};
      delete baseInput.retryCount;

      const revisionPrompt = [
        "Revise this Jarvis deliverable according to the user's requested changes.",
        "",
        `Original task: ${job?.prompt || d.title}`,
        "",
        "Current deliverable:",
        d.body.slice(0, 30000),
        "",
        "Requested changes:",
        instructions,
        "",
        "Return a complete replacement deliverable, not a patch note.",
      ].join("\n");

      const revision = await submitAgentJob({
        userId,
        agentType: d.agentType as any,
        title: `Revision: ${d.title}`.slice(0, 200),
        prompt: revisionPrompt,
        input: {
          ...baseInput,
          revisionOfDeliverableId: d.id,
          revisionOfJobId: d.jobId,
          revisionInstructions: instructions.slice(0, 2000),
        },
      });

      await db
        .update(schema.deliverables)
        .set({
          status: "discarded",
          actedAt: new Date(),
          triageNote: `Revision requested: ${instructions.slice(0, 500)}`,
        })
        .where(eq(schema.deliverables.id, id));

      if (d.jobId) {
        await db
          .update(schema.agentJobs)
          .set({ status: "delivered" })
          .where(and(eq(schema.agentJobs.id, d.jobId), eq(schema.agentJobs.status, "complete")));
      }

      res.json({ ok: true, jobId: revision.id, isDuplicate: revision.isDuplicate, status: "queued" });
    } catch (err) {
      console.error("Error requesting deliverable revision:", err);
      res.status(500).json({ error: "Failed to request revision" });
    }
  });

  app.get("/api/deliverables/:id/revisions", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);

      const [target] = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)))
        .limit(1);

      if (!target) return res.status(404).json({ error: "Deliverable not found" });

      const userDeliverables = await db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.userId, userId));
      const byId = new Map(userDeliverables.map((deliverable) => [deliverable.id, deliverable]));

      let original = target;
      const ancestors = new Set<string>();
      for (;;) {
        const parentId = revisionParentId(original);
        if (!parentId || ancestors.has(parentId)) break;
        const parent = byId.get(parentId);
        if (!parent) break;
        ancestors.add(original.id);
        original = parent;
      }

      const familyIds = new Set<string>([original.id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const deliverable of userDeliverables) {
          const parentId = revisionParentId(deliverable);
          if (parentId && familyIds.has(parentId) && !familyIds.has(deliverable.id)) {
            familyIds.add(deliverable.id);
            changed = true;
          }
        }
      }

      const family = userDeliverables
        .filter((deliverable) => familyIds.has(deliverable.id))
        .sort(compareDeliverableCreatedAt);
      const current = revisionSummary(target, target.id, original.id);

      res.json({
        ok: true,
        comparison: {
          current,
          original: original.id === target.id ? null : revisionSummary(original, target.id, original.id),
          revisions: family
            .filter((deliverable) => deliverable.id !== target.id)
            .map((deliverable) => revisionSummary(deliverable, target.id, original.id)),
          totalCount: family.length,
        },
      });
    } catch (err) {
      console.error("Error fetching deliverable revisions:", err);
      res.status(500).json({ error: "Failed to fetch revisions" });
    }
  });

  app.post("/api/deliverables/:id/discard", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const reviewAction = await loadDeliverableForReviewAction(db, userId, id, "discard");
      if (!reviewAction.ok) return res.status(reviewAction.status).json({ error: reviewAction.error });
      const d = reviewAction.deliverable;
      await db
        .update(schema.deliverables)
        .set({ status: "discarded", actedAt: new Date() })
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)));
      if (d?.jobId) {
        await db
          .update(schema.agentJobs)
          .set({ status: "delivered" })
          .where(and(eq(schema.agentJobs.id, d.jobId), eq(schema.agentJobs.status, "complete")));
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("Error discarding deliverable:", err);
      res.status(500).json({ error: "Failed to discard deliverable" });
    }
  });

  app.post("/api/deliverables/:id/save-to-drive", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const reviewAction = await loadDeliverableForReviewAction(db, userId, id, "save_to_drive");
      if (!reviewAction.ok) return res.status(reviewAction.status).json({ error: reviewAction.error });
      const d = reviewAction.deliverable;
      if (d.driveLink) return res.json({ ok: true, driveLink: d.driveLink });

      const { getUserDriveSettings } = await import("../driveRoutes");
      const { createDriveTextFile } = await import("../integrations/googleDrive");
      const drive = await getUserDriveSettings(userId);
      if (!drive.enabled || !drive.accessToken) {
        return res.status(400).json({ error: "Google Drive is not connected. Enable it in Settings.", code: "DRIVE_NOT_CONNECTED" });
      }

      const content = d.body || d.summary || d.title;
      const baseName = (d.title.slice(0, 95) || "Jarvis Document").replace(/\.md$/, "");
      const fileName = `${baseName}.md`;
      const created = await createDriveTextFile(
        drive.accessToken,
        fileName,
        content,
        { folderId: drive.folderId || undefined },
      );

      const [updated] = await db
        .update(schema.deliverables)
        .set({ driveLink: created.webViewLink })
        .where(eq(schema.deliverables.id, id))
        .returning();

      res.json({ ok: true, driveLink: created.webViewLink, deliverable: updated });
    } catch (err) {
      console.error("Error saving deliverable to Drive:", err);
      res.status(500).json({ error: "Failed to save to Drive" });
    }
  });
}
