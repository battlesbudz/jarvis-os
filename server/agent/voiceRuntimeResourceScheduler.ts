import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { buildPendingVoiceRestorePayload, savePendingCoachResponse } from "../services/coachRuntimeState";
import { buildWorkerRuntimeEvent, resolveWorkerType, withWorkerRuntimeEvent } from "./workerRuntime";
import {
  RESOURCE_PAUSE_REASON,
  RESOURCE_PAUSE_STARTUP_RECOVERY_MS,
  RESOURCE_PAUSED_STATUS,
  buildVoiceRestorePrompt,
  buildVoiceRestoreRecap,
  buildVoiceRuntimeIncidentBundle,
  isLocalHeavyBackgroundJob,
  recordFromInput,
  resourcePauseMetadata,
  shouldAutoResumeResourcePausedJob,
  shouldRecoverStaleResourcePausedJob,
  type VoiceResourcePauseMetadata,
  type VoiceRuntimeIncidentBundle,
  type VoiceRuntimeJobSummary,
} from "./voiceRuntimeResourceCore";
export {
  RESOURCE_PAUSE_REASON,
  RESOURCE_PAUSED_STATUS,
  buildVoiceRestorePrompt,
  buildVoiceRestoreRecap,
  buildVoiceRuntimeIncidentBundle,
  buildVoiceRuntimeStatusAnswer,
  isLocalHeavyBackgroundJob,
  resourcePauseMetadata,
  shouldAutoResumeResourcePausedJob,
  shouldRecoverStaleResourcePausedJob,
} from "./voiceRuntimeResourceCore";

type AgentJobRow = typeof schema.agentJobs.$inferSelect;

const VOICE_RESOURCE_ACTIVE_TTL_MS = RESOURCE_PAUSE_STARTUP_RECOVERY_MS;
const activeVoiceResourceUsers = new Map<string, {
  action?: string;
  state?: string;
  updatedAt: string;
  expiresAt: string | null;
}>();

export function setVoiceRuntimeResourceActive(
  userId: string,
  active: boolean,
  opts: { action?: string; state?: string; now?: Date; ttlMs?: number | null } = {},
): void {
  if (!active) {
    activeVoiceResourceUsers.delete(userId);
    return;
  }
  const now = opts.now ?? new Date();
  const ttlMs = opts.ttlMs === undefined ? VOICE_RESOURCE_ACTIVE_TTL_MS : opts.ttlMs;
  activeVoiceResourceUsers.set(userId, {
    action: opts.action,
    state: opts.state,
    updatedAt: now.toISOString(),
    expiresAt: ttlMs === null ? null : new Date(now.getTime() + ttlMs).toISOString(),
  });
}

export function isVoiceRuntimeResourceActiveForUser(userId: string, now: Date = new Date()): boolean {
  const active = activeVoiceResourceUsers.get(userId);
  if (!active) return false;
  if (active.expiresAt === null) return true;
  const expiresAtMs = Date.parse(active.expiresAt);
  if (!Number.isFinite(expiresAtMs) || now.getTime() >= expiresAtMs) {
    activeVoiceResourceUsers.delete(userId);
    return false;
  }
  return true;
}

export function buildVoiceResourcePausedJobInput(opts: {
  agentType: string;
  input: Record<string, unknown>;
  pausedAt: string;
}): Record<string, unknown> {
  const workerType = resolveWorkerType({ agentType: opts.agentType, input: opts.input });
  return withWorkerRuntimeEvent(
    {
      ...opts.input,
      resourcePause: {
        reason: RESOURCE_PAUSE_REASON,
        pausedBy: "voice_runtime",
        pausedAt: opts.pausedAt,
      } satisfies VoiceResourcePauseMetadata,
    },
    buildWorkerRuntimeEvent({
      type: "progress",
      workerType,
      message: "Paused while local voice is active.",
      userVisible: true,
      progress: { currentStep: "Paused for voice stability" },
      metadata: { reason: RESOURCE_PAUSE_REASON },
    }),
  );
}

function withResourcePauseEvent(job: AgentJobRow, pausedAt: string): Record<string, unknown> {
  return buildVoiceResourcePausedJobInput({
    agentType: job.agentType,
    input: recordFromInput(job.input),
    pausedAt,
  });
}

