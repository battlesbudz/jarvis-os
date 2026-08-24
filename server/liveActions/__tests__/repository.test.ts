import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  console.log("server/liveActions/__tests__/repository.test.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

async function main(): Promise<void> {
  const { eq, inArray } = await import("drizzle-orm");
  const schema = await import("@shared/schema");
  const { db, ensureTablesExist, pool } = await import("../../db");
  const { buildInitialWorkerRuntime, buildWorkerRuntimeEvent, appendWorkerRuntimeEvent } = await import("../../agent/workerRuntime");
  const { staleJobRequeueUpdate } = await import("../../agent/jobRequeue");
  const { projectAgentJob } = await import("../adapters/agentJob");
  const {
    getLiveActionForUser,
    listLiveActionEvents,
    listLiveActionsForUser,
    persistAgentJobProjection,
    reconcileAgentJobsForUser,
  } = await import("../repository");
  const { liveActionReadService } = await import("../service");

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

    const fractionalProgressAction = await persistAgentJobProjection({
      ...staleProjection,
      sourceId: `${marker}-fractional-progress-job`,
      sourceLineageKey: `${marker}-fractional-progress-lineage`,
      progress: {
        kind: "percent",
        currentStep: "Partial step",
        value: 12.3,
        updatedAt: createdAt.toISOString(),
      },
    });
    assert.ok(
      Math.abs((fractionalProgressAction.progress?.value ?? 0) - 12.3) < 0.0001,
      "fractional progress survives persistence",
    );
    const replayedFractionalProgressAction = await persistAgentJobProjection({
      ...staleProjection,
      sourceId: `${marker}-fractional-progress-job`,
      sourceLineageKey: `${marker}-fractional-progress-lineage`,
      progress: {
        kind: "percent",
        currentStep: "Partial step",
        value: 12.3,
        updatedAt: createdAt.toISOString(),
      },
    });
    assert.equal(
      replayedFractionalProgressAction.version,
      fractionalProgressAction.version,
      "REAL rounding does not create a false projection update",
    );

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
    const completedSequences = completedEvents.map((event) => event.sequence).sort((a, b) => a - b);
    assert.deepEqual(
      completedSequences,
      completedSequences.map((_, index) => index + 1),
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

    const watchdogJobId = `${marker}-watchdog-requeue`;
    await db.insert(schema.agentJobs).values({
      id: watchdogJobId,
      userId,
      agentType: "research",
      title: "Repeated watchdog recovery",
      prompt: "Survive repeated restarts",
      input: { workerType: runtime.workerType, workerRuntime: runtime },
      status: "running",
      createdAt,
      startedAt: createdAt,
    });
    const firstRequeueAt = new Date(createdAt.getTime() + 10_000);
    const secondRequeueAt = new Date(createdAt.getTime() + 20_000);
    await db.update(schema.agentJobs).set(staleJobRequeueUpdate(firstRequeueAt))
      .where(eq(schema.agentJobs.id, watchdogJobId));
    await db.update(schema.agentJobs).set({ status: "running", startedAt: firstRequeueAt })
      .where(eq(schema.agentJobs.id, watchdogJobId));
    await db.update(schema.agentJobs).set(staleJobRequeueUpdate(secondRequeueAt))
      .where(eq(schema.agentJobs.id, watchdogJobId));
    await reconcileAgentJobsForUser(userId, { sourceLineageKey: watchdogJobId });
    const watchdogAction = (await listLiveActionsForUser({ userId, limit: 100 }))
      .find((action) => action.source.id === watchdogJobId);
    assert.ok(watchdogAction);
    assert.deepEqual(
      (await listLiveActionEvents(watchdogAction.id))
        .filter((event) => event.message === "Job requeued")
        .map((event) => event.createdAt),
      [firstRequeueAt.toISOString(), secondRequeueAt.toISOString()],
      "repeated watchdog recoveries preserve every queued transition",
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
    assert.equal(
      historicalActions[0]?.createdAt,
      new Date(createdAt.getTime() - 3_000).toISOString(),
      "a retry lineage keeps the root attempt's creation time",
    );

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

    const pagingProjectId = `${marker}-paging-project`;
    const pagingRetryIds = Array.from(
      { length: 500 },
      (_, index) => `${marker}-paging-retry-${String(999 - index).padStart(3, "0")}`,
    );
    const pagingNewestAt = new Date(createdAt.getTime() - 10 * 60_000);
    await db.insert(schema.agentJobs).values(pagingRetryIds.map((id, index) => {
      return {
        id,
        userId,
        agentType: "research",
        title: "Dense retry lineage",
        prompt: `Attempt ${index}`,
        input: index === 0
          ? { projectId: pagingProjectId }
          : { retryOfJobId: pagingRetryIds[index - 1], projectId: pagingProjectId },
        status: "complete",
        createdAt: pagingNewestAt,
        completedAt: pagingNewestAt,
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
      input: { projectId: pagingProjectId },
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

    const boundaryRetryId = `${marker}-paging-retry-000`;
    await db.insert(schema.agentJobs).values({
      id: boundaryRetryId,
      userId,
      agentType: "research",
      title: "Dense retry lineage",
      prompt: "Attempt beyond the first source page",
      input: { retryOfJobId: pagingRetryIds.at(-1)!, projectId: pagingProjectId },
      status: "complete",
      createdAt: pagingNewestAt,
      completedAt: pagingNewestAt,
    });
    await db.delete(schema.liveActions)
      .where(eq(schema.liveActions.sourceLineageKey, pagingRetryIds[0]));
    await reconcileAgentJobsForUser(userId, { projectId: pagingProjectId, limit: 1 });
    const [boundaryRetryAction] = await db.select({ sourceId: schema.liveActions.sourceId })
      .from(schema.liveActions)
      .where(eq(schema.liveActions.sourceLineageKey, pagingRetryIds[0]))
      .limit(1);
    assert.equal(
      boundaryRetryAction?.sourceId,
      boundaryRetryId,
      "unfiltered paging loads retry descendants beyond an equal-timestamp source boundary",
    );

    const activeBoundProjectId = `${marker}-active-bound-project`;
    await db.insert(schema.agentJobs).values(Array.from({ length: 5 }, (_, index) => ({
      id: `${marker}-active-bound-${index}`,
      userId,
      agentType: "research",
      title: `Bounded active ${index}`,
      prompt: "Remain queued",
      input: { projectId: activeBoundProjectId },
      status: "queued",
      createdAt: new Date(createdAt.getTime() + index * 1_000),
    })));
    const freshestActiveId = `${marker}-active-bound-freshest-event`;
    const freshestActiveRuntime = appendWorkerRuntimeEvent(
      buildInitialWorkerRuntime({
        agentType: "research",
        title: "Older job with fresh progress",
        now: new Date(createdAt.getTime() - 24 * 60 * 60 * 1_000),
      }),
      buildWorkerRuntimeEvent({
        type: "progress",
        workerType: "research",
        message: "Fresh progress",
        now: new Date(createdAt.getTime() + 60_000),
        userVisible: true,
      }),
    );
    await db.insert(schema.agentJobs).values({
      id: freshestActiveId,
      userId,
      agentType: "research",
      title: "Older job with fresh progress",
      prompt: "Rank by progress recency",
      input: { projectId: activeBoundProjectId, workerRuntime: freshestActiveRuntime },
      status: "running",
      createdAt: new Date(createdAt.getTime() - 24 * 60 * 60 * 1_000),
      startedAt: new Date(createdAt.getTime() - 24 * 60 * 60 * 1_000),
    });
    await reconcileAgentJobsForUser(userId, { projectId: activeBoundProjectId, limit: 2 });
    const boundedActiveActions = await listLiveActionsForUser({ userId, projectId: activeBoundProjectId, limit: 100 });
    assert.equal(boundedActiveActions.length, 2, "active reconciliation is bounded by the requested snapshot size");
    assert.ok(
      boundedActiveActions.some((action) => action.source.id === freshestActiveId),
      "cold active reconciliation ranks candidates by projected event recency",
    );
    await reconcileAgentJobsForUser(userId, { status: "succeeded", projectId: activeBoundProjectId, limit: 1 });
    assert.equal(
      (await listLiveActionsForUser({ userId, projectId: activeBoundProjectId, limit: 100 })).length,
      2,
      "terminal filters do not reconcile the rest of an active backlog",
    );

    const olderWaitingId = `${marker}-active-bound-older-waiting`;
    const olderWaitingGateId = `${marker}-active-bound-older-waiting-gate`;
    await db.insert(schema.agentApprovalGates).values({
      id: olderWaitingGateId,
      agentId: approvalAgentId,
      userId,
      toolName: "older_waiting_test",
      description: "Keep an older running job pending",
      expiresAt: new Date(createdAt.getTime() + 60_000),
    });
    const olderWaitingRuntime = appendWorkerRuntimeEvent(
      buildInitialWorkerRuntime({
        agentType: "research",
        title: "Older pending approval",
        now: new Date(createdAt.getTime() - 2 * 24 * 60 * 60 * 1_000),
      }),
      buildWorkerRuntimeEvent({
        type: "approval_required",
        workerType: "research",
        message: "Approval required",
        checkpoint: {
          id: olderWaitingGateId,
          gateId: olderWaitingGateId,
          reason: "Approve the older job",
          requiredFor: "research",
        },
        now: new Date(createdAt.getTime() - 2 * 24 * 60 * 60 * 1_000 + 1_000),
        userVisible: true,
      }),
    );
    await db.insert(schema.agentJobs).values({
      id: olderWaitingId,
      userId,
      agentType: "research",
      title: "Older pending approval",
      prompt: "Wait behind newer running jobs",
      input: { projectId: activeBoundProjectId, workerRuntime: olderWaitingRuntime },
      status: "running",
      createdAt: new Date(createdAt.getTime() - 2 * 24 * 60 * 60 * 1_000),
      startedAt: new Date(createdAt.getTime() - 2 * 24 * 60 * 60 * 1_000),
    });
    await reconcileAgentJobsForUser(userId, { status: "waiting_approval", projectId: activeBoundProjectId, limit: 1 });
    assert.ok(
      (await listLiveActionsForUser({ userId, status: "waiting_approval", projectId: activeBoundProjectId, limit: 1 }))
        .some((action) => action.source.id === olderWaitingId),
      "active filtering pages past newer running jobs until a projected approval match is found",
    );

    const freshestCancellationId = `${marker}-active-bound-cancelling`;
    const freshestCancellationAt = new Date(createdAt.getTime() + 120_000);
    await db.insert(schema.agentJobs).values({
      id: freshestCancellationId,
      userId,
      agentType: "research",
      title: "Older job with fresh cancellation",
      prompt: "Cancel now",
      input: { projectId: activeBoundProjectId, cancelRequestedAt: freshestCancellationAt.toISOString() },
      status: "cancelling",
      createdAt: new Date(createdAt.getTime() - 3 * 24 * 60 * 60 * 1_000),
      startedAt: new Date(createdAt.getTime() - 3 * 24 * 60 * 60 * 1_000),
    });
    await reconcileAgentJobsForUser(userId, { projectId: activeBoundProjectId, limit: 2 });
    assert.ok(
      (await listLiveActionsForUser({ userId, projectId: activeBoundProjectId, limit: 2 }))
        .some((action) => action.source.id === freshestCancellationId),
      "active candidate recency includes durable cancellation requests",
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

    const staleWindowProjectId = `${marker}-stale-window-project`;
    const staleWindowIds = Array.from({ length: 3 }, (_, index) => `${marker}-stale-window-${index}`);
    await db.insert(schema.agentJobs).values(staleWindowIds.map((id, index) => ({
      id,
      userId,
      agentType: "research",
      title: `Stale window ${index}`,
      prompt: "Finish before the next filtered poll",
      input: { projectId: staleWindowProjectId },
      status: "running",
      createdAt: new Date(createdAt.getTime() + index * 1_000),
      startedAt: new Date(createdAt.getTime() + index * 1_000),
    })));
    await reconcileAgentJobsForUser(userId, { projectId: staleWindowProjectId, limit: 3 });
    await db.update(schema.agentJobs).set({ status: "complete", completedAt: new Date() })
      .where(inArray(schema.agentJobs.id, staleWindowIds));
    await reconcileAgentJobsForUser(userId, {
      status: "running",
      projectId: staleWindowProjectId,
      limit: 2,
    });
    assert.equal(
      (await listLiveActionsForUser({
        userId,
        status: "running",
        projectId: staleWindowProjectId,
        limit: 2,
      })).length,
      0,
      "status-filtered polling backfills after a full stale window leaves the result",
    );

    const cappedWindowProjectId = `${marker}-capped-window-project`;
    const cappedWindowJobs = await db.insert(schema.agentJobs).values(Array.from({ length: 11 }, (_, index) => ({
      id: `${marker}-capped-window-${index}`,
      userId,
      agentType: "research",
      title: `Capped stale window ${index}`,
      prompt: "Complete before a bounded filtered poll",
      input: { projectId: cappedWindowProjectId },
      status: "running",
      createdAt: new Date(createdAt.getTime() + index * 1_000),
      startedAt: new Date(createdAt.getTime() + index * 1_000),
    }))).returning();
    for (const cappedWindowJob of cappedWindowJobs) {
      await persistAgentJobProjection(projectAgentJob(cappedWindowJob));
    }
    await db.update(schema.agentJobs).set({ status: "complete", completedAt: new Date() })
      .where(inArray(schema.agentJobs.id, cappedWindowJobs.map((job) => job.id)));
    const cappedSnapshot = await liveActionReadService.getSnapshot({
      userId,
      status: "running",
      projectId: cappedWindowProjectId,
      limit: 1,
    });
    assert.equal(
      cappedSnapshot.actions.length,
      0,
      "a bounded reconciliation omits its unreconciled window instead of returning stale status",
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
    await reconcileAgentJobsForUser(userId, { limit: 100 });
    let oldAction = (await listLiveActionsForUser({ userId, limit: 100 }))
      .find((action) => action.source.id === oldJob.id);
    assert.equal(oldAction?.status, "running");

    await db.update(schema.agentJobs).set({ status: "complete", completedAt: new Date() })
      .where(eq(schema.agentJobs.id, oldJob.id));
    await reconcileAgentJobsForUser(userId, { limit: 100 });
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

    const expiredRetryRootId = `${marker}-expired-retry-root`;
    const [expiredRetryRoot] = await db.insert(schema.agentJobs).values({
      id: expiredRetryRootId,
      userId,
      agentType: "research",
      title: "Expired retry root",
      prompt: "Retry after retention",
      status: "complete",
      createdAt: expiredAt,
      completedAt: expiredAt,
    }).returning();
    const expiredRetryAction = await persistAgentJobProjection(projectAgentJob(expiredRetryRoot));
    assert.equal(await getLiveActionForUser(userId, expiredRetryAction.id), null);
    const activeRetryId = `${marker}-expired-retry-active`;
    await db.insert(schema.agentJobs).values({
      id: activeRetryId,
      userId,
      agentType: "research",
      title: "Active retry",
      prompt: "Revive retained detail",
      input: {
        retryOfJobId: expiredRetryRootId,
        liveActionLineageKey: expiredRetryRootId,
        retriedAt: new Date().toISOString(),
      },
      status: "queued",
      createdAt: new Date(),
    });
    const revivedDetail = await liveActionReadService.getDetail(userId, expiredRetryAction.id);
    assert.equal(revivedDetail?.action.source.id, activeRetryId, "detail reconciliation revives an expired retried lineage");
    assert.equal(await liveActionReadService.getDetail(otherUserId, expiredRetryAction.id), null);

    const [staleActiveJob] = await db.insert(schema.agentJobs).values({
      id: `${marker}-stale-active`,
      userId,
      agentType: "research",
      title: "Stale active projection",
      prompt: "Finish outside retention",
      status: "running",
      createdAt: expiredAt,
      startedAt: expiredAt,
    }).returning();
    await reconcileAgentJobsForUser(userId, { limit: 100 });
    const staleActiveAction = (await listLiveActionsForUser({ userId, limit: 100 }))
      .find((action) => action.source.id === staleActiveJob.id);
    assert.equal(staleActiveAction?.status, "running");
    await db.update(schema.agentJobs).set({ status: "complete", completedAt: expiredAt })
      .where(eq(schema.agentJobs.id, staleActiveJob.id));
    await reconcileAgentJobsForUser(userId, { limit: 100 });
    assert.equal(
      await getLiveActionForUser(userId, staleActiveAction!.id),
      null,
      "unfiltered reconciliation expires materialized active rows whose source finished outside retention",
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
