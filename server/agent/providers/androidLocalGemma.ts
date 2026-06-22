import type OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { ANDROID_LOCAL_GEMMA_MODEL } from "@shared/modelProviderCatalog";
import { BaseProvider, isJsonObjectResponseFormat } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";

type DaemonOpResult = { ok: boolean; data?: unknown; error?: string };

type AndroidLocalGemmaDaemonOp = (
  userId: string,
  op: {
    type: "android_local_model_generate";
    requestId?: string;
    model: string;
    prompt: string;
    contextTokens?: number;
    maxTokens?: number;
    backend?: string;
    allowCpuFallback?: boolean;
    temperature?: number;
  } | {
    type: "android_local_model_cancel";
    requestId?: string;
  },
  timeoutMs: number,
) => Promise<DaemonOpResult>;

let daemonOpForTesting: AndroidLocalGemmaDaemonOp | null = null;

const DEFAULT_PHONE_GEMMA_TIMEOUT_MS = 60_000;
const DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS = 2048;
const DEFAULT_PHONE_GEMMA_MAX_COMPLETION_TOKENS = 128;
const DEFAULT_PHONE_GEMMA_ALLOW_CPU_FALLBACK = false;
const DEFAULT_PHONE_GEMMA_PROMPT_CHAR_BUDGET = 3_600;
const DEFAULT_PHONE_GEMMA_TOOL_LIST_CHAR_BUDGET = 1_600;
const MAX_TOOL_DESCRIPTION_CHARS = 180;
const MAX_TOOL_ARGUMENT_NAMES = 12;
const MIN_REQUIRED_PROMPT_SECTION_CHARS = 80;
const MIN_TAIL_PROMPT_SECTION_CHARS = 24;
const DAEMON_TOOL_ARGUMENT_HINTS = [
  "packageName", "url", "x", "y", "x1", "y1", "x2", "y2", "durationMs", "key", "text",
  "path", "query", "root", "fileType", "notificationKey", "replyText", "approved",
  "facing", "audio", "accuracy", "to", "message", "operatorAction",
];
const ANDROID_DAEMON_ACTION_ALIASES: Record<string, string> = {
  screenshot: "android_screenshot",
  screen_shot: "android_screenshot",
  take_screenshot: "android_screenshot",
  capture_screen: "android_screenshot",
  read_screen: "android_read_screen",
  screen_reader: "android_read_screen",
  inspect_screen: "android_read_screen",
  screen_context: "android_screen_context",
  operator_action: "android_operator_action",
  open_app: "android_open_app",
  launch_app: "android_open_app",
  start_app: "android_open_app",
  open_url: "android_browse",
  browse: "android_browse",
  browser: "android_browse",
  tap: "android_tap",
  click: "android_tap",
  type: "android_type",
  type_text: "android_type",
  enter_text: "android_type",
  input_text: "android_type",
  swipe: "android_swipe",
  press_key: "android_press_key",
  key: "android_press_key",
  wait: "android_wait",
  return_to_jarvis: "android_return_to_jarvis",
  open_youtube: "android_open_app",
  launch_youtube: "android_open_app",
  youtube: "android_open_app",
};
const DIRECT_ANDROID_DAEMON_ACTION_NAMES = new Set([
  "android_open_app",
  "android_browse",
  "android_screenshot",
  "android_read_screen",
  "android_screen_context",
  "android_operator_action",
  "android_tap",
  "android_type",
  "android_swipe",
  "android_press_key",
  "android_file_list",
  "android_file_read",
  "android_notifications_list",
  "android_wait",
  "android_return_to_jarvis",
  "android_file_search",
  "android_open_file",
  "android_copy_to_clipboard",
  "android_notification_reply",
  "android_camera_snap",
  "android_camera_clip",
  "android_location_get",
  "android_sms_send",
  "android_screen_record",
  "android_view_hierarchy",
  "android_paste_text",
  "android_get_focused_field",
]);
const ANDROID_APP_PACKAGE_ALIASES: Record<string, string> = {
  youtube: "com.google.android.youtube",
  yt: "com.google.android.youtube",
  you_tube: "com.google.android.youtube",
  chrome: "com.android.chrome",
  browser: "com.android.chrome",
  maps: "com.google.android.apps.maps",
  google_maps: "com.google.android.apps.maps",
  gmail: "com.google.android.gm",
  settings: "com.android.settings",
  spotify: "com.spotify.music",
  reddit: "com.reddit.frontpage",
  facebook: "com.facebook.katana",
  instagram: "com.instagram.android",
  messenger: "com.facebook.orca",
  whatsapp: "com.whatsapp",
  tiktok: "com.ss.android.ugc.trill",
  discord: "com.discord",
};
const FLAG_SECURE_SCREENSHOT_PACKAGES = new Set([
  "com.facebook.katana",
  "com.facebook.lite",
  "com.instagram.android",
  "com.whatsapp",
  "com.snapchat.android",
  "com.netflix.mediaclient",
  "com.disney.disneyplus",
]);
const ANDROID_KEY_ACTION_ALIASES = new Set(["back", "home", "recents", "enter", "volume_up", "volume_down"]);

type LocalGemmaStructuredOutput =
  | { type: "final"; content: string }
  | { type: "tool_calls"; toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] };

function androidLocalGemmaEnv(name: string): string | undefined {
  switch (name) {
    case "ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK":
      return process.env.ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK;
    case "ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS":
      return process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS;
    case "ANDROID_LOCAL_GEMMA_MAX_COMPLETION_TOKENS":
      return process.env.ANDROID_LOCAL_GEMMA_MAX_COMPLETION_TOKENS;
    case "ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET":
      return process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
    case "ANDROID_LOCAL_GEMMA_TIMEOUT_MS":
      return process.env.ANDROID_LOCAL_GEMMA_TIMEOUT_MS;
    case "ANDROID_LOCAL_GEMMA_TOOL_LIST_CHAR_BUDGET":
      return process.env.ANDROID_LOCAL_GEMMA_TOOL_LIST_CHAR_BUDGET;
    default:
      return undefined;
  }
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = androidLocalGemmaEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = androidLocalGemmaEnv(name);
  if (!raw) return fallback;
  return /^(?:1|true|yes|on)$/i.test(raw.trim());
}

