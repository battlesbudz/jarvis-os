import {
  formatAndroidNotificationsInOrder,
  resolveAndroidNotificationReference,
  summarizeAndroidNotifications,
} from "./agent/androidNotificationSummary";
import { LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS } from "./state/runtimeWorkingContext";

export type LocalVoiceModelCallKind = "local_gemma" | "cloud_model" | "secondary_llm";

export interface LocalVoiceModelCall {
  kind: LocalVoiceModelCallKind;
  provider: string;
  model: string;
  reason?: string;
}

export type LocalVoiceCapability =
  | "notifications"
  | "screen"
  | "app_control"
  | "clipboard"
  | "approval"
  | "scheduler"
  | "service";

export type LocalVoiceToolName =
  | "android_read_notifications"
  | "android_read_screen_context"
  | "android_capture_screen"
  | "android_open_app_by_name"
  | "android_copy_to_clipboard"
  | "runtime_request_approval"
  | "runtime_scheduler_status"
  | "runtime_service_status";

export type ScriptedLocalGemmaStep =
  | { type: "final"; text: string }
  | { type: "tool_call"; name: string; arguments?: Record<string, unknown> | string }
  | { type: "invalid_tool_call"; name: string; arguments?: Record<string, unknown> | string }
  | { type: "malformed_output"; raw: string }
  | { type: "blank_response" }
  | { type: "timeout"; afterMs?: number }
  | { type: "false_denial"; capability: LocalVoiceCapability; text?: string }
  | { type: "false_completion"; action: string; text?: string };

export interface ScriptedLocalGemmaPrompt {
  transcript: string;
  contextPacket: string;
}

export class ScriptedFakeLocalGemmaProvider {
  private cursor = 0;
  readonly prompts: ScriptedLocalGemmaPrompt[] = [];

  constructor(private readonly script: ScriptedLocalGemmaStep[]) {}

  async generate(prompt: ScriptedLocalGemmaPrompt): Promise<ScriptedLocalGemmaStep> {
    this.prompts.push(prompt);
    return this.script[this.cursor++] ?? { type: "blank_response" };
  }
}

export interface LocalVoiceNotification {
  app: string;
  title: string;
  text?: string;
  receivedAt?: string;
}

export type LocalVoiceAndroidEvent =
  | { type: "notification"; notifications: LocalVoiceNotification[] }
  | { type: "screen"; activeApp: string; title?: string; text: string; elements?: string[] }
  | { type: "app_control"; appName: string; action: "open" | "search" | "tap" | "type"; success?: boolean; detail?: string }
  | { type: "clipboard"; text: string }
  | { type: "approval"; action: string; approved: boolean }
  | { type: "scheduler"; activeJobs: string[]; pausedJobs?: string[] }
  | { type: "crash"; service: string; message: string };

export interface FakeAndroidExecution {
  toolName: LocalVoiceToolName;
  ok: boolean;
  label: string;
  detail: string;
  data?: {
    notifications?: LocalVoiceNotification[];
  };
}

export interface LocalVoiceNotificationWorkingContext {
  notifications: LocalVoiceNotification[];
  summary: string;
  orderedDetail: string;
  recordedAt: string;
  expiresAt: string;
}

export interface LocalVoiceWorkingContext {
  notifications?: LocalVoiceNotificationWorkingContext;
}

export interface LocalVoiceHarnessDiagnostics {
  outcome: string;
  requestedToolName?: string;
  executedToolName?: LocalVoiceToolName;
  recoveredToolName?: LocalVoiceToolName;
  modelOutputType: ScriptedLocalGemmaStep["type"];
}

export interface LocalVoiceHarnessResult {
  transcript: string;
  canonicalResponse: string;
  chatOutput: string;
  ttsOutput: string;
  responseCount: number;
  modelCalls: LocalVoiceModelCall[];
  androidExecutions: FakeAndroidExecution[];
  workingContext: LocalVoiceWorkingContext;
  diagnostics: LocalVoiceHarnessDiagnostics;
}

export interface LocalVoiceHarnessInput {
  userId: string;
  transcript: string;
  gemma: ScriptedFakeLocalGemmaProvider;
  androidEvents?: LocalVoiceAndroidEvent[];
  workingContext?: LocalVoiceWorkingContext;
  now?: Date;
  simulateCloudRoute?: boolean;
  simulateSecondaryLlmRoute?: boolean;
}

export class LocalVoiceRuntimeHarnessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly modelCalls: LocalVoiceModelCall[],
  ) {
    super(message);
    this.name = "LocalVoiceRuntimeHarnessError";
  }
}

const TOOL_ALIASES: Record<string, LocalVoiceToolName> = {
  android_read_notifications: "android_read_notifications",
  android_read_notification: "android_read_notifications",
  android_notifications_list: "android_read_notifications",
  android_capture_screen: "android_capture_screen",
  android_view_screenshot: "android_capture_screen",
  android_screenshot: "android_capture_screen",
  android_read_screen: "android_read_screen_context",
  android_read_screen_context: "android_read_screen_context",
  android_open_app: "android_open_app_by_name",
  android_open_app_by_name: "android_open_app_by_name",
  android_copy_to_clipboard: "android_copy_to_clipboard",
  copy_to_clipboard: "android_copy_to_clipboard",
  runtime_request_approval: "runtime_request_approval",
  runtime_scheduler_status: "runtime_scheduler_status",
  runtime_service_status: "runtime_service_status",
};

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function latestEvent<T extends LocalVoiceAndroidEvent["type"]>(
  events: LocalVoiceAndroidEvent[],
  type: T,
): Extract<LocalVoiceAndroidEvent, { type: T }> | null {
  const event = [...events].reverse().find((candidate) => candidate.type === type);
  return (event ?? null) as Extract<LocalVoiceAndroidEvent, { type: T }> | null;
}

export function normalizeLocalVoiceToolName(name: string): LocalVoiceToolName | null {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/\s*[_-]\s*/g, "_")
    .replace(/\s+/g, "_");
  return TOOL_ALIASES[normalized] ?? null;
}

function capabilityToolName(capability: LocalVoiceCapability): LocalVoiceToolName {
  switch (capability) {
    case "notifications":
      return "android_read_notifications";
    case "screen":
      return "android_read_screen_context";
    case "app_control":
      return "android_open_app_by_name";
    case "clipboard":
      return "android_copy_to_clipboard";
    case "approval":
      return "runtime_request_approval";
    case "scheduler":
      return "runtime_scheduler_status";
    case "service":
      return "runtime_service_status";
  }
}

function inferRequestedAppName(transcript: string): string {
  const matches = [
    ...transcript.matchAll(
      /\b(?:open|launch|start)\s+(?:the\s+)?([a-z0-9][a-z0-9 ._-]*?)(?=(?:\s+(?:but|and|then)\s+(?:open|launch|start)\b|\s+instead|\s+please|\s+for me|[.!?;,]|$))/gi,
    ),
  ];

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const matchIndex = match.index ?? 0;
    const prefix = transcript.slice(Math.max(0, matchIndex - 48), matchIndex);
    const clausePrefix = prefix.split(/[.!?;,]|\b(?:but|and|then)\b/i).at(-1) ?? prefix;
    if (/\b(?:don't|dont|do not|never|stop|didn't|did not|not|no)\b/i.test(clausePrefix)) {
      continue;
    }

    const appName = compactText(match[1])
      .replace(/\s+app$/i, "")
      .trim();
    if (appName) return appName;
  }

  return "";
}

function argsForRecoveredCapability(
  capability: LocalVoiceCapability,
  transcript: string,
  _events: LocalVoiceAndroidEvent[],
): Record<string, unknown> {
  if (capability !== "app_control") return {};

  const appName = inferRequestedAppName(transcript);
  return appName ? { appName } : {};
}

function capabilityRequestPattern(capability: LocalVoiceCapability): RegExp {
  switch (capability) {
    case "notifications":
      return /\bnotifications?\b/i;
    case "screen":
      return /\b(?:screen|screenshot|screen grab|display)\b/i;
    case "app_control":
      return /\b(?:open|launch|start)\b/i;
    case "clipboard":
      return /\b(?:clipboard|copy)\b/i;
    case "approval":
      return /\b(?:approve|approval|confirm|confirmation)\b/i;
    case "scheduler":
      return /\b(?:scheduler|jobs?|tasks?)\b/i;
    case "service":
      return /\b(?:service|daemon|runtime|crash|status)\b/i;
  }
}

