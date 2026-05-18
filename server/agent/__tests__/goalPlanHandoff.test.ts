import assert from "node:assert/strict";
import {
  buildGoalPlanTask,
  mergeGoalTaskIntoPlan,
} from "../../goalPlanHandoff";
import type { InjectableGoalTask } from "../../goalScheduler";

const pick: InjectableGoalTask = {
  goalTreeId: "tree-1",
  goalTitle: "Launch Jarvis project loops",
  phaseId: "phase-1",
  milestoneId: "milestone-1",
  taskId: "task-1",
  title: "Review the next project action",
  description: "Choose the smallest useful next move.",
  estimateHours: 0.5,
};

function run(): void {
  const dateKey = "2026-05-18";
  const task = buildGoalPlanTask(pick, dateKey, 1_700_000_000_000);

  assert.equal(task.id, "goal_task-1_2026-05-18");
  assert.equal(task.title, "Review the next project action");
  assert.equal(task.category, "goal");
  assert.equal(task.priority, "high");
  assert.equal(task.completed, false);
  assert.equal(task.duration, 30);
  assert.equal(task.createdAt, 1_700_000_000_000);
  assert.equal(task.fromJarvis, true);
  assert.equal(task.goalTreeId, "tree-1");
  assert.equal(task.goalTaskId, "task-1");
  assert.equal(
    task.description,
    "Choose the smallest useful next move. (from goal: Launch Jarvis project loops)",
  );

  const emptyPlan = { date: dateKey, tasks: [], greeting: "Morning", insight: "" };
  const inserted = mergeGoalTaskIntoPlan(emptyPlan, pick, dateKey, 1_700_000_000_000);

  assert.equal(inserted.inserted, true);
  assert.equal(inserted.plan.tasks.length, 1);
  assert.equal(inserted.plan.tasks[0].id, "goal_task-1_2026-05-18");
  assert.deepEqual(emptyPlan.tasks, []);

  const duplicate = mergeGoalTaskIntoPlan(inserted.plan, pick, dateKey, 1_700_000_000_001);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.plan.tasks.length, 1);
  assert.equal(duplicate.task.id, "goal_task-1_2026-05-18");

  console.log("All goal plan handoff assertions passed.");
}

run();
