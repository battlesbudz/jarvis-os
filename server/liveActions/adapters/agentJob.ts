import { createHash } from "node:crypto";
import type { agentJobs } from "@shared/schema";
import type {
  LiveActionArtifactRef,
  LiveActionAttention,
  LiveActionControlCapability,
  LiveActionEventType,
  LiveActionProgress,
  LiveActionStatus,
} from "@shared/liveActions";
import { getWorkerRuntimeFromInput, type WorkerRuntimeEvent } from "../../agent/workerRuntime";
import { sanitizeLiveActionMetadata, sanitizeLiveActionText } from "../sanitize";

export type AgentJobRow = typeof agentJobs.$inferSelect;

export interface ProjectedLiveActionEvent {
  sourceEventKey: string;
  type: LiveActionEventType;
  message: string | null;
  safeMetadata: Record<string, unknown>;
  userVisible: boolean;
  createdAt: Date;
}

export interface AgentJobLiveActionProjection {
  userId: string;
  projectId: string | null;
  lineageType: "agent_job";
  sourceLineageKey: string;
  sourceType: "agent_job";
  sourceId: string;
  kind: string;
  title: string;
  status: LiveActionStatus;
  progress: LiveActionProgress | null;
  attention: LiveActionAttention | null;
  capabilities: LiveActionControlCapability[];
  artifacts: LiveActionArtifactRef[];
  error: { category: string; summary: string; retryEligible: boolean } | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  events: ProjectedLiveActionEvent[];
}

export interface AgentApprovalGateProjection {
  status: string;
  resolvedAt: Date | null;
}

function inputOf(job: AgentJobRow): Record<string, unknown> {
  return job.input && typeof job.input === "object" && !Array.isArray(job.input)
    ? job.input as Record<string, unknown>
    : {};
}

function eventType(event: WorkerRuntimeEvent): LiveActionEventType {
  if (event.type === "progress" && event.metadata?.transition === "resource_paused") {
    return "action.paused";
  }
  if (event.type === "progress" && event.metadata?.transition === "resource_resumed") {
    return "action.resumed";
  }
  switch (event.type) {
    case "queued": return "action.queued";
    case "started": return "action.started";
    case "progress": return "action.progress_updated";
    case "approval_required": return "action.waiting_approval";
    case "retrying": return "action.retry_scheduled";
    case "completed": return "action.succeeded";
    case "failed": return "action.failed";
    case "cancelled": return "action.cancelled";
  }
}

function normalizedStatus(jobStatus: string, approvalPending: boolean): LiveActionStatus {
  switch (jobStatus) {
    case "queued": return "queued";
    case "running": return approvalPending ? "waiting_approval" : "running";
    case "cancelling": return "running";
    case "resource_paused": return "paused";
    case "complete":
    case "delivered": return "succeeded";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    default: return "created";
  }
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function canonicalEvent(job: AgentJobRow, status: LiveActionStatus, input: Record<string, unknown>): ProjectedLiveActionEvent {
  const sourceStatus = job.status;
  const type: LiveActionEventType = sourceStatus === "cancelling"
    ? "action.cancel_requested"
    : status === "queued" ? "action.queued"
      : status === "running" ? "action.started"
        : status === "waiting_approval" ? "action.waiting_approval"
          : status === "paused" ? "action.paused"
            : status === "succeeded" ? "action.succeeded"
              : status === "failed" ? "action.failed"
                : status === "cancelled" ? "action.cancelled"
                  : "action.created";
  const pause = input.resourcePause && typeof input.resourcePause === "object" && !Array.isArray(input.resourcePause)
    ? input.resourcePause as Record<string, unknown>
    : null;
  const requeuedAt = sourceStatus === "queued" ? dateValue(input.requeuedAt) : null;
  const automaticRetryAt = sourceStatus === "queued" && !requeuedAt
    ? dateValue(getWorkerRuntimeFromInput(input)?.events.findLast((event) => event.type === "retrying")?.createdAt)
    : null;
  const at = sourceStatus === "cancelling"
    ? dateValue(input.cancelRequestedAt) ?? job.startedAt ?? job.createdAt
    : sourceStatus === "resource_paused"
      ? dateValue(pause?.pausedAt) ?? job.createdAt
      : requeuedAt ?? automaticRetryAt ?? job.completedAt ?? job.startedAt ?? job.createdAt;
  const keyedSourceStatus = ["complete", "delivered"].includes(sourceStatus) ? "succeeded" : sourceStatus;
  const sourceEventKey = sourceStatus === "cancelling"
    ? `job:${job.id}:cancel_requested:${at.toISOString()}`
    : requeuedAt
      ? `job:${job.id}:requeue:${requeuedAt.toISOString()}`
      : `job:${job.id}:status:${keyedSourceStatus}${pause?.pausedAt ? `:${pause.pausedAt}` : ""}`;
  return {
    sourceEventKey,
    type,
    message: sourceStatus === "cancelling" ? "Cancellation requested" : requeuedAt ? "Job requeued" : `Job ${sourceStatus}`,
    safeMetadata: { sourceStatus },
    userVisible: true,
    createdAt: at,
  };
}

function stableWorkerEventKey(jobId: string, event: WorkerRuntimeEvent): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex")
    .slice(0, 24);
  return `job:${jobId}:worker:${digest}`;
}

