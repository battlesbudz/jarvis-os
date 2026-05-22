import type { Express, Request, Response } from "express";
import { consumePendingCoachResponse, getDaemonScreenshot } from "../services/coachRuntimeState";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerPublicCoachRuntimeRoutes(app: Express): void {
  app.get("/api/daemon/screenshot/:id", (req: Request, res: Response) => {
    const entry = getDaemonScreenshot(paramValue(req.params.id));
    if (!entry || entry.expires < Date.now()) {
      return res.status(404).json({ error: "Screenshot not found or expired" });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.send(entry.data);
  });
}

export function registerAuthenticatedCoachRuntimeRoutes(app: Express): void {
  app.get("/api/coach/pending-response", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const pending = await consumePendingCoachResponse(userId);
      return res.json(pending);
    } catch (err) {
      console.error("Error fetching pending response:", err);
      return res.json({ text: null });
    }
  });
}