function phoneGemmaTimeoutMs(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_TIMEOUT_MS", DEFAULT_PHONE_GEMMA_TIMEOUT_MS, 10_000, 120_000);
}

function phoneGemmaContextTokens(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS", DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS, 512, 4096);
}

function phoneGemmaMaxCompletionTokens(requested: number | undefined): number {
  const ceiling = intEnv("ANDROID_LOCAL_GEMMA_MAX_COMPLETION_TOKENS", DEFAULT_PHONE_GEMMA_MAX_COMPLETION_TOKENS, 16, 512);
  const wanted = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : ceiling;
  return Math.min(ceiling, Math.max(1, wanted));
}

function phoneGemmaAllowCpuFallback(): boolean {
  return boolEnv("ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK", DEFAULT_PHONE_GEMMA_ALLOW_CPU_FALLBACK);
}

function phoneGemmaPromptCharBudget(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET", DEFAULT_PHONE_GEMMA_PROMPT_CHAR_BUDGET, 1_200, 12_000);
}

function phoneGemmaToolListCharBudget(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_TOOL_LIST_CHAR_BUDGET", DEFAULT_PHONE_GEMMA_TOOL_LIST_CHAR_BUDGET, 500, 6_000);
}

function shouldCancelTimedOutGeneration(result: DaemonOpResult): boolean {
  return !result.ok && /timeout/i.test(result.error || "");
}

export function _setAndroidLocalGemmaDaemonOpForTesting(fn: AndroidLocalGemmaDaemonOp | null): void {
  daemonOpForTesting = fn;
}

function normalizeAndroidLocalGemmaModel(model: string): string {
  const raw = model?.trim() || ANDROID_LOCAL_GEMMA_MODEL;
  return raw.startsWith("android-local-gemma/")
    ? raw.slice("android-local-gemma/".length)
    : raw;
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

function messageForPrompt(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): string {
  if (message.role === "tool") {
    return `tool(${message.tool_call_id}): ${textFromContent(message.content)}`;
  }
  const content = textFromContent(message.content);
  if (message.role === "assistant" && message.tool_calls?.length) {
    const calls = message.tool_calls
      .filter((call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => call.type === "function")
      .map((call) => `${call.function.name}(${call.function.arguments || "{}"})`)
      .join("\n");
    return `assistant: ${content}\nassistant tool calls:\n${calls}`.trim();
  }
  return `${message.role}: ${content}`;
}

function truncateText(value: string | undefined, maxChars: number): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function truncateTextMiddle(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  if (maxChars <= 12) return truncateText(text, maxChars);
  const marker = " ... ";
  const available = maxChars - marker.length;
  const headChars = Math.ceil(available * 0.55);
  const tailChars = Math.max(0, available - headChars);
  return `${text.slice(0, headChars).trimEnd()}${marker}${text.slice(text.length - tailChars).trimStart()}`;
}

function latestUserText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function shouldOmitLocalRuntimeErrorMessage(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): boolean {
  if (message.role !== "assistant" || message.tool_calls?.length) return false;
  const text = textFromContent(message.content).trim();
  return /^Error:\s*(?:LOCAL_MODEL_|Phone Gemma|Android Local Gemma|Jarvis Android app device control)/i.test(text) ||
    /\bLOCAL_MODEL_(?:GENERATION_FAILED|DEVICE_MEMORY_LOW|BUSY|CANCELLED|ENGINE_NOT_BUNDLED|VALIDATION_REQUIRED|VALIDATION_FAILED)\b/i.test(text) ||
    /^Phone Gemma (?:could not|finished without|timed out|is still working)/i.test(text);
}

function hasActiveToolContinuation(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  return messages[messages.length - 1]?.role === "tool";
}

function looksLikeLocalToolRequest(text: string): boolean {
  return /\b(screenshot|screen shot|photo|picture|camera|microphone|mic|record|open|launch|tap|click|press|swipe|scroll|type|enter|back|home|settings|permission|bluetooth|wifi|wi-fi|call|text|sms|message|location|map|maps|navigate|alarm|timer|reminder|calendar|volume|brightness|flashlight|read|show|look at|what'?s on|what is on|phone|device|app|apps|control|enable|disable|turn on|turn off)\b/i.test(text);
}

function looksLikeUrlToolRequest(text: string): boolean {
  return /\b(?:https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)/i.test(text);
}

function isToolConfirmationTurn(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  const latest = latestUserText(messages).trim();
  if (!looksLikeApprovalConfirmation(latest)) return false;
  let assistantIndex = -1;
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    assistantIndex = index;
    const text = textFromContent(message.content);
    if (!/\b(?:confirm|approve|permission|should i|do you want me|want me to|shall i|go ahead|proceed)\b/i.test(text)) return false;
    if (looksLikeLocalToolRequest(text) || looksLikeUrlToolRequest(text)) return true;
    break;
  }

  if (assistantIndex < 0) return false;
  const scanStart = Math.max(0, assistantIndex - 4);
  for (let index = assistantIndex - 1; index >= scanStart; index -= 1) {
    const message = messages[index];
    if (message.role === "tool") return true;
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
    if (message.role === "user") {
      const text = textFromContent(message.content);
      if (looksLikeLocalToolRequest(text) || looksLikeUrlToolRequest(text)) return true;
    }
  }
  return false;
}

function looksLikeApprovalConfirmation(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:yes|yeah|yep|ok|okay|sure)(?: please)?(?: go ahead| do it| proceed| continue)?$/.test(normalized) ||
    /^(?:go ahead|do it|please do|please do it|please proceed|proceed|continue)$/.test(normalized);
}

function shouldUseLocalToolProtocol(params: ProviderQueryParams): boolean {
  if (!params.tools?.length || params.toolChoice === "none") return false;
  if (params.toolChoice === "required") return true;
  const latest = latestUserText(params.messages);
  return hasActiveToolContinuation(params.messages) ||
    looksLikeLocalToolRequest(latest) ||
    looksLikeUrlToolRequest(latest) ||
    isToolConfirmationTurn(params.messages);
}

function formatPromptSections(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  budgetChars: number,
  includeIndexes: boolean,
): string {
  const promptMessages = messages.filter((message) => !shouldOmitLocalRuntimeErrorMessage(message));
  const omittedRuntimeErrors = messages.length - promptMessages.length;
  const sections = promptMessages
    .map((message, index) => {
      const name = "name" in message && typeof message.name === "string" ? ` (${message.name})` : "";
      const heading = includeIndexes ? `Message ${index + 1} [${message.role}${name}]` : "";
      return {
        role: message.role,
        hasToolCalls: message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0,
        text: [heading, messageForPrompt(message)].filter(Boolean).join("\n").trim(),
      };
    })
    .filter((section) => section.text.length > 0);

  const systemSections = sections.filter((section) => section.role === "system");
  const nonSystemSections = sections.filter((section) => section.role !== "system");

  const keptSystem: string[] = [];
  let systemUsed = 0;
  let omittedSystem = 0;
  if (systemSections.length > 0) {
    const systemBudget = Math.min(Math.max(400, Math.floor(budgetChars * 0.35)), Math.max(250, budgetChars - 300));
    for (const section of systemSections) {
      const separatorChars = keptSystem.length > 0 ? 10 : 0;
      const available = systemBudget - systemUsed - separatorChars;
      if (available < 120) {
        omittedSystem += 1;
        continue;
      }
      const text = truncateTextMiddle(section.text, available);
      keptSystem.push(text);
      systemUsed += separatorChars + text.length;
    }
  }

  const kept: string[] = [];
  let omittedNonSystem = 0;
  const remainingBudget = Math.max(MIN_REQUIRED_PROMPT_SECTION_CHARS, budgetChars - systemUsed - (keptSystem.length > 0 ? 10 : 0));
  const tailStartIndex = requiredTailStartIndex(nonSystemSections);
  const tailSections = tailStartIndex >= 0 ? nonSystemSections.slice(tailStartIndex) : [];
  let used = 0;
  if (tailSections.length > 0) {
    const separatorChars = Math.max(0, tailSections.length - 1) * 10;
    const perSectionBudget = Math.max(MIN_TAIL_PROMPT_SECTION_CHARS, Math.floor((remainingBudget - separatorChars) / tailSections.length));
    const renderedTail = tailSections.map((section) => truncateTextMiddle(section.text, perSectionBudget));
    kept.push(...renderedTail);
    used = renderedTail.join("\n\n---\n\n").length;
  }

  for (let index = tailStartIndex - 1; index >= 0; index -= 1) {
    const section = nonSystemSections[index].text;
    const separatorChars = kept.length > 0 ? 10 : 0;
    if (used + separatorChars + section.length <= remainingBudget) {
      kept.unshift(section);
      used += separatorChars + section.length;
      continue;
    }
    omittedNonSystem += 1;
  }

  const omitted = omittedSystem + omittedNonSystem + omittedRuntimeErrors;
  const prefix = omitted > 0 ? [`[${omitted} earlier message${omitted === 1 ? "" : "s"} omitted to keep Phone Gemma inside its local context budget.]`] : [];
  return [...prefix, ...keptSystem, ...kept].join("\n\n---\n\n");
}

function requiredTailStartIndex<TSection extends { role: string; hasToolCalls?: boolean }>(sections: TSection[]): number {
  if (sections.length === 0) return -1;
  let index = sections.length - 1;
  if (sections[index].role !== "tool") return index;

  while (index > 0 && sections[index - 1].role === "tool") {
    index -= 1;
  }
  if (index > 0 && sections[index - 1].role === "assistant") {
    index -= 1;
  }
  if (index > 0 && sections[index - 1].role === "user") {
    index -= 1;
  }
  return index;
}

function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parseWholeJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeToolArguments(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "{}";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return "{}";
}

function toolArgumentsObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return null;
}

function aliasToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function packageNameFromAlias(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.includes(".")) return raw;
  return ANDROID_APP_PACKAGE_ALIASES[aliasToken(raw)] || null;
}

function inferPackageNameForAction(actionToken: string, args: Record<string, unknown>): string | null {
  const explicit = packageNameFromAlias(args.packageName);
  if (explicit) return explicit;

  for (const field of ["app", "appName", "application", "package", "target"]) {
    const inferred = packageNameFromAlias(args[field]);
    if (inferred) return inferred;
  }

  const appFromAction = actionToken
    .replace(/^(?:android_)?(?:open|launch|start)_/, "")
    .replace(/^app_/, "");
  return packageNameFromAlias(appFromAction);
}

function inferPackageNamesFromText(text: string): string[] {
  const requestToken = aliasToken(text);
  if (!requestToken) return [];
  const packages = new Set<string>();
  for (const [alias, packageName] of Object.entries(ANDROID_APP_PACKAGE_ALIASES)) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|_)${escapedAlias}(?:_|$)`).test(requestToken)) {
      packages.add(packageName);
    }
  }
  return [...packages];
}

function inferPackageNameFromText(text: string): string | null {
  const packageNames = inferPackageNamesFromText(text);
  return packageNames.length === 1 ? packageNames[0] : null;
}

function inferAllowedPackageNameFromText(text: string): string | null {
  const packageNames = inferPackageNamesFromText(text)
    .filter((packageName) => !packageTargetNegatedInText(text, packageName));
  return packageNames.length === 1 ? packageNames[0] : null;
}

function packageAliases(packageName: string): string[] {
  return Object.entries(ANDROID_APP_PACKAGE_ALIASES)
    .filter(([, value]) => value === packageName)
    .map(([alias]) => alias);
}

function aliasPattern(alias: string): RegExp {
  const pattern = alias
    .split("_")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s_-]+");
  return new RegExp(`\\b${pattern}\\b`, "gi");
}

function requestSegmentForIndex(text: string, index: number): string {
  const before = text.slice(0, index);
  const boundaryPattern = /[,.;!?]|\b(?:but|instead|however)\b|\b(?:and|then|also)\s+(?:please\s+)?(?:open|launch|start|browse)\b/gi;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = boundaryPattern.exec(before))) {
    start = match.index + match[0].length;
  }
  return text.slice(start, index);
}

function packageTargetNegatedInText(text: string, packageName: string): boolean {
  const aliases = packageAliases(packageName);
  const negationPattern = /\b(?:do not|don['’]?t|never|please don['’]?t|avoid|without|except|not)\b/i;
  for (const alias of aliases) {
    const pattern = aliasPattern(alias);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (negationPattern.test(requestSegmentForIndex(text, match.index))) return true;
    }
  }
  return false;
}

function urlFromText(text: string): string | null {
  const match = text.match(/\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\byoutu\.be\/[^\s<>"']+|\byoutube\.com\/[^\s<>"']+/i);
  if (!match) return null;
  const raw = match[0].replace(/[),.;]+$/g, "");
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:^https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url);
}

function hasProhibitedDeviceActionRequest(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const deviceActionPattern = /\b(?:screenshot|screen shot|capture|snap|open|launch|start|browse|tap|click|press|swipe|scroll|type|read|show|inspect|look at|screen|display|phone|device|app|youtube|chrome|browser|back|home|recents|enter)\b/;
  return (
    /\b(?:do not|don['’]?t|can['’]?t|cannot|cant|never|please don['’]?t|won['’]?t|wont|unable to|avoid|without)\b/.test(normalized) &&
    deviceActionPattern.test(normalized)
  ) || (
    deviceActionPattern.test(normalized) &&
    /\b(?:not|never)\b/.test(normalized)
  );
}

function wantsScreenshotRequest(text: string): boolean {
  return /\b(?:screenshot|screen shot|screen capture)\b/i.test(text) ||
    /\b(?:capture|snap)\b[\s\S]{0,24}\b(?:screen|display)\b/i.test(text) ||
    /\btake\b[\s\S]{0,16}\b(?:screenshot|screen shot|screen capture)\b/i.test(text);
}

function targetsFlagSecureScreenshotApp(text: string): boolean {
  return inferPackageNamesFromText(text).some((packageName) => FLAG_SECURE_SCREENSHOT_PACKAGES.has(packageName));
}

function looksLikeScreenshotRestrictionFinalAnswer(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!/\b(?:screenshot|screen shot|screen capture|capture)\b/.test(normalized)) return false;
  const refusal = /\b(?:unable|not able|can['’]?t|cannot|cant|could not|couldn['’]?t|won['’]?t|wont|not allowed)\b/.test(normalized);
  const restriction = /\b(?:system restrictions?|restricted|restrictions?|secure|security|privacy|protected|blocked|not permitted)\b/.test(normalized);
  return refusal && restriction;
}

function shouldPreserveProtectedScreenshotRefusal(
  params: ProviderQueryParams,
  requestText: string,
  finalContent: string,
): boolean {
  if (!wantsScreenshotRequest(requestText)) return false;
  if (!targetsFlagSecureScreenshotApp(requestText)) return false;
  if (!looksLikeScreenshotRestrictionFinalAnswer(finalContent)) return false;
  const completedActions = daemonActionResults(params.messages).completed;
  const completedNavigation = completedActions.some((action) => action === "android_open_app" || action === "android_browse");
  return completedNavigation && completedActions.includes("android_read_screen");
}

function requestsJsonResponse(text: string): boolean {
  return /\b(?:return|respond|reply|output|provide|produce|format|write|give|create|make|generate)\b[\s\S]{0,80}\bjson\b/i.test(text) ||
    /\b(?:need|want|require|would\s+like)\s+(?:a\s+|an\s+|the\s+)?(?:valid\s+|raw\s+)?json\b/i.test(text) ||
    /\b(?:need|want|require|would\s+like)\b[\s\S]{0,80}\bjson\b[\s\S]{0,80}\b(?:object|format|response|reply|output|with|containing|including|include|field|key|property)\b/i.test(text) ||
    /\b(?:show|display|print)\s+(?:me\s+)?(?:the\s+)?json\b/i.test(text) ||
    /\bjson\b[\s\S]{0,48}\b(?:object|format|response|reply|output|with|containing|including|include|field|key|property)\b/i.test(text) ||
    /\b(?:as|valid)\s+json\b/i.test(text);
}

function toolMessageTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function daemonToolResultSucceeded(content: unknown): boolean {
  const text = toolMessageTextContent(content).trim();
  if (!text) return true;

  const parsed = extractJsonObject(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const result = parsed as Record<string, unknown>;
    if (result.ok === false || result.success === false) return false;
    if (typeof result.error === "string" && result.error.trim()) return false;
    if (
      typeof result.status === "string" &&
      /^(?:error|failed|failure|blocked|denied)$/i.test(result.status.trim())
    ) {
      return false;
    }
    return true;
  }

  return !/\b(?:error|failed|failure|blocked|denied|disconnected|not connected)\b/i.test(text);
}

function daemonActionResults(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): { completed: string[]; failed: string[] } {
  const pendingActions = new Map<string, string>();
  const completed: string[] = [];
  const failed: string[] = [];
  let currentTurnStart = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      currentTurnStart = index + 1;
      break;
    }
  }

  for (const message of messages.slice(currentTurnStart)) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.function?.name !== "daemon_action") continue;
        const args = toolArgumentsObject(toolCall.function.arguments);
        const action = typeof args?.action === "string" ? args.action : "";
        if (toolCall.id && action) pendingActions.set(toolCall.id, action);
      }
      continue;
    }
    if (message.role === "tool") {
      const action = pendingActions.get(message.tool_call_id);
      if (action) {
        if (daemonToolResultSucceeded(message.content)) {
          completed.push(action);
        } else {
          failed.push(action);
        }
      }
    }
  }
  return { completed, failed };
}

function normalizeDaemonActionArguments(args: Record<string, unknown>): Record<string, unknown> {
  const actionToken = aliasToken(args.action);
  if (!actionToken) return args;

  if (ANDROID_KEY_ACTION_ALIASES.has(actionToken)) {
    return { ...args, action: "android_press_key", key: String(args.key || actionToken) };
  }

  const action = ANDROID_DAEMON_ACTION_ALIASES[actionToken] || String(args.action || "").trim();
  const normalized = { ...args, action };
  if (action === "android_open_app") {
    const packageName = inferPackageNameForAction(actionToken, args);
    if (packageName) normalized.packageName = packageName;
  }
  return normalized;
}

function normalizeToolArgumentsForTool(toolName: string, value: unknown): string {
  if (toolName !== "daemon_action") return normalizeToolArguments(value);
  const args = toolArgumentsObject(value);
  if (!args) return normalizeToolArguments(value);
  return JSON.stringify(normalizeDaemonActionArguments(args));
}

function daemonActionArgsFromToolName(toolName: string, value: unknown): Record<string, unknown> | null {
  if (toolName === "daemon_action") return null;
  const token = aliasToken(toolName);
  if (!token) return null;

  const actionAlias = ANDROID_DAEMON_ACTION_ALIASES[token];
  const action = actionAlias || (DIRECT_ANDROID_DAEMON_ACTION_NAMES.has(token) ? token : "");
  if (!action) return null;

  const args = toolArgumentsObject(value) || {};
  return normalizeDaemonActionArguments({
    ...args,
    action: actionAlias ? token : action,
  });
}

function normalizeToolCallFunction(
  name: string,
  value: unknown,
): { name: string; arguments: string } {
  const daemonActionArgs = daemonActionArgsFromToolName(name, value);
  if (daemonActionArgs) {
    return {
      name: "daemon_action",
      arguments: JSON.stringify(daemonActionArgs),
    };
  }

  return {
    name,
    arguments: normalizeToolArgumentsForTool(name, value),
  };
}

function enrichDaemonToolCallsFromRequest(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[],
  requestText: string,
): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] {
  const safeToolCalls = toolCalls.filter((toolCall) => {
    if (toolCall.function.name !== "daemon_action") return true;
    const args = toolArgumentsObject(toolCall.function.arguments);
    if (!args || args.action !== "android_open_app") return true;
    const packageName = typeof args.packageName === "string"
      ? packageNameFromAlias(args.packageName)
      : inferAllowedPackageNameFromText(requestText);
    return !!packageName && !packageTargetNegatedInText(requestText, packageName);
  });
  const packageName = inferAllowedPackageNameFromText(requestText);
  if (!packageName) return safeToolCalls;

  return safeToolCalls.map((toolCall) => {
    if (toolCall.function.name !== "daemon_action") return toolCall;
    const args = toolArgumentsObject(toolCall.function.arguments);
    if (!args || args.action !== "android_open_app" || args.packageName) return toolCall;

    return {
      ...toolCall,
      function: {
        ...toolCall.function,
        arguments: JSON.stringify(normalizeDaemonActionArguments({ ...args, packageName })),
      },
    };
  });
}

function generatedToolCallId(index: number): string {
  return `phone_gemma_call_${Date.now().toString(36)}_${index}`;
}

function hasFunctionTool(tools: ProviderQueryParams["tools"], name: string): boolean {
  return !!tools?.some((tool) => tool.type === "function" && tool.function?.name === name);
}

function hasDaemonActionTool(tools: ProviderQueryParams["tools"]): boolean {
  return hasFunctionTool(tools, "daemon_action");
}

function recoverRequiredDaemonActionFromRequest(
  params: ProviderQueryParams,
  finalContent = "",
): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall | null {
  if (params.toolChoice !== "required" || !hasDaemonActionTool(params.tools)) return null;

  const requestText = latestUserText(params.messages).trim();
  if (!requestText) return null;
  if (hasProhibitedDeviceActionRequest(requestText)) return null;

  let args: Record<string, unknown> | null = null;
  const requestToken = aliasToken(requestText);
  const url = urlFromText(requestText);
  const packageName = inferPackageNameFromText(requestText);
  const wantsScreenshot = wantsScreenshotRequest(requestText);
  const daemonResults = daemonActionResults(params.messages);
  if (daemonResults.failed.length > 0) return null;
  const completedActions = daemonResults.completed;
  const completedNavigation = completedActions.some((action) => action === "android_open_app" || action === "android_browse");
  const completedReadScreen = completedActions.includes("android_read_screen");
  const preserveYouTubeTranscript = !!url &&
    isYouTubeUrl(url) &&
    hasFunctionTool(params.tools, "get_youtube_transcript") &&
    /\b(?:summari[sz]e|transcript|caption|captions|what\b[\s\S]{0,24}\b(?:say|said)|video)\b/i.test(requestText);

  if (preserveYouTubeTranscript) {
    return null;
  }

  if (shouldPreserveProtectedScreenshotRefusal(params, requestText, finalContent)) {
    return null;
  }

  if (wantsScreenshot && completedNavigation && !completedReadScreen) {
    args = { action: "android_read_screen" };
  } else if (wantsScreenshot && completedNavigation) {
    args = { action: "android_screenshot" };
  } else if (url) {
    args = { action: "android_browse", url };
  } else if (/\b(?:open|launch|start)\b/i.test(requestText) && packageName) {
    args = { action: "android_open_app", packageName };
  } else if (wantsScreenshot) {
    args = { action: "android_screenshot" };
  } else if (
    /\b(?:what(?:'s| is)|read|show|inspect|look at)\b[\s\S]{0,48}\b(?:screen|display|phone|device)\b/i.test(requestText) ||
    /\b(?:screen|phone|device)\b[\s\S]{0,32}\b(?:says|shows|visible)\b/i.test(requestText)
  ) {
    args = { action: "android_read_screen" };
  } else if (ANDROID_KEY_ACTION_ALIASES.has(requestToken)) {
    args = { action: "android_press_key", key: requestToken };
  } else if (/\b(?:press|tap)\b[\s\S]{0,16}\b(?:back|home|recents|enter)\b/i.test(requestText)) {
    const key = requestText.match(/\b(back|home|recents|enter)\b/i)?.[1]?.toLowerCase();
    if (key) args = { action: "android_press_key", key };
  }

  if (!args) return null;
  if (typeof args.action === "string" && completedActions.includes(args.action)) return null;

  return {
    id: generatedToolCallId(0),
    type: "function",
    function: {
      name: "daemon_action",
      arguments: JSON.stringify(normalizeDaemonActionArguments(args)),
    },
  };
}

function parseLocalGemmaStructuredOutput(
  raw: string,
  options: { preserveWholeJson?: boolean } = {},
): LocalGemmaStructuredOutput {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return { type: "final", content: raw.trim() };
  }

  const data = parsed as Record<string, unknown>;
  const type = typeof data.type === "string" ? data.type : "";
  if (type === "final") {
    return { type: "final", content: jsonEnvelopeText(data) ?? raw.trim() };
  }

  const rawToolCalls = Array.isArray(data.tool_calls)
    ? data.tool_calls
    : Array.isArray(data.toolCalls)
      ? data.toolCalls
      : [];
  if (type === "tool_calls" || rawToolCalls.length > 0) {
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = rawToolCalls
      .map((toolCall, index) => {
        if (!toolCall || typeof toolCall !== "object") return null;
        const item = toolCall as Record<string, unknown>;
        const functionData = item.function && typeof item.function === "object"
          ? item.function as Record<string, unknown>
          : item;
        const name = typeof functionData.name === "string" ? functionData.name.trim() : "";
        if (!name) return null;
        const normalizedFunction = normalizeToolCallFunction(name, functionData.arguments);
        return {
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : generatedToolCallId(index),
          type: "function" as const,
          function: normalizedFunction,
        };
      })
      .filter((toolCall): toolCall is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => !!toolCall);

    return { type: "tool_calls", toolCalls };
  }

  return { type: "final", content: localGemmaFinalText(raw, options) };
}

function localGemmaFinalText(raw: string, options: { preserveWholeJson?: boolean } = {}): string {
  const data = parseWholeJsonObject(raw);
  if (!data) {
    return raw.trim();
  }

  if (data.type === "tool_calls" || Array.isArray(data.tool_calls) || Array.isArray(data.toolCalls)) {
    return raw.trim();
  }

  if (options.preserveWholeJson) {
    return raw.trim();
  }

  return jsonEnvelopeText(data) ?? raw.trim();
}

function jsonEnvelopeText(data: Record<string, unknown>): string | null {
  for (const key of ["content", "response", "reply", "text", "message", "error"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function parameterNames(
  parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"],
): string[] {
  if (!parameters || typeof parameters !== "object") return [];
  const properties = (parameters as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.keys(properties).slice(0, MAX_TOOL_ARGUMENT_NAMES);
}

function requiredParameterNames(parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"]): string[] {
  if (!parameters || typeof parameters !== "object") return [];
  const required = (parameters as { required?: unknown }).required;
  return Array.isArray(required)
    ? required.filter((item): item is string => typeof item === "string").slice(0, MAX_TOOL_ARGUMENT_NAMES)
    : [];
}

function enumValuesForParameter(
  parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"],
  name: string,
): string[] {
  if (!parameters || typeof parameters !== "object") return [];
  const properties = (parameters as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  const property = (properties as Record<string, unknown>)[name];
  if (!property || typeof property !== "object" || Array.isArray(property)) return [];
  const enumValues = (property as { enum?: unknown }).enum;
  if (!Array.isArray(enumValues)) return [];
  return enumValues
    .filter((value): value is string | number | boolean => (
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ))
    .map((value) => String(value));
}

function requiredEnumSummaries(parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"]): string[] {
  return requiredParameterNames(parameters)
    .flatMap((name) => {
      const values = enumValuesForParameter(parameters, name);
      return values.length ? [`${name} enum: ${values.join(", ")}`] : [];
    });
}

function argumentTextForTool(tool: OpenAI.Chat.Completions.ChatCompletionTool): string {
  const required = requiredParameterNames(tool.function.parameters);
  const enumSummaries = requiredEnumSummaries(tool.function.parameters);
  if (tool.function.name === "daemon_action") {
    return [
      " Args: action",
      "aliases: screenshot=android_screenshot, YouTube=android_open_app+packageName",
      `Android args include: ${DAEMON_TOOL_ARGUMENT_HINTS.join(", ")}`,
      required.length ? `required: ${required.join(", ")}` : "",
      enumSummaries.join("; "),
    ].filter(Boolean).join("; ") + ".";
  }

  const args = parameterNames(tool.function.parameters);
  return args.length
    ? ` Args: ${args.join(", ")}${required.length ? `; required: ${required.join(", ")}` : ""}${enumSummaries.length ? `; ${enumSummaries.join("; ")}` : ""}.`
    : " Args: none or tool-defined JSON.";
}

function toolRelevanceScore(tool: OpenAI.Chat.Completions.ChatCompletionTool, requestText: string): number {
  if (tool.type !== "function") return 0;
  const normalizedRequest = requestText.toLowerCase();
  const searchable = `${tool.function.name} ${tool.function.description || ""}`.toLowerCase();
  let score = 0;
  for (const token of normalizedRequest.match(/[a-z0-9_]{3,}/g) || []) {
    if (searchable.includes(token)) score += 1;
  }
  if (/android|phone|device|screen|screenshot|tap|open|app|permission|bluetooth|wifi|location/.test(normalizedRequest)) {
    if (/android|daemon|device|phone|screen|app|control|automation/.test(searchable)) score += 5;
  }
  return score;
}

function toolSpecsForPrompt(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  requestText: string,
  budgetLimit: number = phoneGemmaToolListCharBudget(),
): string {
  const toolList = (tools || [])
    .filter((tool) => tool.type === "function")
    .sort((a, b) => toolRelevanceScore(b, requestText) - toolRelevanceScore(a, requestText));

  const budget = Math.max(160, Math.min(phoneGemmaToolListCharBudget(), budgetLimit));
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const tool of toolList) {
    const argumentText = argumentTextForTool(tool);
    const description = truncateText(tool.function.description, MAX_TOOL_DESCRIPTION_CHARS);
    const line = `- ${tool.function.name}: ${description || "Local Jarvis tool."}${argumentText}`;
    const separatorChars = lines.length > 0 ? 1 : 0;
    if (used + separatorChars + line.length > budget) {
      if (lines.length === 0) {
        lines.push(truncateText(line, budget));
        used = lines[0].length;
        continue;
      }
      omitted += 1;
      continue;
    }
    lines.push(line);
    used += separatorChars + line.length;
  }

  if (omitted > 0) {
    lines.push(`- ${omitted} lower-relevance tool${omitted === 1 ? "" : "s"} omitted to keep the phone-local prompt small.`);
  }

  return lines.join("\n");
}

function toolPromptFromParams(params: ProviderQueryParams): string {
  const requestText = latestUserText(params.messages);
  const promptBudget = phoneGemmaPromptCharBudget();
  const baseIntro = [
    "You are Jarvis running entirely through Android Local Gemma on the user's phone.",
    "Return ONLY one JSON object, with no markdown or extra text.",
    "Jarvis executes requested local tools and sends tool results back; tool results are authoritative.",
    "Tool use shape:",
    `{"type":"tool_calls","tool_calls":[{"name":"tool_name","arguments":{"key":"value"}}]}`,
    "Final answer shape:",
    `{"type":"final","content":"your reply to the user"}`,
    params.toolChoice === "required"
      ? "A tool call is required for this turn. Do not return a final answer."
      : "Use tools only when they are necessary to satisfy the user's request.",
  ].join("\n");
  const toolListBudget = promptBudget - baseIntro.length - MIN_REQUIRED_PROMPT_SECTION_CHARS - 48;
  const toolSpecs = toolSpecsForPrompt(params.tools, requestText, toolListBudget);
  const intro = [
    baseIntro,
    "Available tools:",
    toolSpecs || "- No callable local tools were provided.",
  ].join("\n");

  const conversationBudget = Math.max(MIN_REQUIRED_PROMPT_SECTION_CHARS, promptBudget - intro.length - 32);

  return [
    intro,
    "",
    "Conversation:",
    formatPromptSections(params.messages, conversationBudget, true),
  ].join("\n");
}

function chatPromptFromParams(params: ProviderQueryParams): string {
  const intro = [
    "You are Jarvis running entirely through Android Local Gemma on the user's phone.",
    "Answer directly and keep the response useful. Do not claim that a cloud model handled this turn.",
    params.tools?.length && params.toolChoice !== "none"
      ? "Local Jarvis tools are available for explicit device-control requests, but this turn should be answered normally unless a tool is actually needed."
      : "",
    `Local model: ${normalizeAndroidLocalGemmaModel(params.model)}.`,
  ].filter(Boolean).join("\n");
  const promptBudget = phoneGemmaPromptCharBudget();
  const conversationBudget = Math.max(MIN_REQUIRED_PROMPT_SECTION_CHARS, promptBudget - intro.length - 16);
  return [
    intro,
    "",
    formatPromptSections(params.messages, conversationBudget, false),
  ].join("\n");
}

function textFromDaemonData(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  for (const key of ["text", "content", "reply", "output"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function finishReasonFromDaemonData(data: unknown): string | null {
  if (!data || typeof data !== "object") return "stop";
  const reason = (data as Record<string, unknown>).finishReason;
  return reason === "length" || reason === "tool_calls" || reason === "stop" ? reason : "stop";
}

function normalizeAndroidLocalGemmaError(error: string | undefined): string {
  if (error?.includes("LOCAL_MODEL_ENGINE_NOT_BUNDLED")) {
    return "Phone Gemma is selected, but this APK cannot run LiteRT-LM generation yet. Install a LiteRT-LM-enabled APK before using Android Local Gemma.";
  }
  if (error?.includes("LOCAL_MODEL_VALIDATION_REQUIRED")) {
    return `Phone Gemma's model file is imported, but Jarvis has not validated the LiteRT-LM engine for this exact file on your phone yet. Open Settings -> AI Models -> Phone Gemma and tap Validate engine before chatting locally. Details: ${error}`;
  }
  if (error?.includes("LOCAL_MODEL_VALIDATION_FAILED")) {
    return `Phone Gemma could not validate the LiteRT-LM engine for the imported .litertlm model on this device. Reimport the official Android Gemma 4 E4B .litertlm file, then validate again. Details: ${error}`;
  }
  if (
    error?.includes("LOCAL_MODEL_GENERATION_FAILED") &&
    (error.includes("Failed to invoke the compiled model") || error.includes("llm_litert_compiled_model_executor.cc:755"))
  ) {
    return `Phone Gemma could not finish local inference on this device, usually because the phone-local Gemma runtime hit memory or accelerator pressure. Jarvis stayed on the local phone model and did not use any other model. Close heavy apps, let the phone cool down, then retry with the official E4B .litertlm model imported. Details: ${error}`;
  }
  if (
    error?.includes("LOCAL_MODEL_GENERATION_FAILED") &&
    (error.includes("Failed to create LiteRT-LM engine") || error.includes("llm_litert_compiled_model_executor"))
  ) {
    const cpuFallbackAttempted = /\bcpu:/i.test(error);
    const cpuFallbackDisabled = /cpu fallback skipped:\s*disabled/i.test(error);
    const recoveryPath = cpuFallbackAttempted
      ? "Jarvis tried the device accelerator and CPU fallback"
      : cpuFallbackDisabled
        ? "Jarvis tried the device accelerator; CPU fallback is disabled by default to avoid Android low-memory kills"
        : "Jarvis tried the device accelerator; CPU fallback was skipped unless the phone has enough memory headroom";
    return `Phone Gemma could not start the LiteRT-LM engine for the imported .litertlm model. ${recoveryPath}; reimport ${ANDROID_LOCAL_GEMMA_MODEL.replace("android-local-gemma/", "")} as the official .litertlm file if this keeps happening. Details: ${error}`;
  }
  if (error?.includes("LOCAL_MODEL_DEVICE_MEMORY_LOW")) {
    return `Phone Gemma did not start because Android reported low available memory. Close other heavy apps, then try again. Details: ${error}`;
  }
  if (error?.includes("LOCAL_MODEL_BUSY")) {
    return "Phone Gemma is still working on the previous message. Wait for it to finish or tap Stop before sending another local-model message.";
  }
  if (error?.includes("LOCAL_MODEL_CANCELLED")) {
    return "Phone Gemma generation was cancelled before it finished.";
  }
  if (/daemon timeout/i.test(error || "")) {
    return "Phone Gemma timed out before returning a response. Jarvis asked the Android app to cancel that local generation so it does not keep slowing the phone down.";
  }
  return error || "Android Local Gemma generation failed.";
}

