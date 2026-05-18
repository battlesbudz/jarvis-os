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

const reorderTree: GoalTreeData = {
  phases: [
    {
      id: "phase-a",
      title: "Phase A",
      status: "ready",
      milestones: [
        {
          id: "milestone-a1",
          title: "Milestone A1",
          status: "ready",
          tasks: [
            { id: "task-a1", title: "Task A1", status: "ready" },
            { id: "task-a2", title: "Task A2", status: "ready" },
          ],
        },
        {
          id: "milestone-a2",
          title: "Milestone A2",
          status: "ready",
          tasks: [{ id: "task-a3", title: "Task A3", status: "ready" }],
        },
      ],
    },
    {
      id: "phase-b",
      title: "Phase B",
      status: "ready",
      milestones: [],
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

  const phaseReordered = applyGoalTreeEdit(reorderTree, {
    type: "move_phase",
    phaseId: "phase-b",
    direction: "up",
  });
  assert.deepEqual(phaseReordered.phases.map((p) => p.id), ["phase-b", "phase-a"]);

  const milestoneReordered = applyGoalTreeEdit(reorderTree, {
    type: "move_milestone",
    phaseId: "phase-a",
    milestoneId: "milestone-a2",
    direction: "up",
  });
  assert.deepEqual(
    milestoneReordered.phases[0].milestones.map((m) => m.id),
    ["milestone-a2", "milestone-a1"],
  );

  const taskReordered = applyGoalTreeEdit(reorderTree, {
    type: "move_task",
    phaseId: "phase-a",
    milestoneId: "milestone-a1",
    taskId: "task-a2",
    direction: "up",
  });
  assert.deepEqual(
    taskReordered.phases[0].milestones[0].tasks.map((t) => t.id),
    ["task-a2", "task-a1"],
  );

  const noOpTopMove = applyGoalTreeEdit(reorderTree, {
    type: "move_phase",
    phaseId: "phase-a",
    direction: "up",
  });
  assert.deepEqual(noOpTopMove.phases.map((p) => p.id), ["phase-a", "phase-b"]);

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
