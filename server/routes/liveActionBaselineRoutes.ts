import type { Express, Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import {
  getLiveActionAggregateReport,
  getLiveActionBaselineReport,
  isClientSubmittedLiveActionBaselineMetric,
  recordLiveActionBaseline,
  recordRenderedRepresentationSnapshot,
  observeTerminalStateDrift,
} from "../liveActions/baselineMetrics";

const MAX_BASELINE_VALUE = 365 * 24 * 60 * 60 * 1_000;
type AdminSecretGuard = (req: Request, res: Response) => boolean;

export function registerLiveActionBaselineOperationsRoutes(app: Express, requireOperationsSecret: AdminSecretGuard): void {
  app.get("/api/operations/live-actions/baseline", (req: Request, res: Response) => {
    if (!requireOperationsSecret(req, res)) return;
    res.json(getLiveActionAggregateReport());
  });
}

export function registerLiveActionBaselineRoutes(app: Express): void {
  app.get("/api/live-actions/baseline", (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: "Not authenticated" });
    res.json(getLiveActionBaselineReport(req.userId));
  });

  app.post("/api/live-actions/baseline", (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: "Not authenticated" });
    if (!isClientSubmittedLiveActionBaselineMetric(req.body?.metric)) {
      return res.status(400).json({ error: "Unsupported baseline metric" });
    }
    const value = req.body?.value;
    if (value != null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      return res.status(400).json({ error: "Invalid baseline metric value" });
    }
    const boundedValue = typeof value === "number" ? Math.min(value, MAX_BASELINE_VALUE) : value;
    if (typeof value === "number" && value > MAX_BASELINE_VALUE) {
      recordLiveActionBaseline({
        userId: req.userId,
        metric: "baseline_value_overflow_count",
        surface: typeof req.body?.surface === "string" ? req.body.surface : undefined,
      });
    }
    recordLiveActionBaseline({
      userId: req.userId,
      metric: req.body.metric,
      surface: typeof req.body?.surface === "string" ? req.body.surface : undefined,
      value: boundedValue,
    });
    res.status(202).json({ accepted: true });
  });

  app.post("/api/live-actions/baseline/representations", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const kind = req.body?.kind;
    const surface = typeof req.body?.surface === "string" ? req.body.surface : "unknown";
    const clientId = req.body?.clientId;
    const representations = req.body?.representations;
    const sequence = req.body?.sequence;
    if ((kind !== "agent_job" && kind !== "project") || !Array.isArray(representations) || representations.length > 100
      || !Number.isSafeInteger(sequence) || sequence < 0) {
      return res.status(400).json({ error: "Invalid representation snapshot" });
    }
    if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 100) {
      return res.status(400).json({ error: "Invalid representation client" });
    }
    if (representations.some((item: unknown) => {
      if (!item || typeof item !== "object") return true;
      const candidate = item as { id?: unknown; status?: unknown };
      return typeof candidate.id !== "string" || candidate.id.length < 1 || candidate.id.length > 200
        || (candidate.status != null && (typeof candidate.status !== "string" || candidate.status.length > 50));
    })) {
      return res.status(400).json({ error: "Invalid representation entry" });
    }

    const entries = representations as Array<{ id: string; status?: string }>;
    let terminalStateDriftCount = 0;
    let canonicalStatuses = new Map<string, string>();
    let terminalStatuses: ReadonlySet<string>;
    if (entries.length === 0) {
      terminalStatuses = new Set(kind === "agent_job"
        ? ["complete", "delivered", "failed", "cancelled"]
        : ["complete", "failed"]);
    } else if (kind === "agent_job") {
      const ids = [...new Set(entries.map((item) => item.id))];
      const canonical = await db
        .select({ id: schema.agentJobs.id, status: schema.agentJobs.status })
        .from(schema.agentJobs)
        .where(and(eq(schema.agentJobs.userId, userId), inArray(schema.agentJobs.id, ids)));
      canonicalStatuses = new Map(canonical.map((job) => [job.id, job.status]));
      terminalStatuses = new Set(["complete", "delivered", "failed", "cancelled"]);
    } else {
      const ids = [...new Set(entries.map((item) => item.id))];
      const canonical = await db
        .select({ id: schema.jarvisProjects.id, status: schema.jarvisProjects.status })
        .from(schema.jarvisProjects)
        .where(and(eq(schema.jarvisProjects.userId, userId), inArray(schema.jarvisProjects.id, ids)));
      canonicalStatuses = new Map(canonical.map((project) => [project.id, project.status]));
      terminalStatuses = new Set(["complete", "failed"]);
    }
    const representationCounts = recordRenderedRepresentationSnapshot({
      userId,
      kind,
      surface,
      clientId,
      identities: entries.map((item) => item.id),
      sequence,
    });
    if (!representationCounts) return res.status(202).json({ accepted: true, ignoredAsStale: true });
    terminalStateDriftCount = observeTerminalStateDrift({
      userId,
      kind,
      surface,
      clientId,
      entries,
      canonicalStatuses,
      terminalStatuses,
    }).persistentDriftCount;
    res.status(202).json({ accepted: true, ...representationCounts, terminalStateDriftCount });
  });
}
