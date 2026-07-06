import { getWorkerRuntimeFromInput, resolveWorkerType, type CloudWorkerType, type WorkerApprovalCheckpoint, type WorkerProgressState } from "./workerRuntime";

type Jsonish = unknown;

export interface ObservableJobRow {
  id: string;
  userId?: string | null;
  agentType: string;
  title: string;
  prompt?: string;
  input: unknown;
  status: string;
  result?: Jsonish | null;
  error?: string | null;
  turns?: number | null;
  toolCallsCount?: number | null;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}

export interface ObservableDiagnosticEvent {
  id: string;
  userId?: string | null;
  subsystem: string;
  severity: string;
  message: string;
  metadata?: unknown;
  resolved?: boolean;
  createdAt: Date | string;
}

export interface DecoratedObservableJob {
  id: string;
  agentType: string;
  workerType: CloudWorkerType | null;
  title: string;
  input: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  ageMs: number;
  runtimeMs: number | null;
  retryCount: number;
  lastError: string | null;
  resultPreview: string | null;
  turns: number;
  toolCallsCount: number;
  progress: WorkerProgressState | null;
  approvalCheckpoints: WorkerApprovalCheckpoint[];
  userVisibleEventCount: number;
}

export interface JobRunnerObservabilityReport {
  generatedAt: string;
  summary: {
    total: number;
    byStatus: Record<string, number>;
    activeCount: number;
    recentFailureCount: number;
    oldestQueuedAgeMs: number | null;
  };
  activeJobs: DecoratedObservableJob[];
  recentJobs: DecoratedObservableJob[];
  diagnosticEvents: {
    id: string;
    subsystem: string;
    severity: string;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }[];
}

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "resource_paused"]);
const RECENT_STATUSES = new Set(["complete", "failed", "cancelled", "delivered"]);
const PREVIEW_LIMIT = 240;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ageSince(value: Date | string | null | undefined, now: Date): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.max(0, now.getTime() - date.getTime());
}

function previewResult(result: Jsonish | null | undefined): string | null {
  if (result == null) return null;
  const raw = typeof result === "string" ? result : JSON.stringify(result);
  if (!raw) return null;
  return raw.length > PREVIEW_LIMIT ? `${raw.slice(0, PREVIEW_LIMIT)}...` : raw;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function retryCountFromInput(input: unknown): number {
  const retryCount = objectRecord(input)?.retryCount;
  return typeof retryCount === "number" && Number.isFinite(retryCount) && retryCount > 0
    ? Math.floor(retryCount)
    : 0;
}

function throttleCountFromInput(input: unknown): number {
  const throttleCount = objectRecord(input)?.providerThrottleCount;
  return typeof throttleCount === "number" && Number.isFinite(throttleCount) && throttleCount > 0
    ? Math.floor(throttleCount)
    : 0;
}

function isProviderThrottle(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return lower.includes("429") || lower.includes("rate limit") || lower.includes("tokens per minute");
}

export function decorateJobForObservability(job: ObservableJobRow, now = new Date()): DecoratedObservableJob {
  const createdAt = toDate(job.createdAt) ?? now;
  const startedAt = toDate(job.startedAt);
  const completedAt = toDate(job.completedAt);
  const runtimeEnd = completedAt ?? (job.status === "running" || job.status === "cancelling" ? now : null);
  const runtimeMs = startedAt && runtimeEnd ? Math.max(0, runtimeEnd.getTime() - startedAt.getTime()) : null;
  const input = objectRecord(job.input);
  const workerRuntime = getWorkerRuntimeFromInput(input ?? undefined);

  return {
    id: job.id,
    agentType: job.agentType,
    workerType: workerRuntime?.workerType ?? resolveWorkerType({ agentType: job.agentType, input }),
    title: job.title,
    input,
    status: job.status,
    createdAt: createdAt.toISOString(),
    startedAt: startedAt ? startedAt.toISOString() : null,
    completedAt: completedAt ? completedAt.toISOString() : null,
    ageMs: ageSince(createdAt, now) ?? 0,
    runtimeMs,
    retryCount: retryCountFromInput(input),
    lastError: job.error ?? null,
    resultPreview: previewResult(job.result),
    turns: job.turns ?? 0,
    toolCallsCount: job.toolCallsCount ?? 0,
    progress: workerRuntime?.progress ?? null,
    approvalCheckpoints: workerRuntime?.approvalCheckpoints ?? [],
    userVisibleEventCount: workerRuntime?.events.filter((event) => event.userVisible).length ?? 0,
  };
}

export function buildJobRunnerObservability(opts: {
  jobs: ObservableJobRow[];
  diagnosticEvents: ObservableDiagnosticEvent[];
  now?: Date;
  activeLimit?: number;
  recentLimit?: number;
}): JobRunnerObservabilityReport {
  const now = opts.now ?? new Date();
  const byStatus: Record<string, number> = {};
  let oldestQueuedAgeMs: number | null = null;

  const decorated = opts.jobs.map((job) => {
    byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    if (job.status === "queued") {
      const ageMs = ageSince(job.createdAt, now);
      if (ageMs != null && (oldestQueuedAgeMs == null || ageMs > oldestQueuedAgeMs)) {
        oldestQueuedAgeMs = ageMs;
      }
    }
    return decorateJobForObservability(job, now);
  });

  const activeLimit = opts.activeLimit ?? 20;
  const recentLimit = opts.recentLimit ?? 20;

  return {
    generatedAt: now.toISOString(),
    summary: {
      total: opts.jobs.length,
      byStatus,
      activeCount: decorated.filter((job) => ACTIVE_STATUSES.has(job.status)).length,
      recentFailureCount: decorated.filter((job) => job.status === "failed").length,
      oldestQueuedAgeMs,
    },
    activeJobs: decorated
      .filter((job) => ACTIVE_STATUSES.has(job.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, activeLimit),
    recentJobs: decorated
      .filter((job) => RECENT_STATUSES.has(job.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, recentLimit),
    diagnosticEvents: opts.diagnosticEvents.map((event) => ({
      id: event.id,
      subsystem: event.subsystem,
      severity: event.severity,
      message: event.message,
      metadata: objectRecord(event.metadata) ?? {},
      createdAt: (toDate(event.createdAt) ?? now).toISOString(),
    })),
  };
}

export function decideJobFailureRecovery(opts: {
  input: Record<string, unknown>;
  errorMessage: string;
  maxRetries?: number;
}): {
  action: "requeue" | "fail";
  nextRetryCount: number;
  nextInput?: Record<string, unknown>;
  persistedError: string;
} {
  const maxRetries = opts.maxRetries ?? 2;
  const retryCount = retryCountFromInput(opts.input);
  const throttleCount = throttleCountFromInput(opts.input);
  if (isProviderThrottle(opts.errorMessage) && throttleCount < 8) {
    const nextThrottleCount = throttleCount + 1;
    return {
      action: "requeue",
      nextRetryCount: retryCount,
      nextInput: { ...opts.input, providerThrottleCount: nextThrottleCount },
      persistedError: `Provider throttle ${nextThrottleCount}/8: ${opts.errorMessage}`.slice(0, 2000),
    };
  }

  if (retryCount < maxRetries) {
    const nextRetryCount = retryCount + 1;
    return {
      action: "requeue",
      nextRetryCount,
      nextInput: { ...opts.input, retryCount: nextRetryCount },
      persistedError: `Retry ${nextRetryCount}/${maxRetries}: ${opts.errorMessage}`.slice(0, 2000),
    };
  }

  return {
    action: "fail",
    nextRetryCount: retryCount,
    persistedError: opts.errorMessage,
  };
}
