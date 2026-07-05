import {
  formatAndroidNotificationsInOrder,
  summarizeAndroidNotifications,
} from "./agent/androidNotificationSummary";
import { resolveAndroidNotificationFollowUp } from "./agent/androidNotificationFollowups";
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
  | "android_youtube_search"
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
const ANY_ACTION_COMMAND_WORDS = String.raw`(?:open|launch|start|read|show|check|copy|approve|confirm|request|take|capture|search|find|look\s+up|look\s+for)`;
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
      return /\b(?:screen|screenshot|screen grab|display)\b/i;
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
      return /\b(?:don't|dont|do not|never|stop|didn't|did not|could\s+you\s+not|can\s+you\s+not|please\s+don't|please\s+dont|please\s+do\s+not|not|no)\s+(?:read|show|check|take|capture)\s+(?:it|that|this)\b/i;
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

function hasNegatedCapabilityRequest(capability: LocalVoiceCapability, transcript: string): boolean {
  const requestPattern = capabilityRequestPattern(capability);
  const cancellationPattern = capabilityPronounCancellationPattern(capability);
  const clauses = transcriptActionClauses(transcript);

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (
      cancellationPattern &&
      cancellationPattern.test(clause) &&
      requestPattern.test(clauses.slice(0, index).join(" "))
    ) {
      return true;
    }
    const requestMatch = clause.match(requestPattern);
    if (!requestMatch) continue;
    const commandPrefix = clause.slice(0, requestMatch.index ?? 0);
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
  if (recentNotifications && resolveAndroidNotificationFollowUp(transcript, recentNotifications.notifications)) {
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

function mergeWorkingContext(
  current: LocalVoiceWorkingContext | undefined,
  next: LocalVoiceWorkingContext | null,
): LocalVoiceWorkingContext {
  return {
    ...(current ?? {}),
    ...(next ?? {}),
  };
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
      const workingContextResponse = responseFromNotificationWorkingContext(transcript, workingContext, now, androidRuntime);
      if (workingContextResponse) {
        canonicalResponse = workingContextResponse.response;
        workingContext = workingContextResponse.workingContext;
        diagnostics = { outcome: workingContextResponse.outcome, modelOutputType: modelOutput.type };
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
    }
  } else if (modelOutput.type === "false_denial") {
    const workingContextResponse = responseFromNotificationWorkingContext(transcript, workingContext, now, androidRuntime);
    if (workingContextResponse) {
      canonicalResponse = workingContextResponse.response;
      workingContext = workingContextResponse.workingContext;
      diagnostics = { outcome: workingContextResponse.outcome, modelOutputType: modelOutput.type };
    } else {
      const recoveredAppControlRequest = modelOutput.capability === "app_control"
        ? inferRecoveredAppControlRequest(transcript)
        : null;
      const recoveredToolName = recoveredAppControlRequest?.toolName ?? capabilityToolName(modelOutput.capability);
      const recoveredArgs = recoveredAppControlRequest?.args
        ?? argsForRecoveredCapability(modelOutput.capability, transcript, input.androidEvents ?? []);
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
