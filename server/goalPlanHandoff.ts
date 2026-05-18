import type { InjectableGoalTask } from "./goalScheduler";

export interface GoalPlanTask {
  id: string;
  title: string;
  category: "goal";
  completed: boolean;
  priority: "high";
  duration: number;
  time?: string;
  description: string;
  createdAt: number;
  fromJarvis: boolean;
  goalTreeId: string;
  goalTaskId: string;
}

export interface GoalPlanData {
  date: string;
  tasks: Record<string, unknown>[];
  greeting?: string;
  insight?: string;
  [key: string]: unknown;
}

export interface GoalPlanMergeResult {
  plan: GoalPlanData;
  inserted: boolean;
  task: GoalPlanTask;
}

export function buildGoalPlanTask(
  pick: InjectableGoalTask,
  dateKey: string,
  createdAt = Date.now(),
): GoalPlanTask {
  const minutes = Math.max(15, Math.round((pick.estimateHours || 1) * 60));
  return {
    id: `goal_${pick.taskId}_${dateKey}`,
    title: pick.title,
    category: "goal",
    priority: "high",
    duration: minutes,
    time: undefined,
    description: pick.description
      ? `${pick.description} (from goal: ${pick.goalTitle})`
      : `From goal: ${pick.goalTitle}`,
    completed: false,
    createdAt,
    fromJarvis: true,
    goalTreeId: pick.goalTreeId,
    goalTaskId: pick.taskId,
  };
}

export function mergeGoalTaskIntoPlan(
  plan: Partial<GoalPlanData> | null | undefined,
  pick: InjectableGoalTask,
  dateKey: string,
  createdAt = Date.now(),
): GoalPlanMergeResult {
  const task = buildGoalPlanTask(pick, dateKey, createdAt);
  const existingTasks = Array.isArray(plan?.tasks) ? plan!.tasks : [];
  const alreadyPresent = existingTasks.some((candidate) => {
    return (
      candidate.id === task.id ||
      (candidate.goalTreeId === task.goalTreeId && candidate.goalTaskId === task.goalTaskId)
    );
  });

  const base: GoalPlanData = {
    ...(plan || {}),
    date: plan?.date || dateKey,
    tasks: [...existingTasks],
  };

  if (alreadyPresent) {
    return { plan: base, inserted: false, task };
  }

  return {
    plan: { ...base, tasks: [...base.tasks, task] },
    inserted: true,
    task,
  };
}
