export type DailyCommandStatus =
  | "working"
  | "ready"
  | "waiting_approval"
  | "blocked"
  | "failed"
  | "recovering";

export interface DailyCommandContextWarning {
  source: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface DailyCommandMeta {
  source: string;
  generatedAt: string;
  mode?: "merge" | "replace";
  contextWarnings?: DailyCommandContextWarning[];
  aiTaskCount?: number;
  goalTaskCount?: number;
  preservedTaskCount?: number;
  reasoning?: string;
}

export interface DailyPlanTask {
  id: string;
  title: string;
  completed?: boolean;
  subtasks?: DailyPlanTask[];
  [key: string]: unknown;
}

export interface DailyPlanData {
  date: string;
  tasks: DailyPlanTask[];
  meta?: Record<string, unknown> & { dailyCommand?: DailyCommandMeta };
  [key: string]: unknown;
}

export type DailyPlanPatch =
  | { op: "add_task"; task: Partial<DailyPlanTask> & { title: string } }
  | { op: "update_task"; taskId: string; updates: Partial<DailyPlanTask> }
  | { op: "complete_task"; taskId: string; completed?: boolean }
  | { op: "delete_task"; taskId: string }
  | { op: "reorder_tasks"; taskIds: string[] }
  | { op: "carry_over_task"; taskId: string; targetDate?: string };

export interface DailyCommandStatusInput {
  activeJobsCount?: number;
  failedJobsCount?: number;
  pendingApprovalCount?: number;
  pendingDeliverableApprovalCount?: number;
  planTaskCount?: number;
  contextWarnings?: DailyCommandContextWarning[];
}

export interface DailyCommandStatusReason {
  state: DailyCommandStatus;
  label: string;
  detail: string;
  severity: "info" | "warning" | "error";
  action?: "retry_available" | "approval_required" | "wait" | "reconnect" | "generate_plan";
}

function partsMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getZonedDateTimeParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const map = partsMap(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) === 24 ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1 + days));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function zonedDateTimeToUtc(dateKey: string, timezone: string, hour: number, minute: number, second: number, millisecond: number): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetMs = Date.UTC(year, (month || 1) - 1, day || 1, hour, minute, second, millisecond);
  let guess = new Date(targetMs);

  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedDateTimeParts(guess, timezone);
    const zonedMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, millisecond);
    const delta = zonedMs - targetMs;
    if (delta === 0) break;
    guess = new Date(guess.getTime() - delta);
  }

  return guess;
}

