import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  console.log("server/liveActions/__tests__/repository.test.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const schema = await import("@shared/schema");
  const { db, ensureTablesExist, pool } = await import("../../db");
  const { buildInitialWorkerRuntime, buildWorkerRuntimeEvent, appendWorkerRuntimeEvent } = await import("../../agent/workerRuntime");
  const {
    getLiveActionForUser,
    listLiveActionEvents,
    listLiveActionsForUser,
    reconcileAgentJobsForUser,
  } = await import("../repository");

  await ensureTablesExist();
  const marker = `live-action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userId = `${marker}-owner`;
  const otherUserId = `${marker}-other`;
  const createdAt = new Date();
  const runtime = buildInitialWorkerRuntime({ agentType: "research", title: "Persistent research", now: createdAt });

  try {
    await db.insert(schema.users).values([
      { id: userId, username: userId },
      { id: otherUserId, username: otherUserId },
    ]);
    const [job] = await db.insert(schema.agentJobs).values({
      id: `${marker}-job`,
      userId,
      agentType: "research",
      title: "Persistent research",
      prompt: "Research safely",
      input: { workerType: runtime.workerType, workerRuntime: runtime },
      status: "queued",
      createdAt,
    }).returning();

    await reconcileAgentJobsForUser(userId);
    const [first] = await listLiveActionsForUser({ userId });
    assert.ok(first, "first reconciliation persists an action");
    assert.equal(first.version, 1);
    const firstEvents = await listLiveActionEvents(first.id);
    assert.ok(firstEvents.length >= 1);
    assert.deepEqual(firstEvents.map((event) => event.sequence), firstEvents.map((_, index) => index + 1));

    await reconcileAgentJobsForUser(userId);
    const [replayed] = await listLiveActionsForUser({ userId });
    const replayedEvents = await listLiveActionEvents(first.id);
    assert.equal(replayed.id, first.id, "duplicate replay keeps one stable card identity");
    assert.equal(replayed.version, first.version, "duplicate replay does not advance the version");
    assert.equal(replayedEvents.length, firstEvents.length, "duplicate replay does not append events");

    const staleSourceEvent = buildWorkerRuntimeEvent({
      type: "started",
      workerType: "research",
      message: "Started earlier",
      now: new Date(createdAt.getTime() - 60_000),
      userVisible: true,
      progress: { currentStep: "Old progress", percent: 5 },
    });
    const completedRuntime = appendWorkerRuntimeEvent(runtime, staleSourceEvent);
    await db.update(schema.agentJobs).set({
      input: { workerType: completedRuntime.workerType, workerRuntime: completedRuntime },
      status: "complete",
      completedAt: new Date(createdAt.getTime() + 5 * 60_000),
    }).where(eq(schema.agentJobs.id, job.id));

    await reconcileAgentJobsForUser(userId);
    const [completed] = await listLiveActionsForUser({ userId });
    assert.equal(completed.id, first.id);
    assert.equal(completed.status, "succeeded", "an out-of-order event cannot regress canonical terminal state");
    assert.ok(completed.version > first.version, "a real source transition advances the version");
    const completedEvents = await listLiveActionEvents(first.id);
    assert.deepEqual(
      completedEvents.map((event) => event.sequence),
      completedEvents.map((_, index) => index + 1),
      "newly discovered events receive monotonic sequences",
    );

    completedRuntime.events.push(staleSourceEvent);
    await db.update(schema.agentJobs).set({
      input: { workerType: completedRuntime.workerType, workerRuntime: completedRuntime },
    }).where(eq(schema.agentJobs.id, job.id));
    await reconcileAgentJobsForUser(userId);
    assert.equal(
      (await listLiveActionEvents(first.id)).length,
      completedEvents.length,
      "identical source events remain idempotent even when replayed twice",
    );

    assert.equal(await getLiveActionForUser(otherUserId, first.id), null, "cross-user detail reads are rejected");
    assert.equal((await listLiveActionsForUser({ userId: otherUserId })).length, 0, "cross-user snapshots are empty");
  } finally {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.users).where(eq(schema.users.id, otherUserId));
    await pool.end();
  }
}

main().then(() => {
  console.log("Live Action persistence, idempotency, ordering, reconciliation, and authorization assertions passed.");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
