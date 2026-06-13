import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { parseNaturalTime, parseRecurringExpr } from "../agent/tools/cronTools";
import { db } from "../db";
import { createJarvisScheduledTask } from "../jarvisScheduledTasks";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerScheduledTaskBasicRoutes(app: Express): void {
  app.get("/api/jarvis/scheduled-tasks", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const tasks = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(eq(schema.jarvisScheduledTasks.userId, userId))
        .orderBy(schema.jarvisScheduledTasks.scheduledAt);
      res.json(tasks);
    } catch (err) {
      console.error("Error fetching jarvis scheduled tasks:", err);
      res.status(500).json({ error: "Failed to fetch scheduled tasks" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { title, description, scheduledAt, recurrence, taskKind } = req.body;
      if (!title || !scheduledAt) return res.status(400).json({ error: "title and scheduledAt are required" });
      const scheduledAtText = String(scheduledAt);
      const recurring = parseRecurringExpr(scheduledAtText);
      const scheduledDate = recurring?.scheduledAt ?? parseNaturalTime(scheduledAtText) ?? new Date(scheduledAtText);
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ error: 'scheduledAt must be a valid date or natural time like "in an hour"' });
      }
      const { task, deduped } = await createJarvisScheduledTask({
        userId,
        title: String(title),
        description: description ? String(description) : null,
        scheduledAt: scheduledDate,
        recurrence: recurrence ? String(recurrence) : recurring?.recurrence ?? null,
        taskKind: taskKind ? String(taskKind) : "user_task",
      });
      res.json({ ...task, deduped });
    } catch (err) {
      console.error("Error creating jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to create scheduled task" });
    }
  });

  app.patch("/api/jarvis/scheduled-tasks/:id/complete", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      await db
        .update(schema.jarvisScheduledTasks)
        .set({ completedAt: new Date() })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("Error completing jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  app.patch("/api/jarvis/scheduled-tasks/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const updates: Record<string, unknown> = {};
      if (typeof req.body.active === "boolean") updates.active = req.body.active;
      if (req.body.title) updates.title = req.body.title;
      if (req.body.description !== undefined) updates.description = req.body.description || null;
      if (req.body.scheduledAt) updates.scheduledAt = new Date(req.body.scheduledAt);
      if (req.body.recurrence !== undefined) updates.recurrence = req.body.recurrence || null;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updatable fields provided" });
      const [task] = await db
        .update(schema.jarvisScheduledTasks)
        .set(updates)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .returning();
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (err) {
      console.error("Error updating jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to update task" });
    }
  });
}
