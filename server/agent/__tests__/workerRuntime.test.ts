import assert from "node:assert/strict";
import {
  appendWorkerRuntimeEvent,
  buildInitialWorkerRuntime,
  buildWorkerRuntimeEvent,
  getRetryPolicyForWorker,
  resolveWorkerType,
  type WorkerRuntimeState,
} from "../workerRuntime";

{
  assert.equal(resolveWorkerType({ agentType: "research" }), "research");
  assert.equal(resolveWorkerType({ agentType: "deep_research" }), "research");
  assert.equal(resolveWorkerType({ agentType: "build_feature" }), "coding");
  assert.equal(resolveWorkerType({ agentType: "app_project" }), "coding");
  assert.equal(resolveWorkerType({ agentType: "goal_decompose" }), "goal_task");
  assert.equal(resolveWorkerType({ agentType: "email" }), "outreach");
  assert.equal(resolveWorkerType({ agentType: "custom_agent", input: { workerType: "finance" } }), "finance");
  assert.equal(resolveWorkerType({ agentType: "custom_agent", input: { workerType: "not-real" } }), "coding");
  console.log("OK: worker runtime resolves canonical cloud worker types");
}

{
  const runtime = buildInitialWorkerRuntime({
    agentType: "build_feature",
    title: "Build a project dashboard",
    now: new Date("2026-05-26T12:00:00.000Z"),
  });

  assert.equal(runtime.workerType, "coding");
  assert.equal(runtime.status, "queued");
  assert.equal(runtime.progress.currentStep, "Queued");
  assert.equal(runtime.events[0]?.type, "queued");
  assert.equal(runtime.events[0]?.userVisible, true);
  assert.equal(runtime.retryPolicy.maxAttempts, 2);
  console.log("OK: initial runtime records queued progress and retry policy");
}

{
  const initial = buildInitialWorkerRuntime({
    agentType: "research",
    title: "Research license requirements",
    now: new Date("2026-05-26T12:00:00.000Z"),
  });
  const withProgress = appendWorkerRuntimeEvent(initial, buildWorkerRuntimeEvent({
    type: "progress",
    workerType: "research",
    message: "Gathering source material",
    now: new Date("2026-05-26T12:01:00.000Z"),
    progress: { currentStep: "Gathering source material", percent: 35 },
    userVisible: true,
  }));

  assert.equal(withProgress.status, "progress");
  assert.equal(withProgress.progress.currentStep, "Gathering source material");
  assert.equal(withProgress.progress.percent, 35);
  assert.equal(withProgress.events.at(-1)?.userVisible, true);
  console.log("OK: progress events update user-visible progress state");
}

{
  const runtime: WorkerRuntimeState = buildInitialWorkerRuntime({
    agentType: "outreach",
    title: "Draft partner email",
    now: new Date("2026-05-26T12:00:00.000Z"),
  });
  const checkpoint = appendWorkerRuntimeEvent(runtime, buildWorkerRuntimeEvent({
    type: "approval_required",
    workerType: "outreach",
    message: "Approval required before sending outreach",
    checkpoint: {
      id: "checkpoint-1",
      reason: "External message send",
      requiredFor: "send_email",
    },
    now: new Date("2026-05-26T12:02:00.000Z"),
    userVisible: true,
  }));

  assert.equal(checkpoint.status, "approval_required");
  assert.equal(checkpoint.approvalCheckpoints[0]?.id, "checkpoint-1");
  assert.equal(checkpoint.approvalCheckpoints[0]?.requiredFor, "send_email");
  console.log("OK: approval checkpoints are captured as user-visible runtime events");
}

{
  assert.deepEqual(getRetryPolicyForWorker("browser"), { maxAttempts: 1, backoffMs: 5000 });
  assert.deepEqual(getRetryPolicyForWorker("coding"), { maxAttempts: 2, backoffMs: 15000 });
  assert.deepEqual(getRetryPolicyForWorker("finance"), { maxAttempts: 1, backoffMs: 0 });
  console.log("OK: worker retry policy is type-aware");
}

console.log("\nAll worker runtime assertions passed.");
