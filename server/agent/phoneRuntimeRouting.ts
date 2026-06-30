import type OpenAI from "openai";
import { ANDROID_PHONE_RUNTIME_TOOL_NAMES } from "./androidPhoneRuntimeToolNames";
import { summarizeAndroidNotificationDetail } from "./androidNotificationSummary";

const ANDROID_PHONE_RUNTIME_TOOL_NAME_SET = new Set<string>(ANDROID_PHONE_RUNTIME_TOOL_NAMES);
const SERVER_YOUTUBE_TOOL_NAMES = new Set([
  "search_youtube",
  "fetch_youtube_transcript",
  "youtube_search",
  "get_youtube_transcript",
]);

export function isAndroidPhoneRuntimeToolName(name: string): boolean {
  return ANDROID_PHONE_RUNTIME_TOOL_NAME_SET.has(name);
}

export function phoneRuntimeChatToolName(tool: OpenAI.Chat.Completions.ChatCompletionTool): string | null {
  return tool.type === "function" ? tool.function.name : null;
}

export function filterPhoneRuntimeModelTools(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  options: { allowDaemonActionFallback?: boolean; allowServerYoutubeTools?: boolean } = {},
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.filter((tool) => {
    const name = phoneRuntimeChatToolName(tool);
    if (!name) return false;
    if (isAndroidPhoneRuntimeToolName(name)) return true;
    if (name === "daemon_action") return options.allowDaemonActionFallback === true;
    if (SERVER_YOUTUBE_TOOL_NAMES.has(name)) return options.allowServerYoutubeTools === true;
    return false;
  });
}

function normalizePhoneRuntimeRequestText(text: string): string {
  return text
    .replace(/android\s*[_-]?\s*read\s*[_-]?\s*notifications?/gi, "read notifications")
    .replace(/android\s*[_-]?\s*notifications?\s*[_-]?\s*list/gi, "read notifications")
    .replace(/[_]+/g, " ");
}

export function isYoutubePhoneRequest(text: string): boolean {
  return /\b(you\s*tube|youtube|yt)\b/i.test(text);
}

export function isYoutubePhoneActionRequest(text: string): boolean {
  return /\b(?:open|launch|start)\s+(?:the\s+)?(?:you\s*tube|youtube|yt)\b/i.test(text) ||
    /\b(?:search|find|look\s+up|look\s+for)\s+(?:on\s+)?(?:you\s*tube|youtube|yt)\b/i.test(text) ||
    /\b(?:you\s*tube|youtube|yt)\s+(?:search|find|look\s+up|look\s+for)\b/i.test(text) ||
    /\b(?:search|find|look\s+up|look\s+for)\s+(?:for\s+)?[\s\S]{1,120}?\s+(?:on|in)\s+(?:you\s*tube|youtube|yt)\b/i.test(text) ||
    /\b(?:find|show|get)\s+(?:me\s+)?(?:a\s+few\s+|some\s+)?(?:you\s*tube|youtube|yt)\s*videos?\s+(?:about|on|for)\b/i.test(text) ||
    /\b(?:show|get)\s+(?:me\s+)?(?:a\s+few\s+|some\s+)?videos?\s+(?:about|on|for)\s+[\s\S]{1,120}?\s+(?:on|in)\s+(?:you\s*tube|youtube|yt)\b/i.test(text) ||
    /\b(?:watch|play)\b[\s\S]{0,120}\b(?:on\s+)?(?:you\s*tube|youtube|yt)\b/i.test(text);
}

export function isYoutubeServerResearchRequest(text: string): boolean {
  return isYoutubePhoneRequest(text) &&
    /\b(?:summari[sz]e|summary|research|transcript|captions?|analy[sz]e|report|compare|rank|recommend|recommendation|best videos?|top videos?|best result|pick (?:a|the) video|choose (?:a|the) video)\b/i.test(text);
}

export function isMemoryPhoneBypassRequest(text: string): boolean {
  return /\b(?:memory|memories|remember|recall|what do you know about me|what have i told you|about me|living context)\b/i.test(text);
}

function isPhoneOpenActionRequest(text: string): boolean {
  if (!/\b(?:open|launch|start)\b/i.test(text)) return false;
  if (/\b(?:project|build|create|make|generate|scaffold|code|website|web\s+app)\b/i.test(text)) return false;
  if (/\b(?:youtube|you\s*tube|yt|facebook|fb|linkedin|linked\s+in|instagram|ig|insta|spotify|chrome|browser|camera|settings|messages|texts|gmail|google\s+mail|maps|messenger|whatsapp|snapchat|tiktok|tik\s+tok|x|twitter|reddit|discord|telegram|slack|zoom|teams|calculator|calendar|clock|contacts|notes)\b/i.test(text)) return true;
  return /\b(?:app|application|phone|device)\b/i.test(text);
}

function hasPhoneRuntimeContext(text: string): boolean {
  return /\b(?:android|phone|screen|display|device|app|application|button|keyboard|field|input|notification|notifications)\b/i.test(text) ||
    isYoutubePhoneRequest(text) ||
    isPhoneOpenActionRequest(text);
}

