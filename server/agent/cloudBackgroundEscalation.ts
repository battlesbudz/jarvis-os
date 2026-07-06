import { CODEX_OAUTH_MODEL, type ModelProviderId, type ProviderCredentialKind } from "@shared/modelProviderCatalog";

export type CloudBackgroundEscalationReason =
  | "model_timeout"
  | "blank_model_response"
  | "weak_answer"
  | "runtime_cloud_scale_required"
  | "model_output_invalid"
  | "phone_tool_unavailable"
  | string;

export interface CloudBackgroundProviderStatus {
  id: ModelProviderId | string;
  label: string;
  connected: boolean;
  authType: ProviderCredentialKind | null;
  isDefault?: boolean;
}

export interface CloudBackgroundProviderOption {
  id: string;
  label: string;
  authType: Extract<ProviderCredentialKind, "api_key" | "oauth">;
  requiresBudget: boolean;
  hint: string;
}

export interface CloudBackgroundPermissionEnvelope {
  phoneControl: false;
  memoryWrite: false;
}

export interface CloudBackgroundJobPlan {
  provider: CloudBackgroundProviderOption;
  budgetUsd: number | null;
  permissionEnvelope: CloudBackgroundPermissionEnvelope;
}

export type CloudBackgroundEscalationDecision =
  | {
      kind: "not_offered";
      liveModelSwitch: false;
      message: string;
      connectedProviders: CloudBackgroundProviderOption[];
    }
  | {
      kind: "open_settings";
      liveModelSwitch: false;
      message: string;
      connectedProviders: CloudBackgroundProviderOption[];
    }
  | {
      kind: "confirm_single_provider";
      liveModelSwitch: false;
      message: string;
      connectedProviders: CloudBackgroundProviderOption[];
    }
  | {
      kind: "choose_provider";
      liveModelSwitch: false;
      message: string;
      connectedProviders: CloudBackgroundProviderOption[];
    }
  | {
      kind: "request_budget";
      liveModelSwitch: false;
      message: string;
      connectedProviders: CloudBackgroundProviderOption[];
      provider: CloudBackgroundProviderOption;
    }
  | {
      kind: "queue_job";
      liveModelSwitch: false;
      message: string;
      connectedProviders: CloudBackgroundProviderOption[];
      job: CloudBackgroundJobPlan;
    };

export interface BuildCloudBackgroundEscalationDecisionInput {
  requestText: string;
  reason: CloudBackgroundEscalationReason;
  providers: CloudBackgroundProviderStatus[];
  selectedProviderId?: string | null;
  approvedProvider?: boolean;
  approvedBudgetUsd?: number | null;
}

export interface BuildCloudBackgroundJobInput {
  prompt: string;
  provider: CloudBackgroundProviderOption;
  budgetUsd?: number | null;
}

export interface CloudBackgroundJobInput {
  model: string;
  cloudBackgroundTask: {
    providerId: string;
    providerLabel: string;
    providerAuthType: CloudBackgroundProviderOption["authType"];
    approvedModel: string;
    budgetUsd: number | null;
    liveModelSwitch: false;
    disallowedCapabilities: ["phone_control", "memory_write"];
    compactVerifiedPacketInstructions: string;
    originalPrompt: string;
  };
}

export interface ValidatedCloudBackgroundJobInput {
  providerId: string;
  providerLabel: string;
  providerAuthType: CloudBackgroundProviderOption["authType"];
  approvedModel: string;
  budgetUsd: number | null;
}

export type CloudBackgroundJobInputValidation =
  | { ok: true; model: string; task: ValidatedCloudBackgroundJobInput }
  | { ok: false; message: string }
  | null;

export interface BuildCompactCloudBackgroundResultPacketInput {
  jobId: string;
  providerId: string;
  status: "complete" | "budget_stopped" | "cancelled" | "failed" | "partial";
  summary: string;
  actions: string[];
  partial: boolean;
  spentUsd?: number | null;
  budgetUsd?: number | null;
}

export interface CompactCloudBackgroundResultPacket {
  type: "cloud_background_result";
  jobId: string;
  providerId: string;
  status: BuildCompactCloudBackgroundResultPacketInput["status"];
  partial: boolean;
  summary: string;
  actions: string[];
  spend: {
    spentUsd: number | null;
    budgetUsd: number | null;
  };
}

export interface CloudBackgroundBudgetCheckpointInput {
  jobId: string;
  providerId: string;
  spentUsd?: number | null;
  budgetUsd?: number | null;
  nextEstimatedUsd?: number | null;
  partialSummary?: string | null;
  actions?: string[];
}

