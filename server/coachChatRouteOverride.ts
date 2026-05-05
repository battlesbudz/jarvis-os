import type OpenAI from "openai";
import type { Express, Request, Response } from "express";
import { authMiddleware } from "./auth";
import { routeModelTurn } from "./agent/modelRouter";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function normalizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return null;
      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;
      if (role !== "system" && role !== "user" && role !== "assistant") return null;
      if (typeof content !== "string" || !content.trim()) return null;
      return { role, content } as ChatMessage;
    })
    .filter((message): message is ChatMessage => Boolean(message));
}

function buildContextBlock(body: Record<string, unknown>): string {
  const context: string[] = [];
  if (body.coachingMode) context.push(`Coaching mode: ${String(body.coachingMode)}`);
  if (body.lifeContext) context.push(`Life context: ${JSON.stringify(body.lifeContext).slice(0, 4000)}`);
  if (body.goals) context.push(`Goals: ${JSON.stringify(body.goals).slice(0, 3000)}`);
  if (body.stats) context.push(`Stats: ${JSON.stringify(body.stats).slice(0, 2000)}`);
  return context.join("\n");
}

export function registerCoachChatRouterOverride(app: Express): void {
  app.post("/api/coach/chat", authMiddleware, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const messages = normalizeMessages(body.messages);
      if (messages.length === 0) {
        return res.status(400).json({ error: "messages array is required" });
      }

      const contextBlock = buildContextBlock(body);
      const systemPrompt: ChatMessage = {
        role: "system",
        content: [
          "You are Jarvis, Justin's direct, useful planning and coaching assistant.",
          "Answer the user clearly and helpfully. Be concise unless the task needs detail.",
          "Use the provided context when it is relevant. Do not claim to use unavailable channels or integrations.",
          contextBlock ? `Current user context:\n${contextBlock}` : "",
        ].filter(Boolean).join("\n\n"),
      };

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();

      const result = await routeModelTurn({
        tier: "balanced",
        messages: [systemPrompt, ...messages],
        maxCompletionTokens: 4096,
        logPrefix: "[CoachChatOverride]",
      });

      res.write(`data: ${JSON.stringify({ content: result.textContent })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("[CoachChatOverride] failed:", error);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to get coach response" });
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ content: "I hit an error while routing that message. Please try again in a moment." })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }
  });
}
