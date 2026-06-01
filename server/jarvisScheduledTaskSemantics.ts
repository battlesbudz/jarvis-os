export type ScheduledTaskKind = "user_task" | "jarvis_action";

export interface ScheduledTaskDedupeInput {
  title: string;
  scheduledAt: Date;
  recurrence?: string | null;
  taskKind?: string | null;
}

export interface ScheduledTaskDedupeScope {
  normalizedTitle: string;
  recurrence: string | null;
  taskKind: ScheduledTaskKind;
  includeScheduledAt: boolean;
}

export function normalizeScheduledTaskKind(value: string | null | undefined): ScheduledTaskKind {
  return String(value ?? "").trim().toLowerCase() === "jarvis_action" ? "jarvis_action" : "user_task";
}

export function shouldExecuteScheduledTask(task: {
  taskKind?: string | null;
  shellCommand?: string | null;
}): boolean {
  return normalizeScheduledTaskKind(task.taskKind) === "jarvis_action";
}

export function getScheduledTaskDedupeScope(input: ScheduledTaskDedupeInput): ScheduledTaskDedupeScope {
  const recurrence = String(input.recurrence ?? "").trim() || null;
  return {
    normalizedTitle: String(input.title ?? "").trim().toLowerCase(),
    recurrence,
    taskKind: normalizeScheduledTaskKind(input.taskKind),
    includeScheduledAt: !recurrence,
  };
}
