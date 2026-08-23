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
assert.equal(sanitizeLiveActionText("Shell command: curl https://private.example"), "command: [redacted]");
assert.equal(sanitizeLiveActionText("$ rm -rf /home/justin/private"), "[command redacted]");
assert.equal(sanitizeLiveActionText("Output at /Users/justin/private/report.md"), "Output at [private path]");
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
assert.doesNotMatch(JSON.stringify(waiting), /very-secret|abc\.def\.ghi|curl private/);
assert.equal(projectAgentJob(approvalJob).status, "running", "resolved approval checkpoints do not leave stale attention");

const failed = projectAgentJob(job({
  status: "failed",
  error: "Command failed at C:\\Users\\justin\\private with api_key=secret-value",
  completedAt: now,
}));
assert.equal(failed.status, "failed");
assert.equal(failed.error?.retryEligible, true);
assert.doesNotMatch(failed.error?.summary ?? "", /justin|secret-value/);

const retry = projectAgentJob(job({
  id: "job-2",
  input: { ...(job().input as Record<string, unknown>), retryOfJobId: "job-1", liveActionLineageKey: "job-root" },
}));
assert.equal(retry.sourceLineageKey, "job-root");
assert.equal(projectAgentJob(job({ input: { liveActionLineageKey: "forged-lineage" } })).sourceLineageKey, "job-1");

const cancelRequestedAt = "2026-08-23T12:03:00.000Z";
const cancelling = projectAgentJob(job({
  status: "cancelling",
  startedAt: now,
  input: { cancelRequestedAt },
}));
assert.equal(cancelling.events.at(-1)?.createdAt.toISOString(), cancelRequestedAt);

const pausedAt = "2026-08-23T12:04:00.000Z";
const paused = projectAgentJob(job({
  status: "resource_paused",
  input: { resourcePause: { pausedAt, reason: "voice_active_local_runtime" } },
}));
assert.equal(paused.events.at(-1)?.createdAt.toISOString(), pausedAt);

const requeuedAt = "2026-08-23T12:05:00.000Z";
const requeued = projectAgentJob(job({ input: { ...(job().input as Record<string, unknown>), requeuedAt } }));
assert.equal(requeued.events.at(-1)?.createdAt.toISOString(), requeuedAt);
assert.match(requeued.events.at(-1)?.sourceEventKey ?? "", /12:05:00\.000Z$/);
assert.equal(requeued.events.filter((event) => event.type === "action.queued").length, 2);

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
