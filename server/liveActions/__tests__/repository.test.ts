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
  const { projectAgentJob } = await import("../adapters/agentJob");
  const {
    getLiveActionForUser,
    listLiveActionEvents,
    listLiveActionsForUser,
    persistAgentJobProjection,
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
    const staleProjection = projectAgentJob(job);

    await reconcileAgentJobsForUser(userId);
    const [first] = await listLiveActionsForUser({ userId });
    assert.ok(first, "first reconciliation persists an action");
    assert.equal(first.version, 1);
    assert.equal(first.updatedAt, createdAt.toISOString(), "backfills retain source recency");
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
    assert.equal(completed.updatedAt, new Date(createdAt.getTime() + 5 * 60_000).toISOString());
    assert.ok(completed.version > first.version, "a real source transition advances the version");
    await persistAgentJobProjection(staleProjection);
    assert.equal(
      (await getLiveActionForUser(userId, first.id))?.status,
      "succeeded",
      "an overlapping stale reconciliation cannot regress canonical state",
    );
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

    const approvalRace = {
      ...staleProjection,
      sourceId: `${marker}-approval-job`,
      sourceLineageKey: `${marker}-approval-lineage`,
      status: "running" as const,
    };
    const runningApprovalAction = await persistAgentJobProjection(approvalRace);
    await persistAgentJobProjection({
      ...approvalRace,
      status: "waiting_approval",
      attention: { kind: "approval" as const, reason: "Approval required" },
    });
    assert.equal(
      (await getLiveActionForUser(userId, runningApprovalAction.id))?.status,
      "running",
      "an equal-timestamp pending snapshot cannot regress a resolved approval",
    );

    const approvalAgentId = `${marker}-approval-agent`;
    const pendingGateId = `${marker}-pending-gate`;
    await db.insert(schema.discordAgents).values({ id: approvalAgentId, userId, name: "Approval test agent" });
    await db.insert(schema.agentApprovalGates).values({
      id: pendingGateId,
      agentId: approvalAgentId,
      userId,
      toolName: "approval_test",
      description: "Confirm the equal-timestamp transition",
      expiresAt: new Date(createdAt.getTime() + 60_000),
    });
    const approvalEvent = buildWorkerRuntimeEvent({
      type: "approval_required",
      workerType: "research",
      message: "Approval required",
      now: createdAt,
      userVisible: true,
      checkpoint: {
        id: pendingGateId,
        gateId: pendingGateId,
        reason: "Approval required",
        requiredFor: "approval_test",
      },
    });
    const approvalRuntime = appendWorkerRuntimeEvent(runtime, approvalEvent);
    const [pendingApprovalJob] = await db.insert(schema.agentJobs).values({
      id: `${marker}-pending-approval-job`,
      userId,
      agentType: "research",
      title: "Pending approval",
      prompt: "Wait for approval",
      input: { workerType: approvalRuntime.workerType, workerRuntime: approvalRuntime },
      status: "running",
      createdAt,
      startedAt: createdAt,
    }).returning();
    const genuineRunningAction = await persistAgentJobProjection(projectAgentJob(pendingApprovalJob));
    await persistAgentJobProjection(projectAgentJob(pendingApprovalJob, new Set([pendingGateId])));
    assert.equal(
      (await getLiveActionForUser(userId, genuineRunningAction.id))?.status,
      "waiting_approval",
      "a canonical pending gate permits a genuine equal-timestamp approval transition",
    );

    const [equalTimeCompletedJob] = await db.insert(schema.agentJobs).values({
      id: `${marker}-equal-time-complete`,
      userId,
      agentType: "research",
      title: "Equal-time completion",
      prompt: "Complete immediately",
      status: "complete",
      createdAt,
      completedAt: createdAt,
    }).returning();
    const completedProjection = projectAgentJob(equalTimeCompletedJob);
    const equalTimeTerminalAction = await persistAgentJobProjection(completedProjection);
    await persistAgentJobProjection(projectAgentJob({
      ...equalTimeCompletedJob,
      status: "queued",
      completedAt: null,
    }));
    assert.equal(
      (await getLiveActionForUser(userId, equalTimeTerminalAction.id))?.status,
      "succeeded",
      "an equal-timestamp active snapshot cannot regress canonical terminal state",
    );

    const historicalIds = ["root", "retry", "retry-again"].map((suffix) => `${marker}-${suffix}`);
    await db.insert(schema.agentJobs).values([
      {
        id: historicalIds[0], userId, agentType: "research", title: "Historical retry chain",
        prompt: "First attempt", status: "failed", createdAt: new Date(createdAt.getTime() - 3_000), completedAt: new Date(createdAt.getTime() - 3_000),
      },
      {
        id: historicalIds[1], userId, agentType: "research", title: "Historical retry chain",
        prompt: "Second attempt", input: { retryOfJobId: historicalIds[0] }, status: "failed",
        createdAt: new Date(createdAt.getTime() - 2_000), completedAt: new Date(createdAt.getTime() - 2_000),
      },
      {
        id: historicalIds[2], userId, agentType: "research", title: "Historical retry chain",
        prompt: "Third attempt", input: { retryOfJobId: historicalIds[1] }, status: "queued",
        createdAt: new Date(createdAt.getTime() - 1_000),
      },
    ]);
    await reconcileAgentJobsForUser(userId);
    const historicalActions = (await listLiveActionsForUser({ userId, limit: 100 }))
      .filter((action) => historicalIds.includes(action.source.id));
    assert.equal(historicalActions.length, 1, "historical retry descendants share one root lineage");
    assert.equal(historicalActions[0]?.source.id, historicalIds[2], "the latest retry owns the shared action");

    const oldCreatedAt = new Date(createdAt.getTime() - 31 * 24 * 60 * 60 * 1_000);
    const [oldJob] = await db.insert(schema.agentJobs).values({
      id: `${marker}-old-job`,
      userId,
      agentType: "research",
      title: "Long-running research",
      prompt: "Finish eventually",
      input: { workerType: runtime.workerType, workerRuntime: runtime },
      status: "running",
      createdAt: oldCreatedAt,
      startedAt: oldCreatedAt,
    }).returning();
    await reconcileAgentJobsForUser(userId);
    let oldAction = (await listLiveActionsForUser({ userId, limit: 100 }))
      .find((action) => action.source.id === oldJob.id);
    assert.equal(oldAction?.status, "running");

    await db.update(schema.agentJobs).set({ status: "complete", completedAt: new Date() })
      .where(eq(schema.agentJobs.id, oldJob.id));
    await reconcileAgentJobsForUser(userId);
    oldAction = (await listLiveActionsForUser({ userId, limit: 100 }))
      .find((action) => action.source.id === oldJob.id);
    assert.equal(oldAction?.status, "succeeded", "recent completion refreshes jobs created outside retention");

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
