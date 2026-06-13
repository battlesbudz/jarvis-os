import type { Express, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerGutRoutes(app: Express): void {
  app.get("/api/gut/signals", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const includeResponded = req.query.includeResponded === "true";
    const parsedLimit = parseInt((req.query.limit as string) || "50", 10);
    const limit = Math.min(100, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit);
    try {
      const { getGutSignalsForUser } = await import("../intelligence/gut");
      const signals = await getGutSignalsForUser(userId, { limit, includeResponded });
      res.json(signals);
    } catch (err) {
      console.error("[Gut] signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch gut signals" });
    }
  });

  app.get("/api/gut/signals/item/:itemRef", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const itemRef = paramValue(req.params.itemRef);
    try {
      const { getGutSignalsForUser } = await import("../intelligence/gut");
      const signals = await getGutSignalsForUser(userId, { itemRef, includeResponded: false });
      res.json(signals);
    } catch (err) {
      console.error("[Gut] item signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch gut signals for item" });
    }
  });

  app.post("/api/gut/signals/:id/respond", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = paramValue(req.params.id);
    const { response } = req.body as { response?: string };
    const VALID_RESPONSES = ["confirmed", "dismissed", "ignored"];
    if (!response || !VALID_RESPONSES.includes(response)) {
      return res.status(400).json({ error: "response must be confirmed, dismissed, or ignored" });
    }
    try {
      const { respondToGutSignal } = await import("../intelligence/gut");
      await respondToGutSignal(userId, id, response as schema.GutUserResponse);
      res.json({ ok: true });
    } catch (err) {
      console.error("[Gut] respond failed:", err);
      res.status(500).json({ error: "Failed to store response" });
    }
  });

  app.get("/api/gut/threat-log", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const parsedLimit = parseInt((req.query.limit as string) || "30", 10);
    const limit = Math.min(100, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 30 : parsedLimit);
    try {
      const rows = await db
        .select()
        .from(schema.gutSignals)
        .where(eq(schema.gutSignals.userId, userId))
        .orderBy(desc(schema.gutSignals.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err) {
      console.error("[Gut] threat-log fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch threat log" });
    }
  });
}
