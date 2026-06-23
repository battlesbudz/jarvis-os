import assert from "node:assert/strict";

import {
  buildRuntimeStateCard,
  buildRuntimeStateCardPrompt,
  limitRuntimeTaskStateRows,
  renderRuntimeStateCard,
  type RuntimeStateCardDeps,
} from "../stateCard";

const fixedNow = new Date("2026-06-23T12:00:00.000Z");

const deps: RuntimeStateCardDeps = {
  now: () => fixedNow,
  loadProfileState: async (userId) => ({
    userId,
    preferredName: "Justin",
    timezone: "America/New_York",
    language: "en",
    communicationStyle: "direct and product-focused",
    source: "profile_store",
  }),
  loadTaskState: async () => [{
    taskId: "task-1",
    source: "agent_workflow",
    goal: "Test Phone Gemma device control",
    currentStep: "Validate model and run YouTube action",
    status: "active",
    lastAction: "Validated GPU standard profile.",
    nextAction: "Run deterministic app-open workflow.",
    updatedAt: "2026-06-23T11:55:00.000Z",
  }],
  retrieveMemoryContext: async (input) => ({
    userId: input.userId,
    query: input.query,
    caller: "state_card_test",
    items: [{
      memory: {
        id: "memory-1",
        content: "User wants Jarvis device control to be the flagship feature.",
        category: "preferences",
        tier: "long_term",
        memoryType: "semantic",
        relevanceScore: 90,
        confidence: 95,
        accessCount: 3,
        score: 0.92,
        source: "canonical",
        sourceId: "memory-1",
        sourceRefs: [],
      },
      provenance: [{
        kind: "user_memory",
        id: "memory-1",
        source: "canonical",
        label: "preferences",
      }],
    }],
    sources: {
      memories: ["memory-1"],
      brainChunks: [],
      hotState: [],
    },
    provenance: [{
      kind: "user_memory",
      id: "memory-1",
      source: "canonical",
      label: "preferences",
    }],
    uncertainty: [],
  }),
};

async function testStateCardAlwaysIncludesAuthoritativeIdentityAndTaskState() {
  const card = await buildRuntimeStateCard({
    userId: "user-123",
    assistantName: "Jarvis",
    activeDevice: "android",
    activeModel: "gemma-4-e4b-it",
    currentContext: "phone_gemma_chat",
    availableTools: ["android_open_app_by_name", "memory_search"],
    includeMemoryContext: false,
  }, deps);

  assert.equal(card.assistantName, "Jarvis");
  assert.equal(card.user.userId, "user-123");
  assert.equal(card.user.preferredName, "Justin");
  assert.equal(card.user.timezone, "America/New_York");
  assert.equal(card.session.activeDevice, "android");
  assert.equal(card.session.activeModel, "gemma-4-e4b-it");
  assert.equal(card.taskState.length, 1);
  assert.equal(card.relevantContext.length, 0);

  const rendered = renderRuntimeStateCard(card, { maxChars: 5_000 });
  assert.match(rendered, /Jarvis Runtime State Card/);
  assert.match(rendered, /Preferred name: Justin/);
  assert.match(rendered, /Test Phone Gemma device control/);
  assert.match(rendered, /android_open_app_by_name/);
  assert.match(rendered, /No historical memory packet loaded/);
  console.log("OK: runtime state card renders authoritative identity and task state without requiring memory retrieval");
}

async function testMemoryContextIsOptionalAndClearlyHistorical() {
  const card = await buildRuntimeStateCard({
    userId: "user-123",
    seedQuery: "What should Jarvis device control do?",
    includeMemoryContext: true,
  }, deps);

  assert.equal(card.relevantContext.length, 1);

  const rendered = renderRuntimeStateCard(card, { maxChars: 5_000 });
  assert.match(rendered, /Relevant Historical Context/);
  assert.match(rendered, /flagship feature/);
  assert.match(rendered, /memory_os/);
  console.log("OK: runtime state card keeps retrieved memory separate from authoritative state");
}

