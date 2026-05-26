import assert from "node:assert/strict";
import {
  buildJobRunnerObservability,
  decorateJobForObservability,
  decideJobFailureRecovery,
} from "../jobObservability";
import { buildInitialWorkerRuntime, appendWorkerRuntimeEvent, buildWorkerRuntimeEvent } from "../workerRuntime";

const now = new Date("2026-05-18T12:00:00.000Z");

const baseJob = {
  id: "job-1",
  userId: "user-1",
  agentType: "research",
  title: "Investigate queue behavior",
  prompt: "prompt",
  input: {},
  status: "queued",
  result: null,
  error: null,
  turns: 0,
  toolCallsCount: 0,
  createdAt: new Date("2026-05-18T11:50:00.000Z"),
  startedAt: null,
  completedAt: null,
};

{
  const runtime = appendWorkerRuntimeEvent(
    buildInitialWorkerRuntime({
      agentType: "research",
      title: "Investigate queue behavior",
      now,
    }),
    buildWorkerRuntimeEvent({
      type: "approval_required",
      workerType: "research",
      message: "Need approval before contacting an external source",
      checkpoint: {
        id: "checkpoint-1",
        reason: "External outreach",
        requiredFor: "outreach",
      },
      userVisible: true,
      now,
    }),
  );
  const decorated = decorateJobForObservability({
    ...baseJob,
    status: "running",
    input: { retryCount: 2, workerRuntime: runtime },
    error: "Retry 2/2: provider timed out",
    result: {
      deliverableId: "deliverable-1",
      body: "This long body should be shortened for admin display.".repeat(10),
    },
    startedAt: new Date("2026-05-18T11:58:00.000Z"),
  }, now);

  assert.equal(decorated.ageMs, 10 * 60 * 1000);
  assert.equal(decorated.runtimeMs, 2 * 60 * 1000);
  assert.equal(decorated.retryCount, 2);
  assert.equal(decorated.workerType, "research");
  assert.equal(decorated.progress?.currentStep, "Queued");
  assert.equal(decorated.approvalCheckpoints[0]?.id, "checkpoint-1");
  assert.equal(decorated.userVisibleEventCount, 2);
  assert.equal(decorated.lastError, "Retry 2/2: provider timed out");
  assert.match(decorated.resultPreview ?? "", /deliverable-1/);
  assert.ok((decorated.resultPreview ?? "").length <= 243);
  console.log("OK: job observability decorates age, runtime, retry count, error, and result preview");
}

{
  const report = buildJobRunnerObservability({
    now,
    jobs: [
      baseJob,
      { ...baseJob, id: "job-2", status: "running", startedAt: new Date("2026-05-18T11:59:30.000Z") },
      { ...baseJob, id: "job-3", status: "failed", error: "schema parse failed", completedAt: new Date("2026-05-18T11:59:00.000Z") },
      { ...baseJob, id: "job-4", status: "complete", result: { ok: true }, completedAt: new Date("2026-05-18T11:55:00.000Z") },
    ],
    diagnosticEvents: [
      {
        id: "evt-1",
        userId: "user-1",
        subsystem: "job_queue",
        severity: "error",
        message: "Job job-3 failed",
        metadata: { jobId: "job-3" },
        resolved: false,
        createdAt: new Date("2026-05-18T11:59:05.000Z"),
      },
    ],
  });

  assert.deepEqual(report.summary.byStatus, { queued: 1, running: 1, failed: 1, complete: 1 });
  assert.equal(report.summary.activeCount, 2);
  assert.equal(report.summary.recentFailureCount, 1);
  assert.equal(report.summary.oldestQueuedAgeMs, 10 * 60 * 1000);
  assert.deepEqual(report.activeJobs.map((job) => job.id), ["job-1", "job-2"]);
  assert.deepEqual(report.recentJobs.map((job) => job.id), ["job-3", "job-4"]);
  assert.equal(report.diagnosticEvents[0]?.message, "Job job-3 failed");
  console.log("OK: job runner report summarizes active/recent jobs and recent job_queue events");
}

{
  const decision = decideJobFailureRecovery({
    input: { retryCount: 1, originChannel: "app" },
    errorMessage: "provider unavailable",
    maxRetries: 2,
  });

  assert.equal(decision.action, "requeue");
  assert.equal(decision.nextRetryCount, 2);
  assert.deepEqual(decision.nextInput, { retryCount: 2, originChannel: "app" });
  assert.equal(decision.persistedError, "Retry 2/2: provider unavailable");
  console.log("OK: recoverable job failure increments retry count while preserving input");
}

{
  const decision = decideJobFailureRecovery({
    input: { retryCount: 2 },
    errorMessage: "permanent parse failure",
    maxRetries: 2,
  });

  assert.equal(decision.action, "fail");
  assert.equal(decision.nextRetryCount, 2);
  assert.equal(decision.nextInput, undefined);
  assert.equal(decision.persistedError, "permanent parse failure");
  console.log("OK: exhausted job failure is classified as permanent failure");
}

console.log("\nAll job observability assertions passed.");
