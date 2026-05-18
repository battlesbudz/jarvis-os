import assert from "node:assert/strict";
import type { GoalTreeData } from "@shared/schema";
import {
  applyGoalTreeEdit,
  summarizeGoalTree,
} from "../../goalTreeEditor";

const tree: GoalTreeData = {
  rationale: "Build in small, reviewable steps.",
  generatedAt: "2026-05-18T00:00:00.000Z",
  phases: [
    {
      id: "phase-1",
      title: "Foundation",
      description: "Prepare the base.",
      status: "ready",
      milestones: [
        {
          id: "milestone-1",
          title: "First working slice",
          description: "Small useful launch.",
          status: "ready",
          tasks: [
            {
              id: "task-1",
              title: "Outline the first action",
              description: "Write the smallest next move.",
              estimateHours: 0.5,
              status: "complete",
            },
            {
              id: "task-2",
              title: "Do the first action",
              description: "Ship the smallest next move.",
              estimateHours: 1,
              status: "ready",
            },
          ],
        },
      ],
    },
  ],
};

function run(): void {
  const editedPhase = applyGoalTreeEdit(tree, {
    type: "update_phase",
    phaseId: "phase-1",
    patch: {
      title: "Foundation and setup",
      description: "Prepare the real base.",
    },
  });
  assert.equal(editedPhase.phases[0].title, "Foundation and setup");
  assert.equal(editedPhase.phases[0].description, "Prepare the real base.");

  const editedTask = applyGoalTreeEdit(editedPhase, {
    type: "update_task",
    phaseId: "phase-1",
    milestoneId: "milestone-1",
    taskId: "task-2",
    patch: {
      title: "Ship the first visible action",
      estimateHours: 2,
      status: "in_progress",
    },
  });
  const task = editedTask.phases[0].milestones[0].tasks[1];
  assert.equal(task.title, "Ship the first visible action");
  assert.equal(task.estimateHours, 2);
  assert.equal(task.status, "in_progress");
  assert.equal(editedTask.phases[0].status, "in_progress");
  assert.equal(editedTask.phases[0].milestones[0].status, "in_progress");

  const withAddedTask = applyGoalTreeEdit(editedTask, {
    type: "add_task",
    phaseId: "phase-1",
    milestoneId: "milestone-1",
    task: {
      title: "Review the visible result",
      description: "Confirm the first slice is useful.",
      estimateHours: 0.75,
    },
  });
  const added = withAddedTask.phases[0].milestones[0].tasks[2];
  assert.match(added.id, /^task_/);
  assert.equal(added.title, "Review the visible result");
  assert.equal(added.status, "ready");

  const summary = summarizeGoalTree(withAddedTask);
  assert.equal(summary.totalPhases, 1);
  assert.equal(summary.totalMilestones, 1);
  assert.equal(summary.totalTasks, 3);
  assert.equal(summary.completeTasks, 1);
  assert.equal(summary.inProgressTasks, 1);
  assert.equal(summary.readyTasks, 1);
  assert.equal(summary.progressPercent, 33);
  assert.equal(summary.nextTask?.id, "task-2");

  assert.throws(
    () =>
      applyGoalTreeEdit(tree, {
        type: "update_milestone",
        phaseId: "missing-phase",
        milestoneId: "milestone-1",
        patch: { title: "Nope" },
      }),
    /phase not found/i,
  );

  console.log("All goal tree editor assertions passed.");
}

run();
