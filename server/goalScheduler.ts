/**
 * Goal → daily plan injection.
 *
 * Walks every user's active goal_trees, finds the next-ready tasks,
 * and surfaces a small batch (1-3 per day) that can be merged into
 * the morning plan. Pacing rule: if the user's recent 7-day completion
 * rate is low or today's energy is low, keep the batch light. The user can
 * choose light/balanced/ambitious pacing in preferences.
 */
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import {
  calculateGoalPacing,
  normalizeGoalPacingMode,
  type GoalPacingDecision,
  type GoalPacingMode,
} from "./goalPacing";
import type {
  GoalTreeData,
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

interface PacingContext {
  existingPlanTaskCount?: number;
  calendarBusyMinutes?: number;
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
    const arr = (row?.data as { completed?: boolean; date?: string }[] | undefined) || [];
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

async function weekdayCompletionRate(userId: string, dateKey: string): Promise<number | undefined> {
  try {
    const [row] = await db
      .select({ data: schema.completionHistory.data })
      .from(schema.completionHistory)
      .where(eq(schema.completionHistory.userId, userId))
      .limit(1);
    const arr = (row?.data as { completed?: boolean; date?: string }[] | undefined) || [];
    if (arr.length === 0) return undefined;
    const targetDay = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    const matching = arr.filter((entry) => {
      if (!entry.date) return false;
      return new Date(`${entry.date}T00:00:00Z`).getUTCDay() === targetDay;
    });
    if (matching.length < 3) return undefined;
    return matching.filter((entry) => entry.completed).length / matching.length;
  } catch {
    return undefined;
  }
}

async function getGoalPacingMode(userId: string): Promise<GoalPacingMode> {
  try {
    const [row] = await db
      .select({ data: schema.userPreferences.data })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    return normalizeGoalPacingMode((row?.data as { goalPacingMode?: unknown } | undefined)?.goalPacingMode);
  } catch {
    return "balanced";
  }
}

async function getEnergyLevel(userId: string, dateKey: string): Promise<number | undefined> {
  try {
    const [row] = await db
      .select({ data: schema.energyCheckins.data })
      .from(schema.energyCheckins)
      .where(and(eq(schema.energyCheckins.userId, userId), eq(schema.energyCheckins.date, dateKey)))
      .limit(1);
    const data = row?.data as { energy?: unknown; level?: unknown } | undefined;
    const value = typeof data?.energy === "number" ? data.energy : data?.level;
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

function energyFromData(data: unknown): number | undefined {
  const value =
    typeof (data as { energy?: unknown } | undefined)?.energy === "number"
      ? (data as { energy: number }).energy
      : (data as { level?: unknown } | undefined)?.level;
  return typeof value === "number" ? value : undefined;
}

async function getRecentEnergyLevels(userId: string, dateKey: string): Promise<number[]> {
  try {
    const rows = await db
      .select({ date: schema.energyCheckins.date, data: schema.energyCheckins.data })
      .from(schema.energyCheckins)
      .where(eq(schema.energyCheckins.userId, userId))
      .orderBy(desc(schema.energyCheckins.date))
      .limit(14);
    return rows
      .filter((row) => row.date !== dateKey)
      .map((row) => energyFromData(row.data))
      .filter((value): value is number => typeof value === "number");
  } catch {
    return [];
  }
}

function parseDateKey(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? time : null;
}

function daysUntil(dateKey: string, dueDate: string | undefined): number | null {
  const start = parseDateKey(dateKey);
  const due = parseDateKey(dueDate);
  if (start === null || due === null) return null;
  return Math.ceil((due - start) / (24 * 60 * 60 * 1000));
}

function nearestGoalDeadlineDays(trees: (typeof schema.goalTrees.$inferSelect)[], dateKey: string): number | undefined {
  let nearest: number | null = null;
  for (const row of trees) {
    const tree = (row.tree as GoalTreeData) || { phases: [] };
    for (const phase of tree.phases) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          if (task.status === "complete") continue;
          const days = daysUntil(dateKey, task.dueDate);
          if (days === null) continue;
          nearest = nearest === null ? days : Math.min(nearest, days);
        }
      }
    }
  }
  return nearest ?? undefined;
}

async function getNearestCommitmentDeadlineDays(userId: string, dateKey: string): Promise<number | undefined> {
  try {
    const rows = await db
      .select({ dueDate: schema.commitments.dueDate })
      .from(schema.commitments)
      .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
      .limit(100);
    let nearest: number | null = null;
    for (const row of rows) {
      const days = daysUntil(dateKey, row.dueDate ?? undefined);
      if (days === null) continue;
      nearest = nearest === null ? days : Math.min(nearest, days);
    }
    return nearest ?? undefined;
  } catch {
    return undefined;
  }
}

function taskDurationMinutes(task: unknown): number {
  const duration = (task as { duration?: unknown } | undefined)?.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return 30;
  return Math.max(5, Math.round(duration));
}

function isCalendarBusyTask(task: unknown): boolean {
  const candidate = task as { category?: unknown; time?: unknown } | undefined;
  return candidate?.category === "calendar" || typeof candidate?.time === "string";
}

function calendarBusyMinutesFromTasks(tasks: unknown): number {
  if (!Array.isArray(tasks)) return 0;
  return tasks.filter(isCalendarBusyTask).reduce((sum, task) => sum + taskDurationMinutes(task), 0);
}

export function getPlanPacingContextFromTasks(tasks: unknown): PacingContext {
  return {
    existingPlanTaskCount: Array.isArray(tasks) ? tasks.length : 0,
    calendarBusyMinutes: calendarBusyMinutesFromTasks(tasks),
  };
}

async function getExistingPlanSignals(userId: string, dateKey: string): Promise<{ taskCount: number; calendarBusyMinutes: number }> {
  try {
    const [row] = await db
      .select({ data: schema.plans.data })
      .from(schema.plans)
      .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, dateKey)))
      .limit(1);
    const tasks = (row?.data as { tasks?: unknown } | undefined)?.tasks;
    const context = getPlanPacingContextFromTasks(tasks);
    return { taskCount: context.existingPlanTaskCount ?? 0, calendarBusyMinutes: context.calendarBusyMinutes ?? 0 };
  } catch {
    return { taskCount: 0, calendarBusyMinutes: 0 };
  }
}

