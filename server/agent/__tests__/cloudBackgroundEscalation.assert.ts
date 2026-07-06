import assert from "node:assert/strict";
import {
  CODEX_OAUTH_MODEL,
} from "@shared/modelProviderCatalog";
import {
  buildCloudBackgroundTaskCard,
  buildCloudBackgroundEscalationDecision,
  buildCloudBackgroundJobInput,
  buildCompactCloudBackgroundResultPacket,
  checkCloudBackgroundBudget,
  CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD,
  getDefaultCloudBackgroundModel,
  maxCloudBackgroundModelTurnsForBudget,
  nextCloudBackgroundModelAttemptBudgetCheckpoint,
  nextCloudBackgroundModelStepBudgetCheckpoint,
  shouldOfferCloudBackgroundEscalation,
  validateCloudBackgroundJobInput,
  type CloudBackgroundProviderStatus,
} from "../cloudBackgroundEscalation";

function status(overrides: Partial<Record<CloudBackgroundProviderStatus["id"], Partial<CloudBackgroundProviderStatus>>> = {}) {
  const providers: CloudBackgroundProviderStatus[] = [
    { id: "openai", label: "OpenAI", connected: false, authType: null },
    { id: "anthropic", label: "Claude", connected: false, authType: null },
    { id: "google", label: "Gemini", connected: false, authType: null },
    { id: "local-llama", label: "Local", connected: true, authType: "local" },
    { id: "android-local-gemma", label: "Local", connected: true, authType: "local" },
  ];
  return providers.map((provider) => ({ ...provider, ...(overrides[provider.id] ?? {}) }));
}

assert.equal(shouldOfferCloudBackgroundEscalation("model_timeout"), true);
assert.equal(shouldOfferCloudBackgroundEscalation("blank_model_response"), true);
assert.equal(shouldOfferCloudBackgroundEscalation("weak_answer"), true);
assert.equal(shouldOfferCloudBackgroundEscalation("runtime_cloud_scale_required"), true);
assert.equal(shouldOfferCloudBackgroundEscalation("phone_tool_unavailable"), false);
console.log("OK: local failure signals can offer a task-scoped cloud retry");

{
  const decision = buildCloudBackgroundEscalationDecision({
    requestText: "Use a cloud model for this competitor research.",
    reason: "runtime_cloud_scale_required",
    providers: status(),
  });
  assert.equal(decision.kind, "open_settings");
  assert.equal(decision.liveModelSwitch, false);
  assert.match(decision.message, /Settings/i);
  assert.equal(decision.connectedProviders.length, 0);
  console.log("OK: no connected cloud providers routes the user to Settings");
}

{
  const decision = buildCloudBackgroundEscalationDecision({
    requestText: "Use a cloud model for this.",
    reason: "model_timeout",
    providers: status({
      openai: { connected: true, authType: "oauth", isDefault: true },
    }),
  });
  assert.equal(decision.kind, "confirm_single_provider");
  assert.equal(decision.liveModelSwitch, false);
  assert.equal(decision.connectedProviders.length, 1);
  assert.equal(decision.connectedProviders[0]?.id, "openai");
  assert.equal(decision.connectedProviders[0]?.requiresBudget, false);
  assert.match(decision.message, /use OpenAI/i);
  console.log("OK: one connected OAuth provider still asks before cloud use");
}

{
  const decision = buildCloudBackgroundEscalationDecision({
    requestText: "Use a cloud model for this.",
    reason: "model_timeout",
    providers: status({
      openai: { connected: true, authType: "oauth", isDefault: true },
    }),
    approvedProvider: true,
  });
  assert.equal(decision.kind, "queue_job");
  assert.equal(decision.liveModelSwitch, false);
  assert.equal(decision.job.provider.id, "openai");
  assert.equal(decision.job.budgetUsd, null);
  console.log("OK: single connected provider approval infers the approved provider");
}

