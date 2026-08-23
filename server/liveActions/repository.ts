import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { LiveAction, LiveActionEvent, LiveActionStatus } from "@shared/liveActions";
import { db } from "../db";
import { getWorkerRuntimeFromInput } from "../agent/workerRuntime";
import { projectAgentJob, type AgentJobLiveActionProjection } from "./adapters/agentJob";
import { agentJobLineageKey, agentJobRetryGeneration, loadAgentJobRetryFamily } from "./agentJobLineage";

const ACTIVE_STATUSES: LiveActionStatus[] = ["created", "queued", "running", "waiting_approval", "waiting_user", "paused"];
const ACTIVE_AGENT_JOB_STATUSES = ["queued", "running", "cancelling", "resource_paused"];
const MAX_EVENTS_PER_ACTION = 200;

function sourceStatusesFor(status: LiveActionStatus): string[] {
  switch (status) {
    case "queued": return ["queued"];
    case "running": return ["running", "cancelling"];
    case "waiting_approval": return ["running"];
    case "paused": return ["resource_paused"];
    case "succeeded": return ["complete", "delivered"];
    case "failed": return ["failed"];
    case "cancelled": return ["cancelled"];
    default: return [];
  }
}

function dateIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function rowToAction(row: schema.LiveActionRow): LiveAction {
  return {
    id: row.id,
    projectId: row.projectId,
    parentActionId: row.parentActionId,
    source: {
      type: "agent_job",
      id: row.sourceId,
      lineageType: "agent_job",
      lineageKey: row.sourceLineageKey,
    },
    kind: row.kind,
    title: row.title,
    status: row.status as LiveActionStatus,
    version: row.version,
    progress: row.currentStep && row.progressUpdatedAt
      ? {
          kind: row.progressKind as "indeterminate" | "percent",
          currentStep: row.currentStep,
          value: row.progressValue,
          updatedAt: row.progressUpdatedAt.toISOString(),
        }
      : null,
    attention: row.attention ?? null,
    capabilities: row.controlCapabilities,
    artifacts: row.artifactRefs,
    error: row.errorCategory && row.errorSummary
      ? { category: row.errorCategory, summary: row.errorSummary, retryEligible: row.retryEligible }
      : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: dateIso(row.startedAt),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: dateIso(row.completedAt),
  };
}

function rowToEvent(row: schema.LiveActionEventRow): LiveActionEvent {
  return {
    id: row.id,
    actionId: row.actionId,
    sequence: row.sequence,
    type: row.eventType as LiveActionEvent["type"],
    message: row.message,
    safeMetadata: row.safeMetadata,
    userVisible: row.userVisible,
    createdAt: row.createdAt.toISOString(),
  };
}

function projectionValues(projection: AgentJobLiveActionProjection) {
  const updatedAt = new Date(Math.max(
    projection.createdAt.getTime(),
    projection.startedAt?.getTime() ?? 0,
    projection.completedAt?.getTime() ?? 0,
    ...projection.events.map((event) => event.createdAt.getTime()),
  ));
  return {
    userId: projection.userId,
    projectId: projection.projectId,
    lineageType: projection.lineageType,
    sourceLineageKey: projection.sourceLineageKey,
    sourceType: projection.sourceType,
    sourceId: projection.sourceId,
    kind: projection.kind,
    title: projection.title,
    status: projection.status,
    currentStep: projection.progress?.currentStep ?? null,
    progressKind: projection.progress?.kind ?? "indeterminate",
    progressValue: projection.progress?.value ?? null,
    progressUpdatedAt: projection.progress ? new Date(projection.progress.updatedAt) : null,
    attention: projection.attention,
    controlCapabilities: projection.capabilities,
    artifactRefs: projection.artifacts,
    errorCategory: projection.error?.category ?? null,
    errorSummary: projection.error?.summary ?? null,
    retryEligible: projection.error?.retryEligible ?? false,
    createdAt: projection.createdAt,
    startedAt: projection.startedAt,
    updatedAt,
    completedAt: projection.completedAt,
  };
}

