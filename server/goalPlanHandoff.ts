import type { InjectableGoalTask } from "./goalScheduler";

export interface GoalPlanTask extends Record<string, unknown> {
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

type GoalPlanTaskRecord = Record<string, unknown> & {
  id?: unknown;
  title?: unknown;
  goalTreeId?: unknown;
  goalTaskId?: unknown;
};

export interface GoalPlanData {
  date: string;
  tasks: GoalPlanTaskRecord[];
  greeting?: string;
  insight?: string;
  [key: string]: unknown;
}

export interface GoalPlanMergeResult<TPlan extends GoalPlanData = GoalPlanData> {
  plan: TPlan;
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

export function mergeGoalTaskIntoPlan<TPlan extends Partial<GoalPlanData>>(
  plan: TPlan | null | undefined,
  pick: InjectableGoalTask,
  dateKey: string,
  createdAt = Date.now(),
): GoalPlanMergeResult<TPlan & GoalPlanData> {
  const task = buildGoalPlanTask(pick, dateKey, createdAt);
  const existingTasks: GoalPlanTaskRecord[] = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const alreadyPresent = existingTasks.some((candidate) => {
    return (
      candidate.id === task.id ||
      (candidate.goalTreeId === task.goalTreeId && candidate.goalTaskId === task.goalTaskId)
    );
  });

  const base = {
    ...(plan || {}),
    date: plan?.date || dateKey,
    tasks: [...existingTasks],
  } as TPlan & GoalPlanData;

  if (alreadyPresent) {
    return { plan: base, inserted: false, task };
  }

  return {
    plan: { ...base, tasks: [...base.tasks, task] } as TPlan & GoalPlanData,
    inserted: true,
    task,
  };
}
