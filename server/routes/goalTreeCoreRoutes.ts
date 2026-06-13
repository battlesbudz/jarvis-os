import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { applyGoalTreeEdit, summarizeGoalTree, type GoalTreeEditAction } from "../goalTreeEditor";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerGoalTreeCoreRoutes(app: Express): void {
  app.get("/api/goals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const [row] = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      res.json({ goals: row?.data ?? [] });
    } catch (err) {
      console.error("Error fetching goals:", err);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });

  app.post("/api/goals/:id/decompose", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = paramValue(req.params.id);

      const [goalsRow] = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      const goalsList = (goalsRow?.data as Array<{ id: string; title: string }>) || [];
      const goal = goalsList.find((g) => g.id === goalId);
      if (!goal) return res.status(404).json({ error: "Goal not found" });

      const { enqueueGoalDecomposition } = await import("../agent/goalDecomposer");
      const jobId = await enqueueGoalDecomposition(userId, { id: goal.id, title: goal.title });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error queuing goal decompose:", err);
      res.status(500).json({ error: "Failed to queue decomposition" });
    }
  });

  app.get("/api/goals/:id/tree", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = paramValue(req.params.id);
      const [tree] = await db
        .select()
        .from(schema.goalTrees)
        .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, goalId)))
        .limit(1);
      if (!tree) return res.status(200).json({ hasTree: false });
      res.json({ hasTree: true, ...tree });
    } catch (err) {
      console.error("Error fetching goal tree:", err);
      res.status(500).json({ error: "Failed to fetch tree" });
    }
  });

  app.patch("/api/goals/:id/tree", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = paramValue(req.params.id);
      const action = req.body?.action as GoalTreeEditAction | undefined;
      if (!action || typeof action !== "object" || !("type" in action)) {
        return res.status(400).json({ error: "action is required" });
      }

      const [treeRow] = await db
        .select()
        .from(schema.goalTrees)
        .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, goalId)))
        .limit(1);
      if (!treeRow) return res.status(404).json({ error: "Goal tree not found" });

      const tree = applyGoalTreeEdit(treeRow.tree, action);
      const [updated] = await db
        .update(schema.goalTrees)
        .set({ tree, updatedAt: new Date() })
        .where(and(eq(schema.goalTrees.id, treeRow.id), eq(schema.goalTrees.userId, userId)))
        .returning();

      res.json({
        ok: true,
        hasTree: true,
        ...updated,
        summary: summarizeGoalTree(tree),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update goal tree";
      const status = /not found/i.test(message) ? 404 : /required|invalid/i.test(message) ? 400 : 500;
      if (status === 500) console.error("Error updating goal tree:", err);
      res.status(status).json({ error: message });
    }
  });
}