export async function getGoalPacingDecision(
  userId: string,
  dateKey: string,
  context: PacingContext = {},
): Promise<GoalPacingDecision> {
  const [
    completionRate,
    mode,
    energyLevel,
    recentEnergyLevels,
    existingPlanSignals,
    weekdayRate,
    activeGoalTrees,
    commitmentDeadlineDays,
  ] = await Promise.all([
    recentCompletionRate(userId),
    getGoalPacingMode(userId),
    getEnergyLevel(userId, dateKey),
    getRecentEnergyLevels(userId, dateKey),
    getExistingPlanSignals(userId, dateKey),
    weekdayCompletionRate(userId, dateKey),
    db
      .select()
      .from(schema.goalTrees)
      .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.status, "active")))
      .catch(() => []),
    getNearestCommitmentDeadlineDays(userId, dateKey),
  ]);
  const goalDeadlineDays = nearestGoalDeadlineDays(activeGoalTrees, dateKey);
  const deadlineCandidates = [goalDeadlineDays, commitmentDeadlineDays].filter(
    (days): days is number => typeof days === "number",
  );

  return calculateGoalPacing({
    completionRate,
    mode,
    energyLevel,
    recentEnergyLevels,
    existingPlanTaskCount: context.existingPlanTaskCount ?? existingPlanSignals.taskCount,
    weekdayCompletionRate: weekdayRate,
    calendarBusyMinutes: context.calendarBusyMinutes ?? existingPlanSignals.calendarBusyMinutes,
    nearestDeadlineDays: deadlineCandidates.length > 0 ? Math.min(...deadlineCandidates) : undefined,
  });
}

/**
 * Returns goal-tree tasks that should be injected into TODAY's plan
 * for this user. Caller is responsible for merging them into the
 * existing plan (or letting buildPlanForUser see them).
 */
export async function getInjectableGoalTasks(
  userId: string,
  dateKey: string,
  context: PacingContext = {},
): Promise<InjectableGoalTask[]> {
  const trees = await db
    .select()
    .from(schema.goalTrees)
    .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.status, "active")));
  if (trees.length === 0) return [];

  const pacing = await getGoalPacingDecision(userId, dateKey, context);
  const dailyCap = pacing.dailyCap;

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
