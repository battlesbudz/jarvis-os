export type GoalTreeUiTaskStatus = "ready" | "in_progress" | "blocked" | "complete";
export type GoalTreeUiStatus = "ready" | "in_progress" | "complete";
export type GoalTreeUiTaskState = "complete" | "overdue" | "due_today" | "current" | "next" | "blocked" | "ready";

export interface GoalTreeUiTask {
  id: string;
  title: string;
  description?: string;
  estimateHours?: number;
  status: GoalTreeUiTaskStatus;
  dueDate?: string;
  injectedOnDates?: string[];
}

export interface GoalTreeUiMilestone {
  id: string;
  title: string;
  description?: string;
  status: GoalTreeUiStatus;
  tasks: GoalTreeUiTask[];
}

export interface GoalTreeUiPhase {
  id: string;
  title: string;
  description?: string;
  status: GoalTreeUiStatus;
  milestones: GoalTreeUiMilestone[];
}

export interface GoalTreeHandoffHistoryItem {
  date: string;
  taskId: string;
  taskTitle: string;
}

export interface GoalTreeUiAnalysis {
  summary: {
    total: number;
    done: number;
    active: number;
    ready: number;
    blocked: number;
    overdue: number;
    percent: number;
  };
  currentPhaseId: string | null;
  currentMilestoneId: string | null;
  nextTask: GoalTreeUiTask | null;
  handoffHistory: GoalTreeHandoffHistoryItem[];
}

function dateTime(dateKey: string | undefined): number | null {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const time = new Date(`${dateKey}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? time : null;
}

function daysBetween(dateKey: string, todayKey: string): number | null {
  const target = dateTime(dateKey);
  const today = dateTime(todayKey);
  if (target === null || today === null) return null;
  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}

export function getTaskDueLabel(dueDate: string | undefined, todayKey: string): string | null {
  if (!dueDate) return null;
  const days = daysBetween(dueDate, todayKey);
  if (days === null) return null;
  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

export function getTaskUiState(
  task: GoalTreeUiTask,
  todayKey: string,
  isNextTask: boolean,
): GoalTreeUiTaskState {
  const days = task.dueDate ? daysBetween(task.dueDate, todayKey) : null;
  if (task.status === "complete") return "complete";
  if (days !== null && days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (task.status === "in_progress") return "current";
  if (isNextTask) return "next";
  if (task.status === "blocked") return "blocked";
  return "ready";
}

export function analyzeGoalTreeUi(phases: GoalTreeUiPhase[], todayKey: string): GoalTreeUiAnalysis {
  let total = 0;
  let done = 0;
  let active = 0;
  let ready = 0;
  let blocked = 0;
  let overdue = 0;
  let nextTask: GoalTreeUiTask | null = null;
  let currentPhaseId: string | null = null;
  let currentMilestoneId: string | null = null;
  const latestHandoffs = new Map<string, GoalTreeHandoffHistoryItem>();

  for (const phase of phases) {
    if (!currentPhaseId && phase.status !== "complete") currentPhaseId = phase.id;
    for (const milestone of phase.milestones) {
      if (currentPhaseId === phase.id && !currentMilestoneId && milestone.status !== "complete") {
        currentMilestoneId = milestone.id;
      }
      for (const task of milestone.tasks) {
        total += 1;
        if (task.status === "complete") done += 1;
        if (task.status === "in_progress") active += 1;
        if (task.status === "ready") ready += 1;
        if (task.status === "blocked") blocked += 1;
        if (getTaskUiState(task, todayKey, false) === "overdue") overdue += 1;
        if (!nextTask && (task.status === "in_progress" || task.status === "ready")) {
          nextTask = task;
        }
        for (const date of task.injectedOnDates || []) {
          const current = latestHandoffs.get(task.id);
          if (!current || date > current.date) {
            latestHandoffs.set(task.id, { date, taskId: task.id, taskTitle: task.title });
          }
        }
      }
    }
  }

  const handoffHistory = [...latestHandoffs.values()];
  handoffHistory.sort((a, b) => b.date.localeCompare(a.date));

  return {
    summary: {
      total,
      done,
      active,
      ready,
      blocked,
      overdue,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
    },
    currentPhaseId,
    currentMilestoneId,
    nextTask,
    handoffHistory,
  };
}
