import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerScheduledTaskAttentionRoutes(app: Express): void {
  app.post("/api/jarvis/scheduled-tasks/:id/attention", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { attentionQuestion } = req.body;
      if (!attentionQuestion) return res.status(400).json({ error: "attentionQuestion is required" });

      const [task] = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .limit(1);
      if (!task) return res.status(404).json({ error: "Task not found" });

      await db
        .update(schema.jarvisScheduledTasks)
        .set({ needsAttention: true, attentionQuestion })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));

      try {
        const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
        if (link?.chatId) {
          const { sendLongMessage } = await import("../integrations/telegram");
          await sendLongMessage(
            link.chatId,
            `\u26a0\ufe0f Your task *"${task.title}"* needs your guidance:\n\n${attentionQuestion}\n\nReply directly to this message with your answer and I'll take it from there.\n\n[task:${id}]`,
          );
        }
      } catch (err) {
        console.error("[Routes] attention telegram notify failed:", err);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error setting task attention:", err);
      res.status(500).json({ error: "Failed to set attention" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks/:id/resolve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { userAnswer } = req.body;
      if (!userAnswer) return res.status(400).json({ error: "userAnswer is required" });

      const { resolveScheduledTaskAttention } = await import("../lib/taskResolver");
      const result = await resolveScheduledTaskAttention(userId, id, userAnswer);
      if (!result.ok) {
        return res.status(404).json({ error: result.reason === "not_found" ? "Task not found" : "Task does not need attention" });
      }

      try {
        const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
        if (link?.chatId) {
          const { sendLongMessage } = await import("../integrations/telegram");
          await sendLongMessage(
            link.chatId,
            `\u2705 Got it. I've saved your guidance for *"${result.taskTitle}"* and will apply it next time.`,
          );
        }
      } catch (err) {
        console.error("[Routes] resolve telegram ack failed:", err);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error resolving task attention:", err);
      res.status(500).json({ error: "Failed to resolve attention" });
    }
  });
}