async function sendAndroidLocalGemmaOp(
  userId: string,
  op: Parameters<AndroidLocalGemmaDaemonOp>[1],
  timeoutMs: number,
): Promise<DaemonOpResult> {
  if (daemonOpForTesting) return daemonOpForTesting(userId, op, timeoutMs);
  const { sendDaemonOp } = await import("../../daemon/bridge");
  return sendDaemonOp(userId, op, timeoutMs);
}

export class AndroidLocalGemmaProvider extends BaseProvider {
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    if (!params.userId) {
      throw new Error("Android Local Gemma requires an authenticated user and the Jarvis Android app device control connection.");
    }

    const useToolProtocol = shouldUseLocalToolProtocol(params);
    const prompt = (useToolProtocol ? toolPromptFromParams(params) : chatPromptFromParams(params)).trim();
    if (!prompt) {
      throw new Error("Android Local Gemma received an empty prompt.");
    }

    const requestId = `phone-gemma-${randomUUID()}`;
    const result = await sendAndroidLocalGemmaOp(
      params.userId,
      {
        type: "android_local_model_generate",
        requestId,
        model: normalizeAndroidLocalGemmaModel(params.model),
        prompt,
        contextTokens: phoneGemmaContextTokens(),
        maxTokens: phoneGemmaMaxCompletionTokens(params.maxCompletionTokens),
        allowCpuFallback: phoneGemmaAllowCpuFallback(),
      },
      phoneGemmaTimeoutMs(),
    );