export interface CloudBackgroundBudgetCheckpoint {
  status: "within_budget" | "budget_stopped";
  spentUsd: number;
  budgetUsd: number | null;
  remainingUsd: number | null;
  nextEstimatedUsd: number;
  shouldStopBeforeNextStep: boolean;
  partial: boolean;
  message: string;
  packet?: CompactCloudBackgroundResultPacket;
}

export interface CloudBackgroundTaskCard {
  type: "cloud_background_task_card";
  jobId: string;
  providerId: string;
  status: CompactCloudBackgroundResultPacket["status"];
  summary: string;
  partial: boolean;
  spend: CompactCloudBackgroundResultPacket["spend"];
}

const CLOUD_ESCALATION_REASONS = new Set([
  "model_timeout",
  "blank_model_response",
  "weak_answer",
  "runtime_cloud_scale_required",
  "model_output_invalid",
]);

const LOCAL_PROVIDER_IDS = new Set(["local-llama", "android-local-gemma"]);
export const CLOUD_BACKGROUND_MODEL_STEP_ESTIMATE_USD = 0.05;
export const CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD = 0.25;

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function budgetValue(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rounded = Math.round(amount * 100) / 100;
  return rounded > 0 ? rounded : null;
}

function moneyValue(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100) / 100;
}

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function authTypeValue(value: unknown): CloudBackgroundProviderOption["authType"] | null {
  return value === "api_key" || value === "oauth" ? value : null;
}

function providerSupportsCloudAuthType(providerId: string, authType: CloudBackgroundProviderOption["authType"]): boolean {
  if (authType === "oauth") return providerId === "openai";
  return providerId === "openai" || providerId === "anthropic" || providerId === "google";
}

function disallowsCloudTaskCapability(value: unknown, capability: "phone_control" | "memory_write"): boolean {
  return Array.isArray(value) && value.includes(capability);
}

export function getDefaultCloudBackgroundModel(provider: Pick<CloudBackgroundProviderOption, "id" | "authType">): string {
  if (provider.id === "openai" && provider.authType === "oauth") return CODEX_OAUTH_MODEL;
  if (provider.id === "openai") return "openai/gpt-4.1-mini";
  if (provider.id === "anthropic") return "anthropic/claude-sonnet-4-5";
  if (provider.id === "google") return "google/gemini-2.5-flash";
  return "openai/gpt-4.1-mini";
}

export function nextCloudBackgroundModelStepBudgetCheckpoint(input: {
  jobId: string;
  task: ValidatedCloudBackgroundJobInput;
  spentUsd: number;
  partialSummary?: string | null;
  actions?: string[];
}): CloudBackgroundBudgetCheckpoint | null {
  if (input.task.providerAuthType !== "api_key") return null;
  return checkCloudBackgroundBudget({
    jobId: input.jobId,
    providerId: input.task.providerId,
    spentUsd: input.spentUsd,
    budgetUsd: input.task.budgetUsd,
    nextEstimatedUsd: CLOUD_BACKGROUND_MODEL_STEP_ESTIMATE_USD,
    partialSummary: input.partialSummary,
    actions: input.actions,
  });
}

export function nextCloudBackgroundModelAttemptBudgetCheckpoint(input: {
  jobId: string;
  task: ValidatedCloudBackgroundJobInput;
  spentUsd: number;
  maxTurns: number;
  partialSummary?: string | null;
  actions?: string[];
}): CloudBackgroundBudgetCheckpoint | null {
  if (input.task.providerAuthType !== "api_key") return null;
  const reservedTurns = Math.max(1, input.maxTurns) + 1;
  return checkCloudBackgroundBudget({
    jobId: input.jobId,
    providerId: input.task.providerId,
    spentUsd: input.spentUsd,
    budgetUsd: input.task.budgetUsd,
    nextEstimatedUsd: reservedTurns * CLOUD_BACKGROUND_MODEL_STEP_ESTIMATE_USD,
    partialSummary: input.partialSummary,
    actions: input.actions,
  });
}

export function maxCloudBackgroundModelTurnsForBudget(
  budgetUsd: number | null,
  defaultMaxTurns: number,
): number {
  if (budgetUsd === null) return defaultMaxTurns;
  const affordableTurns = Math.floor(budgetUsd / CLOUD_BACKGROUND_MODEL_STEP_ESTIMATE_USD) - 1;
  return Math.max(1, Math.min(defaultMaxTurns, affordableTurns));
}

export function shouldOfferCloudBackgroundEscalation(reason: CloudBackgroundEscalationReason): boolean {
  return CLOUD_ESCALATION_REASONS.has(compact(reason));
}

