import assert from "node:assert/strict";
import { LiveActionSchema } from "@shared/liveActions";
import type { AgentJobRow } from "../adapters/agentJob";
import { projectAgentJob } from "../adapters/agentJob";
import { sanitizeLiveActionMetadata, sanitizeLiveActionText } from "../sanitize";
import { buildInitialWorkerRuntime, buildWorkerRuntimeEvent, withWorkerRuntimeEvent } from "../../agent/workerRuntime";

const now = new Date("2026-08-23T12:00:00.000Z");

function job(overrides: Partial<AgentJobRow> = {}): AgentJobRow {
  const runtime = buildInitialWorkerRuntime({
    agentType: "research",
    title: "Research launch",
    now,
  });
  return {
    id: "job-1",
    userId: "user-1",
    agentType: "research",
    title: "Research launch",
    prompt: "Research safely",
    input: { workerRuntime: runtime, workerType: runtime.workerType },
    status: "queued",
    result: null,
    error: null,
    turns: 0,
    toolCallsCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

assert.equal(sanitizeLiveActionText("Authorization: Bearer abc.def.ghi"), "authorization: [redacted]");
assert.equal(sanitizeLiveActionText("Cookie: session=super-secret"), "cookie: [redacted]");
assert.equal(
  sanitizeLiveActionText("postgres://user:password@database.example/app"),
  "postgres://[credentials redacted]@database.example/app",
);
assert.equal(
  sanitizeLiveActionText("Request failed for https://client:secret@provider.example/token"),
  "Request failed for https://[credentials redacted]@provider.example/token",
);
for (const prefix of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
  assert.equal(sanitizeLiveActionText(`${prefix}_abcdefghijklmnop`), "[redacted token]");
}
assert.equal(sanitizeLiveActionText("https://example.test?key=AIzaSyA1234567890abcdefghijklmn"), "https://example.test?key=[redacted token]");
assert.equal(sanitizeLiveActionText("Shell command: curl https://private.example"), "command: [redacted]");
assert.equal(sanitizeLiveActionText("$ rm -rf /home/justin/private"), "[command redacted]");
assert.equal(sanitizeLiveActionText("Command failed: git push origin secret-branch"), "Command failed: [redacted]");
for (const command of [
  "bash deploy.sh --token secret",
  "python3 worker.py --api-key secret",
  "node task.js --password secret",
  "docker compose up private-service",
]) {
  assert.equal(sanitizeLiveActionText(`Job failed: ${command}`), "[command redacted]");
}
assert.equal(
  sanitizeLiveActionText("Job failed: Error: curl https://private.example?access_token=secret"),
  "[command redacted]",
);
assert.equal(
  sanitizeLiveActionText("Provider error:\n-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIBogus\n-----END EC PRIVATE KEY-----\nRetry disabled"),
  "Provider error: [private key redacted] Retry disabled",
);
assert.equal(
  sanitizeLiveActionText("escaped=-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg\\n-----END PRIVATE KEY-----"),
  "escaped=[private key redacted]",
);
assert.equal(
  sanitizeLiveActionText("-----BEGIN OPENSSH PRIVATE KEY-----\nunterminated-secret-material"),
  "[private key redacted]",
);
assert.equal(
  sanitizeLiveActionText("Error: Command failed: npm run private-task\nprivate file contents without a token"),
  "Error: Command failed: [redacted]",
);
assert.equal(sanitizeLiveActionText("Output at /Users/justin/private/report.md"), "Output at [private path]");
assert.equal(sanitizeLiveActionText("Key at /root/.ssh/id_rsa"), "Key at [private path]");
assert.equal(
  sanitizeLiveActionText("https://provider.example/callback?access_token=first&refresh_token=second&client_secret=third"),
  "https://provider.example/callback?access_token=[redacted]&refresh_token=[redacted]&client_secret=[redacted]",
);
assert.equal(sanitizeLiveActionText('{"access_token":"first","client_secret":"second"}'), '{"access_token":"[redacted]","client_secret":"[redacted]"}');
assert.equal(sanitizeLiveActionText('{\\"refresh_token\\":\\"third\\"}'), '{"refresh_token":"[redacted]"}');
assert.equal(
  sanitizeLiveActionText("AWS_SECRET_ACCESS_KEY=first OPENAI_API_KEY=second DATABASE_URL=postgres://private"),
  "AWS_SECRET_ACCESS_KEY=[redacted] OPENAI_API_KEY=[redacted] DATABASE_URL=[redacted]",
);
assert.equal(sanitizeLiveActionText("<thinking>private chain of thought</thinking> Safe update"), "[reasoning redacted] Safe update");
assert.deepEqual(
  sanitizeLiveActionMetadata({ token: "secret", command: "rm -rf /", workerType: "research", retryAttempt: 1 }),
  { workerType: "research", retryAttempt: 1 },
);

const queued = projectAgentJob(job());
assert.equal(queued.status, "queued");
assert.equal(queued.sourceLineageKey, "job-1");
assert.equal(queued.progress?.value, 0);
assert.ok(queued.events.every((event) => event.userVisible));
assert.equal(queued.events.filter((event) => event.type === "action.queued").length, 1);
const queuedAfterInsertTimestamp = projectAgentJob(job({
  createdAt: new Date("2026-08-23T12:00:00.250Z"),
}));
assert.equal(
  queuedAfterInsertTimestamp.events.filter((event) => event.type === "action.queued").length,
  1,
  "the pre-insert worker queue event represents the initial database queue transition",
);
assert.ok(queued.capabilities.some((capability) => capability.type === "cancel" && capability.enabled));
assert.ok(
  projectAgentJob(job({ status: "resource_paused" })).capabilities
    .some((capability) => capability.type === "cancel" && capability.enabled),
  "resource-paused jobs expose their supported immediate cancellation",
);
assert.ok(
  !projectAgentJob(job({ status: "running", startedAt: now })).capabilities
    .some((capability) => capability.type === "cancel"),
  "running jobs do not advertise cancellation until workers can honor it",
);
assert.ok(
  !projectAgentJob(job({ input: { workflowId: "workflow-1", workflowStepIndex: 0 } })).capabilities
    .some((capability) => capability.type === "cancel"),
  "workflow-owned queued jobs do not expose a cancellation that would strand the workflow",
);

const approvalRuntime = withWorkerRuntimeEvent(
  (job().input as Record<string, unknown>),
  buildWorkerRuntimeEvent({
    type: "approval_required",
    workerType: "research",
    message: "Approval required; token=very-secret",
    now: new Date("2026-08-23T12:01:00.000Z"),
    userVisible: true,
    progress: { currentStep: "Waiting for approval" },
    checkpoint: {
      id: "gate-1",
      gateId: "gate-1",
      reason: "Approve access using Bearer abc.def.ghi",
      requiredFor: "research",
    },
    metadata: { gateId: "gate-1", token: "very-secret", command: "curl private" },
  }),
);
const approvalJob = job({ input: approvalRuntime, status: "running", startedAt: now });
const waiting = projectAgentJob(approvalJob, new Set(["gate-1"]));
assert.equal(waiting.status, "waiting_approval");
assert.deepEqual(waiting.attention, {
  kind: "approval",
  reason: "Approve access using Bearer [redacted]",
  referenceId: "gate-1",
});
assert.equal(waiting.events.filter((event) => event.type === "action.waiting_approval").length, 1);
assert.deepEqual(
  waiting.capabilities.find((capability) => capability.type === "open_approval"),
  { type: "open_approval", enabled: true, targetRoute: "/api/agents/approvals" },
  "pending approval attention exposes the existing approval surface",
);
assert.doesNotMatch(JSON.stringify(waiting), /very-secret|abc\.def\.ghi|curl private/);
const resolvedApprovalProjection = projectAgentJob(approvalJob);
assert.equal(resolvedApprovalProjection.status, "running", "resolved approval checkpoints do not leave stale attention");
assert.ok(
  !resolvedApprovalProjection.capabilities.some((capability) => capability.type === "open_approval"),
  "resolved approval checkpoints do not leave a stale approval control",
);
const collidingEventAt = new Date("2026-08-23T12:01:30.000Z");
const firstCollidingEvent = buildWorkerRuntimeEvent({
  type: "progress",
  workerType: "research",
  message: "Processing",
  now: collidingEventAt,
  userVisible: true,
  progress: { currentStep: "Processing", percent: 25 },
});
const secondCollidingEvent = buildWorkerRuntimeEvent({
  type: "progress",
  workerType: "research",
  message: "Processing",
  now: collidingEventAt,
  userVisible: true,
  progress: { currentStep: "Processing", percent: 50 },
});
assert.equal(firstCollidingEvent.id, secondCollidingEvent.id);
const collidingRuntime = withWorkerRuntimeEvent(
  withWorkerRuntimeEvent(job().input as Record<string, unknown>, firstCollidingEvent),
  secondCollidingEvent,
);
const collidingProjectionEvents = projectAgentJob(job({ input: collidingRuntime, status: "running", startedAt: now }))
  .events.filter((event) => event.message === "Processing");
assert.equal(collidingProjectionEvents.length, 2);
assert.equal(
  new Set(collidingProjectionEvents.map((event) => event.sourceEventKey)).size,
  2,
  "same-millisecond worker events retain distinct full-payload identities",
);
const priorAttemptStartedAt = new Date("2026-08-23T12:01:40.000Z");
const currentAttemptStartedAt = new Date("2026-08-23T12:01:41.000Z");
const priorAttemptRuntime = withWorkerRuntimeEvent(
  job().input as Record<string, unknown>,
  buildWorkerRuntimeEvent({
    type: "started",
    workerType: "research",
    message: "Started prior attempt",
    now: priorAttemptStartedAt,
    userVisible: true,
  }),
);
const currentAttemptWithoutWorkerStart = projectAgentJob(job({
  input: priorAttemptRuntime,
  status: "running",
  startedAt: currentAttemptStartedAt,
}));
assert.deepEqual(
  currentAttemptWithoutWorkerStart.events
    .filter((event) => event.type === "action.started")
    .map((event) => event.createdAt.toISOString()),
  [priorAttemptStartedAt.toISOString(), currentAttemptStartedAt.toISOString()],
  "a prior attempt start cannot suppress the current canonical start fallback",
);
const automaticRetryAt = new Date("2026-08-23T12:01:45.000Z");
const automaticRetryRuntime = withWorkerRuntimeEvent(
  job().input as Record<string, unknown>,
  buildWorkerRuntimeEvent({
    type: "retrying",
    workerType: "research",
    message: "Retrying after failure",
    now: automaticRetryAt,
    userVisible: true,
    progress: { currentStep: "Retrying", percent: 25 },
    retryAttempt: 1,
  }),
);
const queuedAutomaticRetry = projectAgentJob(job({ input: automaticRetryRuntime, status: "queued" }));
assert.equal(
  queuedAutomaticRetry.events.filter((event) => event.type === "action.queued").length,
  2,
  "an automatic retry records its queue re-entry in addition to the initial queue",
);
const startedAutomaticRetry = projectAgentJob(job({
  input: automaticRetryRuntime,
  status: "running",
  startedAt: new Date("2026-08-23T12:02:00.000Z"),
}));
assert.equal(
  startedAutomaticRetry.events.filter((event) => event.message === "Job queued for retry").length,
  1,
  "automatic retry queue history survives after the next attempt starts",
);
const secondApprovalRuntime = withWorkerRuntimeEvent(approvalRuntime, buildWorkerRuntimeEvent({
  type: "approval_required",
  workerType: "research",
  message: "Second approval required",
  now: new Date("2026-08-23T12:02:00.000Z"),
  userVisible: true,
  checkpoint: { id: "gate-2", gateId: "gate-2", reason: "Approve second step", requiredFor: "research" },
}));
const olderParallelApprovalPending = projectAgentJob(
  job({ input: secondApprovalRuntime, status: "running", startedAt: now }),
  new Set(["gate-1"]),
  undefined,
  new Map([
    ["gate-1", { status: "pending", resolvedAt: null }],
    ["gate-2", { status: "approved", resolvedAt: new Date("2026-08-23T12:02:30.000Z") }],
  ]),
);
assert.equal(olderParallelApprovalPending.status, "waiting_approval");
assert.equal(olderParallelApprovalPending.attention?.referenceId, "gate-1");
assert.ok(
  olderParallelApprovalPending.capabilities.some((capability) => capability.type === "open_approval" && capability.enabled),
  "an older parallel gate remains actionable after a newer gate resolves",
);
const resolvedApprovals = projectAgentJob(
  job({ input: secondApprovalRuntime, status: "running", startedAt: now }),
  new Set(),
  undefined,
  new Map([
    ["gate-1", { status: "approved", resolvedAt: new Date("2026-08-23T12:01:30.000Z") }],
    ["gate-2", { status: "rejected", resolvedAt: new Date("2026-08-23T12:02:30.000Z") }],
  ]),
);
assert.equal(resolvedApprovals.events.filter((event) => event.type === "action.approval_resolved").length, 2);

const failed = projectAgentJob(job({
  status: "failed",
  error: "Command failed at C:\\Users\\justin\\private with api_key=secret-value",
  completedAt: now,
}));
assert.equal(failed.status, "failed");
assert.equal(failed.error?.retryEligible, true);
assert.doesNotMatch(failed.error?.summary ?? "", /justin|secret-value/);

const failedWorkflowStep = projectAgentJob(job({
  status: "failed",
  error: "Workflow step failed",
  completedAt: now,
  input: { workflowId: "workflow-1", workflowStepIndex: 0 },
}));
assert.ok(
  !failedWorkflowStep.capabilities.some((capability) => capability.type === "retry"),
  "workflow-owned failures do not advertise a retry that cannot reactivate the workflow",
);
assert.equal(failedWorkflowStep.error?.retryEligible, false);

const completedAt = new Date("2026-08-23T12:02:45.000Z");
const completedWithoutRuntime = projectAgentJob(job({
  input: {},
  status: "complete",
  completedAt,
}));
const deliveredWithoutRuntime = projectAgentJob(job({
  input: {},
  status: "delivered",
  completedAt,
}));
assert.equal(
  completedWithoutRuntime.events.at(-1)?.sourceEventKey,
  deliveredWithoutRuntime.events.at(-1)?.sourceEventKey,
  "completion and delivery reuse one success-transition identity",
);

const retry = projectAgentJob(job({
  id: "job-2",
  input: {
    ...(job().input as Record<string, unknown>),
    retryOfJobId: "job-1",
    liveActionLineageKey: "job-root",
    liveActionRetryValidated: true,
    retriedAt: "2026-08-23T12:02:00.000Z",
  },
}));
assert.equal(retry.sourceLineageKey, "job-root");
assert.equal(retry.events.filter((event) => event.type === "action.retry_scheduled").length, 1);
const unvalidatedRetry = projectAgentJob(job({
  id: "legacy-client-job",
  input: {
    retryOfJobId: "job-1",
    retriedAt: "2026-08-23T12:02:00.000Z",
  },
}));
assert.equal(unvalidatedRetry.sourceLineageKey, "legacy-client-job");
assert.equal(unvalidatedRetry.events.filter((event) => event.type === "action.retry_scheduled").length, 0);
assert.equal(projectAgentJob(job({ input: { liveActionLineageKey: "forged-lineage" } })).sourceLineageKey, "job-1");

const cancelRequestedAt = "2026-08-23T12:03:00.000Z";
const cancelling = projectAgentJob(job({
  status: "cancelling",
  startedAt: now,
  input: { cancelRequestedAt },
}));
assert.equal(cancelling.events.at(-1)?.createdAt.toISOString(), cancelRequestedAt);

const cancelledAfterRequest = projectAgentJob(job({
  status: "cancelled",
  input: { cancelRequestedAt },
  completedAt: new Date("2026-08-23T12:04:00.000Z"),
}));
assert.deepEqual(
  cancelledAfterRequest.events.map((event) => event.type),
  ["action.cancel_requested", "action.cancelled"],
  "a completed cancellation retains the preceding durable request",
);
assert.equal(
  cancelling.events.at(-1)?.sourceEventKey,
  cancelledAfterRequest.events[0]?.sourceEventKey,
  "active and historical cancellation requests share an idempotency key",
);

const pausedAt = "2026-08-23T12:04:00.000Z";
const paused = projectAgentJob(job({
  status: "resource_paused",
  input: { resourcePause: { pausedAt, reason: "voice_active_local_runtime" } },
}));
assert.equal(paused.events.at(-1)?.createdAt.toISOString(), pausedAt);
assert.match(paused.events.at(-1)?.sourceEventKey ?? "", /12:04:00\.000Z$/);

const requeuedAt = "2026-08-23T12:05:00.000Z";
const earlierRequeuedAt = "2026-08-23T12:04:30.000Z";
const requeued = projectAgentJob(job({
  input: {
    ...(job().input as Record<string, unknown>),
    requeuedAt,
    requeueHistory: [earlierRequeuedAt, requeuedAt],
  },
}));
assert.equal(requeued.events.at(-1)?.createdAt.toISOString(), requeuedAt);
assert.deepEqual(
  requeued.events.filter((event) => event.message === "Job requeued").map((event) => event.createdAt.toISOString()),
  [earlierRequeuedAt, requeuedAt],
  "every durable watchdog requeue is projected exactly once",
);
assert.match(requeued.events.at(-1)?.sourceEventKey ?? "", /12:05:00\.000Z$/);
assert.equal(requeued.events.filter((event) => event.type === "action.queued").length, 3);
const startedAfterRequeue = projectAgentJob(job({
  status: "running",
  startedAt: new Date("2026-08-23T12:06:00.000Z"),
  input: {
    ...(job().input as Record<string, unknown>),
    requeuedAt,
    requeueHistory: [requeuedAt],
  },
}));
assert.equal(
  startedAfterRequeue.events.filter((event) => event.message === "Job requeued").length,
  1,
  "the latest durable requeue survives a cold read after the job starts",
);
assert.equal(
  requeued.events.at(-1)?.sourceEventKey,
  startedAfterRequeue.events.find((event) => event.message === "Job requeued")?.sourceEventKey,
  "active and historical watchdog requeues share an idempotency key",
);

const resumedAt = "2026-08-23T12:06:00.000Z";
const resumed = projectAgentJob(job({
  input: {
    ...(job().input as Record<string, unknown>),
    resourcePause: { pausedAt, resumedAt, reason: "voice_active_local_runtime" },
  },
}));
assert.equal(resumed.events.filter((event) => event.type === "action.resumed").length, 1);
assert.equal(resumed.events.at(-1)?.createdAt.toISOString(), resumedAt);

const durableFirstPauseRuntime = withWorkerRuntimeEvent(
  (job().input as Record<string, unknown>),
  buildWorkerRuntimeEvent({
    type: "progress",
    workerType: "research",
    message: "Paused while local voice is active.",
    now: new Date(pausedAt),
    userVisible: true,
    progress: { currentStep: "Paused for voice stability" },
    metadata: { reason: "voice_active_local_runtime", transition: "resource_paused" },
  }),
);
const durableResumeRuntime = withWorkerRuntimeEvent(
  durableFirstPauseRuntime,
  buildWorkerRuntimeEvent({
    type: "progress",
    workerType: "research",
    message: "Resumed after the local voice session ended.",
    now: new Date(resumedAt),
    userVisible: true,
    progress: { currentStep: "Resumed" },
    metadata: { reason: "voice_active_local_runtime", transition: "resource_resumed" },
  }),
);
const durableSecondPauseRuntime = withWorkerRuntimeEvent(
  durableResumeRuntime,
  buildWorkerRuntimeEvent({
    type: "progress",
    workerType: "research",
    message: "Paused while local voice is active.",
    now: new Date("2026-08-23T12:07:00.000Z"),
    userVisible: true,
    progress: { currentStep: "Paused for voice stability" },
    metadata: { reason: "voice_active_local_runtime", transition: "resource_paused" },
  }),
);
const repaused = projectAgentJob(job({
  status: "resource_paused",
  input: {
    ...durableSecondPauseRuntime,
    resourcePause: {
      pausedAt: "2026-08-23T12:07:00.000Z",
      reason: "voice_active_local_runtime",
    },
  },
}));
assert.equal(
  repaused.events.filter((event) => event.type === "action.paused").length,
  2,
  "durable worker transitions preserve every pause across a resume cycle",
);
assert.equal(
  repaused.events.filter((event) => event.type === "action.resumed").length,
  1,
  "a durable worker transition preserves a resume after a later pause replaces scalar metadata",
);
assert.equal(
  repaused.events.find((event) => event.type === "action.resumed")?.createdAt.toISOString(),
  resumedAt,
);

assert.doesNotThrow(() => LiveActionSchema.parse({
  id: "action-1",
  projectId: null,
  parentActionId: null,
  source: { type: "agent_job", id: queued.sourceId, lineageType: "agent_job", lineageKey: queued.sourceLineageKey },
  kind: queued.kind,
  title: queued.title,
  status: queued.status,
  version: 1,
  progress: queued.progress,
  attention: queued.attention,
  capabilities: queued.capabilities,
  artifacts: queued.artifacts,
  error: queued.error,
  createdAt: queued.createdAt.toISOString(),
  startedAt: null,
  updatedAt: now.toISOString(),
  completedAt: null,
}));

console.log("Live Action agent-job mapping, contracts, and redaction assertions passed.");
