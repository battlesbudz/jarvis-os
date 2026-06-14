import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;
const disabledRealtime = {
  error: "OpenAI Realtime sessions are disabled. Use /api/voice/codex-turn.",
  code: "CODEX_VOICE_TURN_REQUIRED",
};
export function registerVoiceRoutes(app: Express, authMiddleware: RequestHandler): void {
  app.post("/api/voice/codex-turn", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { runCodexVoiceTurn } = await import("../voiceCodexTurn");
      const body = (req.body || {}) as Record<string, unknown>;
      res.json(await runCodexVoiceTurn({
        userId, text: body.text, audioBase64: body.audioBase64,
        mimeType: body.mimeType, sdkSessionId: body.sdkSessionId,
      }));
    } catch (err) {
      const { CodexVoiceTurnError } = await import("../voiceCodexTurn");
      if (err instanceof CodexVoiceTurnError) return res.status(err.status).json({ error: err.message, code: err.code });
      console.error("[voice/codex-turn] Error:", err);
      res.status(500).json({ error: "Failed to complete Codex voice turn" });
    }
  });
  app.get("/api/voice/realtime-session", authMiddleware, (_req: Request, res: Response) => res.json({
    mode: "codex-turn", realtime_available: false, relay_available: false,
    turn_endpoint: "/api/voice/codex-turn", model: "chatgpt-codex-oauth/auto", audio_output: "device",
  }));
  app.post("/api/voice/relay-ticket", authMiddleware, (_req: Request, res: Response) => res.status(410).json({
    ...disabledRealtime,
    error: "OpenAI Realtime voice relay is disabled. Use /api/voice/codex-turn.",
  }));
  app.post("/api/voice/realtime-session", authMiddleware, async (_req: Request, res: Response) => res.status(410).json(disabledRealtime));
  app.post("/api/voice/tool-call", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    const { tool_name, arguments: toolArgs } = req.body || {};
    try {
      if (tool_name === "get_today_summary") {
        const today = new Date().toISOString().slice(0, 10);
        const tasks = await db.select({
          id: schema.jarvisScheduledTasks.id, title: schema.jarvisScheduledTasks.title,
          scheduledAt: schema.jarvisScheduledTasks.scheduledAt, completedAt: schema.jarvisScheduledTasks.completedAt,
        }).from(schema.jarvisScheduledTasks).where(and(eq(schema.jarvisScheduledTasks.userId, userId), sql`DATE(${schema.jarvisScheduledTasks.scheduledAt}) = ${today}`)).limit(10);
        return res.json({ result: JSON.stringify({ date: today, tasks: tasks.map(t => ({ title: t.title, scheduledAt: t.scheduledAt, done: !!t.completedAt })) }) });
      }
      if (tool_name === "search_memories") {
        const query = String((toolArgs as Record<string, unknown>)?.query || "").trim();
        const { retrieveRelevantMemories } = await import("../memory/retrieve");
        const memories = await retrieveRelevantMemories(userId, query, 5);
        return res.json({ result: JSON.stringify({ memories: memories.map((m: { content: string; category: string }) => ({ content: m.content, category: m.category })) }) });
      }
      return res.json({ result: JSON.stringify({ error: `Unknown tool: ${tool_name}` }) });
    } catch (err) {
      console.error("[voice/tool-call] Error:", err);
      res.status(500).json({ error: "Tool execution failed" });
    }
  });
  app.post("/api/conversations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { chatStorage } = await import("../integrations/chatStorage");
      res.status(201).json(await chatStorage.createConversation((req.body || {}).title || "Voice Session"));
    } catch (err) {
      console.error("[conversations] create error:", err);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });
  app.post("/api/conversations/:id/voice-transcript", authMiddleware, async (req: Request, res: Response) => {
    try {
      const entries: Array<{ role: string; text: string }> = req.body?.entries || [];
      if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: "entries array is required" });
      const { chatStorage } = await import("../integrations/chatStorage");
      for (const entry of entries) if (entry.role && entry.text) await chatStorage.createMessage(parseInt(paramValue(req.params.id), 10), entry.role, entry.text);
      res.json({ ok: true, saved: entries.length });
    } catch (err) {
      console.error("[conversations/voice-transcript] error:", err);
      res.status(500).json({ error: "Failed to save transcript" });
    }
  });
}