function withResourcePauseHeartbeat(job: AgentJobRow, pausedAt: string): Record<string, unknown> {
  const input = recordFromInput(job.input);
  const pause = resourcePauseMetadata(input);
  return {
    ...input,
    resourcePause: {
      reason: RESOURCE_PAUSE_REASON,
      pausedBy: pause?.pausedBy ?? "voice_runtime",
      pausedAt,
    } satisfies VoiceResourcePauseMetadata,
  };
}

function withResourceResumeEvent(job: AgentJobRow, resumedAt: string): Record<string, unknown> {
  const input = recordFromInput(job.input);
  const workerType = resolveWorkerType({ agentType: job.agentType, input });
  const pause = resourcePauseMetadata(input);
  return withWorkerRuntimeEvent(
    {
      ...input,
      resourcePause: pause ? { ...pause, resumedAt } : undefined,
    },
    buildWorkerRuntimeEvent({
      type: "progress",
      workerType,
      message: "Resumed after the local voice session ended.",
      userVisible: true,
      progress: { currentStep: "Resumed" },
      metadata: { reason: RESOURCE_PAUSE_REASON },
    }),
  );
}

export async function pauseQueuedLocalHeavyJobsForVoice(
  userId: string,
  opts: { now?: Date; notifyWaitingUser?: boolean } = {},
): Promise<AgentJobRow[]> {
  const now = opts.now ?? new Date();
  const pausedAt = now.toISOString();
  const [candidates, pausedCandidates] = await Promise.all([
    db
      .select()
      .from(schema.agentJobs)
      .where(and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, "queued"))),
    db
      .select()
      .from(schema.agentJobs)
      .where(and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, RESOURCE_PAUSED_STATUS))),
  ]);

  const pauseable = candidates.filter(isLocalHeavyBackgroundJob);
  const refreshable = pausedCandidates.filter(shouldAutoResumeResourcePausedJob);
  const paused: AgentJobRow[] = [];
  for (const job of pauseable) {
    const input = withResourcePauseEvent(job, pausedAt);
    const updated = await db
      .update(schema.agentJobs)
      .set({
        status: RESOURCE_PAUSED_STATUS,
        input,
        error: null,
      })
      .where(and(eq(schema.agentJobs.id, job.id), eq(schema.agentJobs.status, "queued")))
      .returning();
    if (updated[0]) paused.push(updated[0]);
  }
  for (const job of refreshable) {
    await db
      .update(schema.agentJobs)
      .set({
        input: withResourcePauseHeartbeat(job, pausedAt),
        error: null,
      })
      .where(and(eq(schema.agentJobs.id, job.id), eq(schema.agentJobs.status, RESOURCE_PAUSED_STATUS)));
  }

  if (paused.length > 0) {
    await diagEmit({
      userId,
      subsystem: "job_queue",
      severity: "info",
      message: `Paused ${paused.length} local-heavy job(s) while local voice is active.`,
      metadata: {
        type: "resource_pause",
        reason: RESOURCE_PAUSE_REASON,
        jobIds: paused.map((job) => job.id),
      },
    }).catch(() => {});

    if (opts.notifyWaitingUser) {
      const names = paused.map((job) => job.title).slice(0, 3).join(", ");
      await savePendingCoachResponse(
        userId,
        `I paused ${names || "a background task"} while this voice call is active so the local model stays responsive. I will resume it when the call ends.`,
      ).catch(() => {});
    }
  }

  return paused;
}

