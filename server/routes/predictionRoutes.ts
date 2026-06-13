import type { Express, Request, Response } from "express";

const predRunLastAt = new Map<string, number>();
const PRED_RUN_COOLDOWN_MS = 30 * 60 * 1000;

export function registerPredictionRoutes(app: Express): void {
  app.get("/api/predictions", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const { getTodayPredictions } = await import("../intelligence/predictor");
      const predictions = await getTodayPredictions(userId, date, 0);
      return res.json({ predictions });
    } catch (error) {
      console.error("Error getting predictions:", error);
      return res.status(500).json({ error: "Failed to get predictions" });
    }
  });

  app.get("/api/predictions/week", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const startDate = (req.query.startDate as string) || new Date().toISOString().slice(0, 10);
      const { getWeekPredictions } = await import("../intelligence/predictor");
      const predictions = await getWeekPredictions(userId, startDate, 0);
      return res.json({ predictions });
    } catch (error) {
      console.error("Error getting week predictions:", error);
      return res.status(500).json({ error: "Failed to get week predictions" });
    }
  });

  app.get("/api/predictions/accuracy", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { getPredictionAccuracy } = await import("../intelligence/predictor");
      const accuracy = await getPredictionAccuracy(userId);
      return res.json(accuracy);
    } catch (error) {
      console.error("Error getting prediction accuracy:", error);
      return res.status(500).json({ error: "Failed to get accuracy" });
    }
  });

  app.post("/api/predictions/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const lastRun = predRunLastAt.get(userId) ?? 0;
      const msSinceLast = Date.now() - lastRun;
      if (msSinceLast < PRED_RUN_COOLDOWN_MS) {
        const retryAfterSec = Math.ceil((PRED_RUN_COOLDOWN_MS - msSinceLast) / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: "Rate limit — predictions were just generated", retryAfterSec });
      }
      predRunLastAt.set(userId, Date.now());

      const targetDate = (req.body?.date as string) || new Date().toISOString().slice(0, 10);
      const { analysePatterns } = await import("../intelligence/pattern-analyser");
      const { generateAndStorePredictions } = await import("../intelligence/predictor");
      const analysis = await analysePatterns(userId, 60);
      const count = await generateAndStorePredictions(userId, targetDate, analysis);
      return res.json({ generated: count, date: targetDate });
    } catch (error) {
      console.error("Error running prediction engine:", error);
      return res.status(500).json({ error: "Failed to run predictions" });
    }
  });
}
