import type { Express, Request, RequestHandler, Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { runCapabilityGapAnalysis } from "../agent/capabilityGapAnalyzer";

export function registerCapabilityGapRoutes(app: Express, authMiddleware: RequestHandler): void {
  // Returns all gaps from the past 7 days grouped by (userMessage, detectedReason)
  // with occurrence count and addressed status.
  app.get("/api/capability-gaps", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          userMessage: schema.capabilityGaps.userMessage,
          agentReplySnippet: sql<string | null>`MAX(${schema.capabilityGaps.agentReplySnippet})`,
          detectedReason: schema.capabilityGaps.detectedReason,
          channel: sql<string | null>`MAX(${schema.capabilityGaps.channel})`,
          occurrenceCount: sql<number>`COUNT(*)::int`,
          addressed: sql<boolean>`BOOL_AND(${schema.capabilityGaps.addressed})`,
          latestCreatedAt: sql<string>`MAX(${schema.capabilityGaps.createdAt})::text`,
        })
        .from(schema.capabilityGaps)
        .where(
          and(
            eq(schema.capabilityGaps.userId, userId),
            gte(schema.capabilityGaps.createdAt, sevenDaysAgo),
          ),
        )
        .groupBy(
          schema.capabilityGaps.userMessage,
          schema.capabilityGaps.detectedReason,
        )
        .orderBy(desc(sql`MAX(${schema.capabilityGaps.createdAt})`))
        .limit(50);
      res.json({ gaps: rows });
    } catch (err) {
      console.error("[capability-gaps] GET error:", err);
      res.status(500).json({ error: "Failed to fetch capability gaps" });
    }
  });

  app.delete("/api/capability-gaps", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { userMessage, detectedReason } = (req.body ?? {}) as { userMessage?: string; detectedReason?: string };
      if (!userMessage || !detectedReason) {
        return res.status(400).json({ error: "userMessage and detectedReason are required" });
      }
      await db
        .update(schema.capabilityGaps)
        .set({ addressed: true })
        .where(
          and(
            eq(schema.capabilityGaps.userId, userId),
            eq(schema.capabilityGaps.userMessage, userMessage),
            eq(schema.capabilityGaps.detectedReason, detectedReason),
          ),
        );
      res.json({ ok: true });
    } catch (err) {
      console.error("[capability-gaps] DELETE error:", err);
      res.status(500).json({ error: "Failed to dismiss capability gap" });
    }
  });

  app.post("/api/gap-analysis/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { submitted, queued, failed } = await runCapabilityGapAnalysis(userId);
      if (failed) {
        return res.status(500).json({ error: "Gap analysis failed — LLM clustering or DB error. Check server logs." });
      }
      res.json({ ok: true, submitted, queued, total: submitted + queued });
    } catch (err) {
      console.error("[gap-analysis] POST /run error:", err);
      res.status(500).json({ error: "Failed to run gap analysis" });
    }
  });
}