    if (shouldCancelTimedOutGeneration(result)) {
      sendAndroidLocalGemmaOp(
        params.userId,
        { type: "android_local_model_cancel", requestId },
        5_000,
      ).catch(() => {});
    }

    if (!result.ok) {
      throw new Error(normalizeAndroidLocalGemmaError(result.error));
    }

    const text = textFromDaemonData(result.data);
    if (!text.trim()) {
      throw new Error("Phone Gemma finished without response text. The phone-local model may have been interrupted or run out of memory; retry after closing other apps.");
    }

    const requestText = latestUserText(params.messages);
    const preserveRequestedJson = requestsJsonResponse(requestText) || isJsonObjectResponseFormat(params.responseFormat);
    if (useToolProtocol) {
      const parsed = parseLocalGemmaStructuredOutput(text, { preserveWholeJson: preserveRequestedJson });
      if (parsed.type === "tool_calls") {
        const toolCalls = enrichDaemonToolCallsFromRequest(parsed.toolCalls, requestText);
        if (toolCalls.length === 0) {
          const recoveredToolCall = recoverRequiredDaemonActionFromRequest(params);
          if (recoveredToolCall) {
            yield {
              type: "tool_call_start",
              index: 0,
              id: recoveredToolCall.id,
              name: recoveredToolCall.function.name,
            };
            yield {
              type: "tool_call_args",
              index: 0,
              args: recoveredToolCall.function.arguments,
            };
            yield { type: "finish", reason: "tool_calls" };
            return;
          }
          if (hasProhibitedDeviceActionRequest(requestText)) {
            yield { type: "text", delta: "No device action was run." };
            yield { type: "finish", reason: "stop" };
            return;
          }
          if (/\b(?:open|launch|start)\b/i.test(requestText) && inferPackageNamesFromText(requestText).length > 1) {
            yield { type: "text", delta: "I need one app target at a time for local app opening." };
            yield { type: "finish", reason: "stop" };
            return;
          }
          if (!looksLikeLocalToolRequest(requestText) && !looksLikeUrlToolRequest(requestText)) {
            yield { type: "text", delta: "Phone Gemma did not return a usable local answer for that request." };
            yield { type: "finish", reason: "stop" };
            return;
          }
          throw new Error("Phone Gemma returned a tool-call response without a valid local tool call.");
        }
        for (const [index, toolCall] of toolCalls.entries()) {
          yield {
            type: "tool_call_start",
            index,
            id: toolCall.id,
            name: toolCall.function.name,
          };
          yield {
            type: "tool_call_args",
            index,
            args: toolCall.function.arguments,
          };
        }
        yield { type: "finish", reason: "tool_calls" };
        return;
      }

      if (params.toolChoice === "required") {
        const recoveredToolCall = recoverRequiredDaemonActionFromRequest(params, parsed.content);
        if (recoveredToolCall) {
          yield {
            type: "tool_call_start",
            index: 0,
            id: recoveredToolCall.id,
            name: recoveredToolCall.function.name,
          };
          yield {
            type: "tool_call_args",
            index: 0,
            args: recoveredToolCall.function.arguments,
          };
          yield { type: "finish", reason: "tool_calls" };
          return;
        }
        if (shouldPreserveProtectedScreenshotRefusal(params, requestText, parsed.content)) {
          yield { type: "text", delta: parsed.content };
          yield { type: "finish", reason: "stop" };
          return;
        }
        throw new Error("Phone Gemma returned a final answer when the local harness required a tool call. No cloud model was used.");
      }

      if (parsed.content.trim()) {
        yield { type: "text", delta: parsed.content };
        yield { type: "finish", reason: finishReasonFromDaemonData(result.data) };
        return;
      }
    }

    yield {
      type: "text",
      delta: localGemmaFinalText(text, { preserveWholeJson: preserveRequestedJson }),
    };
    yield { type: "finish", reason: finishReasonFromDaemonData(result.data) };
  }
}
