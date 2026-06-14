import assert from "node:assert/strict";
import {
  analyzeGoalTreeUi,
  getTaskDueLabel,
  getTaskUiState,
  type GoalTreeUiPhase,
} from "../../../lib/goalTreeUi";

const phases: GoalTreeUiPhase[] = [
  {
    id: "phase-1",
    title: "Foundation",
    status: "complete",
    milestones: [
      {
        id: "milestone-1",
        title: "Setup",
        status: "complete",
        tasks: [
          {
            id: "task-done",
            title: "Finish setup",
            status: "complete",
            injectedOnDates: ["2026-05-16"],
          },
        ],
      },
    ],
  },
  {
    id: "phase-2",
    title: "Launch",
    status: "in_progress",
    milestones: [
      {
        id: "milestone-2",
        title: "First launch",
        status: "in_progress",
        tasks: [
          {
            id: "task-current",
            title: "Ship the current slice",
            status: "in_progress",
            dueDate: "2026-05-17",
            injectedOnDates: ["2026-05-15", "2026-05-18"],
          },
          {
            id: "task-next",
            title: "Review the next slice",
            status: "ready",
            dueDate: "2026-05-18",
          },
          {
            id: "task-later",
            title: "Plan follow-up",
            status: "ready",
            dueDate: "2026-05-21",
          },
        ],
      },
    ],
  },
];

function run(): void {
  const analysis = analyzeGoalTreeUi(phases, "2026-05-18");

  assert.equal(analysis.summary.total, 4);
  assert.equal(analysis.summary.done, 1);
  assert.equal(analysis.summary.overdue, 1);
  assert.equal(analysis.currentPhaseId, "phase-2");
  assert.equal(analysis.currentMilestoneId, "milestone-2");
  assert.equal(analysis.nextTask?.id, "task-current");

  assert.equal(analysis.handoffHistory.length, 2);
  assert.equal(analysis.handoffHistory[0].taskId, "task-current");
  assert.equal(analysis.handoffHistory[0].date, "2026-05-18");
  assert.equal(analysis.handoffHistory[1].taskId, "task-done");

  assert.equal(getTaskUiState(phases[1].milestones[0].tasks[0], "2026-05-18", true), "overdue");
  assert.equal(getTaskUiState(phases[1].milestones[0].tasks[1], "2026-05-18", false), "due_today");
  assert.equal(getTaskUiState(phases[1].milestones[0].tasks[2], "2026-05-18", false), "ready");

  assert.equal(getTaskDueLabel("2026-05-17", "2026-05-18"), "Overdue");
  assert.equal(getTaskDueLabel("2026-05-18", "2026-05-18"), "Due today");
  assert.equal(getTaskDueLabel("2026-05-21", "2026-05-18"), "Due in 3d");

  console.log("All goal tree UI assertions passed.");
}

run();
