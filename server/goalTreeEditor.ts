import type {
  GoalTreeData,
  GoalTreeMilestone,
  GoalTreePhase,
  GoalTreeTask,
} from "@shared/schema";

type PhaseStatus = GoalTreePhase["status"];
type MilestoneStatus = GoalTreeMilestone["status"];
type TaskStatus = GoalTreeTask["status"];

type PhasePatch = Partial<Pick<GoalTreePhase, "title" | "description" | "status">>;
type MilestonePatch = Partial<Pick<GoalTreeMilestone, "title" | "description" | "status">>;
type TaskPatch = Partial<
  Pick<GoalTreeTask, "title" | "description" | "estimateHours" | "status" | "dueDate">
>;
type MoveDirection = "up" | "down";

export type GoalTreeEditAction =
  | { type: "add_phase"; phase: { title: string; description?: string } }
  | { type: "update_phase"; phaseId: string; patch: PhasePatch }
  | { type: "delete_phase"; phaseId: string }
  | { type: "move_phase"; phaseId: string; direction: MoveDirection }
  | {
      type: "add_milestone";
      phaseId: string;
      milestone: { title: string; description?: string };
    }
  | {
      type: "update_milestone";
      phaseId: string;
      milestoneId: string;
      patch: MilestonePatch;
    }
  | { type: "delete_milestone"; phaseId: string; milestoneId: string }
  | { type: "move_milestone"; phaseId: string; milestoneId: string; direction: MoveDirection }
  | {
      type: "add_task";
      phaseId: string;
      milestoneId: string;
      task: { title: string; description?: string; estimateHours?: number; dueDate?: string };
    }
  | {
      type: "update_task";
      phaseId: string;
      milestoneId: string;
      taskId: string;
      patch: TaskPatch;
    }
  | { type: "delete_task"; phaseId: string; milestoneId: string; taskId: string }
  | { type: "move_task"; phaseId: string; milestoneId: string; taskId: string; direction: MoveDirection };

export interface GoalTreeSummary {
  totalPhases: number;
  totalMilestones: number;
  totalTasks: number;
  completeTasks: number;
  inProgressTasks: number;
  readyTasks: number;
  blockedTasks: number;
  progressPercent: number;
  nextTask: GoalTreeTask | null;
}

function cloneTree(tree: GoalTreeData): GoalTreeData {
  return JSON.parse(JSON.stringify(tree || { phases: [] })) as GoalTreeData;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().slice(0, max);
  return cleaned || undefined;
}

function cleanHours(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0.25, Math.min(40, numeric));
}

function assertTitle(value: string | undefined, label: string): string {
  const title = cleanText(value, 200);
  if (!title) throw new Error(`${label} title is required`);
  return title;
}

function cleanPhasePatch(patch: PhasePatch): PhasePatch {
  const out: PhasePatch = {};
  if ("title" in patch) out.title = assertTitle(patch.title, "phase");
  if ("description" in patch) out.description = cleanText(patch.description, 500);
  if ("status" in patch) out.status = cleanPhaseStatus(patch.status);
  return out;
}

function cleanMilestonePatch(patch: MilestonePatch): MilestonePatch {
  const out: MilestonePatch = {};
  if ("title" in patch) out.title = assertTitle(patch.title, "milestone");
  if ("description" in patch) out.description = cleanText(patch.description, 500);
  if ("status" in patch) out.status = cleanMilestoneStatus(patch.status);
  return out;
}

function cleanTaskPatch(patch: TaskPatch): TaskPatch {
  const out: TaskPatch = {};
  if ("title" in patch) out.title = assertTitle(patch.title, "task");
  if ("description" in patch) out.description = cleanText(patch.description, 500);
  if ("estimateHours" in patch) out.estimateHours = cleanHours(patch.estimateHours);
  if ("status" in patch) out.status = cleanTaskStatus(patch.status);
  if ("dueDate" in patch) out.dueDate = cleanText(patch.dueDate, 40);
  return out;
}

function cleanPhaseStatus(status: unknown): PhaseStatus | undefined {
  return status === "ready" || status === "in_progress" || status === "complete"
    ? status
    : undefined;
}

function cleanMilestoneStatus(status: unknown): MilestoneStatus | undefined {
  return status === "ready" || status === "in_progress" || status === "complete"
    ? status
    : undefined;
}

function cleanTaskStatus(status: unknown): TaskStatus | undefined {
  return status === "ready" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "complete"
    ? status
    : undefined;
}

function findPhase(tree: GoalTreeData, phaseId: string): GoalTreePhase {
  const phase = tree.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`phase not found: ${phaseId}`);
  return phase;
}

function findMilestone(phase: GoalTreePhase, milestoneId: string): GoalTreeMilestone {
  const milestone = phase.milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Error(`milestone not found: ${milestoneId}`);
  return milestone;
}

function findTask(milestone: GoalTreeMilestone, taskId: string): GoalTreeTask {
  const task = milestone.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  return task;
}