function mutableProjectionValues(values: ReturnType<typeof projectionValues>) {
  const { userId: _userId, lineageType: _lineageType, sourceLineageKey: _sourceLineageKey, createdAt: _createdAt, ...mutable } = values;
  return mutable;
}

function projectionValuesMatch(
  left: ReturnType<typeof projectionValues>,
  right: ReturnType<typeof projectionValues>,
): boolean {
  return JSON.stringify(mutableProjectionValues(left)) === JSON.stringify(mutableProjectionValues(right));
}

function projectionChanged(row: schema.LiveActionRow, values: ReturnType<typeof projectionValues>): boolean {
  return row.projectId !== values.projectId
    || row.sourceId !== values.sourceId
    || row.kind !== values.kind
    || row.title !== values.title
    || row.status !== values.status
    || row.currentStep !== values.currentStep
    || row.progressKind !== values.progressKind
    || row.progressValue !== values.progressValue
    || row.progressUpdatedAt?.getTime() !== values.progressUpdatedAt?.getTime()
    || JSON.stringify(row.attention) !== JSON.stringify(values.attention)
    || JSON.stringify(row.controlCapabilities) !== JSON.stringify(values.controlCapabilities)
    || JSON.stringify(row.artifactRefs) !== JSON.stringify(values.artifactRefs)
    || row.errorCategory !== values.errorCategory
    || row.errorSummary !== values.errorSummary
    || row.retryEligible !== values.retryEligible
    || row.startedAt?.getTime() !== values.startedAt?.getTime()
    || row.updatedAt.getTime() !== values.updatedAt.getTime()
    || row.completedAt?.getTime() !== values.completedAt?.getTime();
}

