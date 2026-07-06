import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export function registerAgentJobQueryRoutes(app: Express): void {
  app.get("/api/agent-jobs", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const where = status
        ? and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, status))
        : eq(schema.agentJobs.userId, userId);
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(where)
        .orderBy(desc(schema.agentJobs.createdAt))
        .limit(limit);
      const { attachJobReviewState } = await import("../agent/reviewLoop");
      res.json(jobs.map(attachJobReviewState));
    } catch (err) {
      console.error("Error listing agent jobs:", err);
      res.status(500).json({ error: "Failed to list jobs" });
    }
  });

  app.get("/api/agent-jobs/active", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.userId, userId),
            sql`${schema.agentJobs.status} IN ('queued', 'running', 'cancelling', 'resource_paused')`,
          ),
        )
        .orderBy(asc(schema.agentJobs.createdAt))
        .limit(20);
      const { attachJobReviewState } = await import("../agent/reviewLoop");
      res.json(jobs.map(attachJobReviewState));
    } catch (err) {
      console.error("Error listing active agent jobs:", err);
      res.status(500).json({ error: "Failed to list active jobs" });
    }
  });

  app.get("/api/agent-jobs/observability", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.userId, userId))
        .orderBy(desc(schema.agentJobs.createdAt))
        .limit(80);
      const { getRecentEvents } = await import("../diagnostics/diagnosticsService");
      const { buildJobRunnerObservability } = await import("../agent/jobObservability");
      const diagnosticEvents = await getRecentEvents({
        userId,
        subsystem: "job_queue",
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(buildJobRunnerObservability({ jobs, diagnosticEvents }));
    } catch (err) {
      console.error("Error building agent job observability report:", err);
      res.status(500).json({ error: "Failed to build job observability report" });
    }
  });
}
