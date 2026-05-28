import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import type { DailyPlanData, DailyPlanTask } from "./planOps";

function flattenTasks(tasks: unknown): DailyPlanTask[] {
  if (!Array.isArray(tasks)) return [];
  const flattened: DailyPlanTask[] = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== "object") continue;
    const task = raw as DailyPlanTask;
    flattened.push(task);
    if (Array.isArray(task.subtasks)) {
      flattened.push(...flattenTasks(task.subtasks));
    }
  }
  return flattened;
}

export function findJustCompletedGoalTasks(previousData: unknown, nextData: unknown): Array<{
  id: string;
  goalTreeId: string;
  goalTaskId: string;
}> {
  const previousTasks = flattenTasks((previousData as { tasks?: unknown } | null | undefined)?.tasks);
  const nextTasks = flattenTasks((nextData as { tasks?: unknown } | null | undefined)?.tasks);
  const previousById = new Map(previousTasks.map((task) => [task.id, task]));

  return nextTasks
    .filter((task) => {
      if (task.completed !== true) return false;
      if (typeof task.goalTreeId !== "string" || typeof task.goalTaskId !== "string") return false;
      const previous = previousById.get(task.id);
      return !previous || previous.completed !== true;
    })
    .map((task) => ({
      id: task.id,
      goalTreeId: String(task.goalTreeId),
      goalTaskId: String(task.goalTaskId),
    }));
}

export async function getPlanForUser(userId: string, date: string): Promise<DailyPlanData | null> {
  const [row] = await db
    .select({ data: schema.plans.data })
    .from(schema.plans)
    .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, date)))
    .limit(1);
  return (row?.data as DailyPlanData | undefined) ?? null;
}

export async function savePlanForUser(opts: {
  userId: string;
  date: string;
  data: DailyPlanData;
  previousData?: unknown;
}): Promise<void> {
  let previousData = opts.previousData;
  if (previousData === undefined) {
    previousData = await getPlanForUser(opts.userId, opts.date);
  }

  try {
    const justCompleted = findJustCompletedGoalTasks(previousData, opts.data);
    if (justCompleted.length > 0) {
      const { markTreeTaskComplete } = await import("../goalScheduler");
      for (const task of justCompleted) {
        await markTreeTaskComplete(opts.userId, task.goalTreeId, task.goalTaskId);
      }
    }
  } catch (err) {
    console.error("[Plans] goal-tree completion propagation failed:", err);
  }

  await db
    .insert(schema.plans)
    .values({ userId: opts.userId, date: opts.date, data: opts.data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.plans.userId, schema.plans.date],
      set: { data: opts.data, updatedAt: new Date() },
    });
}