export function normalizeCloudBackgroundProviders(
  providers: CloudBackgroundProviderStatus[],
): CloudBackgroundProviderOption[] {
  return providers
    .filter((provider) => provider.connected)
    .filter((provider) => !LOCAL_PROVIDER_IDS.has(provider.id))
    .filter((provider) => provider.authType === "api_key" || provider.authType === "oauth")
    .map((provider) => {
      const authType = provider.authType as CloudBackgroundProviderOption["authType"];
      const requiresBudget = authType === "api_key";
      const label = compact(provider.label) || provider.id;
      return {
        id: provider.id,
        label,
        authType,
        requiresBudget,
        hint: requiresBudget ? `${label} API key, budget required` : `${label} subscription, no token budget needed`,
      };
    });
}

export function buildCloudBackgroundEscalationDecision(
  input: BuildCloudBackgroundEscalationDecisionInput,
): CloudBackgroundEscalationDecision {
  const connectedProviders = normalizeCloudBackgroundProviders(input.providers);
  const requestText = compact(input.requestText);

  if (!shouldOfferCloudBackgroundEscalation(input.reason) && !/\bcloud model\b/i.test(requestText)) {
    return {
      kind: "not_offered",
      liveModelSwitch: false,
      connectedProviders,
      message: "I can keep this in the live Local conversation.",
    };
  }

  if (connectedProviders.length === 0) {
    return {
      kind: "open_settings",
      liveModelSwitch: false,
      connectedProviders,
      message: "No cloud provider is connected. Open Settings to add one before starting a cloud background task.",
    };
  }

  const selectedProvider = input.selectedProviderId
    ? connectedProviders.find((provider) => provider.id === input.selectedProviderId)
    : input.approvedProvider && connectedProviders.length === 1
      ? connectedProviders[0]!
      : null;

  if (!selectedProvider) {
    if (connectedProviders.length === 1) {
      return {
        kind: "confirm_single_provider",
        liveModelSwitch: false,
        connectedProviders,
        message: `Should I use ${connectedProviders[0]!.label} for this as a separate cloud background task?`,
      };
    }

    return {
      kind: "choose_provider",
      liveModelSwitch: false,
      connectedProviders,
      message: `Which connected cloud provider should I use for this background task? ${connectedProviders.map((provider) => provider.hint).join("; ")}.`,
    };
  }

  if (!input.approvedProvider) {
    return {
      kind: connectedProviders.length === 1 ? "confirm_single_provider" : "choose_provider",
      liveModelSwitch: false,
      connectedProviders,
      message: `Should I use ${selectedProvider.label} for this as a separate cloud background task?`,
    };
  }

  const approvedBudgetUsd = budgetValue(input.approvedBudgetUsd);
  if (selectedProvider.requiresBudget && approvedBudgetUsd === null) {
    return {
      kind: "request_budget",
      liveModelSwitch: false,
      connectedProviders,
      provider: selectedProvider,
      message: `${selectedProvider.label} uses an API key for cloud work. What per-job budget should I stay under?`,
    };
  }
  if (
    selectedProvider.requiresBudget &&
    approvedBudgetUsd !== null &&
    approvedBudgetUsd < CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD
  ) {
    return {
      kind: "request_budget",
      liveModelSwitch: false,
      connectedProviders,
      provider: selectedProvider,
      message:
        `${selectedProvider.label} cloud background jobs need at least ` +
        `$${CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD.toFixed(2)} so the first model request can run.`,
    };
  }

  return {
    kind: "queue_job",
    liveModelSwitch: false,
    connectedProviders,
    message: `Starting a separate cloud background task with ${selectedProvider.label}. Your live chat model stays Local.`,
    job: {
      provider: selectedProvider,
      budgetUsd: selectedProvider.requiresBudget ? approvedBudgetUsd : null,
      permissionEnvelope: {
        phoneControl: false,
        memoryWrite: false,
      },
    },
  };
}

export function buildCloudBackgroundJobInput(input: BuildCloudBackgroundJobInput): CloudBackgroundJobInput {
  const model = getDefaultCloudBackgroundModel(input.provider);
  return {
    model,
    cloudBackgroundTask: {
      providerId: input.provider.id,
      providerLabel: input.provider.label,
      providerAuthType: input.provider.authType,
      approvedModel: model,
      budgetUsd: input.provider.requiresBudget ? budgetValue(input.budgetUsd) : null,
      liveModelSwitch: false,
      disallowedCapabilities: ["phone_control", "memory_write"],
      compactVerifiedPacketInstructions:
        "Return a compact verified packet with status, summary, actions taken, partial flag, spend, and budget. Do not write MemoryOS or directly control the phone.",
      originalPrompt: compact(input.prompt),
    },
  };
}

