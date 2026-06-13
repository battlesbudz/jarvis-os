import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export function registerGoalSummaryRoutes(app: Express) {
  app.get("/api/goals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const row = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      const raw = (row[0]?.data as any[]) ?? [];
      const goals = raw
        .map((g: any) => {
          const current = Number(g.current ?? 0);
          const target = Number(g.target ?? 0);
          let status: string;
          if (target > 0 && current >= target) status = "complete";
          else if (current > 0) status = "in_progress";
          else status = "active";
          return {
            id: g.id ?? "",
            title: g.title ?? "",
            description: g.description ?? null,
            category: g.category ?? "personal",
            target,
            current,
            unit: g.unit ?? "",
            status,
            createdAt: g.createdAt ?? new Date().toISOString(),
            updatedAt: g.updatedAt ?? null,
          };
        })
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(goals);
    } catch (err) {
      console.error("[GET /api/goals] error:", err);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });
}