function classifyError(error: string): string {
  if (/\b(?:401|403|auth|credential|token)\b/i.test(error)) return "authentication";
  if (/\b(?:429|rate.?limit|quota)\b/i.test(error)) return "rate_limit";
  if (/\b(?:timeout|timed.?out)\b/i.test(error)) return "timeout";
  if (/\b(?:network|connection|socket|econn)\b/i.test(error)) return "network";
  return "execution";
}

function isWorkflowOwned(job: AgentJobRow): boolean {
  const workflowId = inputOf(job).workflowId;
  return typeof workflowId === "string" && !!workflowId.trim();
}

function capabilities(job: AgentJobRow): LiveActionControlCapability[] {
  const result: LiveActionControlCapability[] = [];
  if (job.status === "queued" || job.status === "resource_paused") {
    result.push({
      type: "cancel",
      enabled: true,
      targetRoute: `/api/agent-jobs/${job.id}/cancel`,
    });
  }
  if (["failed", "cancelled"].includes(job.status) && !isWorkflowOwned(job)) {
    result.push({ type: "retry", enabled: true, targetRoute: `/api/agent-jobs/${job.id}/retry` });
  }
  return result;
}

export function projectAgentJob(
  job: AgentJobRow,
  pendingApprovalGateIds: ReadonlySet<string> = new Set(),
  resolvedLineageKey?: string,
  approvalGates: ReadonlyMap<string, AgentApprovalGateProjection> = new Map(),
): AgentJobLiveActionProjection {
  const input = inputOf(job);
  const runtime = getWorkerRuntimeFromInput(input);
  const checkpoint = runtime?.approvalCheckpoints.at(-1);
  const status = normalizedStatus(job.status, !!checkpoint?.gateId && pendingApprovalGateIds.has(checkpoint.gateId));
  const pause = input.resourcePause && typeof input.resourcePause === "object"
    ? input.resourcePause as Record<string, unknown>
    : null;
  const attention: LiveActionAttention | null = status === "waiting_approval" && checkpoint
    ? {
        kind: "approval",
        reason: sanitizeLiveActionText(checkpoint.reason, 500) ?? "Approval required",
        ...(checkpoint.gateId ? { referenceId: checkpoint.gateId.slice(0, 200) } : {}),
      }
    : job.status === "cancelling"
      ? { kind: "warning", reason: "Cancellation requested" }
      : status === "paused"
        ? { kind: "warning", reason: sanitizeLiveActionText(pause?.reason, 500) ?? "Paused for runtime resources" }
        : null;
  const progressValue = runtime?.progress && Number.isFinite(runtime.progress.percent)
    ? Math.min(100, Math.max(0, runtime.progress.percent!))
    : null;
  const progressUpdatedAt = runtime?.progress ? new Date(runtime.progress.updatedAt) : null;
  const progress: LiveActionProgress | null = runtime?.progress
    ? {
        kind: progressValue === null ? "indeterminate" : "percent",
        currentStep: sanitizeLiveActionText(runtime.progress.currentStep, 300) ?? "In progress",
        value: progressValue,
        updatedAt: progressUpdatedAt && !Number.isNaN(progressUpdatedAt.getTime())
          ? progressUpdatedAt.toISOString()
          : (job.startedAt ?? job.createdAt).toISOString(),
      }
    : null;
  const workerEvents = (runtime?.events ?? [])
    .filter((event) => event.userVisible)
    .map((event): ProjectedLiveActionEvent => ({
      sourceEventKey: stableWorkerEventKey(job.id, event),
      type: eventType(event),
      message: sanitizeLiveActionText(event.message),
      safeMetadata: sanitizeLiveActionMetadata({
        ...event.metadata,
        workerType: event.workerType,
        retryAttempt: event.retryAttempt,
        gateId: event.checkpoint?.gateId,
      }),
      userVisible: true,
      createdAt: new Date(event.createdAt),
    }))
    .filter((event) => !Number.isNaN(event.createdAt.getTime()));
  const automaticRetryQueuedEvents = (runtime?.events ?? [])
    .filter((event) => event.userVisible && event.type === "retrying")
    .map((event): ProjectedLiveActionEvent => ({
      sourceEventKey: `${stableWorkerEventKey(job.id, event)}:queued`,
      type: "action.queued",
      message: "Job queued for retry",
      safeMetadata: sanitizeLiveActionMetadata({ workerType: event.workerType, retryAttempt: event.retryAttempt }),
      userVisible: true,
      createdAt: new Date(event.createdAt),
    }))
    .filter((event) => !Number.isNaN(event.createdAt.getTime()));
  const projectedWorkerEvents = [...workerEvents, ...automaticRetryQueuedEvents];
  const rawSourceLineageKey = input.liveActionRetryValidated === true && typeof input.retryOfJobId === "string"
    ? typeof input.liveActionLineageKey === "string" ? input.liveActionLineageKey : input.retryOfJobId
    : job.id;
  const sourceLineageKey = (resolvedLineageKey?.trim() || rawSourceLineageKey.trim() || job.id).slice(0, 200);
  const errorSummary = sanitizeLiveActionText(job.error);
  const fallbackEvent = canonicalEvent(job, status, input);
  const isRequeue = job.status === "queued" && !!dateValue(input.requeuedAt);
  const isAutomaticRetryQueue = job.status === "queued"
    && (runtime?.events ?? []).some((event) => event.type === "retrying");
  const hasMatchingFallback = projectedWorkerEvents.some((event) => event.type === fallbackEvent.type
    && (fallbackEvent.type !== "action.queued"
      || (!isRequeue && !isAutomaticRetryQueue)
      || event.createdAt.getTime() === fallbackEvent.createdAt.getTime()));
  const baseEvents = hasMatchingFallback
    ? projectedWorkerEvents
    : [...projectedWorkerEvents, fallbackEvent];
  const requeuedAt = dateValue(input.requeuedAt);
  const historicalRequeueEvents = Array.isArray(input.requeueHistory)
    ? input.requeueHistory.flatMap((value) => {
        const at = dateValue(value);
        return at && !(isRequeue && at.getTime() === requeuedAt?.getTime())
          ? [{
              sourceEventKey: `job:${job.id}:requeue:${at.toISOString()}`,
              type: "action.queued" as const,
              message: "Job requeued",
              safeMetadata: { sourceStatus: "queued" },
              userVisible: true,
              createdAt: at,
            }]
          : [];
      })
    : [];
  const cancelRequestedAt = dateValue(input.cancelRequestedAt);
  const historicalCancelRequestEvent = cancelRequestedAt && job.status !== "cancelling"
    ? {
        sourceEventKey: `job:${job.id}:cancel_requested:${cancelRequestedAt.toISOString()}`,
        type: "action.cancel_requested" as const,
        message: "Cancellation requested",
        safeMetadata: { sourceStatus: "cancelling" },
        userVisible: true,
        createdAt: cancelRequestedAt,
      }
    : null;
  const retriedAt = typeof input.retryOfJobId === "string" ? dateValue(input.retriedAt) : null;
  const retryEvent: ProjectedLiveActionEvent | null = retriedAt
    ? {
        sourceEventKey: `job:${job.id}:retry:${retriedAt.toISOString()}`,
        type: "action.retry_scheduled",
        message: "Retry scheduled",
        safeMetadata: {},
        userVisible: true,
        createdAt: retriedAt,
      }
    : null;
  const resumedAt = dateValue(pause?.resumedAt);
  const resumeEvent: ProjectedLiveActionEvent | null = resumedAt
    && !workerEvents.some((event) => event.type === "action.resumed"
      && event.createdAt.getTime() === resumedAt.getTime())
    ? {
        sourceEventKey: `job:${job.id}:resume:${resumedAt.toISOString()}`,
        type: "action.resumed",
        message: "Job resumed",
        safeMetadata: {},
        userVisible: true,
        createdAt: resumedAt,
      }
    : null;
  const approvalResolutionEvents = (runtime?.approvalCheckpoints ?? []).flatMap((approvalCheckpoint) => {
    const gate = approvalCheckpoint.gateId ? approvalGates.get(approvalCheckpoint.gateId) : undefined;
    return approvalCheckpoint.gateId && gate?.status !== "pending" && gate?.resolvedAt
      ? [{
          sourceEventKey: `gate:${approvalCheckpoint.gateId}:resolved:${gate.status}`,
          type: "action.approval_resolved" as const,
          message: `Approval ${gate.status}`,
          safeMetadata: { gateId: approvalCheckpoint.gateId },
          userVisible: true,
          createdAt: gate.resolvedAt,
        }]
      : [];
  });
  const events = [
    ...historicalRequeueEvents,
    ...(historicalCancelRequestEvent ? [historicalCancelRequestEvent] : []),
    ...baseEvents,
    ...(retryEvent ? [retryEvent] : []),
    ...(resumeEvent ? [resumeEvent] : []),
    ...approvalResolutionEvents,
  ];

  return {
    userId: job.userId,
    projectId: typeof input.projectId === "string" ? input.projectId.slice(0, 200) : null,
    lineageType: "agent_job",
    sourceLineageKey,
    sourceType: "agent_job",
    sourceId: job.id,
    kind: job.agentType.slice(0, 100),
    title: sanitizeLiveActionText(job.title, 300) ?? "Background task",
    status,
    progress,
    attention,
    capabilities: capabilities(job),
    artifacts: [],
    error: status === "failed" && errorSummary
      ? { category: classifyError(job.error ?? ""), summary: errorSummary, retryEligible: !isWorkflowOwned(job) }
      : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    events: events
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.sourceEventKey.localeCompare(b.sourceEventKey)),
  };
}
