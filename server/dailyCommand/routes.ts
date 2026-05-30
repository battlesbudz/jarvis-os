import type { Express, Request, Response } from "express";
import { generateDailyCommandPlan, getDailyCommandSnapshot, patchDailyCommandPlan } from "./service";
import type { DailyPlanPatch } from "./planOps";

function requireUserId(req: Request, res: Response): string | null {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}

function statusFromError(err: unknown): number {
  const status = (err as Error & { status?: unknown })?.status;
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
}

export function registerDailyCommandRoutes(app: Express): void {
  app.get("/api/daily-command/today", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await getDailyCommandSnapshot(userId));
    } catch (err) {
      console.error("[daily-command] snapshot failed:", err);
      res.status(500).json({ error: "Failed to load daily command" });
    }
  });

  app.post("/api/daily-command/plan/generate", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body = (req.body || {}) as { mode?: "merge" | "replace"; confirmReplace?: boolean };
      const result = await generateDailyCommandPlan(userId, {
        mode: body.mode === "replace" ? "replace" : "merge",
        confirmReplace: body.confirmReplace,
        source: "daily_command_api",
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[daily-command] plan generation failed:", err);
      res.status(statusFromError(err)).json({
        error: err instanceof Error ? err.message : "Failed to generate daily command plan",
      });
    }
  });

  app.patch("/api/daily-command/plan", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body = (req.body || {}) as DailyPlanPatch | { ops?: DailyPlanPatch[] };
      const ops = Array.isArray((body as { ops?: DailyPlanPatch[] }).ops)
        ? (body as { ops: DailyPlanPatch[] }).ops
        : [body as DailyPlanPatch];
      if (ops.length === 0 || ops.some((op) => !op || typeof op.op !== "string")) {
        return res.status(400).json({ error: "A daily command plan op is required" });
      }

      let response: Awaited<ReturnType<typeof patchDailyCommandPlan>> | null = null;
      for (const op of ops) {
        response = await patchDailyCommandPlan(userId, op);
      }
      res.json({ ok: true, ...(response || {}) });
    } catch (err) {
      console.error("[daily-command] plan patch failed:", err);
      res.status(statusFromError(err)).json({
        error: err instanceof Error ? err.message : "Failed to patch daily command plan",
      });
    }
  });
}
