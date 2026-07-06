import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { cancellationStatusForAgentJobStatus } from "../agent/voiceRuntimeResourceCore";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerAgentJobMutationRoutes(app: Express): void {
  app.post("/api/agent-jobs", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { agentType, title, prompt, input } = req.body as {
        agentType?: string;
        title?: string;
        prompt?: string;
        input?: Record<string, unknown>;
      };
      const allowed = ["research", "writing", "planning", "email", "goal_decompose"] as const;
      if (!agentType || !allowed.includes(agentType as (typeof allowed)[number])) {
        return res.status(400).json({ error: `agentType must be one of ${allowed.join(", ")}` });
      }
      if (!title || !prompt) {
        return res.status(400).json({ error: "title and prompt are required" });
      }
      const { submitAgentJob } = await import("../agent/jobQueue");
      const { id: jobId } = await submitAgentJob({
        userId,
        agentType: agentType as (typeof allowed)[number],
        title,
        prompt,
        input: input || {},
      });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error submitting agent job:", err);
      res.status(500).json({ error: "Failed to submit job" });
    }
  });

  app.post("/api/agent-jobs/:id/cancel", async (req: Request, res: Response) => {
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
      const newStatus = cancellationStatusForAgentJobStatus(job.status);
      if (!newStatus) {
        return res.status(400).json({ error: "Job is already finished" });
      }
      await db
        .update(schema.agentJobs)
        .set({ status: newStatus, completedAt: newStatus === "cancelled" ? new Date() : undefined })
        .where(eq(schema.agentJobs.id, id));
      res.json({ ok: true, status: newStatus });
    } catch (err) {
      console.error("Error cancelling agent job:", err);
      res.status(500).json({ error: "Failed to cancel job" });
    }
  });

  app.post("/api/agent-jobs/:id/retry", async (req: Request, res: Response) => {
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
      if (!["failed", "cancelled"].includes(job.status)) {
        return res.status(400).json({ error: "Only failed or cancelled jobs can be retried" });
      }

      const { submitAgentJob } = await import("../agent/jobQueue");
      const input = job.input && typeof job.input === "object" && !Array.isArray(job.input)
        ? { ...(job.input as Record<string, unknown>) }
        : {};
      delete input.retryCount;
      const retry = await submitAgentJob({
        userId,
        agentType: job.agentType as any,
        title: job.title,
        prompt: job.prompt,
        input: {
          ...input,
          retryOfJobId: job.id,
          retriedAt: new Date().toISOString(),
        },
      });

      res.json({ ok: true, jobId: retry.id, isDuplicate: retry.isDuplicate, status: "queued" });
    } catch (err) {
      console.error("Error retrying agent job:", err);
      res.status(500).json({ error: "Failed to retry job" });
    }
  });
}