function moveById<T extends { id: string }>(items: T[], id: string, direction: MoveDirection, label: string): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) throw new Error(`${label} not found: ${id}`);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function rollupStatuses(tree: GoalTreeData): GoalTreeData {
  for (const phase of tree.phases) {
    for (const milestone of phase.milestones) {
      if (milestone.tasks.length > 0 && milestone.tasks.every((t) => t.status === "complete")) {
        milestone.status = "complete";
      } else if (milestone.tasks.some((t) => t.status === "complete" || t.status === "in_progress")) {
        milestone.status = "in_progress";
      } else {
        milestone.status = milestone.status === "complete" ? "ready" : milestone.status;
      }
    }

    if (phase.milestones.length > 0 && phase.milestones.every((m) => m.status === "complete")) {
      phase.status = "complete";
    } else if (phase.milestones.some((m) => m.status === "complete" || m.status === "in_progress")) {
      phase.status = "in_progress";
    } else {
      phase.status = phase.status === "complete" ? "ready" : phase.status;
    }
  }
  return tree;
}

export function summarizeGoalTree(tree: GoalTreeData): GoalTreeSummary {
  const summary: GoalTreeSummary = {
    totalPhases: tree.phases.length,
    totalMilestones: 0,
    totalTasks: 0,
    completeTasks: 0,
    inProgressTasks: 0,
    readyTasks: 0,
    blockedTasks: 0,
    progressPercent: 0,
    nextTask: null,
  };

  for (const phase of tree.phases) {
    summary.totalMilestones += phase.milestones.length;
    for (const milestone of phase.milestones) {
      for (const task of milestone.tasks) {
        summary.totalTasks += 1;
        if (task.status === "complete") summary.completeTasks += 1;
        if (task.status === "in_progress") summary.inProgressTasks += 1;
        if (task.status === "ready") summary.readyTasks += 1;
        if (task.status === "blocked") summary.blockedTasks += 1;
        if (!summary.nextTask && (task.status === "in_progress" || task.status === "ready")) {
          summary.nextTask = task;
        }
      }
    }
  }

  summary.progressPercent =
    summary.totalTasks === 0 ? 0 : Math.round((summary.completeTasks / summary.totalTasks) * 100);

  return summary;
}

export function applyGoalTreeEdit(tree: GoalTreeData, action: GoalTreeEditAction): GoalTreeData {
  const next = cloneTree(tree);
  next.phases = Array.isArray(next.phases) ? next.phases : [];

  if (action.type === "add_phase") {
    next.phases.push({
      id: newId("phase"),
      title: assertTitle(action.phase.title, "phase"),
      description: cleanText(action.phase.description, 500),
      status: "ready",
      milestones: [],
    });
    return rollupStatuses(next);
  }

  const phase = "phaseId" in action ? findPhase(next, action.phaseId) : null;

  switch (action.type) {
    case "update_phase":
      Object.assign(phase!, cleanPhasePatch(action.patch));
      break;

    case "delete_phase":
      next.phases = next.phases.filter((p) => p.id !== action.phaseId);
      break;

    case "move_phase":
      next.phases = moveById(next.phases, action.phaseId, action.direction, "phase");
      break;

    case "add_milestone":
      phase!.milestones.push({
        id: newId("milestone"),
        title: assertTitle(action.milestone.title, "milestone"),
        description: cleanText(action.milestone.description, 500),
        status: "ready",
        tasks: [],
      });
      break;

    case "update_milestone": {
      const milestone = findMilestone(phase!, action.milestoneId);
      Object.assign(milestone, cleanMilestonePatch(action.patch));
      break;
    }

    case "delete_milestone":
      phase!.milestones = phase!.milestones.filter((m) => m.id !== action.milestoneId);
      break;

    case "move_milestone":
      phase!.milestones = moveById(phase!.milestones, action.milestoneId, action.direction, "milestone");
      break;

    case "add_task": {
      const milestone = findMilestone(phase!, action.milestoneId);
      milestone.tasks.push({
        id: newId("task"),
        title: assertTitle(action.task.title, "task"),
        description: cleanText(action.task.description, 500),
        estimateHours: cleanHours(action.task.estimateHours) ?? 1,
        dueDate: cleanText(action.task.dueDate, 40),
        status: "ready",
      });
      break;
    }

    case "update_task": {
      const milestone = findMilestone(phase!, action.milestoneId);
      const task = findTask(milestone, action.taskId);
      Object.assign(task, cleanTaskPatch(action.patch));
      if (task.status === "complete" && !task.completedAt) task.completedAt = new Date().toISOString();
      if (task.status !== "complete") delete task.completedAt;
      break;
    }

    case "delete_task": {
      const milestone = findMilestone(phase!, action.milestoneId);
      milestone.tasks = milestone.tasks.filter((t) => t.id !== action.taskId);
      break;
    }

    case "move_task": {
      const milestone = findMilestone(phase!, action.milestoneId);
      milestone.tasks = moveById(milestone.tasks, action.taskId, action.direction, "task");
      break;
    }
  }

  return rollupStatuses(next);
}
