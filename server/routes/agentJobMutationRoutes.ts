import type { Express, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { cancellationStatusForAgentJobStatus } from "../agent/voiceRuntimeResourceCore";
import { cancellationUpdateForAgentJob } from "../agent/jobCancellation";

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
      const jobInput = { ...(input || {}) };
      delete jobInput.retryOfJobId;
      delete jobInput.liveActionLineageKey;
      delete jobInput.liveActionRetryValidated;
      delete jobInput.retriedAt;
      delete jobInput.requeuedAt;
      delete jobInput.requeueHistory;
      delete jobInput.cancelRequestedAt;
      delete jobInput.resourcePause;
      const { submitAgentJob } = await import("../agent/jobQueue");
      const { id: jobId } = await submitAgentJob({
        userId,
        agentType: agentType as (typeof allowed)[number],
        title,
        prompt,
        input: jobInput,
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
      const [cancelled] = await db
        .update(schema.agentJobs)
        .set(cancellationUpdateForAgentJob(newStatus))
        .where(and(
          eq(schema.agentJobs.id, id),
          eq(schema.agentJobs.userId, userId),
          eq(schema.agentJobs.status, job.status),
        ))
        .returning({ status: schema.agentJobs.status });
      if (!cancelled) {
        return res.status(409).json({ error: "Job status changed before cancellation; refresh and try again" });
      }
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
      const retry = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${id}:retry`}, 0))`);
        const [job] = await tx
          .select()
          .from(schema.agentJobs)
          .where(and(eq(schema.agentJobs.id, id), eq(schema.agentJobs.userId, userId)))
          .limit(1)
          .for("update");
        if (!job) return { error: "Job not found", statusCode: 404 } as const;
        if (!["failed", "cancelled"].includes(job.status)) {
          return { error: "Only failed or cancelled jobs can be retried", statusCode: 400 } as const;
        }

        const [existingRetry] = await tx
          .select({ id: schema.agentJobs.id, status: schema.agentJobs.status })
          .from(schema.agentJobs)
          .where(and(
            eq(schema.agentJobs.userId, userId),
            sql`${schema.agentJobs.input}->>'retryOfJobId' = ${job.id}`,
          ))
          .orderBy(desc(schema.agentJobs.createdAt))
          .limit(1);
        if (existingRetry) return { id: existingRetry.id, status: existingRetry.status, isDuplicate: true } as const;

        const input = job.input && typeof job.input === "object" && !Array.isArray(job.input)
          ? { ...(job.input as Record<string, unknown>) }
          : {};
        delete input.retryCount;
        delete input.requeuedAt;
        delete input.requeueHistory;
        delete input.resourcePause;
        delete input.cancelRequestedAt;
        delete input.retriedAt;
        const { resolveAgentJobLineageKey } = await import("../liveActions/agentJobLineage");
        const { submitAgentJob } = await import("../agent/jobQueue");
        const submitted = await submitAgentJob({
          userId,
          agentType: job.agentType as any,
          title: job.title,
          prompt: job.prompt,
          input: {
            ...input,
            liveActionLineageKey: await resolveAgentJobLineageKey(userId, job),
            liveActionRetryValidated: true,
            retryOfJobId: job.id,
            retriedAt: new Date().toISOString(),
          },
        }, { db: tx, skipDuplicateCheck: true });
        return { ...submitted, status: "queued" } as const;
      });
      if ("error" in retry) return res.status(retry.statusCode).json({ error: retry.error });

      res.json({ ok: true, jobId: retry.id, isDuplicate: retry.isDuplicate, status: retry.status });
    } catch (err) {
      console.error("Error retrying agent job:", err);
      res.status(500).json({ error: "Failed to retry job" });
    }
  });
}