function hasNegatedCapabilityRequest(capability: LocalVoiceCapability, transcript: string): boolean {
  const requestPattern = capabilityRequestPattern(capability);
  const clauses = compactText(transcript)
    .split(/[.!?;,]|\b(?:but|then)\b|\band\s+(?=(?:open|launch|start|read|show|check|copy|approve|confirm|request|take|capture)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (!requestPattern.test(clause)) continue;
    return /\b(?:don't|dont|do not|never|stop|didn't|did not|not|no)\b/i.test(clause);
  }

  return false;
}

function notificationWorkingContextActive(
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
): LocalVoiceNotificationWorkingContext | null {
  const notifications = workingContext?.notifications;
  if (!notifications) return null;
  const expiresAt = Date.parse(notifications.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime() ? notifications : null;
}

function queryNeedsNotificationWorkingContext(transcript: string): boolean {
  return /\bnotifications?\b/i.test(transcript) ||
    (/\b(?:summari[sz]e|read|open|show|tell me|repeat|again|rest|all|which)\b/i.test(transcript) &&
      /\b(?:it|that|those|them|one|ones|last|previous|again|rest|all)\b/i.test(transcript));
}

function wantsNotificationSummaryFollowUp(transcript: string): boolean {
  return /\b(?:summari[sz]e|repeat|tell me|which|what|again)\b/i.test(transcript) &&
    /\b(?:that|those|them|last|previous|again)\b/i.test(transcript);
}

function contextPacketFromEvents(
  events: LocalVoiceAndroidEvent[],
  transcript: string,
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
): string {
  const eventTypes = [...new Set(events.map((event) => event.type))].join(", ") || "none";
  const packet = [
    "Assistant: JARVIS",
    "Mode: Local",
    "Model: Gemma",
    `Available phone event fixtures: ${eventTypes}`,
  ];
  const recentNotifications = notificationWorkingContextActive(workingContext, now);
  if (recentNotifications && queryNeedsNotificationWorkingContext(transcript)) {
    packet.push(`Recent notifications: ${recentNotifications.summary}`);
  }
  return packet.join("\n");
}

export class FakeAndroidVoiceRuntime {
  readonly executions: FakeAndroidExecution[] = [];

  constructor(private readonly events: LocalVoiceAndroidEvent[]) {}

  get availableEventTypes(): LocalVoiceAndroidEvent["type"][] {
    return [...new Set(this.events.map((event) => event.type))];
  }

  execute(toolName: LocalVoiceToolName, args: Record<string, unknown> = {}): FakeAndroidExecution {
    let execution: FakeAndroidExecution;
    switch (toolName) {
      case "android_read_notifications": {
        const event = latestEvent(this.events, "notification");
        const notifications = event?.notifications ?? [];
        execution = {
          toolName,
          ok: !!event,
          label: notifications.length ? `${notifications.length} notification${notifications.length === 1 ? "" : "s"}` : "No notifications available",
          detail: notifications.length ? formatAndroidNotificationsInOrder(notifications) : "",
          data: { notifications },
        };
        break;
      }
      case "android_read_screen_context":
      case "android_capture_screen": {
        const event = latestEvent(this.events, "screen");
        execution = {
          toolName,
          ok: !!event,
          label: event ? `Screen: ${event.activeApp}` : "No screen context available",
          detail: event ? [event.title, event.text, ...(event.elements ?? [])].filter(Boolean).join("\n") : "",
        };
        break;
      }
      case "android_open_app_by_name": {
        const requestedApp = compactText(args.appName) || compactText(args.app) || "requested app";
        const event = latestEvent(this.events, "app_control");
        const requestedAppKey = requestedApp.toLowerCase();
        const eventAppKey = compactText(event?.appName).toLowerCase();
        const ok = !!event && event.action === "open" && eventAppKey === requestedAppKey && event.success !== false;
        execution = {
          toolName,
          ok,
          label: ok ? `Opened ${event.appName}` : `Could not open ${requestedApp}`,
          detail: event?.detail ?? "",
        };
        break;
      }
      case "android_copy_to_clipboard": {
        const event = latestEvent(this.events, "clipboard");
        execution = {
          toolName,
          ok: !!event,
          label: event ? "Copied to clipboard" : "No clipboard text available",
          detail: event?.text ?? "",
        };
        break;
      }
      case "runtime_request_approval": {
        const event = latestEvent(this.events, "approval");
        execution = {
          toolName,
          ok: !!event && event.approved,
          label: event ? `${event.action}: ${event.approved ? "approved" : "denied"}` : "No approval response available",
          detail: "",
        };
        break;
      }
      case "runtime_scheduler_status": {
        const event = latestEvent(this.events, "scheduler");
        execution = {
          toolName,
          ok: !!event,
          label: event ? `${event.activeJobs.length} active job${event.activeJobs.length === 1 ? "" : "s"}` : "No scheduler snapshot available",
          detail: event ? [...event.activeJobs, ...(event.pausedJobs ?? []).map((job) => `paused: ${job}`)].join("\n") : "",
        };
        break;
      }
      case "runtime_service_status": {
        const event = latestEvent(this.events, "crash");
        execution = {
          toolName,
          ok: !event,
          label: event ? `${event.service} crashed` : "No service crash recorded",
          detail: event?.message ?? "",
        };
        break;
      }
    }

    this.executions.push(execution);
    return execution;
  }
}

function parseToolArguments(value: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function workingContextFromNotificationExecution(
  execution: FakeAndroidExecution,
  now: Date,
): LocalVoiceWorkingContext | null {
  if (execution.toolName !== "android_read_notifications" || !execution.ok) return null;
  const notifications = execution.data?.notifications ?? [];
  const recordedAt = now.toISOString();
  return {
    notifications: {
      notifications,
      summary: summarizeAndroidNotifications(notifications),
      orderedDetail: formatAndroidNotificationsInOrder(notifications),
      recordedAt,
      expiresAt: new Date(now.getTime() + LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS).toISOString(),
    },
  };
}

function mergeWorkingContext(
  current: LocalVoiceWorkingContext | undefined,
  next: LocalVoiceWorkingContext | null,
): LocalVoiceWorkingContext {
  return {
    ...(current ?? {}),
    ...(next ?? {}),
  };
}

function wantsOrderedNotificationRead(transcript: string): boolean {
  return /\b(?:read|list|show)\b[\s\S]{0,32}\b(?:all|rest|each|everything|every one|them)\b/i.test(transcript) ||
    /\b(?:all|rest|each|everything|every one)\b[\s\S]{0,32}\bnotifications?\b/i.test(transcript);
}

function notificationWorkingContextClauses(transcript: string): string[] {
  return compactText(transcript)
    .split(/[.!?;,]|\b(?:but|then)\b|\band\s+(?=(?:(?:don't|dont|do not|never|stop|didn't|did not|not|no)\s+)?(?:open|launch|start|read|show|check|summari[sz]e|repeat|tell|tap|go)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function clauseIsNegated(clause: string): boolean {
  return /\b(?:don't|dont|do not|never|stop|didn't|did not|not|no)\b/i.test(clause);
}

function wantsNotificationReferenceOpen(transcript: string, notifications: LocalVoiceNotification[]): boolean {
  return /\b(?:open|launch|show|tap|go to)\b/i.test(transcript) &&
    resolveAndroidNotificationReference(notifications, transcript) !== null;
}

function wantsNotificationReferenceRead(transcript: string, notifications: LocalVoiceNotification[]): boolean {
  return /\b(?:read|repeat)\b/i.test(transcript) &&
    resolveAndroidNotificationReference(notifications, transcript) !== null;
}

function isNegatedNotificationCancellationClause(clause: string, notifications: LocalVoiceNotification[]): boolean {
  if (!clauseIsNegated(clause)) return false;
  if (!/\b(?:open|launch|show|tap|go to|read|repeat)\b/i.test(clause)) return false;
  if (!/\b(?:it|that|this|one)\b/i.test(clause)) return false;
  return resolveAndroidNotificationReference(notifications, clause) === null;
}

function negatedReferenceCancelsEarlierClause(
  clauses: string[],
  negatedClauseIndex: number,
  negatedClause: string,
  notifications: LocalVoiceNotification[],
  action: "open" | "read",
): boolean {
  const negatedMatch = resolveAndroidNotificationReference(notifications, negatedClause);
  if (!negatedMatch) return false;
  const earlierClauses = clauses.slice(0, negatedClauseIndex);
  return earlierClauses.some((clause) => {
    if (clauseIsNegated(clause)) return false;
    const hasSameAction = action === "open"
      ? wantsNotificationReferenceOpen(clause, notifications)
      : wantsNotificationReferenceRead(clause, notifications);
    if (!hasSameAction) return false;
    const earlierMatch = resolveAndroidNotificationReference(notifications, clause);
    return earlierMatch?.index === negatedMatch.index;
  });
}

function notificationReferenceText(notification: LocalVoiceNotification): string {
  const message = [notification.title, notification.text].filter(Boolean).join(": ") || "(no notification text)";
  return `${notification.app}: ${message}`;
}

function activeNotificationWorkingContextRequest(
  transcript: string,
  notifications: LocalVoiceNotification[],
): { clause: string; orderedRead: boolean; referenceOpen: boolean; referenceRead: boolean; summaryFollowUp: boolean } | null {
  const clauses = notificationWorkingContextClauses(transcript);
  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (isNegatedNotificationCancellationClause(clause, notifications)) return null;
    const orderedRead = wantsOrderedNotificationRead(clause);
    const referenceOpen = wantsNotificationReferenceOpen(clause, notifications);
    const referenceRead = wantsNotificationReferenceRead(clause, notifications);
    const summaryFollowUp = wantsNotificationSummaryFollowUp(clause);
    if (!orderedRead && !referenceOpen && !referenceRead && !summaryFollowUp) continue;
    if (clauseIsNegated(clause)) {
      if (
        (referenceOpen && negatedReferenceCancelsEarlierClause(clauses, index, clause, notifications, "open")) ||
        (referenceRead && negatedReferenceCancelsEarlierClause(clauses, index, clause, notifications, "read"))
      ) {
        return null;
      }
      continue;
    }
    return { clause, orderedRead, referenceOpen, referenceRead, summaryFollowUp };
  }
  return null;
}

function responseFromNotificationWorkingContext(
  transcript: string,
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
  androidRuntime: FakeAndroidVoiceRuntime,
): { response: string; outcome: string; workingContext: LocalVoiceWorkingContext } | null {
  const recentNotifications = notificationWorkingContextActive(workingContext, now);
  if (!recentNotifications) return null;
  const activeRequest = activeNotificationWorkingContextRequest(transcript, recentNotifications.notifications);
  if (!activeRequest) return null;
  const { clause, orderedRead, referenceOpen, referenceRead } = activeRequest;

  if (referenceOpen) {
    const match = resolveAndroidNotificationReference(recentNotifications.notifications, clause);
    if (!match) {
      return {
        response: "I found the recent notifications, but I could not tell which one you meant.",
        outcome: "notification_reference_unresolved",
        workingContext: workingContext ?? {},
      };
    }
    const execution = androidRuntime.execute("android_open_app_by_name", { appName: match.notification.app });
    return {
      response: execution.ok
        ? `I found the ${match.notification.app} notification and opened ${match.notification.app}.`
        : `I found the ${match.notification.app} notification, but I could not open ${match.notification.app} yet.`,
      outcome: "notification_reference_opened",
      workingContext: workingContext ?? {},
    };
  }

  if (orderedRead) {
    return {
      response: recentNotifications.orderedDetail,
      outcome: "notification_context_read_all",
      workingContext: workingContext ?? {},
    };
  }

  if (referenceRead) {
    const match = resolveAndroidNotificationReference(recentNotifications.notifications, clause);
    if (!match) {
      return {
        response: "I found the recent notifications, but I could not tell which one you meant.",
        outcome: "notification_reference_unresolved",
        workingContext: workingContext ?? {},
      };
    }
    return {
      response: notificationReferenceText(match.notification),
      outcome: "notification_reference_read",
      workingContext: workingContext ?? {},
    };
  }

  return {
    response: recentNotifications.summary,
    outcome: "notification_context_summary",
    workingContext: workingContext ?? {},
  };
}

function summarizeExecution(execution: FakeAndroidExecution): string {
  if (!execution.ok) {
    return `I could not complete that phone action yet. ${execution.label}.`;
  }

  switch (execution.toolName) {
    case "android_read_notifications":
      return summarizeAndroidNotifications(execution.data?.notifications ?? []);
    case "android_read_screen_context":
    case "android_capture_screen":
      return execution.detail ? `Here is what is on your screen:\n${execution.detail}` : "I could not read anything useful from the screen.";
    case "android_open_app_by_name":
      return execution.detail ? `${execution.label}. ${execution.detail}` : `${execution.label}.`;
    case "android_copy_to_clipboard":
      return "I copied those details to your clipboard.";
    case "runtime_request_approval":
      return execution.label;
    case "runtime_scheduler_status":
      return execution.detail ? `${execution.label}:\n${execution.detail}` : execution.label;
    case "runtime_service_status":
      return execution.ok ? "No local runtime crash is recorded." : `${execution.label}. ${execution.detail}`;
  }
}

function finalResponseForModelProblem(outcome: string): string {
  switch (outcome) {
    case "model_output_invalid":
      return "I could not understand the local model output, so I stopped that turn cleanly.";
    case "blank_model_response":
      return "I did not get a usable local model response, so I stopped that turn cleanly.";
    case "model_timeout":
      return "The local model took too long to answer, so I stopped that turn cleanly.";
    case "tool_unavailable":
      return "I could not match that phone action to an available local tool.";
    case "false_completion_blocked":
      return "I have not completed that phone action yet.";
    case "tool_recovery_blocked":
      return "I have not completed that phone action yet.";
    default:
      return "I could not complete that local voice turn.";
  }
}

function recordModelCall(modelCalls: LocalVoiceModelCall[], call: LocalVoiceModelCall): void {
  modelCalls.push(call);
  if (call.kind !== "local_gemma") {
    throw new LocalVoiceRuntimeHarnessError(
      "LOCAL_VOICE_CLOUD_MODEL_BLOCKED",
      "Local voice turns must not route through a cloud model or secondary LLM.",
      [...modelCalls],
    );
  }
}

export async function runLocalVoiceRuntimeHarnessTurn(input: LocalVoiceHarnessInput): Promise<LocalVoiceHarnessResult> {
  const userId = compactText(input.userId);
  const transcript = compactText(input.transcript);
  const now = input.now ?? new Date();
  if (!userId) {
    throw new LocalVoiceRuntimeHarnessError("LOCAL_VOICE_MISSING_USER", "A user is required.", []);
  }
  if (!transcript) {
    throw new LocalVoiceRuntimeHarnessError("LOCAL_VOICE_MISSING_TRANSCRIPT", "A transcript is required.", []);
  }

  const modelCalls: LocalVoiceModelCall[] = [];
  if (input.simulateCloudRoute) {
    recordModelCall(modelCalls, {
      kind: "cloud_model",
      provider: "openai",
      model: "gpt-4.1-mini",
      reason: "simulated local voice fallback",
    });
  }
  if (input.simulateSecondaryLlmRoute) {
    recordModelCall(modelCalls, {
      kind: "secondary_llm",
      provider: "local-router",
      model: "classifier-llm",
      reason: "simulated secondary local planner",
    });
  }

  recordModelCall(modelCalls, {
    kind: "local_gemma",
    provider: "android-local-gemma",
    model: "gemma-4-e4b-it",
    reason: "live local voice turn",
  });

  const androidRuntime = new FakeAndroidVoiceRuntime(input.androidEvents ?? []);
  const modelOutput = await input.gemma.generate({
    transcript,
    contextPacket: contextPacketFromEvents(input.androidEvents ?? [], transcript, input.workingContext, now),
  });

  let canonicalResponse = "";
  let workingContext = mergeWorkingContext(input.workingContext, null);
  let diagnostics: LocalVoiceHarnessDiagnostics;

  if (modelOutput.type === "final") {
    const workingContextResponse = responseFromNotificationWorkingContext(transcript, workingContext, now, androidRuntime);
    if (workingContextResponse) {
      canonicalResponse = workingContextResponse.response;
      workingContext = workingContextResponse.workingContext;
      diagnostics = { outcome: workingContextResponse.outcome, modelOutputType: modelOutput.type };
    } else {
      canonicalResponse = compactText(modelOutput.text) || finalResponseForModelProblem("blank_model_response");
      diagnostics = { outcome: "final", modelOutputType: modelOutput.type };
    }
  } else if (modelOutput.type === "tool_call" || modelOutput.type === "invalid_tool_call") {
    const normalizedToolName = normalizeLocalVoiceToolName(modelOutput.name);
    if (!normalizedToolName) {
      canonicalResponse = finalResponseForModelProblem("tool_unavailable");
      diagnostics = {
        outcome: "tool_unavailable",
        requestedToolName: modelOutput.name,
        modelOutputType: modelOutput.type,
      };
    } else {
      const execution = androidRuntime.execute(normalizedToolName, parseToolArguments(modelOutput.arguments));
      canonicalResponse = summarizeExecution(execution);
      workingContext = mergeWorkingContext(workingContext, workingContextFromNotificationExecution(execution, now));
      diagnostics = {
        outcome: modelOutput.type === "invalid_tool_call" ? "tool_call_recovered" : "tool_call_executed",
        requestedToolName: modelOutput.name,
        executedToolName: normalizedToolName,
        recoveredToolName: modelOutput.name === normalizedToolName ? undefined : normalizedToolName,
        modelOutputType: modelOutput.type,
      };
    }
  } else if (modelOutput.type === "false_denial") {
    const workingContextResponse = responseFromNotificationWorkingContext(transcript, workingContext, now, androidRuntime);
    if (workingContextResponse) {
      canonicalResponse = workingContextResponse.response;
      workingContext = workingContextResponse.workingContext;
      diagnostics = { outcome: workingContextResponse.outcome, modelOutputType: modelOutput.type };
    } else {
      const recoveredToolName = capabilityToolName(modelOutput.capability);
      const recoveredArgs = argsForRecoveredCapability(modelOutput.capability, transcript, input.androidEvents ?? []);
      const recoveryBlocked = recoveredToolName === "android_open_app_by_name"
        ? !compactText(recoveredArgs.appName)
        : hasNegatedCapabilityRequest(modelOutput.capability, transcript);
      if (recoveryBlocked) {
        canonicalResponse = finalResponseForModelProblem("tool_recovery_blocked");
        diagnostics = {
          outcome: "tool_recovery_blocked",
          executedToolName: recoveredToolName,
          modelOutputType: modelOutput.type,
        };
      } else {
        const execution = androidRuntime.execute(recoveredToolName, recoveredArgs);
        canonicalResponse = summarizeExecution(execution);
        workingContext = mergeWorkingContext(workingContext, workingContextFromNotificationExecution(execution, now));
        diagnostics = {
          outcome: "tool_executed_after_false_denial",
          executedToolName: recoveredToolName,
          modelOutputType: modelOutput.type,
        };
      }
    }
  } else if (modelOutput.type === "false_completion") {
    canonicalResponse = finalResponseForModelProblem("false_completion_blocked");
    diagnostics = {
      outcome: "false_completion_blocked",
      requestedToolName: modelOutput.action,
      modelOutputType: modelOutput.type,
    };
  } else {
    const outcome = modelOutput.type === "malformed_output"
      ? "model_output_invalid"
      : modelOutput.type === "blank_response"
        ? "blank_model_response"
        : "model_timeout";
    canonicalResponse = finalResponseForModelProblem(outcome);
    diagnostics = {
      outcome,
      modelOutputType: modelOutput.type,
    };
  }

  const result: LocalVoiceHarnessResult = {
    transcript,
    canonicalResponse,
    chatOutput: canonicalResponse,
    ttsOutput: canonicalResponse,
    responseCount: 1,
    modelCalls,
    androidExecutions: [...androidRuntime.executions],
    workingContext,
    diagnostics,
  };

  if (!result.canonicalResponse || result.chatOutput !== result.ttsOutput || result.responseCount !== 1) {
    throw new LocalVoiceRuntimeHarnessError(
      "LOCAL_VOICE_CANONICAL_RESPONSE_INVALID",
      "Local voice turns must produce exactly one canonical response for chat and TTS.",
      modelCalls,
    );
  }

  return result;
}
