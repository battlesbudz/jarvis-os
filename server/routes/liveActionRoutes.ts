import type { Express, Request, Response } from "express";
import { LiveActionStatusSchema } from "@shared/liveActions";
import { getLiveActionFeatureFlags } from "../liveActions/rollout";
import type { LiveActionReadService } from "../liveActions/service";

interface LiveActionRouteDeps {
  service?: LiveActionReadService;
  projectorEnabled?: () => boolean;
}

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerLiveActionRoutes(app: Express, deps: LiveActionRouteDeps = {}): void {
  const enabled = deps.projectorEnabled ?? (() => getLiveActionFeatureFlags().projector);
  const resolveService = async (): Promise<LiveActionReadService> => deps.service
    ?? (await import("../liveActions/service")).liveActionReadService;

  app.get("/api/live-actions", async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: "Not authenticated" });
    if (!enabled()) return res.status(404).json({ error: "Live Actions are disabled" });
    const statusValue = typeof req.query.status === "string" ? req.query.status : undefined;
    const status = statusValue ? LiveActionStatusSchema.safeParse(statusValue) : null;
    if (status && !status.success) return res.status(400).json({ error: "Invalid Live Action status" });
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    if (projectId && projectId.length > 200) return res.status(400).json({ error: "Invalid project ID" });
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    try {
      const service = await resolveService();
      res.json(await service.getSnapshot({
        userId: req.userId,
        status: status?.success ? status.data : undefined,
        projectId,
        limit,
      }));
    } catch (error) {
      console.error("Error building Live Action snapshot:", error);
      res.status(500).json({ error: "Failed to build Live Action snapshot" });
    }
  });

  app.get("/api/live-actions/:id", async (req: Request, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: "Not authenticated" });
    if (!enabled()) return res.status(404).json({ error: "Live Actions are disabled" });
    const id = paramValue(req.params.id);
    if (!id || id.length > 200) return res.status(400).json({ error: "Invalid Live Action ID" });
    try {
      const service = await resolveService();
      const detail = await service.getDetail(req.userId, id);
      if (!detail) return res.status(404).json({ error: "Live Action not found" });
      res.json(detail);
    } catch (error) {
      console.error("Error reading Live Action detail:", error);
      res.status(500).json({ error: "Failed to read Live Action" });
    }
  });
}
