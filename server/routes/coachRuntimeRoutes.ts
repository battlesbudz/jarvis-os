import type { Express, Request, Response } from "express";
import { abortActiveCoachRun } from "../runRegistry";
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
  app.post("/api/chat/abort", async (req: Request, res: Response) => {
    const callerId = req.userId;
    if (!callerId) return res.status(401).json({ error: "Unauthorized" });

    const { runId } = req.body;
    if (!runId) return res.status(400).json({ error: "runId required" });

    const result = abortActiveCoachRun(String(runId), callerId);
    if (result.status === "not_found") return res.json({ ok: true });
    if (result.status === "forbidden") return res.status(403).json({ error: "Forbidden" });

    try {
      const { cancelUserTranscriptJobs } = await import("../lib/transcriptJobTracker");
      const cancelled = await cancelUserTranscriptJobs(result.userId ?? callerId);
      if (cancelled > 0) {
        console.log(`[abort] Cancelled ${cancelled} pending transcript job(s) for user ${result.userId ?? callerId}`);
      }
    } catch (err) {
      console.warn(`[abort] Failed to cancel transcript jobs: ${err instanceof Error ? err.message : String(err)}`);
    }

    return res.json({ ok: true });
  });

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
