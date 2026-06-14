import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { mergeGoalTaskIntoPlan } from "../goalPlanHandoff";
import { markTasksInjected, type InjectableGoalTask } from "../goalScheduler";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerGoalTaskHandoffRoutes(app: Express): void {
  app.post("/api/goals/:id/tree/tasks/:taskId/add-to-today", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = paramValue(req.params.id);
      const taskId = paramValue(req.params.taskId);
      const todayKey = new Date().toISOString().slice(0, 10);

      const [treeRow] = await db
        .select()
        .from(schema.goalTrees)
        .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, goalId)))
        .limit(1);
      if (!treeRow) return res.status(404).json({ error: "Goal tree not found" });

      const tree = treeRow.tree || { phases: [] };
      let pick: InjectableGoalTask | null = null;
      for (const phase of tree.phases || []) {
        for (const milestone of phase.milestones || []) {
          const task = (milestone.tasks || []).find((candidate) => candidate.id === taskId);
          if (!task) continue;
          if (task.status === "complete") {
            return res.status(409).json({ error: "Goal task is already complete" });
          }
          if (task.status === "blocked") {
            return res.status(400).json({ error: "Goal task is blocked" });
          }
          pick = {
            goalTreeId: treeRow.id,
            goalTitle: treeRow.title,
            phaseId: phase.id,
            milestoneId: milestone.id,
            taskId: task.id,
            title: task.title,
            description: task.description,
            estimateHours: task.estimateHours,
          };
          break;
        }
        if (pick) break;
      }
      if (!pick) return res.status(404).json({ error: "Goal task not found" });

      const [planRow] = await db
        .select({ data: schema.plans.data })
        .from(schema.plans)
        .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, todayKey)))
        .limit(1);
      const currentPlan = (planRow?.data as { date?: string; tasks?: Record<string, unknown>[] } | undefined) || {
        date: todayKey,
        tasks: [],
        greeting: "",
        insight: "",
      };
      const merged = mergeGoalTaskIntoPlan(currentPlan, pick, todayKey);

      await db.insert(schema.plans)
        .values({ userId, date: todayKey, data: merged.plan, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.plans.userId, schema.plans.date],
          set: { data: merged.plan, updatedAt: new Date() },
        });
      await markTasksInjected(userId, [pick], todayKey);

      res.json({
        ok: true,
        inserted: merged.inserted,
        date: todayKey,
        task: merged.task,
      });
    } catch (err) {
      console.error("Error adding goal task to today:", err);
      res.status(500).json({ error: "Failed to add goal task to today" });
    }
  });
}
