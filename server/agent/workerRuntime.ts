export const CLOUD_WORKER_TYPES = [
  "research",
  "browser",
  "coding",
  "form_fill",
  "outreach",
  "finance",
  "goal_task",
] as const;

export type CloudWorkerType = typeof CLOUD_WORKER_TYPES[number];

export const WORKER_RUNTIME_EVENT_TYPES = [
  "queued",
  "started",
  "progress",
  "approval_required",
  "retrying",
  "completed",
  "failed",
  "cancelled",
] as const;

export type WorkerRuntimeEventType = typeof WORKER_RUNTIME_EVENT_TYPES[number];

export interface WorkerRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface WorkerProgressState {
  currentStep: string;
  percent?: number;
  updatedAt: string;
}

export interface WorkerApprovalCheckpoint {
  id: string;
  reason: string;
  requiredFor: string;
  gateId?: string;
  createdAt: string;
}

export interface WorkerRuntimeEvent {
  id: string;
  type: WorkerRuntimeEventType;
  workerType: CloudWorkerType;
  message: string;
  createdAt: string;
  userVisible: boolean;
  progress?: WorkerProgressState;
  checkpoint?: WorkerApprovalCheckpoint;
  retryAttempt?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeState {
  workerType: CloudWorkerType;
  status: WorkerRuntimeEventType;
  retryPolicy: WorkerRetryPolicy;
  progress: WorkerProgressState;
  approvalCheckpoints: WorkerApprovalCheckpoint[];
  events: WorkerRuntimeEvent[];
}

const WORKER_TYPE_SET = new Set<string>(CLOUD_WORKER_TYPES);

const DEFAULT_RETRY_POLICIES: Record<CloudWorkerType, WorkerRetryPolicy> = {
  research: { maxAttempts: 2, backoffMs: 10000 },
  browser: { maxAttempts: 1, backoffMs: 5000 },
  coding: { maxAttempts: 2, backoffMs: 15000 },
  form_fill: { maxAttempts: 1, backoffMs: 5000 },
  outreach: { maxAttempts: 2, backoffMs: 10000 },
  finance: { maxAttempts: 1, backoffMs: 0 },
  goal_task: { maxAttempts: 2, backoffMs: 10000 },
};

const MAX_EVENTS = 50;

function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function eventId(type: WorkerRuntimeEventType, createdAt: string): string {
  return `${type}_${createdAt.replace(/[^0-9]/g, "").slice(0, 17)}`;
}

export function isCloudWorkerType(value: unknown): value is CloudWorkerType {
  return typeof value === "string" && WORKER_TYPE_SET.has(value);
}

export function getRetryPolicyForWorker(workerType: CloudWorkerType): WorkerRetryPolicy {
  return { ...DEFAULT_RETRY_POLICIES[workerType] };
}

export function resolveWorkerType(opts: {
  agentType: string;
  input?: Record<string, unknown> | null;
}): CloudWorkerType {
  const explicit = opts.input?.workerType;
  if (isCloudWorkerType(explicit)) return explicit;

  switch (opts.agentType) {
    case "research":
    case "deep_research":
      return "research";
    case "browser":
      return "browser";
    case "build_feature":
    case "app_project":
    case "project_session":
    case "custom_agent":
    case "named_agent_task":
      return "coding";
    case "form_fill":
      return "form_fill";
    case "email":
    case "outreach":
      return "outreach";
    case "finance":
      return "finance";
    case "goal_decompose":
    case "goal_task":
    case "planning":
      return "goal_task";
    default:
      return "coding";
  }
}

export function buildWorkerRuntimeEvent(opts: {
  type: WorkerRuntimeEventType;
  workerType: CloudWorkerType;
  message: string;
  now?: Date;
  userVisible?: boolean;
  progress?: { currentStep: string; percent?: number };
  checkpoint?: Omit<WorkerApprovalCheckpoint, "createdAt"> & { createdAt?: string };
  retryAttempt?: number;
  metadata?: Record<string, unknown>;
}): WorkerRuntimeEvent {
  const createdAt = iso(opts.now);
  return {
    id: eventId(opts.type, createdAt),
    type: opts.type,
    workerType: opts.workerType,
    message: opts.message,
    createdAt,
    userVisible: opts.userVisible ?? false,
    ...(opts.progress
      ? {
          progress: {
            currentStep: opts.progress.currentStep,
            percent: opts.progress.percent,
            updatedAt: createdAt,
          },
        }
      : {}),
    ...(opts.checkpoint
      ? {
          checkpoint: {
            ...opts.checkpoint,
            createdAt: opts.checkpoint.createdAt ?? createdAt,
          },
        }
      : {}),
    ...(typeof opts.retryAttempt === "number" ? { retryAttempt: opts.retryAttempt } : {}),
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
  };
}

export function buildInitialWorkerRuntime(opts: {
  agentType: string;
  title: string;
  input?: Record<string, unknown> | null;
  now?: Date;
}): WorkerRuntimeState {
  const workerType = resolveWorkerType({ agentType: opts.agentType, input: opts.input });
  const event = buildWorkerRuntimeEvent({
    type: "queued",
    workerType,
    message: `Queued ${opts.title}`,
    now: opts.now,
    userVisible: true,
    progress: { currentStep: "Queued", percent: 0 },
  });

  return {
    workerType,
    status: "queued",
    retryPolicy: getRetryPolicyForWorker(workerType),
    progress: event.progress!,
    approvalCheckpoints: [],
    events: [event],
  };
}

export function appendWorkerRuntimeEvent(
  runtime: WorkerRuntimeState,
  event: WorkerRuntimeEvent,
): WorkerRuntimeState {
  const approvalCheckpoints = event.checkpoint
    ? [...runtime.approvalCheckpoints, event.checkpoint]
    : runtime.approvalCheckpoints;

  return {
    ...runtime,
    status: event.type,
    progress: event.progress ?? runtime.progress,
    approvalCheckpoints,
    events: [...runtime.events, event].slice(-MAX_EVENTS),
  };
}

export function getWorkerRuntimeFromInput(input: Record<string, unknown> | null | undefined): WorkerRuntimeState | null {
  const runtime = input?.workerRuntime;
  if (!runtime || typeof runtime !== "object") return null;
  const candidate = runtime as Partial<WorkerRuntimeState>;
  if (!isCloudWorkerType(candidate.workerType)) return null;
  if (!Array.isArray(candidate.events)) return null;
  return candidate as WorkerRuntimeState;
}

export function withWorkerRuntimeEvent(input: Record<string, unknown>, event: WorkerRuntimeEvent): Record<string, unknown> {
  const existing = getWorkerRuntimeFromInput(input);
  const runtime = existing
    ? appendWorkerRuntimeEvent(existing, event)
    : appendWorkerRuntimeEvent(
        buildInitialWorkerRuntime({
          agentType: event.workerType,
          title: event.message,
          input: { workerType: event.workerType },
        }),
        event,
      );
  return { ...input, workerRuntime: runtime, workerType: runtime.workerType };
}
