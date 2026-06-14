import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export function registerPreferenceRoutes(app: Express): void {
  app.get("/api/preferences", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const row = await db.select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      return res.json(row[0]?.data || {});
    } catch (error) {
      console.error("Error getting preferences:", error);
      return res.status(500).json({ error: "Failed to get preferences" });
    }
  });

  app.patch("/api/preferences", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db.select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const current = (existing[0]?.data as any) || {};
      const merged = { ...current, ...updates };
      await db.insert(schema.userPreferences)
        .values({ userId, data: merged })
        .onConflictDoUpdate({
          target: schema.userPreferences.userId,
          set: { data: merged, updatedAt: new Date() },
        });
      return res.json(merged);
    } catch (error) {
      console.error("Error saving preferences:", error);
      return res.status(500).json({ error: "Failed to save preferences" });
    }
  });

  app.patch("/api/life-context", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db
        .select({ data: schema.lifeContext.data })
        .from(schema.lifeContext)
        .where(eq(schema.lifeContext.userId, userId))
        .limit(1);
      const current = (existing[0]?.data as any) || {};
      const merged = { ...current, ...updates };
      await db.insert(schema.lifeContext)
        .values({ userId, data: merged, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.lifeContext.userId],
          set: { data: merged, updatedAt: new Date() },
        });
      return res.json(merged);
    } catch (error) {
      console.error("Error patching life-context:", error);
      return res.status(500).json({ error: "Failed to update life context" });
    }
  });
}