{
  const decision = buildCloudBackgroundEscalationDecision({
    requestText: "Research this company overnight.",
    reason: "weak_answer",
    providers: status({
      openai: { connected: true, authType: "api_key", isDefault: true },
      google: { connected: true, authType: "api_key" },
    }),
  });
  assert.equal(decision.kind, "choose_provider");
  assert.equal(decision.liveModelSwitch, false);
  assert.deepEqual(decision.connectedProviders.map((provider) => provider.id), ["openai", "google"]);
  assert.ok(decision.connectedProviders.every((provider) => provider.requiresBudget));
  assert.match(decision.message, /OpenAI/);
  assert.match(decision.message, /Gemini/);
  console.log("OK: multiple connected providers require an explicit provider choice");
}

{
  const decision = buildCloudBackgroundEscalationDecision({
    requestText: "Research this company.",
    reason: "weak_answer",
    providers: status({
      google: { connected: true, authType: "api_key" },
    }),
    selectedProviderId: "google",
    approvedProvider: true,
  });
  assert.equal(decision.kind, "request_budget");
  assert.equal(decision.liveModelSwitch, false);
  assert.match(decision.message, /budget/i);
  console.log("OK: pay-per-token cloud jobs require a per-job budget");
}

{
  const decision = buildCloudBackgroundEscalationDecision({
    requestText: "Research this company.",
    reason: "weak_answer",
    providers: status({
      google: { connected: true, authType: "api_key" },
    }),
    selectedProviderId: "google",
    approvedProvider: true,
    approvedBudgetUsd: CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD - 0.01,
  });
  assert.equal(decision.kind, "request_budget");
  assert.match(decision.message, /\$0\.25/);
  console.log("OK: API-key cloud jobs reject budgets below the minimum first-request budget");
}

{
  const decision = buildCloudBackgroundEscalationDecision({
    requestText: "Research this company.",
    reason: "weak_answer",
    providers: status({
      google: { connected: true, authType: "api_key" },
    }),
    selectedProviderId: "google",
    approvedProvider: true,
    approvedBudgetUsd: 2.5,
  });
  assert.equal(decision.kind, "queue_job");
  assert.equal(decision.liveModelSwitch, false);
  assert.equal(decision.job.provider.id, "google");
  assert.equal(decision.job.budgetUsd, 2.5);
  assert.equal(decision.job.permissionEnvelope.phoneControl, false);
  assert.equal(decision.job.permissionEnvelope.memoryWrite, false);
  console.log("OK: approved API-key jobs queue with budget and restricted permissions");
}

{
  const input = buildCloudBackgroundJobInput({
    prompt: "Research the competitor and write a report.",
    provider: {
      id: "anthropic",
      label: "Claude",
      authType: "api_key",
      requiresBudget: true,
      hint: "Claude API key, budget required",
    },
    budgetUsd: 4,
  });
  assert.equal(input.model, "anthropic/claude-sonnet-4-5");
  assert.equal(input.cloudBackgroundTask.providerId, "anthropic");
  assert.equal(input.cloudBackgroundTask.approvedModel, "anthropic/claude-sonnet-4-5");
  assert.equal(input.cloudBackgroundTask.budgetUsd, 4);
  assert.equal(input.cloudBackgroundTask.liveModelSwitch, false);
  assert.deepEqual(input.cloudBackgroundTask.disallowedCapabilities, ["phone_control", "memory_write"]);
  assert.deepEqual(validateCloudBackgroundJobInput(input), {
    ok: true,
    model: "anthropic/claude-sonnet-4-5",
    task: {
      providerId: "anthropic",
      providerLabel: "Claude",
      providerAuthType: "api_key",
      approvedModel: "anthropic/claude-sonnet-4-5",
      budgetUsd: 4,
    },
  });
  assert.match(input.cloudBackgroundTask.compactVerifiedPacketInstructions, /compact verified packet/i);
  console.log("OK: queued cloud task metadata is task-scoped and forbids phone control/memory writes");
}

