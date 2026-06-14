import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export function registerDeliverableRoutes(app: Express): void {
  app.get("/api/deliverables", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const triageSection = typeof req.query.triageSection === "string" ? req.query.triageSection : null;

      if (triageSection === "auto_handled") {
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const items = await db
          .select()
          .from(schema.deliverables)
          .where(
            and(
              eq(schema.deliverables.userId, userId),
              eq(schema.deliverables.status, "approved"),
              gte(schema.deliverables.actedAt, since),
              sql`${schema.deliverables.triageStatus} IN ('auto_handled', 'promoted_memory')`
            )
          )
          .orderBy(desc(schema.deliverables.createdAt))
          .limit(20);
        const { attachDeliverableReviewState } = await import("../agent/reviewLoop");
        return res.json(items.map(attachDeliverableReviewState));
      }

      const status = typeof req.query.status === "string" ? req.query.status : "pending_approval";
      const items = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.userId, userId), eq(schema.deliverables.status, status)))
        .orderBy(desc(schema.deliverables.createdAt))
        .limit(50);
      const { attachDeliverableReviewState } = await import("../agent/reviewLoop");
      res.json(items.map(attachDeliverableReviewState));
    } catch (err) {
      console.error("Error listing deliverables:", err);
      res.status(500).json({ error: "Failed to list deliverables" });
    }
  });
}
