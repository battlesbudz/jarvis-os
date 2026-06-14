import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { db as dbType } from "../db";

type Db = typeof dbType;

export interface MissionControlQueueRoutesDeps {
  db: Db;
}

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerMissionControlQueueRoutes(app: Express, deps: MissionControlQueueRoutesDeps): void {
  const { db } = deps;

  app.get("/api/mission-control/queue-panel", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const [reviewRows, activeJobRows] = await Promise.all([
        db
          .select()
          .from(schema.deliverables)
          .where(and(eq(schema.deliverables.userId, userId), eq(schema.deliverables.status, "pending_approval")))
          .orderBy(desc(schema.deliverables.createdAt))
          .limit(10),
        db
          .select()
          .from(schema.agentJobs)
          .where(
            and(
              eq(schema.agentJobs.userId, userId),
              sql`${schema.agentJobs.status} IN ('queued', 'running', 'cancelling')`,
            ),
          )
          .orderBy(asc(schema.agentJobs.createdAt))
          .limit(20),
      ]);

      const [{ attachDeliverableReviewState }, { attachJobReviewState }] = await Promise.all([
        import("../agent/reviewLoop"),
        import("../agent/reviewLoop"),
      ]);

      res.json({
        reviewItems: reviewRows.map(attachDeliverableReviewState),
        activeJobs: activeJobRows.map(attachJobReviewState),
      });
    } catch (err) {
      console.error("[mission-control] queue panel failed:", err);
      res.status(500).json({ error: "Failed to load Mission Control queue panel" });
    }
  });

  app.post("/api/mission-control/agent-jobs/:id/cancel", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);

      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(and(eq(schema.agentJobs.id, id), eq(schema.agentJobs.userId, userId)))
        .limit(1);

      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.status === "complete" || job.status === "failed") {
        return res.status(400).json({ error: "Job is already finished" });
      }
      if (job.status === "cancelled" || job.status === "cancelling") {
        return res.json({ ok: true, status: job.status });
      }

      const newStatus = job.status === "queued" ? "cancelled" : "cancelling";
      await db
        .update(schema.agentJobs)
        .set({ status: newStatus, completedAt: newStatus === "cancelled" ? new Date() : undefined })
        .where(eq(schema.agentJobs.id, id));

      res.json({ ok: true, status: newStatus });
    } catch (err) {
      console.error("[mission-control] cancel job failed:", err);
      res.status(500).json({ error: "Failed to cancel worker job" });
    }
  });
}
