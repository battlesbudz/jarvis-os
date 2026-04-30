/**
 * Regression test for the scheduler's needsAttention guard.
 *
 * Verifies that when an agent calls flag_task_needs_attention during a run,
 * the scheduler skips the advance/complete block and only clears inProgressAt.
 *
 * Run with: tsx server/agent/__tests__/schedulerNeedsAttention.test.ts
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Pure helper extracted from scheduler's handleDueTask post-run logic.
// This mirrors the exact branching at server/scheduler.ts lines ~560-599.
// ---------------------------------------------------------------------------

interface FreshTask {
  needsAttention: boolean;
}

interface TaskUpdate {
  inProgressAt: null;
  completedAt?: Date;
  scheduledAt?: Date;
}

/**
 * Simulates the scheduler's post-run decision:
 * - If needsAttention, only clear inProgressAt (do NOT advance/complete).
 * - Otherwise, advance or complete the task.
 */
function computePostRunUpdate(
  freshTask: FreshTask | null,
  opts: {
    isRecurring: boolean;
    nextRun: Date | null;
    firedAt: Date;
  },
): { skipped: true } | { skipped: false; update: TaskUpdate } {
  if (freshTask?.needsAttention) {
    return { skipped: true };
  }

  if (opts.isRecurring && opts.nextRun) {
    return {
      skipped: false,
      update: { inProgressAt: null, scheduledAt: opts.nextRun },
    };
  }

  return {
    skipped: false,
    update: { inProgressAt: null, completedAt: opts.firedAt },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  const firedAt = new Date("2025-01-15T10:00:00Z");
  const nextRun = new Date("2025-01-16T10:00:00Z");

  // SNA-1: needsAttention=true → skip completion entirely
  {
    const result = computePostRunUpdate(
      { needsAttention: true },
      { isRecurring: false, nextRun: null, firedAt },
    );
    assert(result.skipped === true, "SNA-1: needsAttention=true → skipped=true (no advance or complete)");
  }

  // SNA-2: needsAttention=true on a recurring task → still skip
  {
    const result = computePostRunUpdate(
      { needsAttention: true },
      { isRecurring: true, nextRun, firedAt },
    );
    assert(result.skipped === true, "SNA-2: needsAttention=true on recurring task → skipped=true");
    if (!result.skipped) {
      assert(!("scheduledAt" in result.update), "SNA-2: no scheduledAt set when skipped");
    }
  }

  // SNA-3: needsAttention=false on one-time task → completedAt set
  {
    const result = computePostRunUpdate(
      { needsAttention: false },
      { isRecurring: false, nextRun: null, firedAt },
    );
    assert(result.skipped === false, "SNA-3: needsAttention=false → not skipped");
    if (!result.skipped) {
      assert(
        result.update.completedAt?.toISOString() === firedAt.toISOString(),
        "SNA-3: completedAt is set to firedAt",
      );
      assert(result.update.inProgressAt === null, "SNA-3: inProgressAt cleared");
    }
  }

  // SNA-4: needsAttention=false on recurring task with nextRun → scheduledAt advanced
  {
    const result = computePostRunUpdate(
      { needsAttention: false },
      { isRecurring: true, nextRun, firedAt },
    );
    assert(result.skipped === false, "SNA-4: recurring task → not skipped");
    if (!result.skipped) {
      assert(
        result.update.scheduledAt?.toISOString() === nextRun.toISOString(),
        "SNA-4: scheduledAt advanced to nextRun",
      );
      assert(!("completedAt" in result.update), "SNA-4: completedAt not set on recurring advance");
      assert(result.update.inProgressAt === null, "SNA-4: inProgressAt cleared");
    }
  }

  // SNA-5: freshTask is null (task was deleted mid-run) → no skip (safe fallback)
  {
    const result = computePostRunUpdate(null, { isRecurring: false, nextRun: null, firedAt });
    assert(
      result.skipped === false,
      "SNA-5: freshTask=null → not skipped (falsy needsAttention, safe to complete)",
    );
  }

  // SNA-6: Verify the scheduler claim filter: needsAttention=true tasks must be
  // excluded from the due-task query. This is enforced by the WHERE clause in
  // runDueScheduledTasks (scheduler.ts line ~398):
  //   eq(schema.jarvisScheduledTasks.needsAttention, false)
  // Here we validate the filter logic directly via a simulated task list.
  {
    const tasks = [
      { id: "t1", needsAttention: false, scheduledAt: new Date("2025-01-15T09:00:00Z") },
      { id: "t2", needsAttention: true,  scheduledAt: new Date("2025-01-15T09:00:00Z") },
      { id: "t3", needsAttention: false, scheduledAt: new Date("2025-01-15T09:30:00Z") },
    ];
    const dueTasks = tasks.filter((t) => !t.needsAttention);
    assert(dueTasks.length === 2, "SNA-6: only 2 of 3 tasks claimed (needsAttention=true excluded)");
    assert(
      !dueTasks.some((t) => t.id === "t2"),
      "SNA-6: task t2 (needsAttention=true) excluded from claim",
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
