import type { Express, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export function registerEgoRoutes(app: Express) {
  app.get("/api/ego/dashboard", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { analyseEgo, getISOWeekMonday } = await import("../intelligence/ego");
      const weekOf = getISOWeekMonday(new Date());
      const analysis = await analyseEgo(userId, weekOf);

      const latestReport = await db
        .select()
        .from(schema.egoWeeklyReports)
        .where(eq(schema.egoWeeklyReports.userId, userId))
        .orderBy(desc(schema.egoWeeklyReports.createdAt))
        .limit(1);

      res.json({
        analysis,
        latestReport: latestReport[0] ?? null,
      });
    } catch (err) {
      console.error("[Ego] dashboard failed:", err);
      res.status(500).json({ error: "Failed to load ego dashboard" });
    }
  });

  app.get("/api/ego/reports", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const reports = await db
        .select()
        .from(schema.egoWeeklyReports)
        .where(eq(schema.egoWeeklyReports.userId, userId))
        .orderBy(desc(schema.egoWeeklyReports.createdAt))
        .limit(12);

      res.json({ reports });
    } catch (err) {
      console.error("[Ego] reports failed:", err);
      res.status(500).json({ error: "Failed to load reports" });
    }
  });

  app.post("/api/ego/trigger", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const isDev = process.env.NODE_ENV !== "production";
      const forceOverride = req.query.force === "true";
      if (!isDev && !forceOverride) {
        return res.status(403).json({ error: "Manual trigger not available in production (pass ?force=true to override)" });
      }

      const { runEgoForUser, getISOWeekMonday } = await import("../intelligence/ego");
      const weekOf = getISOWeekMonday(new Date());
      const delivered = await runEgoForUser(userId, weekOf);
      res.json({ ok: true, delivered, weekOf });
    } catch (err) {
      console.error("[Ego] trigger failed:", err);
      res.status(500).json({ error: "Failed to trigger ego report" });
    }
  });
}
