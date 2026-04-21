/**
 * Goal → daily plan injection.
 *
 * Walks every user's active goal_trees, finds the next-ready tasks,
 * and surfaces a small batch (1-3 per day) that can be merged into
 * the morning plan. Pacing rule: if the user's recent 7-day completion
 * rate is below 50%, only inject 1 task; otherwise inject up to 3.
 */
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import type {
  GoalTreeData,
  GoalTreePhase,
  GoalTreeMilestone,
  GoalTreeTask,
} from "@shared/schema";

export interface InjectableGoalTask {
  goalTreeId: string;
  goalTitle: string;
  phaseId: string;
  milestoneId: string;
  taskId: string;
  title: string;
  description?: string;
  estimateHours?: number;
}

function isTaskActionable(t: GoalTreeTask): boolean {
  return t.status === "ready" || t.status === "in_progress";
}

function nextActionableTasksFromTree(tree: GoalTreeData): GoalTreeTask[] {
  // Walk in order. Stop after we collect a few candidates from the
  // earliest open milestone(s).
  const out: GoalTreeTask[] = [];
  outer: for (const phase of tree.phases) {
    if (phase.status === "complete") continue;
    for (const ms of phase.milestones) {
      if (ms.status === "complete") continue;
      for (const t of ms.tasks) {
        if (isTaskActionable(t)) {
          out.push(t);
          if (out.length >= 3) break outer;
        }
      }
      // Don't skip ahead past an open milestone — keep work sequential.
      if (out.length > 0) break;
    }
    if (out.length > 0) break;
  }
  return out;
}

async function recentCompletionRate(userId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ data: schema.completionHistory.data })
      .from(schema.completionHistory)
      .where(eq(schema.completionHistory.userId, userId))
      .limit(1);
    const arr = (row?.data as Array<{ completed?: boolean; date?: string }> | undefined) || [];
    if (arr.length === 0) return 1;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = arr.filter((h) => {
      if (!h.date) return false;
      return new Date(h.date).getTime() >= sevenDaysAgo;
    });
    if (recent.length === 0) return 1;
    const done = recent.filter((h) => h.completed).length;
    return done / recent.length;
  } catch {
    return 1;
  }
}

/**
 * Returns goal-tree tasks that should be injected into TODAY's plan
 * for this user. Caller is responsible for merging them into the
 * existing plan (or letting buildPlanForUser see them).
 */
export async function getInjectableGoalTasks(userId: string, dateKey: string): Promise<InjectableGoalTask[]> {
  const trees = await db
    .select()
    .from(schema.goalTrees)
    .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.status, "active")));
  if (trees.length === 0) return [];

  const rate = await recentCompletionRate(userId);
  const dailyCap = rate < 0.5 ? 1 : 3;

  const candidates: InjectableGoalTask[] = [];
  for (const row of trees) {
    const tree = (row.tree as GoalTreeData) || { phases: [] };
    const next = nextActionableTasksFromTree(tree);
    for (const t of next) {
      // Avoid double-injecting the same task on the same date
      if (Array.isArray(t.injectedOnDates) && t.injectedOnDates.includes(dateKey)) continue;
      // Locate the parent phase/milestone ids for later state updates
      let phaseId = "";
      let milestoneId = "";
      for (const ph of tree.phases) {
        const ms = ph.milestones.find((m) => m.tasks.some((tt) => tt.id === t.id));
        if (ms) {
          phaseId = ph.id;
          milestoneId = ms.id;
          break;
        }
      }
      candidates.push({
        goalTreeId: row.id,
        goalTitle: row.title,
        phaseId,
        milestoneId,
        taskId: t.id,
        title: t.title,
        description: t.description,
        estimateHours: t.estimateHours,
      });
      if (candidates.length >= dailyCap) break;
    }
    if (candidates.length >= dailyCap) break;
  }

  return candidates;
}

/**
 * Mark the given tasks as injected for `dateKey` and flip their status
 * to in_progress. Idempotent — safe to call multiple times per day.
 */
