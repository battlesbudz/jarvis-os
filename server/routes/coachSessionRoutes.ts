import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { activeCoachRuns } from "../runRegistry";
import { db } from "../db";
import { getSoulPromptBlock } from "../memory/soul";
import { buildUntrustedSoulContext, BUDGET_PRESETS } from "../memory/contextBuilder";
import { buildCoachSystemPrompt } from "../services/aiCoachContextService";

export function registerCoachSessionRoutes(app: Express, openai: OpenAI): void {
  app.post("/api/chat/abort", async (req: Request, res: Response) => {
    const callerId = req.userId;
    if (!callerId) return res.status(401).json({ error: "Unauthorized" });
    const { runId } = req.body;
    if (!runId) return res.status(400).json({ error: "runId required" });
    const run = activeCoachRuns.get(runId);
    if (!run) return res.json({ ok: true });
    if (run.userId !== callerId) return res.status(403).json({ error: "Forbidden" });
    run.controller.abort();
    activeCoachRuns.delete(runId);

    try {
      const { cancelUserTranscriptJobs } = await import("../lib/transcriptJobTracker");
      const cancelled = await cancelUserTranscriptJobs(run.userId);
      if (cancelled > 0) {
        console.log(`[abort] Cancelled ${cancelled} pending transcript job(s) for user ${run.userId}`);
      }
    } catch (err) {
      console.warn(`[abort] Failed to cancel transcript jobs: ${err instanceof Error ? err.message : String(err)}`);
    }

    return res.json({ ok: true });
  });

  app.post("/api/coach/proactive", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { context, goals, stats, history, lifeContext } = req.body;
      if (!context) return res.status(400).json({ error: "context is required" });

      let userCommitments: any[] = [];
      try {
        userCommitments = await db
          .select()
          .from(schema.commitments)
          .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
          .orderBy(desc(schema.commitments.extractedAt))
          .limit(10);
      } catch {}

      const soulBlock = buildUntrustedSoulContext(
        await getSoulPromptBlock(userId ?? ""),
        "User context from JARVIS Soul",
        BUDGET_PRESETS.coachTurn.soul,
      );
      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], [], lifeContext || null, [], false, [], false, userCommitments, undefined, [], [], false, undefined, undefined, undefined, soulBlock);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt + `\n\nIMPORTANT: You are initiating the conversation proactively — the user hasn't said anything yet. Address the following accountability context directly. Be brief (2-3 sentences max). Don't greet — get right to the point.\n\nAccountability context:\n${context}` },
          { role: "user", content: "[Jarvis is checking in proactively — no user message. Address the accountability context above.]" },
        ],
        stream: true,
        max_completion_tokens: 300,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Error in proactive coach:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate proactive message" });
      } else {
        res.end();
      }
    }
  });
}