export async function persistAgentJobProjection(projection: AgentJobLiveActionProjection): Promise<LiveAction> {
  return db.transaction(async (tx) => {
    const lockKey = `${projection.userId}:${projection.lineageType}:${projection.sourceLineageKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    let [row] = await tx
      .select()
      .from(schema.liveActions)
      .where(and(
        eq(schema.liveActions.userId, projection.userId),
        eq(schema.liveActions.lineageType, projection.lineageType),
        eq(schema.liveActions.sourceLineageKey, projection.sourceLineageKey),
      ))
      .limit(1);
    const values = projectionValues(projection);

    const wasInserted = !row;
    if (!row) {
      [row] = await tx.insert(schema.liveActions).values(values).returning();
    }
    if (!row) throw new Error("Live Action projection insert returned no row");

    const existingEvents = await tx
      .select({ sourceEventKey: schema.liveActionEvents.sourceEventKey })
      .from(schema.liveActionEvents)
      .where(eq(schema.liveActionEvents.actionId, row.id));
    const existingKeys = new Set(existingEvents.map((event) => event.sourceEventKey));
    const newEvents = projection.events.filter((event) => !existingKeys.has(event.sourceEventKey));
    let insertedEventCount = 0;

    if (newEvents.length > 0) {
      const [maxSequence] = await tx
        .select({ value: sql<number>`coalesce(max(${schema.liveActionEvents.sequence}), 0)::int` })
        .from(schema.liveActionEvents)
        .where(eq(schema.liveActionEvents.actionId, row.id));
      const inserted = await tx.insert(schema.liveActionEvents).values(newEvents.map((event, index) => ({
        actionId: row!.id,
        sequence: (maxSequence?.value ?? 0) + index + 1,
        sourceEventKey: event.sourceEventKey,
        eventType: event.type,
        message: event.message,
        safeMetadata: event.safeMetadata,
        userVisible: event.userVisible,
        createdAt: event.createdAt,
      }))).onConflictDoNothing().returning({ id: schema.liveActionEvents.id });
      insertedEventCount = inserted.length;
    }

    if (!wasInserted) {
      const sameTimestampConflict = row.updatedAt.getTime() === values.updatedAt.getTime()
        && projectionChanged(row, values);
      const canonicalAttempt = sameTimestampConflict
        ? await tx.execute(sql`
            WITH RECURSIVE retry_family AS (
              SELECT job.id, job.created_at, 0 AS generation, ARRAY[job.id]::varchar[] AS path
              FROM agent_jobs job
              WHERE job.user_id = ${projection.userId}
                AND (
                  job.id = ${projection.sourceLineageKey}
                  OR (
                    (job.id = ${projection.sourceId} OR job.id = ${row.sourceId})
                    AND NOT EXISTS (
                      SELECT 1 FROM agent_jobs parent
                      WHERE parent.user_id = ${projection.userId}
                        AND parent.id = job.input->>'retryOfJobId'
                    )
                  )
                )
              UNION ALL
              SELECT child.id, child.created_at, parent.generation + 1, parent.path || child.id
              FROM agent_jobs child
              JOIN retry_family parent ON child.input->>'retryOfJobId' = parent.id
              WHERE child.user_id = ${projection.userId}
                AND NOT child.id = ANY(parent.path)
            )
            SELECT id FROM retry_family ORDER BY generation DESC, created_at DESC, id DESC LIMIT 1
          `)
        : null;
      const canonicalJobId = (canonicalAttempt?.rows?.[0] as { id?: unknown } | undefined)?.id;
      const [canonicalJob] = typeof canonicalJobId === "string"
        ? await tx.select().from(schema.agentJobs).where(and(
            eq(schema.agentJobs.id, canonicalJobId),
            eq(schema.agentJobs.userId, projection.userId),
          )).limit(1).for("update")
        : [];
      const canonicalInput = canonicalJob?.input && typeof canonicalJob.input === "object" && !Array.isArray(canonicalJob.input)
        ? canonicalJob.input as Record<string, unknown>
        : {};
      const canonicalGateIds = canonicalJob
        ? [...new Set(getWorkerRuntimeFromInput(canonicalInput)?.approvalCheckpoints.flatMap((checkpoint) =>
            checkpoint.gateId ? [checkpoint.gateId] : []) ?? [])]
        : [];
      const canonicalGates = canonicalGateIds.length > 0
        ? await tx.select({
            id: schema.agentApprovalGates.id,
            status: schema.agentApprovalGates.status,
            resolvedAt: schema.agentApprovalGates.resolvedAt,
          }).from(schema.agentApprovalGates).where(and(
            eq(schema.agentApprovalGates.userId, projection.userId),
            inArray(schema.agentApprovalGates.id, canonicalGateIds),
          )).for("update")
        : [];
      const canonicalPendingGateIds = new Set(canonicalGates
        .filter((gate) => gate.status === "pending")
        .map((gate) => gate.id));
      const canonicalValues = canonicalJob
        ? projectionValues(projectAgentJob(
            canonicalJob,
            canonicalPendingGateIds,
            projection.sourceLineageKey,
            new Map(canonicalGates.map((gate) => [gate.id, gate])),
          ))
        : null;
      const staleProjection = row.updatedAt.getTime() > values.updatedAt.getTime()
        || (sameTimestampConflict && (!canonicalValues || !projectionValuesMatch(values, canonicalValues)));
      if (!staleProjection && (projectionChanged(row, values) || insertedEventCount > 0)) {
        [row] = await tx
          .update(schema.liveActions)
          .set({ ...mutableProjectionValues(values), version: row.version + 1 })
          .where(eq(schema.liveActions.id, row.id))
          .returning();
      } else if (staleProjection && insertedEventCount > 0) {
        [row] = await tx
          .update(schema.liveActions)
          .set({ version: row.version + 1 })
          .where(eq(schema.liveActions.id, row.id))
          .returning();
      }
    }
    if (!row) throw new Error("Live Action projection update returned no row");

    await tx.execute(sql`
      DELETE FROM live_action_events
      WHERE action_id = ${row.id}
        AND id NOT IN (
          SELECT id FROM live_action_events
          WHERE action_id = ${row.id}
          ORDER BY created_at DESC, source_event_key DESC
          LIMIT ${MAX_EVENTS_PER_ACTION}
        )
    `);
    await tx.execute(sql`
      UPDATE live_action_events
      SET sequence = -sequence
      WHERE action_id = ${row.id}
    `);
    await tx.execute(sql`
      WITH ordered_events AS (
        SELECT id, row_number() OVER (ORDER BY created_at, source_event_key)::int AS sequence
        FROM live_action_events
        WHERE action_id = ${row.id}
      )
      UPDATE live_action_events event
      SET sequence = ordered_events.sequence
      FROM ordered_events
      WHERE event.id = ordered_events.id
    `);
    return rowToAction(row);
  });
}

export async function reconcileAgentJobsForUser(userId: string, opts: {
  sourceLineageKey?: string;
  status?: LiveActionStatus;
  projectId?: string;
  limit?: number;
} = {}): Promise<void> {
  const terminalCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const lineageCondition = opts.sourceLineageKey
    ? or(
        eq(schema.agentJobs.id, opts.sourceLineageKey),
        sql`${schema.agentJobs.input}->>'liveActionLineageKey' = ${opts.sourceLineageKey}`,
        sql`${schema.agentJobs.input}->>'retryOfJobId' = ${opts.sourceLineageKey}`,
      )
    : undefined;
  const scope = [eq(schema.agentJobs.userId, userId)];
  if (lineageCondition) scope.push(lineageCondition);
  if (opts.projectId) scope.push(sql`${schema.agentJobs.input}->>'projectId' = ${opts.projectId}`);
  const sourceStatuses = opts.status ? sourceStatusesFor(opts.status) : [];
  const filteredScope = sourceStatuses.length > 0
    ? [...scope, inArray(schema.agentJobs.status, sourceStatuses)]
    : opts.status ? [...scope, sql`false`] : scope;
  const projectedActionConditions = opts.status
    ? [
        eq(schema.liveActions.userId, userId),
        eq(schema.liveActions.status, opts.status),
        or(
          inArray(schema.liveActions.status, ACTIVE_STATUSES),
          gte(schema.liveActions.completedAt, terminalCutoff),
        )!,
        ...(opts.projectId ? [eq(schema.liveActions.projectId, opts.projectId)] : []),
        ...(opts.sourceLineageKey ? [eq(schema.liveActions.sourceLineageKey, opts.sourceLineageKey)] : []),
      ]
    : [];
  const matchingProjectedActions: Array<{ id: string; sourceId: string; updatedAt: Date }> = [];
  if (projectedActionConditions.length > 0) {
    let cursor: { id: string; updatedAt: Date } | undefined;
    do {
      const page = await db.select({
        id: schema.liveActions.id,
        sourceId: schema.liveActions.sourceId,
        updatedAt: schema.liveActions.updatedAt,
      }).from(schema.liveActions)
        .where(and(
          ...projectedActionConditions,
          ...(cursor ? [or(
            lt(schema.liveActions.updatedAt, cursor.updatedAt),
            and(eq(schema.liveActions.updatedAt, cursor.updatedAt), lt(schema.liveActions.id, cursor.id)),
          )!] : []),
        ))
        .orderBy(desc(schema.liveActions.updatedAt), desc(schema.liveActions.id))
        .limit(500);
      matchingProjectedActions.push(...page);
      cursor = page.length === 500 ? page.at(-1) : undefined;
    } while (cursor);
  }
  const [activeJobs] = await Promise.all([
    db.select().from(schema.agentJobs).where(and(
      ...scope,
      inArray(schema.agentJobs.status, ACTIVE_AGENT_JOB_STATUSES),
    )),
  ]);
  const retainedJobs: Array<typeof schema.agentJobs.$inferSelect> = [];
  const sourceUpdatedAt = sql<Date>`greatest(${schema.agentJobs.createdAt}, coalesce(${schema.agentJobs.completedAt}, ${schema.agentJobs.createdAt}))`;
  const targetLineages = opts.sourceLineageKey ? 1 : Math.min(Math.max(opts.limit ?? 25, 1), 100);
  let sourceCursor: { id: string; updatedAt: Date } | undefined;
  do {
    const page = await db.select({
      job: schema.agentJobs,
      updatedAt: sourceUpdatedAt,
    }).from(schema.agentJobs).where(and(
      ...filteredScope,
      or(
        gte(schema.agentJobs.createdAt, terminalCutoff),
        gte(schema.agentJobs.completedAt, terminalCutoff),
      ),
      ...(sourceCursor ? [or(
        lt(sourceUpdatedAt, sourceCursor.updatedAt),
        and(eq(sourceUpdatedAt, sourceCursor.updatedAt), lt(schema.agentJobs.id, sourceCursor.id)),
      )!] : []),
    )).orderBy(desc(sourceUpdatedAt), desc(schema.agentJobs.id)).limit(500);
    retainedJobs.push(...page.map((entry) => entry.job));
    if (page.length < 500) break;
    const retainedTerminalJobs = retainedJobs.filter((job) => !ACTIVE_AGENT_JOB_STATUSES.includes(job.status));
    const discoveredFamily = await loadAgentJobRetryFamily(userId, retainedTerminalJobs);
    const discoveredTerminalLineages = new Set(retainedTerminalJobs
      .map((job) => agentJobLineageKey(job, discoveredFamily)));
    if (!opts.status && discoveredTerminalLineages.size >= targetLineages) break;
    const last = page.at(-1)!;
    sourceCursor = { id: last.job.id, updatedAt: last.updatedAt };
  } while (sourceCursor);
  const projectedSourceIds = [...new Set(matchingProjectedActions.map((action) => action.sourceId))];
  const projectedJobs: Array<typeof schema.agentJobs.$inferSelect> = [];
  for (let index = 0; index < projectedSourceIds.length; index += 500) {
    projectedJobs.push(...await db.select().from(schema.agentJobs).where(and(
        eq(schema.agentJobs.userId, userId),
        inArray(schema.agentJobs.id, projectedSourceIds.slice(index, index + 500)),
      )));
  }
  const filteredLineageKeys = opts.status
    ? [...new Set(retainedJobs.map((job) => projectAgentJob(job).sourceLineageKey))]
    : [];
  const lineageJobs = filteredLineageKeys.length > 0
    ? await db.select().from(schema.agentJobs).where(and(
        eq(schema.agentJobs.userId, userId),
        or(
          inArray(schema.agentJobs.id, filteredLineageKeys),
          inArray(sql<string>`${schema.agentJobs.input}->>'liveActionLineageKey'`, filteredLineageKeys),
          inArray(sql<string>`${schema.agentJobs.input}->>'retryOfJobId'`, filteredLineageKeys),
        ),
        or(
          inArray(schema.agentJobs.status, ["queued", "running", "cancelling", "resource_paused"]),
          gte(schema.agentJobs.createdAt, terminalCutoff),
          gte(schema.agentJobs.completedAt, terminalCutoff),
        ),
      ))
    : [];
  const seedJobs = [...new Map([
    ...activeJobs,
    ...retainedJobs,
    ...lineageJobs,
    ...projectedJobs,
  ].map((job) => [job.id, job])).values()];
  const descendantRoots = opts.sourceLineageKey
    ? [opts.sourceLineageKey]
    : opts.status ? filteredLineageKeys : [];
  const jobsById = await loadAgentJobRetryFamily(userId, seedJobs, descendantRoots);
  const jobs = [...jobsById.values()];
  const retryGenerations = new Map(jobs.map((job) => [job.id, agentJobRetryGeneration(job, jobsById)]));
  const approvalGateIds = [...new Set(jobs.flatMap((job) => {
    const input = job.input && typeof job.input === "object" && !Array.isArray(job.input)
      ? job.input as Record<string, unknown>
      : {};
    return getWorkerRuntimeFromInput(input)?.approvalCheckpoints.flatMap((checkpoint) =>
      checkpoint.gateId ? [checkpoint.gateId] : []) ?? [];
  }))];
  const approvalGates = approvalGateIds.length > 0
    ? await db.select({
        id: schema.agentApprovalGates.id,
        status: schema.agentApprovalGates.status,
        resolvedAt: schema.agentApprovalGates.resolvedAt,
      }).from(schema.agentApprovalGates).where(and(
        eq(schema.agentApprovalGates.userId, userId),
        inArray(schema.agentApprovalGates.id, approvalGateIds),
      ))
    : [];
  const pendingGateIds = new Set(approvalGates.filter((gate) => gate.status === "pending").map((gate) => gate.id));
  const approvalGatesById = new Map(approvalGates.map((gate) => [gate.id, gate]));

  const grouped = new Map<string, AgentJobLiveActionProjection[]>();
  for (const job of jobs) {
    const projection = projectAgentJob(job, pendingGateIds, agentJobLineageKey(job, jobsById), approvalGatesById);
    const group = grouped.get(projection.sourceLineageKey) ?? [];
    group.push(projection);
    grouped.set(projection.sourceLineageKey, group);
  }

  const groups = [...grouped.values()];
  for (let index = 0; index < groups.length; index += 8) {
    await Promise.all(groups.slice(index, index + 8).map(async (group) => {
      group.sort((a, b) => (retryGenerations.get(a.sourceId) ?? 0) - (retryGenerations.get(b.sourceId) ?? 0)
        || a.createdAt.getTime() - b.createdAt.getTime()
        || a.sourceId.localeCompare(b.sourceId));
      const latest = group.at(-1)!;
      const eventsBySourceKey = new Map(group
        .flatMap((projection) => projection.events)
        .map((event) => [event.sourceEventKey, event]));
      latest.events = [...eventsBySourceKey.values()]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.sourceEventKey.localeCompare(b.sourceEventKey))
        .slice(-MAX_EVENTS_PER_ACTION);
      await persistAgentJobProjection(latest);
    }));
  }
}

export async function listLiveActionsForUser(opts: {
  userId: string;
  status?: LiveActionStatus;
  projectId?: string;
  limit?: number;
}): Promise<LiveAction[]> {
  const conditions = [eq(schema.liveActions.userId, opts.userId)];
  const terminalCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  conditions.push(or(
    inArray(schema.liveActions.status, ACTIVE_STATUSES),
    gte(schema.liveActions.completedAt, terminalCutoff),
  )!);
  if (opts.status) conditions.push(eq(schema.liveActions.status, opts.status));
  if (opts.projectId) conditions.push(eq(schema.liveActions.projectId, opts.projectId));
  const rows = await db
    .select()
    .from(schema.liveActions)
    .where(and(...conditions))
    .orderBy(desc(schema.liveActions.updatedAt))
    .limit(Math.min(Math.max(opts.limit ?? 25, 1), 100));
  return rows.map(rowToAction);
}

export async function getLiveActionForUser(userId: string, actionId: string): Promise<LiveAction | null> {
  const terminalCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const [row] = await db
    .select()
    .from(schema.liveActions)
    .where(and(
      eq(schema.liveActions.id, actionId),
      eq(schema.liveActions.userId, userId),
      or(
        inArray(schema.liveActions.status, ACTIVE_STATUSES),
        gte(schema.liveActions.completedAt, terminalCutoff),
      ),
    ))
    .limit(1);
  return row ? rowToAction(row) : null;
}

export async function listLiveActionEvents(actionId: string): Promise<LiveActionEvent[]> {
  const rows = await db
    .select()
    .from(schema.liveActionEvents)
    .where(eq(schema.liveActionEvents.actionId, actionId))
    .orderBy(schema.liveActionEvents.sequence);
  return rows.map(rowToEvent);
}

export const liveActionActiveStatuses = ACTIVE_STATUSES;
