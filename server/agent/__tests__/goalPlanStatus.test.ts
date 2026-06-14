import assert from "node:assert/strict";
import { goalTaskIsInPlan } from "../../../lib/goalPlanStatus";

function run(): void {
  assert.equal(
    goalTaskIsInPlan(
      {
        date: "2026-05-18",
        tasks: [
          {
            id: "goal_task-1_2026-05-18",
            title: "Review next action",
            goalTreeId: "tree-1",
            goalTaskId: "task-1",
            completed: false,
          },
        ],
      },
      "tree-1",
      "task-1",
    ),
    true,
  );

  assert.equal(
    goalTaskIsInPlan(
      {
        date: "2026-05-18",
        tasks: [
          {
            id: "goal_task-2_2026-05-18",
            title: "Different task",
            goalTreeId: "tree-1",
            goalTaskId: "task-2",
            completed: false,
          },
        ],
      },
      "tree-1",
      "task-1",
    ),
    false,
  );

  assert.equal(goalTaskIsInPlan(null, "tree-1", "task-1"), false);
  assert.equal(goalTaskIsInPlan({ date: "2026-05-18", tasks: null }, "tree-1", "task-1"), false);

  console.log("All goal plan status assertions passed.");
}

run();
