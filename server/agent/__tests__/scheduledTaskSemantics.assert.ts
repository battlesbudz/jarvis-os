import assert from "node:assert/strict";
import {
  getScheduledTaskDedupeScope,
  normalizeScheduledTaskKind,
  shouldExecuteScheduledTask,
} from "../../jarvisScheduledTaskSemantics";

assert.equal(normalizeScheduledTaskKind(undefined), "user_task");
assert.equal(normalizeScheduledTaskKind(null), "user_task");
assert.equal(normalizeScheduledTaskKind(""), "user_task");
assert.equal(normalizeScheduledTaskKind("jarvis_action"), "jarvis_action");
assert.equal(normalizeScheduledTaskKind("USER_TASK"), "user_task");

assert.equal(
  shouldExecuteScheduledTask({ taskKind: "user_task", shellCommand: null }),
  false,
  "personal to-do/reminder tasks must not be executed by Jarvis",
);
assert.equal(
  shouldExecuteScheduledTask({ taskKind: "jarvis_action", shellCommand: null }),
  true,
  "explicit Jarvis actions can run through the agent scheduler",
);
assert.equal(
  shouldExecuteScheduledTask({ taskKind: "jarvis_action", shellCommand: "npm.cmd test" }),
  true,
  "explicit shell jobs remain executable",
);

const dailyUserTask = getScheduledTaskDedupeScope({
  title: "Make $140 on DoorDash",
  scheduledAt: new Date("2026-06-01T00:00:00.000Z"),
  recurrence: "daily",
  taskKind: "user_task",
});
assert.equal(dailyUserTask.includeScheduledAt, false);
assert.equal(dailyUserTask.normalizedTitle, "make $140 on doordash");
assert.equal(dailyUserTask.recurrence, "daily");
assert.equal(dailyUserTask.taskKind, "user_task");

const oneOffUserTask = getScheduledTaskDedupeScope({
  title: "Call Bill",
  scheduledAt: new Date("2026-06-01T17:00:00.000Z"),
  recurrence: null,
  taskKind: "user_task",
});
assert.equal(oneOffUserTask.includeScheduledAt, true);

console.log("OK: scheduled task semantics keep personal tasks non-executable and dedupe recurring tasks by intent");
