interface GoalPlanLike {
  tasks?: unknown;
}

interface GoalPlanTaskLike {
  goalTreeId?: unknown;
  goalTaskId?: unknown;
}

export function goalTaskIsInPlan(
  plan: GoalPlanLike | null | undefined,
  goalTreeId: string,
  goalTaskId: string,
): boolean {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  return tasks.some((task) => {
    const candidate = task as GoalPlanTaskLike;
    return candidate.goalTreeId === goalTreeId && candidate.goalTaskId === goalTaskId;
  });
}
