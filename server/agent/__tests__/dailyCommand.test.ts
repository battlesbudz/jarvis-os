import assert from "node:assert/strict";
import {
  applyDailyPlanPatch,
  classifyDailyCommandStatus,
  getLocalDateKey,
  getLocalDayWindow,
  mergeGeneratedTasksIntoPlan,
} from "../../dailyCommand/planOps";

{
  const nearMidnightUtc = new Date("2026-05-29T02:30:00.000Z");
  assert.equal(getLocalDateKey(nearMidnightUtc, "America/New_York"), "2026-05-28");
  assert.equal(getLocalDateKey(nearMidnightUtc, "UTC"), "2026-05-29");

  const window = getLocalDayWindow("2026-05-28", "America/New_York");
  assert.equal(window.startTime, "2026-05-28T04:00:00.000Z");
  assert.equal(window.endTime, "2026-05-29T03:59:59.999Z");
  console.log("OK: daily command date helpers use user-local days");
}

{
  const existing = {
    date: "2026-05-28",
    tasks: [
      { id: "manual-1", title: "Call the bank", completed: false, fromJarvis: false },
      { id: "ai-old", title: "Draft license checklist", completed: false, fromJarvis: true },
    ],
  };

  const merged = mergeGeneratedTasksIntoPlan(
    existing,
    [
      { title: "Draft license checklist", category: "career", priority: "high" },
      { title: "Review calendar commitments", category: "personal", priority: "medium", duration: 20 },
    ],
    {
      dateKey: "2026-05-28",
      createdAt: 1_700_000_000_000,
      source: "daily_command_test",
    },
  );

  assert.equal(merged.inserted.length, 1);
  assert.equal(merged.plan.tasks.length, 3);
  assert.equal(merged.plan.tasks[0].id, "manual-1");
  assert.equal(merged.plan.tasks[2].title, "Review calendar commitments");
  assert.equal(merged.plan.tasks[2].dailyCommandDate, "2026-05-28");
  assert.equal(merged.plan.meta?.dailyCommand?.source, "daily_command_test");
  console.log("OK: generated tasks merge without overwriting user edits or duplicating titles");
}

{
  const base = {
    date: "2026-05-28",
    tasks: [
      { id: "a", title: "First", completed: false },
      { id: "b", title: "Second", completed: false },
    ],
  };

  const completed = applyDailyPlanPatch(base, { op: "complete_task", taskId: "a", completed: true });
  assert.equal(completed.tasks.find((task) => task.id === "a")?.completed, true);

  const updated = applyDailyPlanPatch(completed, { op: "update_task", taskId: "b", updates: { title: "Second edited" } });
  assert.equal(updated.tasks.find((task) => task.id === "b")?.title, "Second edited");

  const reordered = applyDailyPlanPatch(updated, { op: "reorder_tasks", taskIds: ["b", "a"] });
  assert.deepEqual(reordered.tasks.map((task) => task.id), ["b", "a"]);

  const deleted = applyDailyPlanPatch(reordered, { op: "delete_task", taskId: "a" });
  assert.deepEqual(deleted.tasks.map((task) => task.id), ["b"]);
  console.log("OK: daily command plan patch operations are deterministic");
}

{
  assert.equal(classifyDailyCommandStatus({ activeJobsCount: 1 }), "working");
  assert.equal(classifyDailyCommandStatus({ pendingApprovalCount: 1 }), "waiting_approval");
  assert.equal(classifyDailyCommandStatus({ failedJobsCount: 1 }), "failed");
  assert.equal(
    classifyDailyCommandStatus({
      planTaskCount: 0,
      contextWarnings: [{ source: "calendar", severity: "error", message: "Calendar unavailable" }],
    }),
    "blocked",
  );
  assert.equal(classifyDailyCommandStatus({ planTaskCount: 3 }), "ready");
  console.log("OK: daily command status classifier exposes working, waiting, failed, blocked, and ready");
}

console.log("\nAll daily command assertions passed.");
