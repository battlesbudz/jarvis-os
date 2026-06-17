import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

const validCategories = new Set(["keyword", "company", "person", "industry"]);
const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerNervousSystemWatchRoutes(app: Express): void {
  app.get("/api/nervous-system/signals", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const parsedLimit = parseInt((req.query.limit as string) || "20", 10);
    const limit = Math.min(50, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit);
    try {
      const signals = await db
        .select()
        .from(schema.nervousSystemSignals)
        .where(eq(schema.nervousSystemSignals.userId, userId))
        .orderBy(desc(schema.nervousSystemSignals.createdAt))
        .limit(limit);
      res.json(signals);
    } catch (err) {
      console.error("[NervousSystem] signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch signals" });
    }
  });

  app.get("/api/nervous-system/watches", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const watches = await db
        .select()
        .from(schema.nervousSystemWatches)
        .where(eq(schema.nervousSystemWatches.userId, userId))
        .orderBy(schema.nervousSystemWatches.createdAt);
      res.json(watches);
    } catch (err) {
      console.error("[NervousSystem] watches fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch watches" });
    }
  });

  app.post("/api/nervous-system/watches", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { label, category } = req.body as { label?: string; category?: string };
    if (!label?.trim()) return res.status(400).json({ error: "label is required" });
    const cat = category && validCategories.has(category) ? category : "keyword";
    try {
      const [watch] = await db
        .insert(schema.nervousSystemWatches)
        .values({ userId, label: label.trim(), category: cat })
        .returning();
      res.json(watch);
    } catch (err) {
      console.error("[NervousSystem] watch create failed:", err);
      res.status(500).json({ error: "Failed to create watch" });
    }
  });

  app.patch("/api/nervous-system/watches/:id", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = paramValue(req.params.id);
    const { active, label, category } = req.body as { active?: boolean; label?: string; category?: string };
    try {
      const updates: Partial<typeof schema.nervousSystemWatches.$inferInsert> = {};
      if (typeof active === "boolean") updates.active = active;
      if (label?.trim()) updates.label = label.trim();
      if (category !== undefined) {
        updates.category = validCategories.has(category) ? category : "keyword";
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      const [updated] = await db
        .update(schema.nervousSystemWatches)
        .set(updates)
        .where(and(eq(schema.nervousSystemWatches.id, id), eq(schema.nervousSystemWatches.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Watch not found" });
      res.json(updated);
    } catch (err) {
      console.error("[NervousSystem] watch update failed:", err);
      res.status(500).json({ error: "Failed to update watch" });
    }
  });

  app.delete("/api/nervous-system/watches/:id", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = paramValue(req.params.id);
    try {
      await db
        .delete(schema.nervousSystemWatches)
        .where(and(eq(schema.nervousSystemWatches.id, id), eq(schema.nervousSystemWatches.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[NervousSystem] watch delete failed:", err);
      res.status(500).json({ error: "Failed to delete watch" });
    }
  });
}
