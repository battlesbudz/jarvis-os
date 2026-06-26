import type OpenAI from "openai";
import { randomUUID } from "node:crypto";

import type { FallbackChainEntry } from "../agent/providers/fallback";
import type { ProviderTurnResult } from "../agent/providers/base";
import type { DaemonOp } from "../daemon/bridge";
import {
  createRuntimeExplanation,
  renderRuntimeExplanation,
  runtimeSource,
  type RuntimeExplanation,
} from "../core/runtime/runtimeExplanation";
import { preflightAndroidRuntimeCapabilityAction } from "./runtimeCapability";

export type PhoneGemmaDiagnosticCheckId =
  | "identity"
  | "ready_response"
  | "simple_math"
  | "memory_lookup"
  | "open_youtube"
  | "cancel_sanity";

export type PhoneGemmaDiagnosticStatus = "passed" | "failed" | "partial" | "skipped";
export type PhoneGemmaRecoveryStatus = "recovered" | "partial" | "failed";
export type PhoneGemmaDiagnosticIntent = "status" | "run_diagnostic" | "fix";

export interface PhoneGemmaDiagnosticCheckResult {
  id: PhoneGemmaDiagnosticCheckId;
  label: string;
  status: PhoneGemmaDiagnosticStatus;
  detail: string;
}

export interface PhoneGemmaDiagnosticKey {
  userId: string;
  deviceId: string;
  model: string;
  profileId: string;
}

export interface PhoneGemmaDiagnosticResult extends PhoneGemmaDiagnosticKey {
  status: Exclude<PhoneGemmaDiagnosticStatus, "skipped">;
  checkedAt: string;
  expiresAt: string;
  checks: PhoneGemmaDiagnosticCheckResult[];
}

export interface PhoneGemmaDiagnosticLookup {
  state: "missing" | "fresh" | "stale";
  result: PhoneGemmaDiagnosticResult | null;
  expiresAt: string | null;
}

export interface PhoneGemmaRecoveryStepResult {
  status: PhoneGemmaDiagnosticStatus;
  detail: string;
}

export interface PhoneGemmaResetApprovalResult {
  approved: boolean;
  gateId?: string;
  reason?: string;
  resetTarget?: PhoneGemmaResetTarget;
}

export interface PhoneGemmaRecoveryResult extends PhoneGemmaDiagnosticKey {
  status: PhoneGemmaRecoveryStatus;
  checkedAt: string;
  steps: Array<PhoneGemmaRecoveryStepResult & { id: "cancel" | "native_idle" | "clear_stale_state" }>;
  preservedModelFiles: true;
  preservedMemories: true;
}