async function testStateCardFallsBackWhenStoresAreUnavailable() {
  const card = await buildRuntimeStateCard({
    userId: "user-fallback",
    activeDevice: "android",
    activeModel: "gemma-4-e4b-it",
  }, {
    now: () => fixedNow,
    loadProfileState: async () => {
      throw new Error("profile offline");
    },
    loadTaskState: async () => {
      throw new Error("tasks offline");
    },
  });

  assert.equal(card.user.userId, "user-fallback");
  assert.equal(card.user.source, "fallback");
  assert.equal(card.taskState.length, 0);
  assert.ok(card.uncertainty.some((entry) => entry.includes("Profile store was unavailable")));
  assert.ok(card.uncertainty.some((entry) => entry.includes("Task state store was unavailable")));
  console.log("OK: runtime state card remains available when profile or task stores fail");
}

function testTaskStateLimitPreservesJobsAndWorkflows() {
  const limited = limitRuntimeTaskStateRows([{
    taskId: "scheduled-1",
    source: "scheduled_task",
    goal: "Scheduled low priority 1",
    status: "scheduled",
    updatedAt: "2026-06-23T10:00:00.000Z",
  }, {
    taskId: "scheduled-2",
    source: "scheduled_task",
    goal: "Scheduled low priority 2",
    status: "scheduled",
    updatedAt: "2026-06-23T10:01:00.000Z",
  }, {
    taskId: "scheduled-3",
    source: "scheduled_task",
    goal: "Scheduled low priority 3",
    status: "scheduled",
    updatedAt: "2026-06-23T10:02:00.000Z",
  }, {
    taskId: "job-1",
    source: "agent_job",
    goal: "Queued local-model diagnostic",
    status: "queued",
    updatedAt: "2026-06-23T09:00:00.000Z",
  }, {
    taskId: "workflow-1",
    source: "agent_workflow",
    goal: "Active Phone Gemma workflow",
    status: "active",
    updatedAt: "2026-06-23T08:00:00.000Z",
  }], 3);

  assert.deepEqual(limited.map((task) => task.taskId), [
    "workflow-1",
    "job-1",
    "scheduled-3",
  ]);
  console.log("OK: runtime state card task limiting preserves active workflows and jobs");
}

function testTaskStateLimitPrioritizesRunningJobs() {
  const limited = limitRuntimeTaskStateRows([{
    taskId: "queued-1",
    source: "agent_job",
    goal: "Queued job 1",
    status: "queued",
    updatedAt: "2026-06-23T11:00:00.000Z",
  }, {
    taskId: "queued-2",
    source: "agent_job",
    goal: "Queued job 2",
    status: "queued",
    updatedAt: "2026-06-23T11:01:00.000Z",
  }, {
    taskId: "running-1",
    source: "agent_job",
    goal: "Running job",
    status: "running",
    updatedAt: "2026-06-23T10:00:00.000Z",
  }], 2);

  assert.equal(limited[0].taskId, "running-1");
  assert.equal(limited.length, 2);
  console.log("OK: runtime state card task limiting prioritizes running jobs over queued jobs");
}

async function testPromptHelperRespectsCompactBudget() {
  const prompt = await buildRuntimeStateCardPrompt({
    userId: "user-123",
    assistantName: "Jarvis",
    activeDevice: "android",
    activeModel: "gemma-4-e4b-it",
    availableTools: ["android_open_app_by_name"],
    renderMaxChars: 480,
  }, deps);

  assert.ok(prompt.length <= 480);
  assert.match(prompt, /Jarvis Runtime State Card/);
  assert.match(prompt, /Assistant: Jarvis/);
  console.log("OK: runtime state card prompt helper renders a compact prompt packet");
}

async function main() {
  await testStateCardAlwaysIncludesAuthoritativeIdentityAndTaskState();
  await testMemoryContextIsOptionalAndClearlyHistorical();
  await testStateCardFallsBackWhenStoresAreUnavailable();
  testTaskStateLimitPreservesJobsAndWorkflows();
  testTaskStateLimitPrioritizesRunningJobs();
  await testPromptHelperRespectsCompactBudget();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