{
  assert.equal(getDefaultCloudBackgroundModel({ id: "openai", authType: "oauth" }), CODEX_OAUTH_MODEL);
  assert.equal(getDefaultCloudBackgroundModel({ id: "openai", authType: "api_key" }), "openai/gpt-4.1-mini");
  assert.equal(getDefaultCloudBackgroundModel({ id: "google", authType: "api_key" }), "google/gemini-2.5-flash");
  assert.equal(getDefaultCloudBackgroundModel({ id: "anthropic", authType: "api_key" }), "anthropic/claude-sonnet-4-5");
  assert.equal(maxCloudBackgroundModelTurnsForBudget(0.1, 6), 1);
  assert.equal(maxCloudBackgroundModelTurnsForBudget(3, 6), 6);
  assert.equal(maxCloudBackgroundModelTurnsForBudget(null, 6), 6);
  console.log("OK: approved cloud providers map to concrete worker models");
}

{
  assert.deepEqual(
    validateCloudBackgroundJobInput({
      model: "gpt-4.1-mini",
      cloudBackgroundTask: {
        providerId: "google",
        providerLabel: "Gemini",
        providerAuthType: "api_key",
        approvedModel: "google/gemini-2.5-flash",
        budgetUsd: 3,
        liveModelSwitch: false,
        disallowedCapabilities: ["phone_control", "memory_write"],
      },
    }),
    { ok: false, message: "Cloud background task is not routed through the approved provider." },
  );
  assert.deepEqual(
    validateCloudBackgroundJobInput({
      model: "google/gemini-2.5-flash",
      cloudBackgroundTask: {
        providerId: "google",
        providerLabel: "Gemini",
        providerAuthType: "api_key",
        approvedModel: "google/gemini-2.5-flash",
        liveModelSwitch: false,
        disallowedCapabilities: ["phone_control", "memory_write"],
      },
    }),
    { ok: false, message: "Cloud background task is missing its approved per-job budget." },
  );
  assert.deepEqual(
    validateCloudBackgroundJobInput({
      model: "google/gemini-2.5-flash",
      cloudBackgroundTask: {
        providerId: "google",
        providerLabel: "Gemini",
        providerAuthType: "oauth",
        approvedModel: "google/gemini-2.5-flash",
        budgetUsd: null,
        liveModelSwitch: false,
        disallowedCapabilities: ["phone_control", "memory_write"],
      },
    }),
    { ok: false, message: "Cloud background task uses an unsupported provider authentication route." },
  );
  assert.deepEqual(
    validateCloudBackgroundJobInput(buildCloudBackgroundJobInput({
      prompt: "Research the competitor.",
      provider: {
        id: "google",
        label: "Gemini",
        authType: "api_key",
        requiresBudget: true,
        hint: "Gemini API key, budget required",
      },
      budgetUsd: 0.004,
    })),
    { ok: false, message: "Cloud background task is missing its approved per-job budget." },
  );
  assert.deepEqual(
    validateCloudBackgroundJobInput(buildCloudBackgroundJobInput({
      prompt: "Research the competitor.",
      provider: {
        id: "google",
        label: "Gemini",
        authType: "api_key",
        requiresBudget: true,
        hint: "Gemini API key, budget required",
      },
      budgetUsd: CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD - 0.01,
    })),
    { ok: false, message: "Cloud background task budget is below the minimum required to start." },
  );
  console.log("OK: worker validation rejects wrong-model or unbudgeted cloud jobs");
}

