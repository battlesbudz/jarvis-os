import {
  formatAndroidNotificationsInOrder,
  summarizeAndroidNotifications,
} from "./agent/androidNotificationSummary";
import { resolveAndroidNotificationFollowUp } from "./agent/androidNotificationFollowups";
import { LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS } from "./state/runtimeWorkingContext";
import { normalizeVoiceRestoreReply } from "@shared/voiceApprovalGates";
import {
  buildCloudBackgroundEscalationDecision,
  type CloudBackgroundEscalationDecision,
  type CloudBackgroundProviderStatus,
} from "./agent/cloudBackgroundEscalation";
import { buildGroundedEvidencePacketPrompt } from "./state/groundedEvidencePacket";
import { shouldGroundPersonalMemoryRequest } from "./state/groundingQueryPlanner";
import { classifyRuntimeMemoryInspectionIntent } from "./state/runtimeMemoryInspection";

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
  | "android_youtube_search"
  | "android_copy_to_clipboard"
  | "runtime_request_approval"
  | "runtime_scheduler_status"
  | "runtime_service_status";

type LocalVoiceScreenToolName = Extract<LocalVoiceToolName, "android_read_screen_context" | "android_capture_screen">;

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

export type LocalVoiceScreenSource = "accessibility" | "temporary_capture";

export interface LocalVoiceScreenEvent {
  type: "screen";
  activeApp: string;
  title?: string;
  text: string;
  elements?: string[];
  source?: LocalVoiceScreenSource;
  captureId?: string;
  capturePath?: string;
  savedToGallery?: boolean;
  galleryPath?: string;
}

export interface LocalVoiceScreenSnapshot {
  source: LocalVoiceScreenSource;
  activeApp: string;
  title?: string;
  text: string;
  elements: string[];
  captureId?: string;
  capturePath?: string;
  savedToGallery?: boolean;
  galleryPath?: string;
}

export type LocalVoiceScreenCapturePreviewAction = "copy_details" | "delete";

export interface LocalVoiceScreenCaptureContext {
  id: string;
  path: string;
  createdAt: string;
  expiresAt: string;
  savedToGallery: boolean;
  galleryPath?: string;
  previewLabel: "Temporary screen capture";
  previewActions: LocalVoiceScreenCapturePreviewAction[];
}

export interface LocalVoiceScreenWorkingContext {
  source: LocalVoiceScreenSource;
  activeApp: string;
  title?: string;
  text?: string;
  elements: string[];
  recordedAt: string;
  expiresAt: string;
  capture?: LocalVoiceScreenCaptureContext;
}

export type LocalVoiceAndroidEvent =
  | { type: "notification"; notifications: LocalVoiceNotification[] }
  | LocalVoiceScreenEvent
  | { type: "app_control"; appName: string; action: "open" | "search" | "tap" | "type"; query?: string; success?: boolean; detail?: string }
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
    screen?: LocalVoiceScreenSnapshot;
    blockedByUser?: boolean;
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
  screen?: LocalVoiceScreenWorkingContext;
}

export interface LocalVoiceHarnessDiagnostics {
  outcome: string;
  requestedToolName?: string;
  executedToolName?: LocalVoiceToolName;
  recoveredToolName?: LocalVoiceToolName;
  modelOutputType: ScriptedLocalGemmaStep["type"] | "runtime_direct";
  cloudEscalation?: CloudBackgroundEscalationDecision;
  copiedDetails?: {
    capture?: {
      id: string;
      path: string;
      savedToGallery: boolean;
      galleryPath?: string;
      expiresAt: string;
    };
  };
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

export interface LocalVoiceCloudEscalationInput {
  providers: CloudBackgroundProviderStatus[];
  selectedProviderId?: string | null;
  selectedProviderAuthType?: "api_key" | "oauth" | null;
  approvedProvider?: boolean;
  approvedBudgetUsd?: number | null;
}

export interface LocalVoiceHarnessInput {
  userId: string;
  transcript: string;
  gemma: ScriptedFakeLocalGemmaProvider;
  androidEvents?: LocalVoiceAndroidEvent[];
  workingContext?: LocalVoiceWorkingContext;
  cloudEscalation?: LocalVoiceCloudEscalationInput;
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
  android_youtube_search: "android_youtube_search",
  youtube_search: "android_youtube_search",
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

function latestScreenEvent(
  events: LocalVoiceAndroidEvent[],
  toolName: LocalVoiceScreenToolName,
): LocalVoiceScreenEvent | null {
  const screens = events.filter((event): event is LocalVoiceScreenEvent => event.type === "screen");
  if (toolName === "android_read_screen_context") {
    return [...screens].reverse().find((event) => screenEventSource(event) !== "temporary_capture") ?? null;
  }

  return [...screens].reverse().find((event) => screenEventSource(event) === "temporary_capture") ?? null;
}

function screenEventSource(event: LocalVoiceScreenEvent): LocalVoiceScreenSource {
  return event.source ?? "accessibility";
}

function screenSnapshotFromEvent(
  event: LocalVoiceScreenEvent,
  toolName: Extract<LocalVoiceToolName, "android_read_screen_context" | "android_capture_screen">,
): LocalVoiceScreenSnapshot {
  return {
    source: toolName === "android_capture_screen" ? "temporary_capture" : screenEventSource(event),
    activeApp: event.activeApp,
    title: event.title,
    text: event.text,
    elements: event.elements ?? [],
    captureId: event.captureId,
    capturePath: event.capturePath,
    savedToGallery: event.savedToGallery,
    galleryPath: event.galleryPath,
  };
}

function formatScreenSnapshot(snapshot: LocalVoiceScreenSnapshot | LocalVoiceScreenWorkingContext): string {
  return [snapshot.title, snapshot.text, ...snapshot.elements].filter(Boolean).join("\n");
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

const YOUTUBE_APP_NAME_PATTERN = String.raw`(?:youtube|you\s*tube|yt)`;
const YOUTUBE_SEARCH_VERB_PATTERN = String.raw`(?:search|find|look\s+up|look\s+for)`;
const YOUTUBE_APP_NAME_REGEX = new RegExp(String.raw`\b${YOUTUBE_APP_NAME_PATTERN}\b`, "i");
const YOUTUBE_SEARCH_VERB_REGEX = new RegExp(String.raw`\b${YOUTUBE_SEARCH_VERB_PATTERN}\b`, "i");
const ANY_ACTION_COMMAND_WORDS = String.raw`(?:open|launch|start|read|show|check|copy|save|keep|delete|remove|discard|approve|confirm|request|take|capture|search|find|look\s+up|look\s+for)`;
const OPEN_STYLE_ACTION_COMMAND_WORDS = String.raw`(?:open|launch|start|read|show|check|copy|approve|confirm|request|take|capture)`;
const SEARCH_TARGET_ACTION_PATTERN = String.raw`${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:on\s+)?(?:${YOUTUBE_APP_NAME_PATTERN}|google|chrome|browser|web)\b`;
const TARGETLESS_SEARCH_ACTION_PATTERN = String.raw`${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:for\s+|me\s+)?[a-z0-9]`;
const NEGATED_ACTION_WORDS = String.raw`(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)`;
const OPTIONAL_FILLER_PREFIX = String.raw`(?:(?:actually|wait|sorry|hold\s+on|hang\s+on|nevermind|never\s+mind)\s+)?`;
const OPTIONAL_NEGATED_ACTION_WORDS = String.raw`(?:${NEGATED_ACTION_WORDS}\s+)?`;
const ACTION_CLAUSE_SPLIT_PATTERN = new RegExp(
  String.raw`[.!?;,]\s*(?:and\s+)?(?=${OPTIONAL_FILLER_PREFIX}${OPTIONAL_NEGATED_ACTION_WORDS}${ANY_ACTION_COMMAND_WORDS}\b)|\band\s+then\s+(?=${OPTIONAL_FILLER_PREFIX}${OPTIONAL_NEGATED_ACTION_WORDS}${ANY_ACTION_COMMAND_WORDS}\b)|\b(?:but|then)\s+(?=${OPTIONAL_FILLER_PREFIX}${OPTIONAL_NEGATED_ACTION_WORDS}${ANY_ACTION_COMMAND_WORDS}\b)|\band\s+(?=${OPTIONAL_FILLER_PREFIX}${NEGATED_ACTION_WORDS}\s+${ANY_ACTION_COMMAND_WORDS}\b)|\band\s+(?=${OPTIONAL_FILLER_PREFIX}${OPTIONAL_NEGATED_ACTION_WORDS}${SEARCH_TARGET_ACTION_PATTERN})|\band\s+(?=${OPTIONAL_FILLER_PREFIX}${OPTIONAL_NEGATED_ACTION_WORDS}${TARGETLESS_SEARCH_ACTION_PATTERN})|\band\s+(?=${OPTIONAL_FILLER_PREFIX}${OPTIONAL_NEGATED_ACTION_WORDS}${OPEN_STYLE_ACTION_COMMAND_WORDS}\b)`,
  "i",
);

function transcriptActionClauses(transcript: string): string[] {
  return compactText(transcript)
    .split(ACTION_CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim().replace(/[,:;]+$/, "").trim())
    .filter(Boolean);
}

const NEGATED_ACTION_PREFIX_PATTERN = /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\b/i;
const SCREEN_UNDERSTANDING_ACTION_PREFIX_PATTERN = /\b(?:read|show|check|describe|look\s+at|tell\s+me\s+about)\b/i;

function isNegatedActionClause(clause: string): boolean {
  const match = clause.match(capabilityRequestPattern("app_control"));
  const commandPrefix = clause.slice(0, match?.index ?? 0);
  return !!match && NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix);
}

type AppControlActionFamily = "open" | "search";

function appControlPronounCancellationAction(clause: string): AppControlActionFamily | null {
  if (/\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:open|launch|start)\s+(?:it|that|this)\b/i.test(clause)) {
    return "open";
  }
  if (/\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:search|find|look\s+up|look\s+for)\s+(?:for\s+)?(?:it|that|this)\b/i.test(clause)) {
    return "search";
  }
  return null;
}