export async function markTasksInjected(userId: string, picks: InjectableGoalTask[], dateKey: string): Promise<void> {
  if (picks.length === 0) return;
  const byTree = new Map<string, InjectableGoalTask[]>();
  for (const p of picks) {
    const list = byTree.get(p.goalTreeId) || [];
    list.push(p);
    byTree.set(p.goalTreeId, list);
  }

  for (const [treeId, items] of byTree.entries()) {
    const [row] = await db
      .select()
      .from(schema.goalTrees)
      .where(and(eq(schema.goalTrees.id, treeId), eq(schema.goalTrees.userId, userId)))
      .limit(1);
    if (!row) continue;
    const tree = (row.tree as GoalTreeData) || { phases: [] };
    const ids = new Set(items.map((i) => i.taskId));
    let mutated = false;
    for (const ph of tree.phases) {
      for (const ms of ph.milestones) {
        for (const t of ms.tasks) {
          if (ids.has(t.id)) {
            const dates = Array.isArray(t.injectedOnDates) ? t.injectedOnDates : [];
            if (!dates.includes(dateKey)) {
              t.injectedOnDates = [...dates, dateKey];
              mutated = true;
            }
            if (t.status === "ready") {
              t.status = "in_progress";
              mutated = true;
            }
          }
        }
      }
    }
    if (mutated) {
      await db
        .update(schema.goalTrees)
        .set({ tree, updatedAt: new Date() })
        .where(eq(schema.goalTrees.id, treeId));
    }
  }
}

/**
 * When a daily plan task originating from a goal tree is checked off,
 * propagate completion back into goal_trees so the next walk skips it
 * and exposes the next task.
 */
export async function markTreeTaskComplete(userId: string, goalTreeId: string, taskId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.goalTrees)
    .where(and(eq(schema.goalTrees.id, goalTreeId), eq(schema.goalTrees.userId, userId)))
    .limit(1);
  if (!row) return;
  const tree = (row.tree as GoalTreeData) || { phases: [] };
  let mutated = false;

  // 1. Mark the task complete and roll up milestone / phase status.
  for (const ph of tree.phases) {
    for (const ms of ph.milestones) {
      for (const t of ms.tasks) {
        if (t.id === taskId && t.status !== "complete") {
          t.status = "complete";
          t.completedAt = new Date().toISOString();
          mutated = true;
        }
      }
      const allDone = ms.tasks.length > 0 && ms.tasks.every((t) => t.status === "complete");
      if (allDone && ms.status !== "complete") {
        ms.status = "complete";
        mutated = true;
      } else if (
        ms.status !== "complete" &&
        ms.tasks.some((t) => t.status === "complete" || t.status === "in_progress")
      ) {
        if (ms.status !== "in_progress") {
          ms.status = "in_progress";
          mutated = true;
        }
      }
    }
    const phaseDone = ph.milestones.length > 0 && ph.milestones.every((m) => m.status === "complete");
    if (phaseDone && ph.status !== "complete") {
      ph.status = "complete";
      mutated = true;
    } else if (
      ph.status !== "complete" &&
      ph.milestones.some((m) => m.status === "complete" || m.status === "in_progress")
    ) {
      if (ph.status !== "in_progress") {
        ph.status = "in_progress";
        mutated = true;
      }
    }
  }

  // 2. Advance the wavefront: the FIRST non-complete milestone of the
  //    FIRST non-complete phase is the active milestone — flip all of
  //    its blocked tasks to ready so the daily-plan walker can inject
  //    them. This is what unblocks downstream work after a phase or
  //    milestone has been finished.
  const activePhase = tree.phases.find((p) => p.status !== "complete");
  if (activePhase) {
    const activeMs = activePhase.milestones.find((m) => m.status !== "complete");
    if (activeMs) {
      for (const t of activeMs.tasks) {
        if (t.status === "blocked") {
          t.status = "ready";
          mutated = true;
        }
      }
    }
  }

  if (mutated) {
    await db
      .update(schema.goalTrees)
      .set({ tree, updatedAt: new Date() })
      .where(eq(schema.goalTrees.id, goalTreeId));
  }
}
