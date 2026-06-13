import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { normalizeGoalPacingMode } from "../goalPacing";

export function registerGoalPacingRoutes(app: Express): void {
  app.get("/api/goals/pacing", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const dateKey =
        typeof req.query.date === "string" && req.query.date.trim()
          ? req.query.date.trim()
          : new Date().toISOString().slice(0, 10);
      const { getGoalPacingDecision } = await import("../goalScheduler");
      const pacing = await getGoalPacingDecision(userId, dateKey);
      res.json({ ...pacing, date: dateKey });
    } catch (err) {
      console.error("Error fetching goal pacing:", err);
      res.status(500).json({ error: "Failed to fetch goal pacing" });
    }
  });

  app.patch("/api/goals/pacing", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rawMode = req.body?.mode;
      const mode = normalizeGoalPacingMode(rawMode);
      if (rawMode !== mode) return res.status(400).json({ error: "Invalid goal pacing mode" });

      const [existing] = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const current = (existing?.data as Record<string, unknown> | undefined) || {};
      const data = { ...current, goalPacingMode: mode };
      await db.insert(schema.userPreferences)
        .values({ userId, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.userPreferences.userId,
          set: { data, updatedAt: new Date() },
        });

      const { getGoalPacingDecision } = await import("../goalScheduler");
      const dateKey = new Date().toISOString().slice(0, 10);
      const pacing = await getGoalPacingDecision(userId, dateKey);
      res.json({ ...pacing, date: dateKey });
    } catch (err) {
      console.error("Error updating goal pacing:", err);
      res.status(500).json({ error: "Failed to update goal pacing" });
    }
  });
}