export async function resumeResourcePausedJobsAfterVoice(
  userId: string,
  opts: { now?: Date } = {},
): Promise<AgentJobRow[]> {
  const now = opts.now ?? new Date();
  const resumedAt = now.toISOString();
  const candidates = await db
    .select()
    .from(schema.agentJobs)
    .where(and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, RESOURCE_PAUSED_STATUS)));

  const resumable = candidates.filter(shouldAutoResumeResourcePausedJob);
  const resumed: AgentJobRow[] = [];
  for (const job of resumable) {
    const input = withResourceResumeEvent(job, resumedAt);
    const updated = await db
      .update(schema.agentJobs)
      .set({
        status: "queued",
        startedAt: null,
        input,
        error: null,
      })
      .where(and(eq(schema.agentJobs.id, job.id), eq(schema.agentJobs.status, RESOURCE_PAUSED_STATUS)))
      .returning();
    if (updated[0]) resumed.push(updated[0]);
  }

  if (resumed.length > 0) {
    await diagEmit({
      userId,
      subsystem: "job_queue",
      severity: "info",
      message: `Resumed ${resumed.length} resource-paused job(s) after local voice ended.`,
      metadata: {
        type: "resource_resume",
        reason: RESOURCE_PAUSE_REASON,
        jobIds: resumed.map((job) => job.id),
        recovery: true,
      },
    }).catch(() => {});
  }

  return resumed;
}

export async function recoverStaleResourcePausedJobsAfterVoice(opts: { now?: Date } = {}): Promise<AgentJobRow[]> {
  const now = opts.now ?? new Date();
  const recoveredAt = now.toISOString();
  const candidates = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.status, RESOURCE_PAUSED_STATUS));

  const recoverable = candidates.filter((job) =>
    !isVoiceRuntimeResourceActiveForUser(job.userId, now) && shouldRecoverStaleResourcePausedJob(job, now)
  );
  const recovered: AgentJobRow[] = [];
  for (const job of recoverable) {
    const pause = resourcePauseMetadata(recordFromInput(job.input));
    if (!pause?.pausedAt) continue;
    const input = withResourceResumeEvent(job, recoveredAt);
    const updated = await db
      .update(schema.agentJobs)
      .set({
        status: "queued",
        startedAt: null,
        input,
        error: null,
      })
      .where(
        and(
          eq(schema.agentJobs.id, job.id),
          eq(schema.agentJobs.status, RESOURCE_PAUSED_STATUS),
          sql`${schema.agentJobs.input}->'resourcePause'->>'pausedAt' = ${pause.pausedAt}`,
        ),
      )
      .returning();
    if (updated[0]) recovered.push(updated[0]);
  }

  if (recovered.length > 0) {
    const recoveredByUser = new Map<string, AgentJobRow[]>();
    for (const job of recovered) {
      recoveredByUser.set(job.userId, [...(recoveredByUser.get(job.userId) ?? []), job]);
    }
    for (const [userId, jobs] of recoveredByUser) {
      await diagEmit({
        userId,
        subsystem: "job_queue",
        severity: "info",
        message: `Recovered ${jobs.length} stale voice-paused job(s).`,
        metadata: { type: "resource_resume", reason: RESOURCE_PAUSE_REASON, recovered: true, jobIds: jobs.map((job) => job.id) },
      }).catch(() => {});
    }
  }

  return recovered;
}

export async function recordUnexpectedVoiceSessionEnd(input: {
  userId: string;
  now?: Date;
  lastState?: string;
  lastAction?: string;
  transcript?: string;
  activeTaskTitle?: string;
}): Promise<VoiceRuntimeIncidentBundle> {
  const bundle = buildVoiceRuntimeIncidentBundle(input);
  await diagEmit({
    userId: input.userId,
    subsystem: "integration",
    severity: "error",
    message: "Local voice session ended unexpectedly.",
    metadata: {
      type: "voice_runtime_incident",
      incident: bundle,
    },
  }).catch(() => {});
  const prompt = buildVoiceRestorePrompt(bundle);
  await savePendingCoachResponse(input.userId, prompt, undefined, {
    voiceRestore: buildPendingVoiceRestorePayload({
      incident: bundle,
      prompt,
      recap: buildVoiceRestoreRecap(bundle),
    }),
  }).catch(() => {});
  return bundle;
}

export async function listVoiceRuntimeJobs(userId: string): Promise<VoiceRuntimeJobSummary[]> {
  return db
    .select({
      id: schema.agentJobs.id,
      title: schema.agentJobs.title,
      status: schema.agentJobs.status,
    })
    .from(schema.agentJobs)
    .where(and(
      eq(schema.agentJobs.userId, userId),
      inArray(schema.agentJobs.status, ["queued", "running", "cancelling", RESOURCE_PAUSED_STATUS]),
    ));
}