export function isPhoneRuntimeCoveredRequest(text: string): boolean {
  const normalized = normalizePhoneRuntimeRequestText(text);
  if (isYoutubePhoneRequest(normalized)) return isYoutubePhoneActionRequest(normalized) && !isYoutubeServerResearchRequest(normalized);
  return isPhoneOpenActionRequest(normalized) ||
    /\b(?:browse to|navigate to|open (?:a )?(?:url|link|website|site))\b/i.test(normalized) ||
    /\b(?:screenshot|screen shot|screen capture)\b/i.test(normalized) ||
    /\b(?:read|inspect|look at|what(?:'s| is))\b.{0,48}\b(?:screen|display|phone)\b/i.test(normalized) ||
    isPhoneNotificationReadRequest(normalized) ||
    (hasPhoneRuntimeContext(normalized) && /\b(?:tap|swipe|scroll|type|press|back|home|recents|enter)\b/i.test(normalized));
}

export function isPhoneNotificationReadRequest(text: string): boolean {
  const normalized = normalizePhoneRuntimeRequestText(text);
  if (!/\bnotifications?\b/i.test(normalized)) return false;
  if (/\b(?:settings?|enabled|disabled|turn(?:ed)?\s+on|turn(?:ed)?\s+off|permission|permissions|access|allowed|blocked|muted|silenced|configure|configured|configuration)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(?:don't|do not|dont|never|stop)\b[\s\S]{0,48}\b(?:read|show|list|check|view|see)\b[\s\S]{0,48}\bnotifications?\b/i.test(normalized)) {
    return false;
  }
  if (
    /\bnotifications?\b[\s\S]{0,64}\b(?:work|works|mean|means|definition|concept|settings?|enabled|disabled|on|off|noisy|muted|silenced|allowed|blocked)\b/i.test(normalized) ||
    /\b(?:explain|describe|define|summari[sz]e)\b[\s\S]{0,64}\b(?:how\s+)?(?:android\s+)?notifications?\b[\s\S]{0,64}\b(?:work|works|mean|means|definition|concept)\b/i.test(normalized) ||
    /\b(?:ways?|tips?|advice|recommendations?|steps?|guide|guidance|best\s+way)\b[\s\S]{0,64}\bnotifications?\b/i.test(normalized) ||
    /\bnotifications?\b[\s\S]{0,64}\b(?:ways?|tips?|advice|recommendations?|steps?|guide|guidance|best\s+way|reduce|manage|control|quiet|limit|avoid|get\s+fewer|make\s+fewer)\b/i.test(normalized)
  ) {
    return false;
  }
  return (
    /\b(?:read|show|list|check|view|see|summari[sz]e)\b[\s\S]{0,64}\bnotifications?\b/i.test(normalized) ||
    /\bwhat(?:'s| is| are)?\b[\s\S]{0,64}\b(?:my|current|new|unread|recent|pending)\s+notifications?\b/i.test(normalized) ||
    /\b(?:do i have|are there|any)\b[\s\S]{0,24}\b(?:any\s+|new\s+|unread\s+|recent\s+)?notifications?\b/i.test(normalized) ||
    /\bnotifications?\b[\s\S]{0,64}\b(?:do i have|are there|show|list|read|check|view|see)\b/i.test(normalized)
  );
}

export function deterministicPhoneRuntimeToolCallFromRequest(
  requestText: string,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall | null {
  if (!isPhoneNotificationReadRequest(requestText)) return null;
  const hasNotificationTool = tools.some((tool) => phoneRuntimeChatToolName(tool) === "android_read_notifications");
  if (!hasNotificationTool) return null;
  return {
    id: `jarvis_phone_runtime_${Date.now().toString(36)}_0`,
    type: "function",
    function: {
      name: "android_read_notifications",
      arguments: "{}",
    },
  };
}

export function deterministicAndroidToolSummary(
  toolName: string,
  execResult: { result: "success" | "error" | "pending"; label: string; detail: string },
): string | null {
  if (toolName !== "android_read_notifications") return null;
  if (execResult.result === "error") {
    return summarizeAndroidNotificationDetail({ error: execResult.detail || execResult.label });
  }
  try {
    return summarizeAndroidNotificationDetail(JSON.parse(execResult.detail || "{}"));
  } catch {
    return summarizeAndroidNotificationDetail({ screenContext: execResult.detail });
  }
}

export function buildPhoneRuntimeRequiredToolNames(
  lastUserContent: string,
  isDeviceControlRequest: boolean,
  phoneRuntimeCoveredRequest: boolean,
): string[] {
  const youtubePhoneActionRequest = isYoutubePhoneRequest(lastUserContent) && isYoutubePhoneActionRequest(lastUserContent);
  const youtubeResearchRequest = isYoutubeServerResearchRequest(lastUserContent);
  if (!isDeviceControlRequest && !phoneRuntimeCoveredRequest && !youtubePhoneActionRequest && !youtubeResearchRequest) return [];
  const requiredToolNames = new Set<string>();

  if (phoneRuntimeCoveredRequest) {
    ANDROID_PHONE_RUNTIME_TOOL_NAMES.forEach((name) => requiredToolNames.add(name));
  }

  if (youtubePhoneActionRequest || youtubeResearchRequest) {
    if (!youtubeResearchRequest) {
      requiredToolNames.add("android_youtube_search");
      requiredToolNames.add("android_open_phone_url");
    } else {
      requiredToolNames.add("search_youtube");
      requiredToolNames.add("fetch_youtube_transcript");
    }
  }

  return [...requiredToolNames];
}
