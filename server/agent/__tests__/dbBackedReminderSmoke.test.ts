import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  console.log("server/agent/__tests__/dbBackedReminderSmoke.test.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";

async function run(): Promise<void> {
  const { and, eq } = await import("drizzle-orm");
  const schema = await import("@shared/schema");
  const { db, ensureTablesExist, pool } = await import("../../db");
  const { shouldExecuteScheduledTask } = await import("../../jarvisScheduledTaskSemantics");
  const { scheduleJarvisTaskTool } = await import("../tools/scheduleJarvisTask");

  const marker = `jarvis-db-reminder-smoke-${Date.now()}`;
  const userId = marker;
  const title = `${marker} follow up`;
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);

  await ensureTablesExist();

  try {
    await db
      .insert(schema.users)
      .values({
        id: userId,
        username: userId,
        password: null,
        displayName: "Jarvis DB reminder smoke",
        email: null,
      })
      .onConflictDoNothing();

    const result = await scheduleJarvisTaskTool.execute(
      {
        title,
        description: `DB-backed reminder smoke marker ${marker}`,
        scheduledAt: scheduledAt.toISOString(),
        taskKind: "user_task",
      },
      { userId, state: {}, channel: "db-backed-reminder-smoke" },
    );

    assert.equal(result.ok, true);
    assert.match(result.label ?? "", /Scheduled/);

    const [created] = await db
      .select()
      .from(schema.jarvisScheduledTasks)
      .where(and(
        eq(schema.jarvisScheduledTasks.userId, userId),
        eq(schema.jarvisScheduledTasks.title, title),
      ))
      .limit(1);

    assert.ok(created, "scheduled task row should be persisted");
    assert.equal(created.userId, userId);
    assert.equal(created.taskKind, "user_task");
    assert.equal(created.recurrence, null);
    assert.equal(created.active, true);
    assert.equal(created.completedAt, null);
    assert.equal(created.shellCommand, null);
    assert.equal(created.needsAttention, false);
    assert.equal(shouldExecuteScheduledTask({ taskKind: created.taskKind, shellCommand: created.shellCommand }), false);

    const duplicate = await scheduleJarvisTaskTool.execute(
      {
        title,
        description: `DB-backed reminder smoke marker ${marker}`,
        scheduledAt: scheduledAt.toISOString(),
        taskKind: "user_task",
      },
      { userId, state: {}, channel: "db-backed-reminder-smoke" },
    );

    assert.equal(duplicate.ok, true);
    assert.match(duplicate.label ?? "", /Already scheduled/);

    const matchingRows = await db
      .select()
      .from(schema.jarvisScheduledTasks)
      .where(and(
        eq(schema.jarvisScheduledTasks.userId, userId),
        eq(schema.jarvisScheduledTasks.title, title),
      ));

    assert.equal(matchingRows.length, 1, "same reminder should dedupe instead of creating duplicates");
    console.log("OK: DB-backed reminder smoke persists a user-owned scheduled task and dedupes repeats");
  } finally {
    await db.delete(schema.jarvisScheduledTasks).where(eq(schema.jarvisScheduledTasks.userId, userId)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => {});
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
