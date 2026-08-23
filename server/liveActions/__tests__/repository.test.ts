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

    const retentionProjection = {
      ...staleProjection,
      sourceId: `${marker}-retention-job`,
      sourceLineageKey: `${marker}-retention-lineage`,
      events: Array.from({ length: 200 }, (_, index) => ({
        sourceEventKey: `${marker}-retention-${String(index).padStart(3, "0")}`,
        type: "action.progress_updated" as const,
        message: `Progress ${index}`,
        safeMetadata: {},
        userVisible: true,
        createdAt: new Date(createdAt.getTime() + index * 1_000),
      })),
    };
    const retentionAction = await persistAgentJobProjection(retentionProjection);
    await persistAgentJobProjection({
      ...retentionProjection,
      events: [{
        sourceEventKey: `${marker}-retention-late-old`,
        type: "action.progress_updated",
        message: "Late historical progress",
        safeMetadata: {},
        userVisible: true,
        createdAt: new Date(createdAt.getTime() - 1_000),
      }],
    });
    const retainedEvents = await listLiveActionEvents(retentionAction.id);
    assert.equal(retainedEvents.length, 200);
    assert.ok(
      !retainedEvents.some((event) => event.message === "Late historical progress"),
      "retention evicts by source chronology rather than late insertion sequence",
    );
    assert.deepEqual(
      retainedEvents.map((event) => event.sequence),
      retainedEvents.map((_, index) => index + 1),
      "discarding a late historical event does not disturb assigned sequences",
    );
    const retainedSequences = new Map(retainedEvents.map((event) => [event.id, event.sequence]));
    await persistAgentJobProjection({
      ...retentionProjection,
      events: [{
        sourceEventKey: `${marker}-retention-newest`,
        type: "action.progress_updated",
        message: "Newest progress",
        safeMetadata: {},
        userVisible: true,
        createdAt: new Date(createdAt.getTime() + 300_000),
      }],
    });
    const rolledEvents = await listLiveActionEvents(retentionAction.id);
    assert.equal(rolledEvents.length, 200);
    assert.equal(rolledEvents.at(-1)?.message, "Newest progress");
    for (const event of rolledEvents) {
      const previousSequence = retainedSequences.get(event.id);
      if (previousSequence !== undefined) {
        assert.equal(event.sequence, previousSequence, "retention preserves surviving event cursors");
      }
    }
    assert.equal(rolledEvents.at(-1)?.sequence, 201, "new events keep a monotonic sequence after eviction");

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
    const approvalResolvedAt = new Date(createdAt.getTime() + 1_000);
    await db.update(schema.agentApprovalGates).set({ status: "approved", resolvedAt: approvalResolvedAt })
      .where(eq(schema.agentApprovalGates.id, pendingGateId));
    await reconcileAgentJobsForUser(userId);
    assert.ok(
      (await listLiveActionEvents(genuineRunningAction.id)).some((event) =>
        event.type === "action.approval_resolved" && event.createdAt === approvalResolvedAt.toISOString()),
      "resolved approval gates append a durable resolution event",
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

    const newerRuntime = appendWorkerRuntimeEvent(runtime, buildWorkerRuntimeEvent({
      type: "progress",
      workerType: "research",
      message: "Newer progress",
      now: createdAt,
      userVisible: true,
      progress: { currentStep: "Newer progress", percent: 50 },
    }));
    const [equalTimeRunningJob] = await db.insert(schema.agentJobs).values({
      id: `${marker}-equal-time-running`,
      userId,
      agentType: "research",
      title: "Equal-time progress",
      prompt: "Make progress",
      input: { workerType: newerRuntime.workerType, workerRuntime: newerRuntime },
      status: "running",
      createdAt,
      startedAt: createdAt,
    }).returning();
    const equalTimeRunningAction = await persistAgentJobProjection(projectAgentJob(equalTimeRunningJob));
    await persistAgentJobProjection(projectAgentJob({
      ...equalTimeRunningJob,
      input: { workerType: runtime.workerType, workerRuntime: runtime },
    }));
    assert.equal(
      (await getLiveActionForUser(userId, equalTimeRunningAction.id))?.progress?.currentStep,
      "Newer progress",
      "an equal-timestamp same-status snapshot cannot regress canonical progress",
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

    const equalRetryIds = [`${marker}-equal-attempt-z`, `${marker}-equal-attempt-a`];
    const [equalFailedJob, equalRetryJob] = await db.insert(schema.agentJobs).values([
      {
        id: equalRetryIds[0], userId, agentType: "research", title: "Equal-time retry",
        prompt: "First attempt", status: "failed", createdAt, completedAt: createdAt,
      },
      {
        id: equalRetryIds[1], userId, agentType: "research", title: "Equal-time retry",
        prompt: "Second attempt", input: { retryOfJobId: equalRetryIds[0] }, status: "queued", createdAt,
      },
    ]).returning();
    await reconcileAgentJobsForUser(userId);
    assert.ok(
      (await listLiveActionsForUser({ userId, limit: 100 }))
        .some((action) => action.source.id === equalRetryIds[1]),
      "equal-timestamp reconciliation selects the newest retry generation",
    );
    const equalRetryAction = await persistAgentJobProjection(projectAgentJob(equalRetryJob, new Set(), equalRetryIds[0]));
    await persistAgentJobProjection(projectAgentJob(equalFailedJob));
    assert.equal(
      (await getLiveActionForUser(userId, equalRetryAction.id))?.source.id,
      equalRetryIds[1],
      "an equal-timestamp older attempt cannot replace the canonical retry",
    );

    await db.update(schema.agentJobs).set({ status: "complete", completedAt: new Date() })
      .where(eq(schema.agentJobs.id, historicalIds[2]));
    await reconcileAgentJobsForUser(userId, { status: "failed" });
    const failedHistoricalActions = (await listLiveActionsForUser({ userId, status: "failed", limit: 100 }))
      .filter((action) => historicalIds.includes(action.source.id));
    assert.equal(failedHistoricalActions.length, 0, "filtered reconciliation includes later retry descendants");

    const pagingRetryIds = Array.from({ length: 500 }, (_, index) => `${marker}-paging-retry-${index}`);
    const pagingNewestAt = new Date(createdAt.getTime() - 10 * 60_000);
    await db.insert(schema.agentJobs).values(pagingRetryIds.map((id, index) => {
      const attemptAt = new Date(pagingNewestAt.getTime() - index * 60_000);
      return {
        id,
        userId,
        agentType: "research",
        title: "Dense retry lineage",
        prompt: `Attempt ${index}`,
        input: index === 0 ? {} : { retryOfJobId: pagingRetryIds[index - 1] },
        status: "complete",
        createdAt: attemptAt,
        completedAt: attemptAt,
      };
    }));
    const pagingSecondTerminalId = `${marker}-paging-second-terminal`;
    const pagingSecondTerminalAt = new Date(pagingNewestAt.getTime() - 510 * 60_000);
    await db.insert(schema.agentJobs).values({
      id: pagingSecondTerminalId,
      userId,
      agentType: "research",
      title: "Second terminal lineage",
      prompt: "Remain discoverable beyond a dense retry page",
      status: "complete",
      createdAt: pagingSecondTerminalAt,
      completedAt: pagingSecondTerminalAt,
    });
    await db.insert(schema.agentJobs).values(Array.from({ length: 25 }, (_, index) => ({
      id: `${marker}-paging-active-${index}`,
      userId,
      agentType: "research",
      title: `Older active ${index}`,
      prompt: "Keep running",
      status: "running",
      createdAt: new Date(pagingSecondTerminalAt.getTime() - (index + 1) * 60_000),
      startedAt: new Date(pagingSecondTerminalAt.getTime() - (index + 1) * 60_000),
    })));
    await reconcileAgentJobsForUser(userId, { limit: 25 });
    assert.ok(
      (await listLiveActionsForUser({ userId, limit: 25 }))
        .some((action) => action.source.id === pagingSecondTerminalId),
      "terminal paging does not let active lineages hide a newer terminal lineage beyond a dense retry page",
    );

    const [filteredRunningJob] = await db.insert(schema.agentJobs).values({
      id: `${marker}-filtered-running`,
      userId,
      agentType: "research",
      title: "Filtered running transition",
      prompt: "Finish while filtered",
      status: "running",
      createdAt,
      startedAt: createdAt,
    }).returning();
    await reconcileAgentJobsForUser(userId, { status: "running" });
    assert.ok(
      (await listLiveActionsForUser({ userId, status: "running", limit: 100 }))
        .some((action) => action.source.id === filteredRunningJob.id),
    );
    await db.update(schema.agentJobs).set({ status: "complete", completedAt: new Date() })
      .where(eq(schema.agentJobs.id, filteredRunningJob.id));
    await reconcileAgentJobsForUser(userId, { status: "running" });
    assert.ok(
      !(await listLiveActionsForUser({ userId, status: "running", limit: 100 }))
        .some((action) => action.source.id === filteredRunningJob.id),
      "status-filtered polling refreshes actions that leave the requested state",
    );

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

    const expiredAt = new Date(createdAt.getTime() - 31 * 24 * 60 * 60 * 1_000);
    const expiredDetail = await persistAgentJobProjection(projectAgentJob({
      ...oldJob,
      id: `${marker}-expired-detail`,
      status: "complete",
      completedAt: expiredAt,
    }));
    assert.equal(
      await getLiveActionForUser(userId, expiredDetail.id),
      null,
      "detail reads enforce terminal retention",
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