export interface PhoneGemmaDiagnosticDeps {
  now?: () => Date;
  signal?: AbortSignal;
  nativeIdlePollTimeoutMs?: number;
  nativeIdlePollIntervalMs?: number;
  sendAndroidDaemonOp?: (
    userId: string,
    op: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  runIdentityCheck?: (input: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaRecoveryStepResult>;
  runReadyResponseCheck?: (input: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaRecoveryStepResult>;
  runSimpleMathCheck?: (input: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaRecoveryStepResult>;
  runMemoryLookupCheck?: (input: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaRecoveryStepResult>;
  runOpenYoutubeCheck?: (input: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaRecoveryStepResult>;
  runCancelSanityCheck?: (input: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaRecoveryStepResult>;
  requestResetApproval?: (input: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaResetApprovalResult>;
  cancelActiveGeneration?: (input: PhoneGemmaRecoveryKey) => Promise<PhoneGemmaRecoveryStepResult>;
  waitForNativeIdle?: (input: PhoneGemmaRecoveryKey) => Promise<PhoneGemmaRecoveryStepResult>;
  clearStaleRequestState?: (input: PhoneGemmaRecoveryKey) => Promise<PhoneGemmaRecoveryStepResult>;
  writeMemory?: (record: unknown) => Promise<void>;
}

export interface PhoneGemmaResetTarget {
  requestId: string | null;
  scope: "tracked_phone_gemma_request" | "all_active_phone_gemma_generations";
  capturedAt: string;
}

export interface PhoneGemmaRecoveryKey extends PhoneGemmaDiagnosticKey {
  resetTarget?: PhoneGemmaResetTarget;
}

interface ActivePhoneGemmaRequest {
  userId: string;
  requestId: string;
  model: string;
  startedAt: string;
}

const DEFAULT_DIAGNOSTIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_DEVICE_ID = "android-phone";
const DEFAULT_PROFILE_ID = "active";
const DEFAULT_MODEL = "gemma-4-e4b-it";
const DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS = 2048;
const DEFAULT_PHONE_GEMMA_ALLOW_CPU_FALLBACK = false;
const DEFAULT_NATIVE_IDLE_POLL_TIMEOUT_MS = 2_000;
const DEFAULT_NATIVE_IDLE_POLL_INTERVAL_MS = 250;
const YOUTUBE_PACKAGE = "com.google.android.youtube";
const PHONE_GEMMA_ALIAS_PATTERN = /\b(?:phone gemma|local gemma|local model|phone model)\b/;
const PHONE_GEMMA_FIX_PATTERN = /\b(?:fix|reset|unstick|repair|recover|restart|reinitialize)\b/;
const PHONE_GEMMA_CANCEL_RUNTIME_PATTERN = /\b(?:stop|cancel|clear)\b.*\b(?:generation|request|inference|runtime|busy|stuck|hung|stale)\b|\b(?:generation|request|inference|runtime|busy|stuck|hung|stale)\b.*\b(?:stop|cancel|clear)\b/;
const PHONE_GEMMA_RUN_DIAGNOSTIC_PATTERN = /\b(?:run|start|perform|do)\b.*\b(?:diagnostic|diagnostics|test|tests|self test|health check)\b|\b(?:test|check|diagnose)\b\s+(?:the\s+)?(?:phone gemma|local gemma|local model|phone model)\b/;
const PHONE_GEMMA_STATUS_PATTERN = /\b(?:status|health|health check|healthy|working|stable|unstable|ready|validated|validation|passing|pass|passed|failing|failed|broken|diagnostic|diagnostics|test|tests|self test)\b/;

const diagnosticStore = new Map<string, PhoneGemmaDiagnosticResult>();
const activeRequests = new Map<string, ActivePhoneGemmaRequest>();
let phoneGemmaDiagnosticDepsForTesting: PhoneGemmaDiagnosticDeps | null = null;

export function _setPhoneGemmaDiagnosticDepsForTesting(deps: PhoneGemmaDiagnosticDeps | null): void {
  phoneGemmaDiagnosticDepsForTesting = deps;
}

export function clearPhoneGemmaDiagnosticsForTesting(): void {
  diagnosticStore.clear();
  activeRequests.clear();
}

function textFromContent(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function latestUserText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/['`\u2018\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(input: Partial<PhoneGemmaDiagnosticKey> & { userId: string }): PhoneGemmaDiagnosticKey {
  return {
    userId: input.userId.trim(),
    deviceId: input.deviceId?.trim() || DEFAULT_DEVICE_ID,
    model: normalizePhoneGemmaModelId(input.model) || DEFAULT_MODEL,
    profileId: input.profileId?.trim() || DEFAULT_PROFILE_ID,
  };
}

function normalizePhoneGemmaModelId(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("android-local-gemma/")
    ? trimmed.slice("android-local-gemma/".length)
    : trimmed;
}

function storeKey(input: PhoneGemmaDiagnosticKey): string {
  return [
    input.userId.trim(),
    input.deviceId.trim(),
    input.model.trim(),
    input.profileId.trim(),
  ].join("\u001f");
}

function nowFromDeps(deps: PhoneGemmaDiagnosticDeps = {}): Date {
  return (deps.now ?? phoneGemmaDiagnosticDepsForTesting?.now ?? (() => new Date()))();
}

function mergedDeps(deps: PhoneGemmaDiagnosticDeps = {}): PhoneGemmaDiagnosticDeps {
  return { ...(phoneGemmaDiagnosticDepsForTesting ?? {}), ...deps };
}

function createDiagnosticAbortError(message = "Phone Gemma diagnostic was stopped."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfDiagnosticAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createDiagnosticAbortError();
}

function waitForDiagnosticPoll(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfDiagnosticAborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createDiagnosticAbortError());
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function expiresAtFor(checkedAt: string): string {
  return new Date(new Date(checkedAt).getTime() + DEFAULT_DIAGNOSTIC_TTL_MS).toISOString();
}

function statusFromChecks(checks: PhoneGemmaDiagnosticCheckResult[]): PhoneGemmaDiagnosticResult["status"] {
  const runnable = checks.filter((check) => check.status !== "skipped");
  if (runnable.length === 0) return "partial";
  if (runnable.every((check) => check.status === "passed")) return "passed";
  if (runnable.some((check) => check.status === "passed")) return "partial";
  return "failed";
}

function checkLabel(id: PhoneGemmaDiagnosticCheckId): string {
  switch (id) {
    case "identity":
      return "Runtime identity";
    case "ready_response":
      return "READY response";
    case "simple_math":
      return "Simple math";
    case "memory_lookup":
      return "Memory lookup";
    case "open_youtube":
      return "Open YouTube";
    case "cancel_sanity":
      return "Cancel sanity";
  }
}

function toCheckResult(
  id: PhoneGemmaDiagnosticCheckId,
  result: PhoneGemmaRecoveryStepResult,
): PhoneGemmaDiagnosticCheckResult {
  return {
    id,
    label: checkLabel(id),
    status: result.status,
    detail: result.detail,
  };
}

export function recordPhoneGemmaDiagnosticResult(
  input: Omit<PhoneGemmaDiagnosticResult, "expiresAt"> & { expiresAt?: string },
): PhoneGemmaDiagnosticResult {
  const key = normalizeKey(input);
  const checkedAt = input.checkedAt || new Date().toISOString();
  const result: PhoneGemmaDiagnosticResult = {
    ...key,
    status: input.status,
    checkedAt,
    expiresAt: input.expiresAt ?? expiresAtFor(checkedAt),
    checks: input.checks,
  };
  diagnosticStore.set(storeKey(key), result);
  return result;
}

export function getLatestPhoneGemmaDiagnostic(
  input: Partial<PhoneGemmaDiagnosticKey> & { userId: string },
  deps: PhoneGemmaDiagnosticDeps = {},
): PhoneGemmaDiagnosticLookup {
  const key = normalizeKey(input);
  const result = diagnosticStore.get(storeKey(key)) ?? null;
  if (!result) return { state: "missing", result: null, expiresAt: null };
  const expiresAtMs = new Date(result.expiresAt).getTime();
  const nowMs = nowFromDeps(deps).getTime();
  return {
    state: Number.isFinite(expiresAtMs) && expiresAtMs > nowMs ? "fresh" : "stale",
    result,
    expiresAt: result.expiresAt,
  };
}

export function findLatestPhoneGemmaDiagnostic(
  input: { userId: string; deviceId?: string; model?: string; profileId?: string },
  deps: PhoneGemmaDiagnosticDeps = {},
): PhoneGemmaDiagnosticLookup {
  const userId = input.userId.trim();
  const deviceId = input.deviceId?.trim();
  const model = normalizePhoneGemmaModelId(input.model);
  const profileId = input.profileId?.trim();
  if (deviceId && model && profileId) {
    return getLatestPhoneGemmaDiagnostic({ userId, deviceId, model, profileId }, deps);
  }

  const matches = [...diagnosticStore.values()]
    .filter((result) => result.userId === userId)
    .filter((result) => !deviceId || result.deviceId === deviceId)
    .filter((result) => !model || result.model === model)
    .filter((result) => !profileId || result.profileId === profileId)
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());
  const result = matches[0] ?? null;
  if (!result) return { state: "missing", result: null, expiresAt: null };
  const expiresAtMs = new Date(result.expiresAt).getTime();
  const nowMs = nowFromDeps(deps).getTime();
  return {
    state: Number.isFinite(expiresAtMs) && expiresAtMs > nowMs ? "fresh" : "stale",
    result,
    expiresAt: result.expiresAt,
  };
}

export function markPhoneGemmaGenerationStarted(input: {
  userId: string;
  requestId: string;
  model: string;
  startedAt?: string;
}): void {
  const userId = input.userId.trim();
  if (!userId || !input.requestId.trim()) return;
  activeRequests.set(userId, {
    userId,
    requestId: input.requestId,
    model: input.model,
    startedAt: input.startedAt ?? new Date().toISOString(),
  });
}

export function markPhoneGemmaGenerationFinished(input: { userId: string; requestId: string }): void {
  const active = activeRequests.get(input.userId.trim());
  if (active?.requestId === input.requestId) {
    activeRequests.delete(input.userId.trim());
  }
}

export function clearPhoneGemmaStaleRequestState(userId: string, requestId?: string | null): boolean {
  const normalizedUserId = userId.trim();
  if (!requestId) return activeRequests.delete(normalizedUserId);
  const active = activeRequests.get(normalizedUserId);
  if (active?.requestId !== requestId) return false;
  return activeRequests.delete(normalizedUserId);
}

export function classifyPhoneGemmaDiagnosticIntent(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): PhoneGemmaDiagnosticIntent | null {
  const normalized = normalizeQuestion(latestUserText(messages));
  if (!normalized) return null;

  if ((PHONE_GEMMA_FIX_PATTERN.test(normalized) || PHONE_GEMMA_CANCEL_RUNTIME_PATTERN.test(normalized)) &&
    PHONE_GEMMA_ALIAS_PATTERN.test(normalized)) {
    return "fix";
  }

  if (PHONE_GEMMA_RUN_DIAGNOSTIC_PATTERN.test(normalized) &&
    PHONE_GEMMA_ALIAS_PATTERN.test(normalized)) {
    return "run_diagnostic";
  }

  if (PHONE_GEMMA_STATUS_PATTERN.test(normalized) &&
    PHONE_GEMMA_ALIAS_PATTERN.test(normalized)) {
    return "status";
  }

  return null;
}

function providerTurnResult(
  text: string,
  route: FallbackChainEntry | undefined,
  runtimeExplanation?: RuntimeExplanation,
): ProviderTurnResult {
  const renderedText = runtimeExplanation ? renderRuntimeExplanation(runtimeExplanation) : text;
  return {
    textContent: renderedText,
    textChunks: [renderedText],
    toolCallList: [],
    finishReason: "stop",
    providerName: "jarvis-runtime",
    model: route?.model,
    fallbackUsed: false,
    runtimeExplanation,
  };
}

function renderCheckSummary(checks: PhoneGemmaDiagnosticCheckResult[]): string {
  return checks.map((check) => `${check.label}: ${check.status} (${check.detail})`).join("; ");
}

function renderDiagnosticStatusAnswer(lookup: PhoneGemmaDiagnosticLookup): string {
  if (lookup.state === "missing" || !lookup.result) {
    return "I don't have a recent Phone Gemma diagnostic for this device/model/profile yet. Ask me to test Phone Gemma Runtime and I can run the quick diagnostic.";
  }

  const age = lookup.state === "stale" ? "stale" : "current";
  if (lookup.result.status === "passed") {
    return `Phone Gemma passed its ${age} diagnostic for this device/model/profile. ${renderCheckSummary(lookup.result.checks)}`;
  }

  return `Phone Gemma is not passing diagnostics for this device/model/profile. The latest result is ${age} and ${lookup.result.status}. ${renderCheckSummary(lookup.result.checks)}`;
}

async function sendAndroidDaemonOp(
  userId: string,
  op: Record<string, unknown>,
  timeoutMs: number,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const override = deps.sendAndroidDaemonOp ?? phoneGemmaDiagnosticDepsForTesting?.sendAndroidDaemonOp;
  if (override) return override(userId, op, timeoutMs);
  const { sendDaemonOp } = await import("../daemon/bridge");
  return sendDaemonOp(userId, op as DaemonOp, timeoutMs, "android");
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return recordFromUnknown(parsed);
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function activeRequestCountFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  if (Array.isArray(value)) return value.length;
  return null;
}

function activeInferenceRequestCount(data: unknown): number | null {
  const record = recordFromUnknown(data);
  if (!record) return null;

  for (const key of ["activeRequests", "activeRequestCount", "active_requests"]) {
    const count = activeRequestCountFromValue(record[key]);
    if (count !== null) return count;
  }

  const inference = recordFromUnknown(record.inference);
  if (inference) {
    for (const key of ["activeRequests", "activeRequestCount", "active_requests"]) {
      const count = activeRequestCountFromValue(inference[key]);
      if (count !== null) return count;
    }
  }

  const nestedData = recordFromUnknown(record.data);
  return nestedData && nestedData !== record ? activeInferenceRequestCount(nestedData) : null;
}

async function readPhoneGemmaNativeStatus(
  input: PhoneGemmaDiagnosticKey,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return sendAndroidDaemonOp(input.userId, {
    type: "android_local_model_status",
    model: input.model,
  }, 5_000, deps);
}

function textFromDaemonData(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  for (const key of ["text", "response", "output", "content", "message"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

async function generateDiagnosticPrompt(
  input: PhoneGemmaDiagnosticKey,
  prompt: string,
  maxTokens: number,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<{ ok: boolean; text: string; error?: string }> {
  throwIfDiagnosticAborted(deps.signal);
  const requestId = `phone-gemma-diagnostic-${randomUUID()}`;
  let onAbort: (() => void) | null = null;
  const cancelDiagnosticGeneration = () => sendAndroidDaemonOp(input.userId, {
    type: "android_local_model_cancel",
    requestId,
  }, 5_000, deps).catch(() => undefined);
  const generatePromise = sendAndroidDaemonOp(input.userId, {
    type: "android_local_model_generate",
    requestId,
    model: input.model,
    prompt,
    contextTokens: phoneGemmaRuntimeContextTokens(input.profileId),
    maxTokens,
    allowCpuFallback: phoneGemmaRuntimeAllowCpuFallback(),
  }, 45_000, deps);

  const abortPromise = deps.signal
    ? new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        cancelDiagnosticGeneration();
        reject(createDiagnosticAbortError());
      };
      deps.signal?.addEventListener("abort", onAbort, { once: true });
    })
    : null;

  try {
    const result = await (abortPromise ? Promise.race([generatePromise, abortPromise]) : generatePromise);
    if (!result.ok) {
      await cancelDiagnosticGeneration();
      return { ok: false, text: "", error: result.error ?? "Phone Gemma generation failed." };
    }
    return { ok: true, text: textFromDaemonData(result.data) };
  } finally {
    if (onAbort) deps.signal?.removeEventListener("abort", onAbort);
  }
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return /^(?:1|true|yes|on)$/i.test(raw.trim());
}

function contextTokensFromProfile(profileId: string): number | null {
  const match = profileId.match(/(?:^|-)(512|1024|2048|4096)(?:$|-)/);
  return match ? Number(match[1]) : null;
}

function phoneGemmaRuntimeContextTokens(profileId: string): number {
  return contextTokensFromProfile(profileId) ??
    intEnv("ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS", DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS, 512, 4096);
}

function phoneGemmaRuntimeAllowCpuFallback(): boolean {
  return boolEnv("ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK", DEFAULT_PHONE_GEMMA_ALLOW_CPU_FALLBACK);
}

async function defaultIdentityCheck(): Promise<PhoneGemmaRecoveryStepResult> {
  return {
    status: "passed",
    detail: "Jarvis identity is runtime-owned and does not depend on Phone Gemma guessing.",
  };
}

async function defaultReadyResponseCheck(
  input: PhoneGemmaDiagnosticKey,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaRecoveryStepResult> {
  const result = await generateDiagnosticPrompt(input, "Say exactly: READY", 16, deps);
  if (!result.ok) return { status: "failed", detail: result.error ?? "Phone Gemma did not generate." };
  return result.text.trim() === "READY"
    ? { status: "passed", detail: "Returned READY." }
    : { status: "failed", detail: `Expected READY but got: ${result.text.slice(0, 80) || "blank response"}.` };
}

async function defaultSimpleMathCheck(
  input: PhoneGemmaDiagnosticKey,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaRecoveryStepResult> {
  const result = await generateDiagnosticPrompt(
    input,
    "Answer with only the decimal integer for 7 + 5.",
    16,
    deps,
  );
  if (!result.ok) return { status: "failed", detail: result.error ?? "Phone Gemma did not generate." };
  const compact = result.text.replace(/[^0-9]/g, "");
  return compact === "12"
    ? { status: "passed", detail: "7 + 5 matched." }
    : { status: "failed", detail: `7 + 5 response did not match: ${result.text.slice(0, 120) || "blank response"}.` };
}

async function defaultMemoryLookupCheck(input: PhoneGemmaDiagnosticKey): Promise<PhoneGemmaRecoveryStepResult> {
  try {
    const { retrieveMemoryContext } = await import("../memory/memoryOs");
    const context = await retrieveMemoryContext({
      userId: input.userId,
      query: "Jarvis identity user preferred name Phone Gemma diagnostic",
      limit: 3,
      caller: "runtime_memory_inspection",
      skipAccessUpdate: true,
      canonicalOnly: true,
    });
    const retrievalFailed = context.uncertainty.some((item) => /retrieval failed/i.test(item));
    if (retrievalFailed) {
      return { status: "failed", detail: context.uncertainty.join(" ") };
    }
    return {
      status: "passed",
      detail: `MemoryOS read path responded with ${context.items.length} matching record(s).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", detail: `MemoryOS read path failed: ${message}` };
  }
}

async function defaultOpenYoutubeCheck(input: PhoneGemmaDiagnosticKey): Promise<PhoneGemmaRecoveryStepResult> {
  const result = await preflightAndroidRuntimeCapabilityAction(input.userId, "android_open_app");
  if (result.ok) {
    return {
      status: "passed",
      detail: `YouTube resolves deterministically to ${YOUTUBE_PACKAGE}; Android open-app preflight is ready.`,
    };
  }
  return {
    status: "failed",
    detail: `YouTube resolves deterministically to ${YOUTUBE_PACKAGE}, but Android open-app preflight is ${result.status}: ${result.reason}`,
  };
}

async function defaultCancelSanityCheck(
  input: PhoneGemmaDiagnosticKey,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaRecoveryStepResult> {
  const result = await readPhoneGemmaNativeStatus(input, deps);
  if (result.ok) {
    const activeCount = activeInferenceRequestCount(result.data);
    if (activeCount === null) {
      return {
        status: "skipped",
        detail: "Android status did not report active Phone Gemma requests; unscoped cancel was not sent.",
      };
    }
    if (activeCount > 0) {
      return {
        status: "skipped",
        detail: `Phone Gemma is already running ${activeCount} active request(s); cancel sanity skipped to avoid interrupting active generation.`,
      };
    }
    return {
      status: "passed",
      detail: "Phone Gemma is idle; cancel sanity did not send an unscoped cancel request.",
    };
  }
  if (/not connected|not available|unsupported/i.test(result.error ?? "")) {
    return { status: "skipped", detail: result.error ?? "Cancel sanity is not available on this Android runtime." };
  }
  return { status: "failed", detail: result.error ?? "Android did not return Phone Gemma status for cancel sanity." };
}

export async function runPhoneGemmaQuickDiagnostic(
  input: Partial<PhoneGemmaDiagnosticKey> & { userId: string },
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaDiagnosticResult> {
  const key = normalizeKey(input);
  const allDeps = mergedDeps(deps);
  const checks: PhoneGemmaDiagnosticCheckResult[] = [];

  const runners: Array<[PhoneGemmaDiagnosticCheckId, (key: PhoneGemmaDiagnosticKey) => Promise<PhoneGemmaRecoveryStepResult>]> = [
    ["identity", allDeps.runIdentityCheck ?? defaultIdentityCheck],
    ["ready_response", allDeps.runReadyResponseCheck ?? ((runnerKey) => defaultReadyResponseCheck(runnerKey, allDeps))],
    ["simple_math", allDeps.runSimpleMathCheck ?? ((runnerKey) => defaultSimpleMathCheck(runnerKey, allDeps))],
    ["memory_lookup", allDeps.runMemoryLookupCheck ?? defaultMemoryLookupCheck],
    ["open_youtube", allDeps.runOpenYoutubeCheck ?? defaultOpenYoutubeCheck],
    ["cancel_sanity", allDeps.runCancelSanityCheck ?? ((runnerKey) => defaultCancelSanityCheck(runnerKey, allDeps))],
  ];

  for (const [id, runner] of runners) {
    try {
      throwIfDiagnosticAborted(allDeps.signal);
      checks.push(toCheckResult(id, await runner(key)));
    } catch (error) {
      if (isAbortError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      checks.push(toCheckResult(id, { status: "failed", detail: message }));
    }
  }

  return recordPhoneGemmaDiagnosticResult({
    ...key,
    status: statusFromChecks(checks),
    checkedAt: nowFromDeps(allDeps).toISOString(),
    checks,
  });
}

async function defaultCancelActiveGeneration(
  input: PhoneGemmaRecoveryKey,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaRecoveryStepResult> {
  const active = activeRequests.get(input.userId);
  const resetTarget = input.resetTarget;
  if (resetTarget?.scope === "all_active_phone_gemma_generations" && resetTarget.requestId === null) {
    const activeStartedAt = active ? new Date(active.startedAt).getTime() : Number.NaN;
    const capturedAt = new Date(resetTarget.capturedAt).getTime();
    if (active && Number.isFinite(activeStartedAt) && Number.isFinite(capturedAt) && activeStartedAt > capturedAt) {
      return {
        status: "failed",
        detail: "A newer Phone Gemma request started after reset approval was created, so I did not cancel it. Ask to reset Phone Gemma again to approve the current request.",
      };
    }
  }
  const requestId = resetTarget?.requestId ?? active?.requestId;
  const result = await sendAndroidDaemonOp(input.userId, {
    type: "android_local_model_cancel",
    ...(requestId ? { requestId } : {}),
  }, 5_000, deps);
  if (result.ok) return { status: "passed", detail: "Android acknowledged the Phone Gemma cancel request." };
  return { status: "failed", detail: result.error ?? "Android did not acknowledge the Phone Gemma cancel request." };
}

async function defaultRequestResetApproval(
  input: PhoneGemmaDiagnosticKey,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaResetApprovalResult> {
  const active = activeRequests.get(input.userId);
  const resetTarget: PhoneGemmaResetTarget = {
    requestId: active?.requestId ?? null,
    scope: active?.requestId ? "tracked_phone_gemma_request" : "all_active_phone_gemma_generations",
    capturedAt: nowFromDeps(deps).toISOString(),
  };
  const toolArgs = {
    surface: "android",
    action: "android_local_model_cancel",
    model: input.model,
    deviceId: input.deviceId,
    profileId: input.profileId,
    requestId: resetTarget.requestId,
    scope: resetTarget.scope,
    capturedAt: resetTarget.capturedAt,
  };
  const description = active?.requestId
    ? `Reset Phone Gemma Runtime by cancelling Android local model request ${active.requestId}.`
    : "Reset Phone Gemma Runtime by sending Android daemon cancel for active local Gemma generations.";

  try {
    const { requestApproval, awaitApproval } = await import("../agent/agentApproval");
    const gate = await requestApproval({
      agentId: "jarvis-runtime",
      userId: input.userId,
      toolName: "daemon_action",
      toolArgs,
      description,
      ttlMs: 5 * 60 * 1000,
      initiatedBy: "user",
    });
    if (gate.status === "approved") {
      return { approved: true, gateId: gate.id, resetTarget };
    }
    const approved = await awaitApproval(gate.id, 5 * 60 * 1000, deps.signal);
    return approved
      ? { approved: true, gateId: gate.id, resetTarget }
      : { approved: false, gateId: gate.id, reason: "Approval is required before resetting Phone Gemma Runtime." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { approved: false, reason: `Approval gate failed before resetting Phone Gemma Runtime: ${message}` };
  }
}

async function defaultWaitForNativeIdle(
  input: PhoneGemmaRecoveryKey,
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaRecoveryStepResult> {
  const timeoutMs = Math.max(0, deps.nativeIdlePollTimeoutMs ?? DEFAULT_NATIVE_IDLE_POLL_TIMEOUT_MS);
  const intervalMs = Math.max(1, deps.nativeIdlePollIntervalMs ?? DEFAULT_NATIVE_IDLE_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let lastActiveCount: number | null = null;

  while (true) {
    throwIfDiagnosticAborted(deps.signal);
    const result = await readPhoneGemmaNativeStatus(input, deps);
    if (!result.ok) {
      if (/not connected|not available|unsupported/i.test(result.error ?? "")) {
        return {
          status: "skipped",
          detail: result.error ?? "Native idle confirmation is not available on this Android runtime.",
        };
      }
      return {
        status: "failed",
        detail: result.error ?? "Android did not return Phone Gemma model status after cancellation.",
      };
    }

    const activeCount = activeInferenceRequestCount(result.data);
    if (activeCount === 0) {
      return {
        status: "passed",
        detail: "Android confirmed Phone Gemma has no active native requests after cancellation.",
      };
    }
    if (activeCount === null) {
      return {
        status: "failed",
        detail: "Android status did not report active Phone Gemma request count, so native idle could not be confirmed.",
      };
    }

    lastActiveCount = activeCount;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await waitForDiagnosticPoll(Math.min(intervalMs, remainingMs), deps.signal);
  }

  if (lastActiveCount !== null) {
    return {
      status: "failed",
      detail: `Android still reports ${lastActiveCount} active Phone Gemma native request(s) after waiting for cancellation to settle.`,
    };
  }

  return {
    status: "failed",
    detail: "Android status did not report whether Phone Gemma became idle after cancellation.",
  };
}

async function defaultClearStaleRequestState(input: PhoneGemmaRecoveryKey): Promise<PhoneGemmaRecoveryStepResult> {
  const requestId = input.resetTarget?.requestId;
  const cleared = clearPhoneGemmaStaleRequestState(input.userId, requestId);
  if (requestId && !cleared) {
    return {
      status: "skipped",
      detail: `Tracked Phone Gemma request ${requestId} was no longer active in Jarvis server state; current request tracking was left untouched.`,
    };
  }
  return {
    status: "passed",
    detail: cleared
      ? "Cleared Jarvis server stale Phone Gemma request state."
      : "Jarvis server had no stale Phone Gemma request state to clear.",
  };
}

function recoveryStatusFromSteps(steps: PhoneGemmaRecoveryResult["steps"]): PhoneGemmaRecoveryStatus {
  const required = steps.filter((step) => step.id !== "native_idle" || step.status !== "skipped");
  if (required.every((step) => step.status === "passed" || step.status === "skipped")) return "recovered";
  if (required.some((step) => step.status === "passed")) return "partial";
  return "failed";
}

export async function fixPhoneGemmaLocalModel(
  input: Partial<PhoneGemmaDiagnosticKey> & { userId: string; resetTarget?: PhoneGemmaResetTarget },
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<PhoneGemmaRecoveryResult> {
  const key: PhoneGemmaRecoveryKey = {
    ...normalizeKey(input),
    ...(input.resetTarget ? { resetTarget: input.resetTarget } : {}),
  };
  const allDeps = mergedDeps(deps);
  throwIfDiagnosticAborted(allDeps.signal);
  const cancel = await (allDeps.cancelActiveGeneration ?? ((runnerKey) => defaultCancelActiveGeneration(runnerKey, allDeps)))(key);
  throwIfDiagnosticAborted(allDeps.signal);
  const nativeIdle = await (allDeps.waitForNativeIdle ?? ((runnerKey) => defaultWaitForNativeIdle(runnerKey, allDeps)))(key);
  throwIfDiagnosticAborted(allDeps.signal);
  const canClearStaleState = cancel.status === "passed" && nativeIdle.status !== "failed";
  const clear = canClearStaleState
    ? await (allDeps.clearStaleRequestState ?? defaultClearStaleRequestState)(key)
    : {
      status: "skipped" as const,
      detail: "Kept Jarvis server Phone Gemma request state so a later reset can retry the tracked request.",
    };
  const steps: PhoneGemmaRecoveryResult["steps"] = [
    { id: "cancel", ...cancel },
    { id: "native_idle", ...nativeIdle },
    { id: "clear_stale_state", ...clear },
  ];

  return {
    userId: key.userId,
    deviceId: key.deviceId,
    model: key.model,
    profileId: key.profileId,
    status: recoveryStatusFromSteps(steps),
    checkedAt: nowFromDeps(allDeps).toISOString(),
    steps,
    preservedModelFiles: true,
    preservedMemories: true,
  };
}

function renderRecoveryAnswer(result: PhoneGemmaRecoveryResult): string {
  const stepText = result.steps
    .map((step) => `${step.id.replace(/_/g, " ")}: ${step.status} (${step.detail})`)
    .join("; ");
  if (result.status === "recovered") {
    return `I reset Phone Gemma Runtime. ${stepText}. Model files and memories were preserved.`;
  }
  if (result.status === "partial") {
    return `I partially reset Phone Gemma Runtime, but one check still needs attention. ${stepText}. Model files and memories were preserved.`;
  }
  return `I could not reset Phone Gemma Runtime cleanly. ${stepText}. Model files and memories were preserved.`;
}

function renderResetApprovalAnswer(result: PhoneGemmaResetApprovalResult): string {
  const gateText = result.gateId ? ` Gate ID: ${result.gateId}.` : "";
  const reason = result.reason ?? "Approval is required before resetting Phone Gemma Runtime.";
  return `${reason}${gateText} Review the approval request before I cancel any Android local model work.`;
}

export async function answerPhoneGemmaDiagnosticQuestion(
  input: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    userId?: string;
    route: FallbackChainEntry | undefined;
    deviceId?: string;
    model?: string;
    profileId?: string;
    signal?: AbortSignal;
  },
  deps: PhoneGemmaDiagnosticDeps = {},
): Promise<ProviderTurnResult | null> {
  const intent = classifyPhoneGemmaDiagnosticIntent(input.messages);
  if (!intent) return null;

  const userId = input.userId?.trim();
  if (!userId) {
    const explanation = createRuntimeExplanation({
      title: "Authentication required",
      message: "Authentication/runtime error: Jarvis needs a signed-in user before checking Phone Gemma diagnostics.",
      severity: "error",
      attemptedSources: [runtimeSource("Diagnostics")],
    });
    return providerTurnResult(explanation.message, input.route, explanation);
  }

  const deviceId = input.deviceId?.trim();
  const model = normalizePhoneGemmaModelId(input.model || (input.route?.providerName === "android-local-gemma" ? input.route.model : undefined));
  const profileId = input.profileId?.trim();
  const key = normalizeKey({
    userId,
    deviceId,
    model,
    profileId,
  });
  const diagnosticDeps = mergedDeps({
    ...deps,
    signal: input.signal ?? deps.signal,
  });

  if (intent === "fix") {
    const approval = await (diagnosticDeps.requestResetApproval ?? ((approvalKey) => defaultRequestResetApproval(approvalKey, diagnosticDeps)))(key);
    if (!approval.approved) {
      const message = renderResetApprovalAnswer(approval);
      const explanation = createRuntimeExplanation({
        title: "Approval required",
        message,
        severity: "warning",
        attemptedSources: [runtimeSource("Diagnostics")],
        actions: approval.gateId
          ? [{ id: "review_approval_gate", label: "Review approval", kind: "open_settings" }]
          : [{ id: "check_phone_gemma_settings", label: "Check Phone Gemma settings", kind: "open_settings" }],
      });
      return providerTurnResult(message, input.route, explanation);
    }
    const recovery = await fixPhoneGemmaLocalModel({
      ...key,
      ...(approval.resetTarget ? { resetTarget: approval.resetTarget } : {}),
    }, diagnosticDeps);
    const message = renderRecoveryAnswer(recovery);
    const explanation = createRuntimeExplanation({
      title: "Phone Gemma reset",
      message,
      severity: recovery.status === "recovered" ? "info" : "warning",
      usedSources: [runtimeSource("Diagnostics")],
      actions: recovery.status === "recovered"
        ? [{ id: "run_phone_gemma_diagnostic", label: "Test Phone Gemma", kind: "retry" }]
        : [{ id: "check_phone_gemma_settings", label: "Check Phone Gemma settings", kind: "open_settings" }],
    });
    return providerTurnResult(message, input.route, explanation);
  }

  if (intent === "run_diagnostic") {
    const result = await runPhoneGemmaQuickDiagnostic(key, diagnosticDeps);
    const message = renderDiagnosticStatusAnswer({ state: "fresh", result, expiresAt: result.expiresAt });
    const explanation = createRuntimeExplanation({
      title: "Phone Gemma diagnostic",
      message,
      severity: result.status === "passed" ? "info" : "warning",
      usedSources: [runtimeSource("Diagnostics")],
      actions: result.status === "passed" ? [] : [{ id: "fix_phone_gemma", label: "Fix Phone Gemma", kind: "retry" }],
    });
    return providerTurnResult(message, input.route, explanation);
  }

  const lookup = findLatestPhoneGemmaDiagnostic({
    userId,
    deviceId,
    model,
    profileId,
  }, deps);
  const message = renderDiagnosticStatusAnswer(lookup);
  const explanation = createRuntimeExplanation({
    title: "Phone Gemma status",
    message,
    severity: lookup.state === "fresh" && lookup.result?.status === "passed" ? "info" : "warning",
    usedSources: lookup.result ? [runtimeSource("Diagnostics")] : [],
    attemptedSources: lookup.result ? [] : [runtimeSource("Diagnostics")],
    actions: lookup.state === "missing"
      ? [{ id: "run_phone_gemma_diagnostic", label: "Test Phone Gemma", kind: "retry" }]
      : lookup.result?.status === "passed"
        ? []
        : [{ id: "fix_phone_gemma", label: "Fix Phone Gemma", kind: "retry" }],
  });
  return providerTurnResult(message, input.route, explanation);
}