function positiveClauseFromNegation(clause: string): string {
  return clause
    .replace(/^\s*(?:(?:actually|wait|sorry|hold\s+on|hang\s+on|nevermind|never\s+mind)\s+)?(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+/i, "")
    .trim();
}

function hasEarlierPositiveOpenRequestForApp(clauses: string[], beforeIndex: number, appName: string): boolean {
  const canceledApp = compactText(appName).toLowerCase();
  if (!canceledApp) return false;

  for (let index = beforeIndex; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (isNegatedActionClause(clause)) continue;
    if (inferRequestedAppName(clause).toLowerCase() === canceledApp) {
      return true;
    }
  }

  return false;
}

function hasEarlierPositiveYoutubeSearchQuery(clauses: string[], beforeIndex: number, query: string): boolean {
  const canceledQuery = compactText(query).toLowerCase();
  if (!canceledQuery) return false;

  for (let index = beforeIndex; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (isNegatedActionClause(clause)) continue;
    const explicitYoutubeQuery = inferYoutubeSearchQuery(clause);
    const targetlessYoutubeQuery =
      !explicitYoutubeQuery && isYoutubeAppName(inferLatestRequestedAppName(clauses, index - 1))
        ? inferSearchQueryFromClause(clause)
        : "";
    if (compactText(explicitYoutubeQuery || targetlessYoutubeQuery).toLowerCase() === canceledQuery) {
      return true;
    }
  }

  return false;
}

function hasEarlierPositiveYoutubeSearchRequest(clauses: string[], beforeIndex: number): boolean {
  for (let index = beforeIndex; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (isNegatedActionClause(clause)) continue;
    if (inferYoutubeSearchQuery(clause)) {
      return true;
    }
  }

  return false;
}

function hasEarlierPositiveAppControlRequestForAction(
  clauses: string[],
  beforeIndex: number,
  action: AppControlActionFamily,
): boolean {
  for (let index = beforeIndex; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (isNegatedActionClause(clause)) continue;
    if (action === "open" && inferRequestedAppName(clause)) {
      return true;
    }
    if (action === "search" && (inferYoutubeSearchQuery(clause) || inferSearchQueryFromClause(clause))) {
      return true;
    }
  }

  return false;
}

function cleanYoutubeSearchQuery(query: string | undefined, options: { stripIndirectObject?: boolean } = {}): string {
  let cleaned = stripTrailingRequestSuffixes(query ?? "");
  if (options.stripIndirectObject) {
    cleaned = cleaned.replace(/^me\s+/i, "").trim();
  }
  return cleaned;
}

function stripTrailingRequestSuffixes(query: string): string {
  let cleaned = compactText(query);
  for (let index = 0; index < 3; index += 1) {
    const withoutInstead = cleaned.replace(/\s+instead$/i, "").trim();
    if (withoutInstead !== cleaned) {
      cleaned = withoutInstead.replace(/[,:;]+$/, "").trim();
      continue;
    }

    const withoutPlease = cleaned.match(/^(.*)\s+please$/i);
    if (withoutPlease?.[1] && !/\bplease$/i.test(withoutPlease[1])) {
      cleaned = withoutPlease[1].replace(/[,:;]+$/, "").trim();
      continue;
    }

    const withoutForMe = cleaned.match(/^(.*)\s+for me$/);
    if (withoutForMe?.[1] && !/\bdo it$/i.test(withoutForMe[1])) {
      cleaned = withoutForMe[1].replace(/[,:;]+$/, "").trim();
      continue;
    }

    break;
  }
  return cleaned;
}

function youtubeQueriesMatch(requestedQuery: string, eventQuery: string): boolean {
  const requested = compactText(requestedQuery).toLowerCase();
  const event = compactText(eventQuery).toLowerCase();
  return !!requested && !!event && requested === event;
}

function isYoutubeAppName(appName: string): boolean {
  return /^(?:youtube|you tube|yt)$/i.test(compactText(appName));
}

function normalizeKnownSearchTarget(target: string | undefined): string {
  const normalized = compactText(target)
    .replace(/^the\s+/i, "")
    .replace(/\s+app$/i, "")
    .trim();
  if (isYoutubeAppName(normalized) || /^(?:google|chrome|browser|web)$/i.test(normalized)) {
    return normalized;
  }
  return "";
}

function inferExplicitSearchTarget(clause: string): string {
  const trailingTargetMatch = clause.match(
    new RegExp(String.raw`\b${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:for\s+)?.+?\s+(?:on|in)\s+([a-z0-9][a-z0-9 ._-]*?)\s*[.!?]*$`, "i"),
  );
  const trailingTarget = normalizeKnownSearchTarget(trailingTargetMatch?.[1]);
  if (trailingTarget) return trailingTarget;

  const leadingTargetMatch = clause.match(
    new RegExp(String.raw`\b${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:(?:on|in)\s+)?(?!for\b)([a-z0-9][a-z0-9 ._-]*?)\s+for\b`, "i"),
  );
  return normalizeKnownSearchTarget(leadingTargetMatch?.[1]);
}

function inferYoutubeSearchQuery(transcript: string): string {
  const patterns = [
    new RegExp(
      String.raw`\b(?:open|launch|start)(?:\s+up)?\s+(?:the\s+)?${YOUTUBE_APP_NAME_PATTERN}(?:\s+app)?\s+(?:and|then)?\s*${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:for\s+)?(.+?)\s*[.!?]*$`,
      "i",
    ),
    new RegExp(
      String.raw`\b${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:on\s+)?${YOUTUBE_APP_NAME_PATTERN}\s+(?:for\s+)?(.+?)\s*[.!?]*$`,
      "i",
    ),
    new RegExp(
      String.raw`\b${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+${YOUTUBE_APP_NAME_PATTERN}\s*[.!?]*$`,
      "i",
    ),
  ];

  const clauses = transcriptActionClauses(transcript);

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (!YOUTUBE_APP_NAME_REGEX.test(clause) || !YOUTUBE_SEARCH_VERB_REGEX.test(clause)) {
      continue;
    }

    for (const pattern of patterns) {
      const match = clause.match(pattern);
      const commandPrefix = clause.slice(0, match?.index ?? 0);
      if (NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) continue;
      const query = cleanYoutubeSearchQuery(match?.[1], {
        stripIndirectObject: /\b(?:find|look\s+up|look\s+for)\s+me\b/i.test(clause),
      });
      if (query) return query;
    }
  }

  return "";
}

function inferSearchQueryFromClause(clause: string): string {
  const match = clause.match(
    new RegExp(String.raw`\b${YOUTUBE_SEARCH_VERB_PATTERN}\s+(?:for\s+)?(.+?)\s*[.!?]*$`, "i"),
  );
  const commandPrefix = clause.slice(0, match?.index ?? 0);
  if (NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) return "";
  return cleanYoutubeSearchQuery(match?.[1], {
    stripIndirectObject: /\b(?:find|look\s+up|look\s+for)\s+me\b/i.test(clause),
  });
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
    if (NEGATED_ACTION_PREFIX_PATTERN.test(clausePrefix)) {
      continue;
    }

    const appName = compactText(match[1])
      .replace(/\s+app$/i, "")
      .trim();
    if (appName) return appName;
  }

  return "";
}