export function validateCloudBackgroundJobInput(input: Record<string, unknown>): CloudBackgroundJobInputValidation {
  const rawTask = input.cloudBackgroundTask;
  if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) return null;

  const providerId = compact(recordValue(rawTask, "providerId"));
  const providerLabel = compact(recordValue(rawTask, "providerLabel")) || providerId;
  const providerAuthType = authTypeValue(recordValue(rawTask, "providerAuthType"));
  const approvedModel = compact(recordValue(rawTask, "approvedModel"));
  const model = compact(input.model);
  const budgetUsd = budgetValue(recordValue(rawTask, "budgetUsd"));

  if (!providerId || !providerAuthType) {
    return { ok: false, message: "Cloud background task is missing its approved provider." };
  }
  if (!providerSupportsCloudAuthType(providerId, providerAuthType)) {
    return { ok: false, message: "Cloud background task uses an unsupported provider authentication route." };
  }

  const expectedModel = getDefaultCloudBackgroundModel({ id: providerId, authType: providerAuthType });
  if (!model || model !== expectedModel || approvedModel !== expectedModel) {
    return { ok: false, message: "Cloud background task is not routed through the approved provider." };
  }

  if (recordValue(rawTask, "liveModelSwitch") !== false) {
    return { ok: false, message: "Cloud background task attempted to switch the live chat model." };
  }

  const disallowedCapabilities = recordValue(rawTask, "disallowedCapabilities");
  if (
    !disallowsCloudTaskCapability(disallowedCapabilities, "phone_control") ||
    !disallowsCloudTaskCapability(disallowedCapabilities, "memory_write")
  ) {
    return { ok: false, message: "Cloud background task is missing its restricted permission envelope." };
  }

  if (providerAuthType === "api_key" && budgetUsd === null) {
    return { ok: false, message: "Cloud background task is missing its approved per-job budget." };
  }
  if (
    providerAuthType === "api_key" &&
    budgetUsd !== null &&
    budgetUsd < CLOUD_BACKGROUND_MIN_API_KEY_BUDGET_USD
  ) {
    return { ok: false, message: "Cloud background task budget is below the minimum required to start." };
  }

  return {
    ok: true,
    model,
    task: {
      providerId,
      providerLabel,
      providerAuthType,
      approvedModel,
      budgetUsd: providerAuthType === "api_key" ? budgetUsd : null,
    },
  };
}

export function buildCompactCloudBackgroundResultPacket(
  input: BuildCompactCloudBackgroundResultPacketInput,
): CompactCloudBackgroundResultPacket {
  return {
    type: "cloud_background_result",
    jobId: compact(input.jobId),
    providerId: compact(input.providerId),
    status: input.status,
    partial: input.partial,
    summary: compact(input.summary),
    actions: input.actions.map(compact).filter(Boolean),
    spend: {
      spentUsd: input.spentUsd ?? null,
      budgetUsd: input.budgetUsd ?? null,
    },
  };
}

export function checkCloudBackgroundBudget(
  input: CloudBackgroundBudgetCheckpointInput,
): CloudBackgroundBudgetCheckpoint {
  const spentUsd = moneyValue(input.spentUsd);
  const budgetUsd = budgetValue(input.budgetUsd);
  const nextEstimatedUsd = moneyValue(input.nextEstimatedUsd);
  const remainingUsd = budgetUsd == null ? null : Math.max(0, Math.round((budgetUsd - spentUsd) * 100) / 100);
  const shouldStopBeforeNextStep = budgetUsd != null && spentUsd + nextEstimatedUsd > budgetUsd;

  if (!shouldStopBeforeNextStep) {
    return {
      status: "within_budget",
      spentUsd,
      budgetUsd,
      remainingUsd,
      nextEstimatedUsd,
      shouldStopBeforeNextStep,
      partial: false,
      message: budgetUsd == null
        ? "No pay-per-token budget applies to this cloud background task."
        : `Cloud background task is within budget with $${remainingUsd?.toFixed(2)} remaining.`,
    };
  }

  const summary = compact(input.partialSummary) || "The cloud background task stopped before exceeding the approved budget.";
  return {
    status: "budget_stopped",
    spentUsd,
    budgetUsd,
    remainingUsd,
    nextEstimatedUsd,
    shouldStopBeforeNextStep,
    partial: true,
    message: "Cloud background task stopped before exceeding the approved budget and preserved partial work.",
    packet: buildCompactCloudBackgroundResultPacket({
      jobId: input.jobId,
      providerId: input.providerId,
      status: "budget_stopped",
      summary,
      actions: input.actions ?? [],
      partial: true,
      spentUsd,
      budgetUsd,
    }),
  };
}

export function buildCloudBackgroundTaskCard(packet: CompactCloudBackgroundResultPacket): CloudBackgroundTaskCard {
  return {
    type: "cloud_background_task_card",
    jobId: packet.jobId,
    providerId: packet.providerId,
    status: packet.status,
    summary: packet.summary,
    partial: packet.partial,
    spend: packet.spend,
  };
}
