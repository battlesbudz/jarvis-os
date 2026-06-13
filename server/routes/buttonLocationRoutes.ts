import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { authMiddleware } from "../auth";
import { db } from "../db";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerButtonLocationRoutes(app: Express): void {
  app.get("/api/button-locations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const rows = await db.select().from(schema.buttonLocations)
        .where(eq(schema.buttonLocations.userId, userId))
        .orderBy(desc(schema.buttonLocations.updatedAt));
      res.json({ entries: rows });
    } catch (err) {
      console.error("[button-locations] GET error:", err);
      res.status(500).json({ error: "Failed to fetch button locations" });
    }
  });

  app.post("/api/button-locations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { appPackage, screenContext, elementLabel, coordinatesX, coordinatesY, screenshotHash, screenshotPath } = req.body;
      if (!appPackage || !elementLabel || coordinatesX == null || coordinatesY == null) {
        return res.status(400).json({ error: "appPackage, elementLabel, coordinatesX, coordinatesY are required" });
      }
      const [row] = await db.insert(schema.buttonLocations).values({
        userId,
        appPackage: String(appPackage),
        screenContext: String(screenContext || ""),
        elementLabel: String(elementLabel),
        coordinatesX: Number(coordinatesX),
        coordinatesY: Number(coordinatesY),
        screenshotHash: screenshotHash ? String(screenshotHash) : null,
        screenshotPath: screenshotPath ? String(screenshotPath) : null,
        confidence: 0.5,
      }).returning();
      res.json({ entry: row });
    } catch (err) {
      console.error("[button-locations] POST error:", err);
      res.status(500).json({ error: "Failed to create button location" });
    }
  });

  app.delete("/api/button-locations/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(paramValue(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select({ id: schema.buttonLocations.id, userId: schema.buttonLocations.userId })
        .from(schema.buttonLocations).where(eq(schema.buttonLocations.id, id)).limit(1);
      if (!rows.length || rows[0].userId !== userId) return res.status(404).json({ error: "Not found" });
      await db.delete(schema.buttonLocations).where(eq(schema.buttonLocations.id, id));
      res.json({ deleted: true });
    } catch (err) {
      console.error("[button-locations] DELETE error:", err);
      res.status(500).json({ error: "Failed to delete button location" });
    }
  });

  app.patch("/api/button-locations/:id/confirm", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(paramValue(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select().from(schema.buttonLocations).where(and(eq(schema.buttonLocations.id, id), eq(schema.buttonLocations.userId, userId))).limit(1);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const current = rows[0];
      const newConfidence = Math.min(1.0, current.confidence + 0.15);
      const [updated] = await db.update(schema.buttonLocations).set({
        confidence: newConfidence,
        stale: false,
        failCount: 0,
        lastConfirmedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.buttonLocations.id, id)).returning();
      res.json({ entry: updated });
    } catch (err) {
      console.error("[button-locations] PATCH confirm error:", err);
      res.status(500).json({ error: "Failed to confirm button location" });
    }
  });

  app.patch("/api/button-locations/:id/deny", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(paramValue(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select().from(schema.buttonLocations).where(and(eq(schema.buttonLocations.id, id), eq(schema.buttonLocations.userId, userId))).limit(1);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const current = rows[0];
      const newConfidence = Math.max(0, current.confidence - 0.2);
      const newFailCount = (current.failCount ?? 0) + 1;
      const nowStale = newConfidence < 0.3 || newFailCount >= 3;
      const [updated] = await db.update(schema.buttonLocations).set({
        confidence: newConfidence,
        stale: nowStale,
        failCount: newFailCount,
        updatedAt: new Date(),
      }).where(eq(schema.buttonLocations.id, id)).returning();
      res.json({ entry: updated });
    } catch (err) {
      console.error("[button-locations] PATCH deny error:", err);
      res.status(500).json({ error: "Failed to deny button location" });
    }
  });
}