function inferRecoveredAppControlRequest(
  transcript: string,
): { toolName: LocalVoiceToolName; args: Record<string, unknown> } | null {
  const clauses = transcriptActionClauses(transcript);

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (!capabilityRequestPattern("app_control").test(clause)) continue;
    if (isNegatedActionClause(clause)) {
      const positiveClause = positiveClauseFromNegation(clause);
      const canceledAppName = inferRequestedAppName(positiveClause);
      if (canceledAppName && hasEarlierPositiveOpenRequestForApp(clauses, index - 1, canceledAppName)) {
        return null;
      }

      const explicitCanceledYoutubeQuery = inferYoutubeSearchQuery(positiveClause);
      const targetlessCanceledYoutubeQuery =
        !explicitCanceledYoutubeQuery &&
        !YOUTUBE_APP_NAME_REGEX.test(positiveClause) &&
        isYoutubeAppName(inferLatestRequestedAppName(clauses, index - 1))
          ? inferSearchQueryFromClause(positiveClause)
          : "";
      const canceledYoutubeQuery = explicitCanceledYoutubeQuery || targetlessCanceledYoutubeQuery;
      if (canceledYoutubeQuery && hasEarlierPositiveYoutubeSearchQuery(clauses, index - 1, canceledYoutubeQuery)) {
        return null;
      }
      if (
        !canceledYoutubeQuery &&
        YOUTUBE_APP_NAME_REGEX.test(positiveClause) &&
        YOUTUBE_SEARCH_VERB_REGEX.test(positiveClause) &&
        hasEarlierPositiveYoutubeSearchRequest(clauses, index - 1)
      ) {
        return null;
      }

      const cancellationAction = appControlPronounCancellationAction(clause);
      if (
        cancellationAction &&
        hasEarlierPositiveAppControlRequestForAction(clauses, index - 1, cancellationAction)
      ) {
        return null;
      }
      continue;
    }

    const explicitSearchTarget = inferExplicitSearchTarget(clause);
    if (explicitSearchTarget && !isYoutubeAppName(explicitSearchTarget)) {
      return null;
    }

    const youtubeQuery = inferYoutubeSearchQuery(clause);
    if (youtubeQuery) {
      return { toolName: "android_youtube_search", args: { query: youtubeQuery } };
    }

    const searchQuery = inferSearchQueryFromClause(clause);
    const previousAppName = searchQuery ? inferLatestRequestedAppName(clauses, index - 1) : "";
    if (searchQuery && isYoutubeAppName(previousAppName)) {
      return { toolName: "android_youtube_search", args: { query: searchQuery } };
    }

    const appName = inferRequestedAppName(clause);
    if (appName) {
      return { toolName: "android_open_app_by_name", args: { appName } };
    }
  }

  return null;
}

function inferLatestRequestedAppName(clauses: string[], startIndex: number): string {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (inferYoutubeSearchQuery(clauses[index])) return "YouTube";
    const appName = inferRequestedAppName(clauses[index]);
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

  const youtubeQuery = inferYoutubeSearchQuery(transcript);
  if (youtubeQuery) return { query: youtubeQuery };

  const appName = inferRequestedAppName(transcript);
  return appName ? { appName } : {};
}

function capabilityRequestPattern(capability: LocalVoiceCapability): RegExp {
  switch (capability) {
    case "notifications":
      return /\bnotifications?\b/i;
    case "screen":
      return /\b(?:screen|screenshot|screen grab|capture|display|on[-\s]?screen)\b/i;
    case "app_control":
      return /\b(?:open|launch|start|search|find|look\s+up|look\s+for)\b/i;
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

function capabilityPronounCancellationPattern(capability: LocalVoiceCapability): RegExp | null {
  switch (capability) {
    case "notifications":
      return /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:read|show|check)\s+(?:it|them|that|this)\b/i;
    case "screen":
      return /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:read|show|check)\s+(?:it|that|this)\b/i;
    case "clipboard":
      return /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+copy\s+(?:it|them|that|this)\b/i;
    case "approval":
      return /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:approve|confirm|request)\s+(?:it|that|this)\b/i;
    case "scheduler":
      return /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:read|show|check)\s+(?:it|them|that|this)\b/i;
    case "service":
      return /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:read|show|check)\s+(?:it|that|this)\b/i;
    case "app_control":
      return null;
  }
}

const SCREEN_CAPTURE_PRONOUN_CANCELLATION_PATTERN = /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:take|capture|grab|snap|attach)\s+(?:it|that|this)\b/i;

function hasNegatedCapabilityRequest(capability: LocalVoiceCapability, transcript: string): boolean {
  const requestPattern = capabilityRequestPattern(capability);
  const cancellationPattern = capabilityPronounCancellationPattern(capability);
  const clauses = transcriptActionClauses(transcript);

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    const previousClauses = clauses.slice(0, index).join(" ");
    const hasPreviousRequest = capability === "screen"
      ? isScreenWorkingContextFollowUpRequest(previousClauses)
      : requestPattern.test(previousClauses);
    if (
      capability === "screen"
      && SCREEN_CAPTURE_PRONOUN_CANCELLATION_PATTERN.test(clause)
      && screenCaptureRequestNegationState(previousClauses).positive
    ) {
      return true;
    }
    if (
      cancellationPattern &&
      cancellationPattern.test(clause) &&
      hasPreviousRequest
    ) {
      return true;
    }
    const requestMatch = capability === "screen" ? screenContextRequestMatch(clause) : clause.match(requestPattern);
    if (!requestMatch) continue;
    const commandPrefix = clause.slice(0, requestMatch.index ?? 0);
    if (capability === "screen") {
      const negated = NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix);
      const actionPrefix = commandPrefix.replace(NEGATED_ACTION_PREFIX_PATTERN, "").trim();
      if (!negated) return false;
      if (screenCaptureRequestNegationState(clause).negated) {
        return !(
          hasPositiveScreenContextRequest(clauses.slice(0, index).join(" "))
          || hasPositiveScreenContextRequestAfterNegatedCapture(clause)
        );
      }
      if (!actionPrefix || SCREEN_UNDERSTANDING_ACTION_PREFIX_PATTERN.test(actionPrefix)) return true;
      continue;
    }
    return NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix);
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

