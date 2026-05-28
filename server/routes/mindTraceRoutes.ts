import type { Express, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { decideContextPacks } from "../agent/contextPacks";
import { buildMindTrace } from "../agent/mindTrace";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getPersistedMindTrace(results: unknown): unknown | null {
  if (!Array.isArray(results)) return null;
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const record = result as Record<string, unknown>;
    if (record.type === "mind_trace" && record.trace && typeof record.trace === "object") {
      return record.trace;
    }
  }
  return null;
}

export function registerMindTraceRoutes(app: Express): void {
  app.post("/api/mind-trace/preview", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const userRequest = typeof body.userRequest === "string"
        ? body.userRequest.trim()
        : typeof body.message === "string"
          ? body.message.trim()
          : "";
      if (!userRequest) {
        return res.status(400).json({ error: "userRequest is required" });
      }

      const channel = typeof body.channel === "string" ? body.channel : "debug";
      const decision = decideContextPacks({ userMessage: userRequest, channel });
      const trace = buildMindTrace({
        userId,
        userRequest,
        channel,
        contextDecision: decision,
        contextLoaded: asStringArray(body.contextLoaded),
        memoriesRetrieved: Array.isArray(body.memoriesRetrieved) ? body.memoriesRetrieved as never : [],
        soulSectionsUsed: asStringArray(body.soulSectionsUsed),
        toolsCalled: Array.isArray(body.toolsCalled) ? body.toolsCalled as never : [],
        confidenceNotes: asStringArray(body.confidenceNotes),
        uncertaintyNotes: asStringArray(body.uncertaintyNotes),
        errors: asStringArray(body.errors),
        blockedSetupIssues: asStringArray(body.blockedSetupIssues),
        approvalRequired: typeof body.approvalRequired === "boolean" ? body.approvalRequired : undefined,
        approvalGateId: typeof body.approvalGateId === "string" ? body.approvalGateId : null,
      });

      res.json({ trace });
    } catch (err) {
      console.error("[mind-trace] preview failed:", err);
      res.status(500).json({ error: "Failed to build mind trace" });
    }
  });

  app.get("/api/mind-trace/recent", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const parsedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 25)) : 10;
      const rows = await db
        .select()
        .from(schema.orchestrationTraces)
        .where(eq(schema.orchestrationTraces.userId, userId))
        .orderBy(desc(schema.orchestrationTraces.createdAt))
        .limit(limit);

      const traces = rows.map((row) => {
        const persistedTrace = getPersistedMindTrace(row.results);
        const trace = persistedTrace ?? buildMindTrace({
          traceId: row.traceId,
          userId,
          userRequest: row.userRequest,
          channel: "orchestration_trace",
          confidenceNotes: [`Subtasks: ${Array.isArray(row.subtasks) ? row.subtasks.length : 0}`],
          errors: row.finalAnswer ? [] : ["No final answer recorded on orchestration trace."],
          now: row.createdAt,
        });

        return {
          ...(trace as Record<string, unknown>),
          orchestration: {
            databaseId: row.id,
            subtaskCount: Array.isArray(row.subtasks) ? row.subtasks.length : 0,
            resultCount: Array.isArray(row.results) ? row.results.length : 0,
            totalRetries: row.totalRetries,
            completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
            durationMs: row.durationMs,
          },
        };
      });

      res.json({ traces });
    } catch (err) {
      console.error("[mind-trace] recent traces failed:", err);
      res.status(500).json({ error: "Failed to fetch recent mind traces" });
    }
  });
}