export function getLocalDateKey(now = new Date(), timezone = "America/New_York"): string {
  try {
    const map = partsMap(new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function getNextLocalDateKey(dateKey: string): string {
  return addDaysToDateKey(dateKey, 1);
}

export function getLocalDayWindow(dateKey: string, timezone = "America/New_York"): { startTime: string; endTime: string } {
  try {
    const start = zonedDateTimeToUtc(dateKey, timezone, 0, 0, 0, 0);
    const nextStart = zonedDateTimeToUtc(getNextLocalDateKey(dateKey), timezone, 0, 0, 0, 0);
    return {
      startTime: start.toISOString(),
      endTime: new Date(nextStart.getTime() - 1).toISOString(),
    };
  } catch {
    return {
      startTime: new Date(`${dateKey}T00:00:00.000Z`).toISOString(),
      endTime: new Date(`${dateKey}T23:59:59.999Z`).toISOString(),
    };
  }
}

function safeTasks(plan: Partial<DailyPlanData> | null | undefined): DailyPlanTask[] {
  return Array.isArray(plan?.tasks) ? [...plan.tasks] : [];
}

function normaliseTitle(title: unknown): string {
  return String(title || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function makeGeneratedTaskId(dateKey: string, createdAt: number, index: number): string {
  return `jarvis_${dateKey}_${createdAt}_${index}`;
}

export function withDailyCommandMeta(
  plan: Partial<DailyPlanData> | null | undefined,
  meta: DailyCommandMeta,
): DailyPlanData {
  return {
    ...(plan || {}),
    date: plan?.date || getLocalDateKey(),
    tasks: safeTasks(plan),
    meta: {
      ...((plan?.meta as Record<string, unknown> | undefined) || {}),
      dailyCommand: meta,
    },
  };
}

export function mergeGeneratedTasksIntoPlan(
  plan: Partial<DailyPlanData> | null | undefined,
  generatedTasks: Array<Partial<DailyPlanTask> & { title: string }>,
  opts: {
    dateKey: string;
    createdAt?: number;
    source: string;
    mode?: "merge" | "replace";
    contextWarnings?: DailyCommandContextWarning[];
  },
): { plan: DailyPlanData; inserted: DailyPlanTask[] } {
  const createdAt = opts.createdAt ?? Date.now();
  const baseTasks = opts.mode === "replace" ? [] : safeTasks(plan);
  const seenTitles = new Set(baseTasks.map((task) => normaliseTitle(task.title)).filter(Boolean));
  const inserted: DailyPlanTask[] = [];

  for (const [index, task] of generatedTasks.entries()) {
    const title = String(task.title || "").trim();
    if (!title) continue;
    const key = normaliseTitle(title);
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    inserted.push({
      id: typeof task.id === "string" ? task.id : makeGeneratedTaskId(opts.dateKey, createdAt, index),
      ...task,
      title,
      completed: task.completed === true,
      createdAt: typeof task.createdAt === "number" ? task.createdAt : createdAt,
      fromJarvis: task.fromJarvis ?? true,
      dailyCommandDate: opts.dateKey,
      originSurface: task.originSurface ?? "daily_command",
      sourceIntent: task.sourceIntent ?? "morning_plan",
    });
  }

  const nextPlan: DailyPlanData = {
    ...(plan || {}),
    date: opts.dateKey,
    tasks: [...baseTasks, ...inserted],
  };

  return {
    plan: withDailyCommandMeta(nextPlan, {
      source: opts.source,
      generatedAt: new Date(createdAt).toISOString(),
      mode: opts.mode ?? "merge",
      contextWarnings: opts.contextWarnings ?? [],
      aiTaskCount: inserted.length,
      preservedTaskCount: baseTasks.length,
    }),
    inserted,
  };
}

function updateTaskTree(
  tasks: DailyPlanTask[],
  taskId: string,
  updater: (task: DailyPlanTask) => DailyPlanTask,
): DailyPlanTask[] {
  return tasks.map((task) => {
    if (task.id === taskId) return updater(task);
    if (!Array.isArray(task.subtasks)) return task;
    const subtasks = updateTaskTree(task.subtasks, taskId, updater);
    const completed = subtasks.length > 0 && subtasks.every((subtask) => subtask.completed === true);
    return { ...task, subtasks, completed };
  });
}

function deleteFromTaskTree(tasks: DailyPlanTask[], taskId: string): DailyPlanTask[] {
  const next: DailyPlanTask[] = [];
  for (const task of tasks) {
    if (task.id === taskId) continue;
    if (Array.isArray(task.subtasks)) {
      next.push({ ...task, subtasks: deleteFromTaskTree(task.subtasks, taskId) });
    } else {
      next.push(task);
    }
  }
  return next;
}

export function applyDailyPlanPatch(plan: Partial<DailyPlanData> | null | undefined, patch: DailyPlanPatch): DailyPlanData {
  const base: DailyPlanData = {
    ...(plan || {}),
    date: plan?.date || getLocalDateKey(),
    tasks: safeTasks(plan),
  };

  switch (patch.op) {
    case "add_task": {
      const createdAt = Date.now();
      const task: DailyPlanTask = {
        id: patch.task.id || makeGeneratedTaskId(base.date, createdAt, base.tasks.length),
        completed: false,
        createdAt,
        ...patch.task,
        title: String(patch.task.title).trim(),
      };
      return { ...base, tasks: [...base.tasks, task] };
    }
    case "update_task":
      return {
        ...base,
        tasks: updateTaskTree(base.tasks, patch.taskId, (task) => ({ ...task, ...patch.updates, id: task.id })),
      };
    case "complete_task":
      return {
        ...base,
        tasks: updateTaskTree(base.tasks, patch.taskId, (task) => ({
          ...task,
          completed: patch.completed ?? true,
        })),
      };
    case "delete_task":
      return { ...base, tasks: deleteFromTaskTree(base.tasks, patch.taskId) };
    case "reorder_tasks": {
      const byId = new Map(base.tasks.map((task) => [task.id, task]));
      const ordered = patch.taskIds
        .map((id) => byId.get(id))
        .filter((task): task is DailyPlanTask => Boolean(task));
      const orderedIds = new Set(ordered.map((task) => task.id));
      return { ...base, tasks: [...ordered, ...base.tasks.filter((task) => !orderedIds.has(task.id))] };
    }
    case "carry_over_task":
      return base;
    default: {
      const neverPatch: never = patch;
      throw new Error(`Unsupported daily plan patch: ${JSON.stringify(neverPatch)}`);
    }
  }
}

export function classifyDailyCommandStatus(input: DailyCommandStatusInput): DailyCommandStatus {
  const activeJobs = input.activeJobsCount ?? 0;
  const failedJobs = input.failedJobsCount ?? 0;
  const pendingApprovals = (input.pendingApprovalCount ?? 0) + (input.pendingDeliverableApprovalCount ?? 0);
  const planTaskCount = input.planTaskCount ?? 0;
  const hasBlockingWarning = (input.contextWarnings ?? []).some((warning) => warning.severity === "error");

  if (pendingApprovals > 0) return "waiting_approval";
  if (activeJobs > 0 && failedJobs > 0) return "recovering";
  if (activeJobs > 0) return "working";
  if (failedJobs > 0) return "failed";
  if (planTaskCount === 0 && hasBlockingWarning) return "blocked";
  return "ready";
}

export function buildDailyCommandStatusReasons(input: DailyCommandStatusInput): DailyCommandStatusReason[] {
  const activeJobs = input.activeJobsCount ?? 0;
  const failedJobs = input.failedJobsCount ?? 0;
  const pendingApprovals = (input.pendingApprovalCount ?? 0) + (input.pendingDeliverableApprovalCount ?? 0);
  const planTaskCount = input.planTaskCount ?? 0;
  const warnings = input.contextWarnings ?? [];
  const reasons: DailyCommandStatusReason[] = [];

  if (pendingApprovals > 0) {
    reasons.push({
      state: "waiting_approval",
      label: "Waiting for approval",
      detail: `${pendingApprovals} approval ${pendingApprovals === 1 ? "item needs" : "items need"} your decision before Jarvis acts.`,
      severity: "warning",
      action: "approval_required",
    });
  }

  if (activeJobs > 0) {
    reasons.push({
      state: "working",
      label: "Jarvis is working",
      detail: `${activeJobs} background ${activeJobs === 1 ? "job is" : "jobs are"} queued or running.`,
      severity: "info",
      action: "wait",
    });
  }

  if (failedJobs > 0) {
    reasons.push({
      state: "failed",
      label: "Retry available",
      detail: `${failedJobs} ${failedJobs === 1 ? "job failed" : "jobs failed"} and can be reviewed or retried from the Inbox.`,
      severity: "error",
      action: "retry_available",
    });
  }

  for (const warning of warnings.filter((item) => item.severity === "error").slice(0, 3)) {
    reasons.push({
      state: "blocked",
      label: `${warning.source} blocked`,
      detail: warning.message,
      severity: "error",
      action: "reconnect",
    });
  }

  if (planTaskCount === 0 && reasons.length === 0) {
    reasons.push({
      state: "blocked",
      label: "No daily plan yet",
      detail: "Generate or add tasks so Jarvis has a concrete daily loop to run.",
      severity: "warning",
      action: "generate_plan",
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      state: "ready",
      label: "Ready",
      detail: "Plan, jobs, approvals, and setup signals are clear.",
      severity: "info",
    });
  }

  return reasons;
}