{
  const input = buildCloudBackgroundJobInput({
    prompt: "Research the competitor and write a report.",
    provider: {
      id: "google",
      label: "Gemini",
      authType: "api_key",
      requiresBudget: true,
      hint: "Gemini API key, budget required",
    },
    budgetUsd: CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD,
  });
  const validation = validateCloudBackgroundJobInput(input);
  assert.equal(validation?.ok, true);
  if (validation?.ok !== true) throw new Error("expected valid cloud job input");
  assert.equal(
    nextCloudBackgroundModelStepBudgetCheckpoint({
      jobId: "job-budget-ok",
      task: validation.task,
      spentUsd: 0,
    })?.shouldStopBeforeNextStep,
    false,
  );
  assert.equal(
    nextCloudBackgroundModelStepBudgetCheckpoint({
      jobId: "job-budget-stop",
      task: validation.task,
      spentUsd: CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD - 0.04,
      partialSummary: "Finished the first pass.",
    })?.shouldStopBeforeNextStep,
    true,
  );
  const attemptInput = buildCloudBackgroundJobInput({
    prompt: "Research the competitor and write a report.",
    provider: {
      id: "google",
      label: "Gemini",
      authType: "api_key",
      requiresBudget: true,
      hint: "Gemini API key, budget required",
    },
    budgetUsd: CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD,
  });
  const attemptValidation = validateCloudBackgroundJobInput(attemptInput);
  assert.equal(attemptValidation?.ok, true);
  if (attemptValidation?.ok !== true) throw new Error("expected valid cloud job input");
  assert.equal(
    nextCloudBackgroundModelAttemptBudgetCheckpoint({
      jobId: "job-attempt-ok",
      task: attemptValidation.task,
      spentUsd: 0,
      maxTurns: 1,
    })?.shouldStopBeforeNextStep,
    false,
  );
  assert.equal(
    nextCloudBackgroundModelAttemptBudgetCheckpoint({
      jobId: "job-attempt-stop",
      task: attemptValidation.task,
      spentUsd: CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD - 0.09,
      maxTurns: 1,
      partialSummary: "Finished the first pass.",
    })?.shouldStopBeforeNextStep,
    true,
  );
  console.log("OK: API-key cloud jobs reserve budget before each model attempt");
}

{
  const checkpoint = checkCloudBackgroundBudget({
    jobId: "job-budget",
    providerId: "google",
    spentUsd: 1.92,
    budgetUsd: 2,
    nextEstimatedUsd: 0.12,
    partialSummary: "Found two useful sources and drafted the outline.",
    actions: ["searched public web", "drafted outline"],
  });
  assert.equal(checkpoint.status, "budget_stopped");
  assert.equal(checkpoint.shouldStopBeforeNextStep, true);
  assert.equal(checkpoint.partial, true);
  assert.equal(checkpoint.packet?.status, "budget_stopped");
  assert.equal(checkpoint.packet?.partial, true);
  assert.equal(checkpoint.packet?.spend.budgetUsd, 2);
  console.log("OK: cloud jobs stop before exceeding budget and preserve partial work");
}

{
  const packet = buildCompactCloudBackgroundResultPacket({
    jobId: "job-123",
    providerId: "openai",
    status: "budget_stopped",
    summary: "Found three competitors and drafted half the report.",
    actions: ["searched public web", "drafted outline"],
    partial: true,
    spentUsd: 1.94,
    budgetUsd: 2,
  });
  assert.deepEqual(packet, {
    type: "cloud_background_result",
    jobId: "job-123",
    providerId: "openai",
    status: "budget_stopped",
    partial: true,
    summary: "Found three competitors and drafted half the report.",
    actions: ["searched public web", "drafted outline"],
    spend: { spentUsd: 1.94, budgetUsd: 2 },
  });
  const card = buildCloudBackgroundTaskCard(packet);
  assert.deepEqual(card, {
    type: "cloud_background_task_card",
    jobId: "job-123",
    providerId: "openai",
    status: "budget_stopped",
    summary: "Found three competitors and drafted half the report.",
    partial: true,
    spend: { spentUsd: 1.94, budgetUsd: 2 },
  });
  console.log("OK: cloud job results can return a compact verified packet for Local JARVIS");
}

{
  const cancelled = buildCompactCloudBackgroundResultPacket({
    jobId: "job-cancelled",
    providerId: "anthropic",
    status: "cancelled",
    summary: "Stopped by the user after collecting initial notes.",
    actions: ["collected initial notes"],
    partial: true,
    spentUsd: 0.48,
    budgetUsd: 5,
  });
  const card = buildCloudBackgroundTaskCard(cancelled);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.partial, true);
  assert.equal(card.status, "cancelled");
  assert.equal(card.partial, true);
  assert.deepEqual(card.spend, { spentUsd: 0.48, budgetUsd: 5 });
  console.log("OK: cancelled cloud jobs preserve partial work in the result packet and task card");
}

console.log("\nAll cloud background escalation assertions passed.");
