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
  diagnostics: LocalVoiceHarnessDiagnostics;
}

export interface LocalVoiceHarnessInput {
  userId: string;
  transcript: string;
  gemma: ScriptedFakeLocalGemmaProvider;
  androidEvents?: LocalVoiceAndroidEvent[];
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

function contextPacketFromEvents(events: LocalVoiceAndroidEvent[]): string {
  const eventTypes = [...new Set(events.map((event) => event.type))].join(", ") || "none";
  return [
    "Assistant: JARVIS",
    "Mode: Local",
    "Model: Gemma",
    `Available phone event fixtures: ${eventTypes}`,
  ].join("\n");
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
          detail: notifications
            .map((notification) => `${notification.app}: ${notification.title}${notification.text ? ` - ${notification.text}` : ""}`)
            .join("\n"),
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

function summarizeExecution(execution: FakeAndroidExecution): string {
  if (!execution.ok) {
    return `I could not complete that phone action yet. ${execution.label}.`;
  }

  switch (execution.toolName) {
    case "android_read_notifications":
      return execution.detail ? `Here are your current notifications:\n${execution.detail}` : "You do not have visible notifications right now.";
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
    contextPacket: contextPacketFromEvents(input.androidEvents ?? []),
  });

  let canonicalResponse = "";
  let diagnostics: LocalVoiceHarnessDiagnostics;

  if (modelOutput.type === "final") {
    canonicalResponse = compactText(modelOutput.text) || finalResponseForModelProblem("blank_model_response");
    diagnostics = { outcome: "final", modelOutputType: modelOutput.type };
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
      diagnostics = {
        outcome: modelOutput.type === "invalid_tool_call" ? "tool_call_recovered" : "tool_call_executed",
        requestedToolName: modelOutput.name,
        executedToolName: normalizedToolName,
        recoveredToolName: modelOutput.name === normalizedToolName ? undefined : normalizedToolName,
        modelOutputType: modelOutput.type,
      };
    }
  } else if (modelOutput.type === "false_denial") {
    const recoveredToolName = capabilityToolName(modelOutput.capability);
    const recoveredArgs = argsForRecoveredCapability(modelOutput.capability, transcript, input.androidEvents ?? []);
    if (recoveredToolName === "android_open_app_by_name" && !compactText(recoveredArgs.appName)) {
      canonicalResponse = finalResponseForModelProblem("tool_recovery_blocked");
      diagnostics = {
        outcome: "tool_recovery_blocked",
        executedToolName: recoveredToolName,
        modelOutputType: modelOutput.type,
      };
    } else {
      const execution = androidRuntime.execute(recoveredToolName, recoveredArgs);
      canonicalResponse = summarizeExecution(execution);
      diagnostics = {
        outcome: "tool_executed_after_false_denial",
        executedToolName: recoveredToolName,
        modelOutputType: modelOutput.type,
      };
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
