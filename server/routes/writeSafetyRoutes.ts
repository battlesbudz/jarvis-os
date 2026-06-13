import type { Express, Request, Response } from "express";
import { desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { authMiddleware } from "../auth";
import { db } from "../db";
import { isIntegrationOwner } from "../integrationOwner";

export function registerWriteSafetyRoutes(app: Express): void {
  app.get("/api/write-budget", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const {
        checkCircuitBreaker,
        CIRCUIT_MAX_WRITES,
        writeBudgetSummary,
      } = await import("../agent/safeWritePolicy");
      const [status, summary] = await Promise.all([checkCircuitBreaker(), writeBudgetSummary()]);
      res.json({
        count: status.count,
        max: CIRCUIT_MAX_WRITES,
        tripped: status.tripped,
        resetAt: status.resetAt?.toISOString() ?? null,
        summary,
      });
    } catch (err) {
      console.error("[write-budget] GET error:", err);
      res.status(500).json({ error: "Failed to fetch write budget" });
    }
  });

  app.post("/api/write-budget/reset", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!(await isIntegrationOwner(userId))) {
        return res.status(403).json({ error: "Only the account owner can reset the write budget" });
      }
      const { resetCircuitBreaker } = await import("../agent/safeWritePolicy");
      await resetCircuitBreaker();
      res.json({ ok: true });
    } catch (err) {
      console.error("[write-budget] POST /reset error:", err);
      res.status(500).json({ error: "Failed to reset write budget" });
    }
  });

  app.get("/api/self-heal-audit", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!(await isIntegrationOwner(userId))) {
        return res.status(403).json({ error: "Only the account owner can view the self-heal audit log" });
      }
      const parsedLimit = parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 200));
      const entries = await db
        .select()
        .from(schema.selfHealAuditLog)
        .orderBy(desc(schema.selfHealAuditLog.createdAt))
        .limit(limit);
      res.json({ entries });
    } catch (err) {
      console.error("[self-heal-audit] GET error:", err);
      res.status(500).json({ error: "Failed to fetch self-heal audit log" });
    }
  });
}