function screenWorkingContextActive(
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
): LocalVoiceScreenWorkingContext | null {
  const screen = workingContext?.screen;
  if (!screen) return null;
  const expiresAt = Date.parse(screen.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  if (expiresAt > now.getTime()) return screen;
  return null;
}

function pruneExpiredWorkingContext(
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
): LocalVoiceWorkingContext {
  return {
    ...(notificationWorkingContextActive(workingContext, now)
      ? { notifications: workingContext?.notifications }
      : {}),
    ...(screenWorkingContextActive(workingContext, now)
      ? { screen: workingContext?.screen }
      : {}),
  };
}

function isScreenCaptureContextFollowUpRequest(transcript: string): boolean {
  return /\b(?:what'?s|whats|what is)\s+(?:in|inside|on)\s+(?:this|that|the)\s+(?:screenshot|screen\s*shot|screen\s*capture|capture)\b/i.test(transcript)
    || /\b(?:read|show|describe|look at|tell me about)\s+(?:this|that|the)\s+(?:screenshot|screen\s*shot|screen\s*capture|capture)\b/i.test(transcript);
}

const SCREEN_CONTEXT_META_QUESTION_PATTERN = /\b(?:how\s+(?:do|can|would|to)|can\s+you\s+show\s+me\s+how|why\s+(?:can't|cant|can|would|do))\b.*\b(?:read|show|describe|look\s+at)?\s*(?:my\s+|the\s+|this\s+|that\s+)?(?:screen|display)\b|\bscreen\s+(?:capture|readers?|reading)\b/i;

function isScreenContextFollowUpRequest(transcript: string): boolean {
  return transcriptActionClauses(transcript).some((clause) => {
    if (isScreenCaptureContextFollowUpRequest(clause)) return true;
    if (SCREEN_CONTEXT_META_QUESTION_PATTERN.test(clause)) return false;
    return /\b(?:what'?s|whats|what is)\s+on\s+(?:(?:my|the|this|that)\s+)?(?:screen|display)\b/i.test(clause)
      || /\b(?:read|show|describe|look at)\s+(?:(?:my|the current|current|the|this|that)\s+)?(?:screen|display)\b/i.test(clause)
      || /\btell\s+me\s+about\s+(?:(?:my|the current|current|the|this|that)\s+)(?:screen|display)\b/i.test(clause)
      || SCREEN_APP_UI_CONTEXT_REQUEST_PATTERN.test(clause);
  });
}

const SCREEN_APP_UI_CONTEXT_REQUEST_PATTERN = /\bwhat\s+(?:does|is)\s+(?:the\s+)?(?:title|button|form|page)\b.*\b(?:screen|display|app|ui|on[-\s]?screen)\b|\bwhere\s+is\s+(?:the\s+)?[a-z0-9 ._-]+\b.*\b(?:screen|display|app|ui|on[-\s]?screen)\b/i;
const SCREEN_CONTEXT_PRONOUN_FOLLOW_UP_PATTERN = /\bwhat\s+(?:does|do)\s+(?:it|that|this)\s+(?:show|say|contain)(?:\s+(?:please|again|now|right\s+now|currently|current|latest|live))*\s*[.!?]*$|\b(?:what'?s|whats|what is)\s+(?:in|inside|on)\s+(?:it|that|this)(?:\s+(?:please|again|now|right\s+now|currently|current|latest|live))*\s*[.!?]*$|\b(?:read|show|describe|look at|tell me about)\s+(?:it|that|this)(?:\s+(?:please|for\s+me|again|now|right\s+now|currently|current|latest|live))*\s*[.!?]*$/i;
const NEGATED_SCREEN_CONTEXT_PRONOUN_FOLLOW_UP_PATTERN = /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:read|show|describe|look at|tell me about|check)\s+(?:it|that|this)\b/i;
const NEGATED_SCREEN_READBACK_PATTERN = /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:read|show|describe|look\s+at|tell\s+me\s+about|check)\s+(?:(?:my|the|this|that)\s+)?(?:screen|display|screenshot|screen\s*shot|screen\s*capture|capture|it|that|this)\b/i;
const SCREEN_CONTEXT_PRONOUN_IDIOM_PATTERN = /\b(?:what'?s|whats|what is)\s+in\s+it\s+for\s+(?:me|you|us|them|him|her)\b/i;
const SCREEN_CAPTURE_META_QUESTION_PATTERN = /\b(?:how\s+(?:do|can|would|to)|can\s+you\s+show\s+me\s+how|why\s+(?:can't|cant|can|would|do)|what\s+is|tell\s+me\s+about)\b.*\b(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab)\b/i;

function isScreenContextPronounFollowUpRequest(transcript: string): boolean {
  if (SCREEN_CONTEXT_PRONOUN_IDIOM_PATTERN.test(transcript)) return false;
  return SCREEN_CONTEXT_PRONOUN_FOLLOW_UP_PATTERN.test(transcript);
}

function isNegatedScreenContextPronounFollowUpRequest(transcript: string): boolean {
  return NEGATED_SCREEN_CONTEXT_PRONOUN_FOLLOW_UP_PATTERN.test(transcript);
}

function hasNegatedScreenReadbackRequest(transcript: string): boolean {
  return transcriptActionClauses(transcript).some((clause) => NEGATED_SCREEN_READBACK_PATTERN.test(clause));
}

function isScreenWorkingContextFollowUpRequest(transcript: string): boolean {
  return isScreenContextFollowUpRequest(transcript) || isScreenContextPronounFollowUpRequest(transcript);
}

function screenContextRequestMatch(clause: string): RegExpMatchArray | null {
  return clause.match(capabilityRequestPattern("screen"))
    ?? clause.match(SCREEN_APP_UI_CONTEXT_REQUEST_PATTERN)
    ?? clause.match(SCREEN_CONTEXT_PRONOUN_FOLLOW_UP_PATTERN);
}

function hasPositiveScreenContextRequest(transcript: string): boolean {
  for (const clause of transcriptActionClauses(transcript)) {
    if (!isScreenWorkingContextFollowUpRequest(clause)) continue;
    const requestMatch = screenContextRequestMatch(clause);
    const commandPrefix = clause.slice(0, requestMatch?.index ?? 0);
    if (!NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) return true;
  }
  return false;
}

function hasPositiveCapabilityRequest(capability: LocalVoiceCapability, transcript: string): boolean {
  for (const clause of transcriptActionClauses(transcript)) {
    const match = clause.match(capabilityRequestPattern(capability));
    if (!match) continue;
    const commandPrefix = clause.slice(0, match.index ?? 0);
    if (!NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) return true;
  }
  return false;
}

function hasPositiveClipboardRequest(transcript: string): boolean {
  for (const clause of transcriptActionClauses(transcript)) {
    const match = clause.match(/\b(?:copy\b.*\bclipboard\b|clipboard)\b/i);
    if (!match) continue;
    const commandPrefix = clause.slice(0, match.index ?? 0);
    if (!NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) return true;
  }
  return false;
}

function hasPositiveNonScreenRuntimeRequest(transcript: string): boolean {
  if (inferRecoveredAppControlRequest(transcript)) return true;
  if (hasPositiveClipboardRequest(transcript)) return true;
  return (["notifications", "approval", "scheduler", "service"] as LocalVoiceCapability[])
    .some((capability) => hasPositiveCapabilityRequest(capability, transcript));
}

function hasPositiveScreenContextRequestAfterNegatedCapture(clause: string): boolean {
  for (const pattern of [...EXPLICIT_SCREEN_CAPTURE_PATTERNS, BARE_SCREEN_CAPTURE_NEGATION_PATTERN]) {
    const match = clause.match(pattern);
    if (!match) continue;
    const commandPrefix = clause.slice(0, match.index ?? 0);
    if (!NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) continue;
    const remainder = clause.slice((match.index ?? 0) + match[0].length);
    if (hasPositiveScreenContextRequest(remainder)) return true;
  }
  return false;
}

function requiresFreshScreenRead(transcript: string): boolean {
  return isScreenWorkingContextFollowUpRequest(transcript)
    && /\b(?:now|current|currently|live|latest)\b/i.test(transcript);
}

const EXPLICIT_SCREEN_CAPTURE_PATTERNS = [
  /^\s*(?:please\s+)?(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab)(?:\s+(?:please|this|that|it))?\s*[.!?]*\s*$/i,
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab)\b/i,
  /\b(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab)\s+(?:this|that|it|my|the)\b/i,
  /\b(?:send|share|attach)\s+(?:me\s+)?(?:a|the)?\s*(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab)\b/i,
  /\b(?:take|capture|grab|snap|attach)\b.*\b(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab)\b/i,
  /\b(?:capture|grab|snap|attach)\b.*\b(?:my|the|this|that)?\s*(?:screen|display)\b/i,
  /\b(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab)\s+(?:my|the|this|that)\s+(?:phone|device|screen|display)\b/i,
  /\b(?:take|capture|grab|snap|attach)\s+(?:it|that|this)\b/i,
];
const BARE_SCREEN_CAPTURE_NEGATION_PATTERN = /\b(?:screenshot|screen\s*shot|screen\s*capture|screen\s*grab|capture)\b/i;

function screenCaptureRequestNegationState(transcript: string): { positive: boolean; negated: boolean } {
  let latestIntent: "positive" | "negated" | null = null;
  for (const clause of transcriptActionClauses(transcript)) {
    for (const pattern of EXPLICIT_SCREEN_CAPTURE_PATTERNS) {
      const match = clause.match(pattern);
      if (!match) continue;
      const commandPrefix = clause.slice(0, match.index ?? 0);
      if (NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) {
        latestIntent = "negated";
      } else {
        latestIntent = "positive";
      }
    }
    const bareCaptureMatch = clause.match(BARE_SCREEN_CAPTURE_NEGATION_PATTERN);
    if (bareCaptureMatch) {
      const commandPrefix = clause.slice(0, bareCaptureMatch.index ?? 0);
      if (NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix)) {
        latestIntent = "negated";
      }
    }
  }
  return {
    positive: latestIntent === "positive",
    negated: latestIntent === "negated",
  };
}

function isExplicitScreenCaptureRequest(transcript: string): boolean {
  const clauses = transcriptActionClauses(transcript);
  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (SCREEN_CAPTURE_META_QUESTION_PATTERN.test(clause)) continue;
    const state = screenCaptureRequestNegationState(clause);
    if (state.positive) return true;
    if (state.negated) return false;
  }
  return false;
}

function hasNegatedScreenCaptureRequest(transcript: string): boolean {
  return screenCaptureRequestNegationState(transcript).negated;
}

function shouldExecuteToolBeforeWorkingContext(toolName: LocalVoiceToolName): boolean {
  return toolName === "android_read_screen_context" || toolName === "android_capture_screen";
}

function screenToolNameForTranscript(toolName: LocalVoiceScreenToolName, transcript: string): LocalVoiceScreenToolName {
  if (isExplicitScreenCaptureRequest(transcript)) return "android_capture_screen";
  return toolName === "android_capture_screen" ? "android_read_screen_context" : toolName;
}

function hasFreshScreenEventForTool(
  events: LocalVoiceAndroidEvent[],
  toolName: LocalVoiceToolName,
  transcript: string,
): boolean {
  if (toolName !== "android_read_screen_context" && toolName !== "android_capture_screen") return false;
  const requestedToolName = screenToolNameForTranscript(toolName, transcript);
  return latestScreenEvent(events, requestedToolName) !== null
    || (
      requestedToolName === "android_read_screen_context"
      && !hasNegatedScreenCaptureRequest(transcript)
      && latestScreenEvent(events, "android_capture_screen") !== null
    );
}

function screenRefreshToolForTranscript(
  transcript: string,
  workingContext?: LocalVoiceWorkingContext,
  now: Date = new Date(),
): LocalVoiceToolName | null {
  if (hasNegatedCapabilityRequest("screen", transcript)) return null;
  const activeScreen = screenWorkingContextActive(workingContext, now);
  if (
    activeScreen?.capture
    && isScreenCaptureContextFollowUpRequest(transcript)
    && !requiresFreshScreenRead(transcript)
  ) {
    return null;
  }
  if (isExplicitScreenCaptureRequest(transcript) || isScreenContextFollowUpRequest(transcript)) {
    return "android_read_screen_context";
  }
  if (isScreenContextPronounFollowUpRequest(transcript) && activeScreen) {
    return "android_read_screen_context";
  }
  return null;
}

async function contextPacketFromEvents(
  userId: string,
  events: LocalVoiceAndroidEvent[],
  transcript: string,
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
): Promise<string> {
  const eventTypes = [...new Set(events.map((event) => event.type))].join(", ") || "none";
  const packet = [
    "Assistant: JARVIS",
    "Mode: Local",
    "Model: Gemma",
    `Available phone event fixtures: ${eventTypes}`,
  ];
  const recentNotifications = notificationWorkingContextActive(workingContext, now);
  if (recentNotifications && resolveAndroidNotificationFollowUp(transcript, recentNotifications.notifications)) {
    packet.push(`Recent notifications: ${recentNotifications.summary}`);
  }
  const recentScreen = screenWorkingContextActive(workingContext, now);
  if (
    recentScreen
    && isScreenWorkingContextFollowUpRequest(transcript)
    && !hasNegatedCapabilityRequest("screen", transcript)
    && !isNegatedScreenContextPronounFollowUpRequest(transcript)
    && !requiresFreshScreenRead(transcript)
  ) {
    packet.push(`Recent screen: ${recentScreen.activeApp} - ${recentScreen.title ?? recentScreen.text}`);
  }
  const memoryInspectionIntent = classifyRuntimeMemoryInspectionIntent([{ role: "user", content: transcript }]);
  const shouldBuildGroundedPacket = memoryInspectionIntent?.scopeLabel === "about you" ||
    (!memoryInspectionIntent && shouldGroundPersonalMemoryRequest(transcript));
  if (shouldBuildGroundedPacket) {
    try {
      packet.push(await buildGroundedEvidencePacketPrompt({
        userId,
        requestText: transcript,
        query: memoryInspectionIntent?.scopeLabel === "about you" ? memoryInspectionIntent.query : undefined,
        activeDevice: "android",
        activeModel: "gemma-4-e4b-it",
        currentContext: "local_voice",
        memoryLimit: 4,
        commitmentLimit: 3,
        renderMaxChars: 1_700,
      }));
    } catch {
      packet.push([
        "## Jarvis Grounded Evidence Packet",
        "EVIDENCE:",
        "- No grounded evidence loaded for this turn.",
        "Uncertainty:",
        "- Grounded evidence packet builder was unavailable.",
      ].join("\n"));
    }
  }
  return packet.join("\n");
}

function isRuntimeActivityStatusRequest(transcript: string): boolean {
  const text = compactText(transcript).toLowerCase();
  return /\bwhat(?:'s|\s+is|\s+are)\s+(?:you|jarvis)\s+(?:doing|working\s+on|running)\b/.test(text) ||
    /\bwhat\s+are\s+you\s+doing\s+right\s+now\b/.test(text) ||
    /\bwhat\s+is\s+running\s+right\s+now\b/.test(text);
}

function runtimeActivityStatusResponse(
  transcript: string,
  androidRuntime: FakeAndroidVoiceRuntime,
): {
  response: string;
  diagnostics: LocalVoiceHarnessDiagnostics;
} | null {
  if (!isRuntimeActivityStatusRequest(transcript)) return null;

  const scheduler = androidRuntime.execute("runtime_scheduler_status");
  const service = androidRuntime.execute("runtime_service_status");
  const lines: string[] = [];

  if (scheduler.ok) {
    lines.push(scheduler.detail ? `Scheduler: ${scheduler.label}:\n${scheduler.detail}` : `Scheduler: ${scheduler.label}.`);
  } else {
    lines.push("Scheduler: no active background work is visible to the local runtime.");
  }

  lines.push(service.ok ? "Voice runtime: no local crash is recorded." : `Voice runtime: ${service.label}. ${service.detail}`);

  return {
    response: lines.join("\n"),
    diagnostics: {
      outcome: "runtime_status_answer",
      executedToolName: "runtime_scheduler_status",
      modelOutputType: "runtime_direct",
    },
  };
}

function runtimeVoiceRestoreResponse(
  transcript: string,
  androidRuntime: FakeAndroidVoiceRuntime,
): {
  response: string;
  diagnostics: LocalVoiceHarnessDiagnostics;
} | null {
  const hasInterruptedVoiceContext = androidRuntime.availableEventTypes.includes("crash");
  const restoreReply = normalizeVoiceRestoreReply(transcript, { allowGenericReply: hasInterruptedVoiceContext });
  if (restoreReply.intent === "dismiss" && hasInterruptedVoiceContext) {
    const service = androidRuntime.execute("runtime_service_status");
    return {
      response: service.ok
        ? "I do not have an interrupted local voice context waiting to restore."
        : "Okay, I won't restore that interrupted voice context.",
      diagnostics: {
        outcome: service.ok ? "runtime_voice_restore_missing" : "runtime_voice_restore_dismissed",
        executedToolName: "runtime_service_status",
        modelOutputType: "runtime_direct",
      },
    };
  }
  if (restoreReply.intent !== "restore") return null;

  const service = androidRuntime.execute("runtime_service_status");
  if (service.ok) {
    return {
      response: "I do not have an interrupted local voice context waiting to restore.",
      diagnostics: {
        outcome: "runtime_voice_restore_missing",
        executedToolName: "runtime_service_status",
        modelOutputType: "runtime_direct",
      },
    };
  }

  const scheduler = androidRuntime.execute("runtime_scheduler_status");
  const lines = [
    "Here is the context I can safely restore:",
    `- Voice runtime: ${service.label}. ${service.detail}`,
  ];
  if (scheduler.ok && scheduler.detail) {
    lines.push(`- Background work:\n${scheduler.detail}`);
  }
  lines.push("The mic is still paused; tap Talk Mode when you want me listening again.");

  return {
    response: lines.join("\n"),
    diagnostics: {
      outcome: "runtime_voice_restore_recap",
      executedToolName: "runtime_service_status",
      modelOutputType: "runtime_direct",
    },
  };
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
        const event = latestScreenEvent(this.events, toolName);
        const screen = event ? screenSnapshotFromEvent(event, toolName) : null;
        const detail = screen ? formatScreenSnapshot(screen) : "";
        const hasCaptureAttachment = !!screen?.captureId || !!screen?.capturePath;
        const ok = !!screen && (toolName === "android_capture_screen" ? detail.length > 0 || hasCaptureAttachment : detail.length > 0);
        execution = {
          toolName,
          ok,
          label: screen
            ? screen.source === "temporary_capture"
              ? "Temporary screen capture"
              : `Screen: ${screen.activeApp}`
            : "No screen context available",
          detail,
          data: ok && screen ? { screen } : undefined,
        };
        break;
      }
      case "android_open_app_by_name": {
        const requestedApp = compactText(args.appName) || compactText(args.app) || "requested app";
        const event = [...this.events].reverse().find((candidate): candidate is Extract<LocalVoiceAndroidEvent, { type: "app_control" }> =>
          candidate.type === "app_control" && candidate.action === "open",
        );
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
      case "android_youtube_search": {
        const query = compactText(args.query) || compactText(args.searchQuery) || compactText(args.search_query) || compactText(args.text);
        const event = [...this.events].reverse().find((candidate): candidate is Extract<LocalVoiceAndroidEvent, { type: "app_control" }> =>
          candidate.type === "app_control" &&
          candidate.action === "search" &&
          isYoutubeAppName(candidate.appName) &&
          youtubeQueriesMatch(query, compactText(candidate.query)),
        );
        const eventQuery = compactText(event?.query);
        const ok = !!event && event.success !== false;
        execution = {
          toolName,
          ok,
          label: ok
            ? `Searched YouTube for ${eventQuery || query}`
            : `Could not search YouTube${query ? ` for ${query}` : ""}`,
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

function workingContextFromScreenExecution(
  execution: FakeAndroidExecution,
  now: Date,
  options: { suppressReadableScreenText?: boolean } = {},
): LocalVoiceWorkingContext | null {
  const screen = execution.data?.screen;
  if (
    !screen ||
    !execution.ok ||
    (execution.toolName !== "android_read_screen_context" && execution.toolName !== "android_capture_screen")
  ) {
    return null;
  }

  const recordedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS).toISOString();
  const captureId = screen.captureId ?? `temporary-capture-${now.getTime()}`;
  const suppressReadableScreenText = options.suppressReadableScreenText && execution.toolName === "android_capture_screen";
  return {
    screen: {
      source: screen.source,
      activeApp: screen.activeApp,
      title: suppressReadableScreenText ? undefined : screen.title,
      text: suppressReadableScreenText ? undefined : screen.text,
      elements: suppressReadableScreenText ? [] : screen.elements,
      recordedAt,
      expiresAt,
      ...(screen.source === "temporary_capture"
        ? {
            capture: {
              id: captureId,
              path: screen.capturePath ?? "",
              createdAt: recordedAt,
              expiresAt,
              savedToGallery: screen.savedToGallery ?? false,
              galleryPath: screen.galleryPath,
              previewLabel: "Temporary screen capture" as const,
              previewActions: ["copy_details", "delete"] as LocalVoiceScreenCapturePreviewAction[],
            },
          }
        : {}),
    },
  };
}

function workingContextFromExecution(
  execution: FakeAndroidExecution,
  now: Date,
  options: { suppressReadableScreenText?: boolean } = {},
): LocalVoiceWorkingContext | null {
  return workingContextFromNotificationExecution(execution, now)
    ?? workingContextFromScreenExecution(execution, now, options);
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

function mergeWorkingContextFromExecution(
  current: LocalVoiceWorkingContext | undefined,
  execution: FakeAndroidExecution,
  now: Date,
  options: { suppressReadableScreenText?: boolean } = {},
): LocalVoiceWorkingContext {
  const next = workingContextFromExecution(execution, now, options);
  if (next) return mergeWorkingContext(current, next);
  if (
    !execution.ok
    && (execution.toolName === "android_read_screen_context" || execution.toolName === "android_capture_screen")
    && !execution.data?.blockedByUser
  ) {
    const cleared = { ...(current ?? {}) };
    delete cleared.screen;
    return cleared;
  }
  return mergeWorkingContext(current, null);
}

function screenContextSummary(screen: LocalVoiceScreenWorkingContext): string {
  const detail = formatScreenSnapshot(screen);
  return detail ? `Here is what is on your screen:\n${detail}` : "I could not read anything useful from the screen.";
}

type ScreenCaptureFollowUpAction = "save" | "copy_details" | "delete";

const SCREEN_CAPTURE_TARGET_NOUN_PATTERN = String.raw`(?:screenshot|screen\s*shot|screen\s*capture|capture)`;
const SCREEN_CAPTURE_TARGET_PRONOUN_PATTERN = String.raw`(?:it|that|this)`;
const SCREEN_CAPTURE_COURTESY_TAIL_PATTERN = String.raw`(?:\s+(?:please|for\s+me))*\s*$`;
const SCREEN_CAPTURE_SAVE_DESTINATION_PATTERN = String.raw`(?:\s+(?:to|in|into)\s+(?:(?:the|my)\s+)?(?:gallery|photos|camera\s+roll|chat|this\s+chat))?`;
const SCREEN_CAPTURE_COPY_DESTINATION_PATTERN = String.raw`(?:\s+(?:to|in|into)\s+(?:(?:the|my)\s+)?(?:clipboard|chat|this\s+chat))?`;
const SCREEN_CAPTURE_DELETE_DESTINATION_PATTERN = String.raw`(?:\s+(?:from|out\s+of)\s+(?:(?:the|my)\s+)?(?:chat|this\s+chat))?`;

function screenCaptureFollowUpAction(
  transcript: string,
): { action: ScreenCaptureFollowUpAction; negated: boolean } | null {
  const clauses = transcriptActionClauses(transcript);
  const negatedActions = new Set<ScreenCaptureFollowUpAction>();
  let latestNegatedAction: { action: ScreenCaptureFollowUpAction; negated: true } | null = null;

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    const checks: Array<{ action: ScreenCaptureFollowUpAction; pattern: RegExp }> = [
      {
        action: "save",
        pattern: new RegExp(
          String.raw`\b(?:save|keep)\b(?:.*\b${SCREEN_CAPTURE_TARGET_NOUN_PATTERN}\b${SCREEN_CAPTURE_SAVE_DESTINATION_PATTERN}|\s+${SCREEN_CAPTURE_TARGET_PRONOUN_PATTERN}\b${SCREEN_CAPTURE_SAVE_DESTINATION_PATTERN}|${SCREEN_CAPTURE_SAVE_DESTINATION_PATTERN})${SCREEN_CAPTURE_COURTESY_TAIL_PATTERN}`,
          "i",
        ),
      },
      {
        action: "copy_details",
        pattern: new RegExp(
          String.raw`(?:\bcopy\b.*\bdetails\b(?:.*\b${SCREEN_CAPTURE_TARGET_NOUN_PATTERN}\b${SCREEN_CAPTURE_COPY_DESTINATION_PATTERN}|\s+(?:for|of|about)\s+${SCREEN_CAPTURE_TARGET_PRONOUN_PATTERN}\b${SCREEN_CAPTURE_COPY_DESTINATION_PATTERN}|${SCREEN_CAPTURE_COPY_DESTINATION_PATTERN})|\bcopy\b\s+${SCREEN_CAPTURE_TARGET_PRONOUN_PATTERN}\b${SCREEN_CAPTURE_COPY_DESTINATION_PATTERN})${SCREEN_CAPTURE_COURTESY_TAIL_PATTERN}`,
          "i",
        ),
      },
      {
        action: "delete",
        pattern: new RegExp(
          String.raw`\b(?:delete|remove|discard)\b(?:.*\b${SCREEN_CAPTURE_TARGET_NOUN_PATTERN}\b${SCREEN_CAPTURE_DELETE_DESTINATION_PATTERN}|\s+${SCREEN_CAPTURE_TARGET_PRONOUN_PATTERN}\b${SCREEN_CAPTURE_DELETE_DESTINATION_PATTERN}|${SCREEN_CAPTURE_DELETE_DESTINATION_PATTERN})${SCREEN_CAPTURE_COURTESY_TAIL_PATTERN}`,
          "i",
        ),
      },
    ];

    for (const check of checks) {
      const match = clause.match(check.pattern);
      if (!match) continue;
      const commandPrefix = clause.slice(0, match.index ?? 0);
      const negated = NEGATED_ACTION_PREFIX_PATTERN.test(commandPrefix);
      if (negated) {
        negatedActions.add(check.action);
        latestNegatedAction ??= { action: check.action, negated: true };
        continue;
      }
      return {
        action: check.action,
        negated: negatedActions.has(check.action),
      };
    }
  }

  return latestNegatedAction;
}

function responseFromScreenWorkingContext(
  transcript: string,
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
  androidRuntime: FakeAndroidVoiceRuntime,
  options: { skipScreenContextSummary?: boolean; pendingToolName?: LocalVoiceToolName } = {},
): {
  response: string;
  outcome: string;
  workingContext: LocalVoiceWorkingContext;
  copiedDetails?: LocalVoiceHarnessDiagnostics["copiedDetails"];
} | null {
  const screen = screenWorkingContextActive(workingContext, now);
  if (!screen) return null;

  const capture = screen.capture;
  const captureAction = capture ? screenCaptureFollowUpAction(transcript) : null;
  if (
    captureAction?.negated
    && !hasPositiveScreenContextRequest(transcript)
    && !(options.pendingToolName && !shouldExecuteToolBeforeWorkingContext(options.pendingToolName))
    && !hasPositiveNonScreenRuntimeRequest(transcript)
  ) {
    return {
      response: finalResponseForModelProblem("tool_recovery_blocked"),
      outcome: "screen_capture_action_blocked",
      workingContext: workingContext ?? {},
    };
  }

  if (capture && captureAction?.action === "save" && !captureAction.negated) {
    return {
      response: "I can't save temporary screen captures to Gallery yet. They stay attached to this chat unless you delete them.",
      outcome: "screen_capture_save_unavailable",
      workingContext: workingContext ?? {},
    };
  }

  if (capture && captureAction?.action === "copy_details" && !captureAction.negated) {
    return {
      response: "I copied the screen capture details.",
      outcome: "screen_capture_details_copied",
      workingContext: workingContext ?? {},
      copiedDetails: {
        capture: {
          id: capture.id,
          path: capture.path,
          savedToGallery: capture.savedToGallery,
          galleryPath: capture.galleryPath,
          expiresAt: capture.expiresAt,
        },
      },
    };
  }

  if (capture && captureAction?.action === "delete" && !captureAction.negated) {
    const nextWorkingContext = { ...(workingContext ?? {}) };
    delete nextWorkingContext.screen;
    return {
      response: "I deleted that temporary screen capture.",
      outcome: "screen_capture_deleted",
      workingContext: nextWorkingContext,
    };
  }

  if (options.skipScreenContextSummary) return null;

  const screenContextRequested = isScreenWorkingContextFollowUpRequest(transcript);
  if (
    screenContextRequested
    && (hasNegatedCapabilityRequest("screen", transcript) || isNegatedScreenContextPronounFollowUpRequest(transcript))
  ) {
    return null;
  }

  if (screenContextRequested) {
    return {
      response: screen.source === "temporary_capture"
        ? `Temporary screen capture attached. Attached to chat; Gallery save not intended.\n${screenContextSummary(screen)}`
        : screenContextSummary(screen),
      outcome: screen.source === "temporary_capture" ? "screen_capture_context_summary" : "screen_context_summary",
      workingContext: workingContext ?? {},
    };
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
  const followUp = resolveAndroidNotificationFollowUp(transcript, recentNotifications.notifications);
  if (!followUp) return null;

  if (followUp.kind === "open") {
    const execution = androidRuntime.execute("android_open_app_by_name", { appName: followUp.notification.app });
    return {
      response: execution.ok
        ? `I found the ${followUp.notification.app} notification and opened ${followUp.notification.app}.`
        : `I found the ${followUp.notification.app} notification, but I could not open ${followUp.notification.app} yet.`,
      outcome: "notification_reference_opened",
      workingContext: workingContext ?? {},
    };
  }

  if (followUp.kind === "read_all") {
    return {
      response: followUp.response,
      outcome: "notification_context_read_all",
      workingContext: workingContext ?? {},
    };
  }

  if (followUp.kind === "read") {
    return {
      response: followUp.response,
      outcome: "notification_reference_read",
      workingContext: workingContext ?? {},
    };
  }

  return {
    response: followUp.response,
    outcome: "notification_context_summary",
    workingContext: workingContext ?? {},
  };
}

function responseFromRuntimeWorkingContext(
  transcript: string,
  workingContext: LocalVoiceWorkingContext | undefined,
  now: Date,
  androidRuntime: FakeAndroidVoiceRuntime,
  options: { skipScreenContextSummary?: boolean; pendingToolName?: LocalVoiceToolName } = {},
): {
  response: string;
  outcome: string;
  workingContext: LocalVoiceWorkingContext;
  copiedDetails?: LocalVoiceHarnessDiagnostics["copiedDetails"];
} | null {
  if (isScreenContextPronounFollowUpRequest(transcript) && !isScreenContextFollowUpRequest(transcript)) {
    const notificationResponse = responseFromNotificationWorkingContext(transcript, workingContext, now, androidRuntime);
    if (notificationResponse) return notificationResponse;
  }

  const screenResponse = responseFromScreenWorkingContext(transcript, workingContext, now, androidRuntime, options);
  if (screenResponse) return screenResponse;

  return responseFromNotificationWorkingContext(transcript, workingContext, now, androidRuntime);
}

function executeAndroidToolWithFallback(
  androidRuntime: FakeAndroidVoiceRuntime,
  toolName: LocalVoiceToolName,
  args: Record<string, unknown>,
  transcript: string,
): { execution: FakeAndroidExecution; executedToolName: LocalVoiceToolName; usedCaptureFallback: boolean } {
  const requestedToolName = toolName === "android_read_screen_context" || toolName === "android_capture_screen"
    ? screenToolNameForTranscript(toolName, transcript)
    : toolName;
  if (requestedToolName === "android_read_screen_context" && hasNegatedCapabilityRequest("screen", transcript)) {
    return {
      execution: {
        toolName: "android_read_screen_context",
        ok: false,
        label: "Screen read was not allowed",
        detail: "",
        data: { blockedByUser: true },
      },
      executedToolName: "android_read_screen_context",
      usedCaptureFallback: false,
    };
  }
  if (requestedToolName === "android_capture_screen" && hasNegatedScreenCaptureRequest(transcript)) {
    if (hasPositiveScreenContextRequest(transcript)) {
      const readExecution = androidRuntime.execute("android_read_screen_context", args);
      return { execution: readExecution, executedToolName: "android_read_screen_context", usedCaptureFallback: false };
    }
    return {
      execution: {
        toolName: "android_capture_screen",
        ok: false,
        label: "Screen capture was not allowed",
        detail: "",
        data: { blockedByUser: true },
      },
      executedToolName: "android_capture_screen",
      usedCaptureFallback: false,
    };
  }
  const execution = androidRuntime.execute(requestedToolName, args);
  if (requestedToolName !== "android_read_screen_context" || execution.ok) {
    return { execution, executedToolName: requestedToolName, usedCaptureFallback: false };
  }

  if (hasNegatedScreenCaptureRequest(transcript)) {
    return { execution, executedToolName: requestedToolName, usedCaptureFallback: false };
  }

  const captureExecution = androidRuntime.execute("android_capture_screen", args);
  if (!captureExecution.ok) {
    return { execution, executedToolName: requestedToolName, usedCaptureFallback: false };
  }

  return {
    execution: captureExecution,
    executedToolName: "android_capture_screen",
    usedCaptureFallback: true,
  };
}

function summarizeExecution(
  execution: FakeAndroidExecution,
  options: { suppressReadableScreenText?: boolean } = {},
): string {
  if (!execution.ok) {
    return `I could not complete that phone action yet. ${execution.label}.`;
  }

  switch (execution.toolName) {
    case "android_read_notifications":
      return summarizeAndroidNotifications(execution.data?.notifications ?? []);
    case "android_read_screen_context":
      return execution.detail ? `Here is what is on your screen:\n${execution.detail}` : "I could not read anything useful from the screen.";
    case "android_capture_screen":
      if (execution.detail && !options.suppressReadableScreenText) {
        return `Temporary screen capture attached. Attached to chat; Gallery save not intended.\nHere is what is on your screen:\n${execution.detail}`;
      }
      return execution.data?.screen?.captureId || execution.data?.screen?.capturePath
        ? "Temporary screen capture attached. Attached to chat; Gallery save not intended."
        : "I could not capture anything useful from the screen.";
    case "android_open_app_by_name":
      return execution.detail ? `${execution.label}. ${execution.detail}` : `${execution.label}.`;
    case "android_youtube_search":
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

function cloudEscalationForModelProblem(
  outcome: string,
  transcript: string,
  escalation: LocalVoiceCloudEscalationInput | undefined,
): CloudBackgroundEscalationDecision | null {
  if (!escalation) return null;
  return buildCloudBackgroundEscalationDecision({
    requestText: transcript,
    reason: outcome,
    providers: escalation.providers,
    selectedProviderId: escalation.selectedProviderId,
    selectedProviderAuthType: escalation.selectedProviderAuthType,
    approvedProvider: escalation.approvedProvider,
    approvedBudgetUsd: escalation.approvedBudgetUsd,
  });
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

  const androidRuntime = new FakeAndroidVoiceRuntime(input.androidEvents ?? []);
  let workingContext = pruneExpiredWorkingContext(input.workingContext, now);
  const runtimeRestore = runtimeVoiceRestoreResponse(transcript, androidRuntime);
  if (runtimeRestore) {
    const canonicalResponse = runtimeRestore.response;
    return {
      transcript,
      canonicalResponse,
      chatOutput: canonicalResponse,
      ttsOutput: canonicalResponse,
      responseCount: 1,
      modelCalls,
      androidExecutions: [...androidRuntime.executions],
      workingContext,
      diagnostics: runtimeRestore.diagnostics,
    };
  }
  const runtimeStatus = runtimeActivityStatusResponse(transcript, androidRuntime);
  if (runtimeStatus) {
    const canonicalResponse = runtimeStatus.response;
    return {
      transcript,
      canonicalResponse,
      chatOutput: canonicalResponse,
      ttsOutput: canonicalResponse,
      responseCount: 1,
      modelCalls,
      androidExecutions: [...androidRuntime.executions],
      workingContext,
      diagnostics: runtimeStatus.diagnostics,
    };
  }

  recordModelCall(modelCalls, {
    kind: "local_gemma",
    provider: "android-local-gemma",
    model: "gemma-4-e4b-it",
    reason: "live local voice turn",
  });

  const modelOutput = await input.gemma.generate({
    transcript,
    contextPacket: await contextPacketFromEvents(userId, input.androidEvents ?? [], transcript, workingContext, now),
  });

  let canonicalResponse = "";
  let diagnostics: LocalVoiceHarnessDiagnostics;

  if (modelOutput.type === "final") {
    const finalScreenRefreshTool = screenRefreshToolForTranscript(transcript, workingContext, now);
    const shouldRefreshScreen = !!finalScreenRefreshTool
      && (
        requiresFreshScreenRead(transcript)
        || hasFreshScreenEventForTool(input.androidEvents ?? [], finalScreenRefreshTool, transcript)
      );
    const workingContextResponse = responseFromRuntimeWorkingContext(
      transcript,
      workingContext,
      now,
      androidRuntime,
      { skipScreenContextSummary: shouldRefreshScreen },
    );
    if (workingContextResponse) {
      canonicalResponse = workingContextResponse.response;
      workingContext = workingContextResponse.workingContext;
      diagnostics = {
        outcome: workingContextResponse.outcome,
        modelOutputType: modelOutput.type,
        copiedDetails: workingContextResponse.copiedDetails,
      };
    } else if (finalScreenRefreshTool && shouldRefreshScreen) {
      const executionResult = executeAndroidToolWithFallback(androidRuntime, finalScreenRefreshTool, {}, transcript);
      const execution = executionResult.execution;
      const suppressReadableScreenText = executionResult.executedToolName === "android_capture_screen"
        && hasNegatedScreenReadbackRequest(transcript);
      canonicalResponse = summarizeExecution(execution, { suppressReadableScreenText });
      workingContext = mergeWorkingContextFromExecution(workingContext, execution, now, { suppressReadableScreenText });
      diagnostics = {
        outcome: executionResult.usedCaptureFallback
          ? "tool_executed_after_final_capture_fallback"
          : "tool_executed_after_final_screen_refresh",
        executedToolName: executionResult.executedToolName,
        modelOutputType: modelOutput.type,
      };
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
      const shouldRefreshScreen = shouldExecuteToolBeforeWorkingContext(normalizedToolName)
        && (
          requiresFreshScreenRead(transcript)
          || hasFreshScreenEventForTool(input.androidEvents ?? [], normalizedToolName, transcript)
        );
      const workingContextResponse = responseFromRuntimeWorkingContext(
        transcript,
        workingContext,
        now,
        androidRuntime,
        { skipScreenContextSummary: shouldRefreshScreen, pendingToolName: normalizedToolName },
      );
      if (workingContextResponse) {
        canonicalResponse = workingContextResponse.response;
        workingContext = workingContextResponse.workingContext;
        diagnostics = {
          outcome: workingContextResponse.outcome,
          modelOutputType: modelOutput.type,
          copiedDetails: workingContextResponse.copiedDetails,
        };
      } else {
        const executionResult = executeAndroidToolWithFallback(
          androidRuntime,
          normalizedToolName,
          parseToolArguments(modelOutput.arguments),
          transcript,
        );
        const execution = executionResult.execution;
        const suppressReadableScreenText = executionResult.executedToolName === "android_capture_screen"
          && hasNegatedScreenReadbackRequest(transcript);
        canonicalResponse = summarizeExecution(execution, { suppressReadableScreenText });
        workingContext = mergeWorkingContextFromExecution(workingContext, execution, now, { suppressReadableScreenText });
        diagnostics = {
          outcome: executionResult.usedCaptureFallback
            ? "tool_call_capture_fallback"
            : modelOutput.type === "invalid_tool_call"
              ? "tool_call_recovered"
              : "tool_call_executed",
          requestedToolName: modelOutput.name,
          executedToolName: executionResult.executedToolName,
          recoveredToolName: modelOutput.name === normalizedToolName ? undefined : executionResult.executedToolName,
          modelOutputType: modelOutput.type,
        };
      }
    }
  } else if (modelOutput.type === "false_denial") {
    const recoveredAppControlRequest = modelOutput.capability === "app_control"
      ? inferRecoveredAppControlRequest(transcript)
      : null;
    const recoveredToolName = recoveredAppControlRequest?.toolName ?? capabilityToolName(modelOutput.capability);
    const recoveredArgs = recoveredAppControlRequest?.args
      ?? argsForRecoveredCapability(modelOutput.capability, transcript, input.androidEvents ?? []);
    const shouldRefreshScreen = shouldExecuteToolBeforeWorkingContext(recoveredToolName)
      && (
        requiresFreshScreenRead(transcript)
        || hasFreshScreenEventForTool(input.androidEvents ?? [], recoveredToolName, transcript)
      );
    const workingContextResponse = responseFromRuntimeWorkingContext(
      transcript,
      workingContext,
      now,
      androidRuntime,
      { skipScreenContextSummary: shouldRefreshScreen, pendingToolName: recoveredToolName },
    );
    if (workingContextResponse) {
      canonicalResponse = workingContextResponse.response;
      workingContext = workingContextResponse.workingContext;
      diagnostics = {
        outcome: workingContextResponse.outcome,
        modelOutputType: modelOutput.type,
        copiedDetails: workingContextResponse.copiedDetails,
      };
    } else {
      const recoveryBlocked = modelOutput.capability === "app_control"
        ? !recoveredAppControlRequest
        : hasNegatedCapabilityRequest(modelOutput.capability, transcript);
      if (recoveryBlocked) {
        canonicalResponse = finalResponseForModelProblem("tool_recovery_blocked");
        diagnostics = {
          outcome: "tool_recovery_blocked",
          executedToolName: recoveredToolName,
          modelOutputType: modelOutput.type,
        };
      } else {
        const executionResult = executeAndroidToolWithFallback(androidRuntime, recoveredToolName, recoveredArgs, transcript);
        const execution = executionResult.execution;
        const suppressReadableScreenText = executionResult.executedToolName === "android_capture_screen"
          && hasNegatedScreenReadbackRequest(transcript);
        canonicalResponse = summarizeExecution(execution, { suppressReadableScreenText });
        workingContext = mergeWorkingContextFromExecution(workingContext, execution, now, { suppressReadableScreenText });
        diagnostics = {
          outcome: executionResult.usedCaptureFallback
            ? "tool_executed_after_false_denial_capture_fallback"
            : "tool_executed_after_false_denial",
          executedToolName: executionResult.executedToolName,
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
    const cloudEscalation = cloudEscalationForModelProblem(outcome, transcript, input.cloudEscalation);
    const localProblemResponse = finalResponseForModelProblem(outcome);
    canonicalResponse = cloudEscalation && cloudEscalation.kind !== "not_offered"
      ? `${localProblemResponse} ${cloudEscalation.message}`
      : localProblemResponse;
    diagnostics = {
      outcome,
      modelOutputType: modelOutput.type,
      ...(cloudEscalation ? { cloudEscalation } : {}),
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
