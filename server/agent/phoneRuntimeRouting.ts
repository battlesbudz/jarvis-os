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
const PHONE_DEVICE_CONTROL_KEYWORDS = [
  "screenshot", "screen shot", "screen capture",
  "open youtube", "open instagram", "open spotify", "open chrome", "open camera",
  "open settings", "open messages", "open gmail", "open maps", "open the app",
  "take a photo", "tap on", "tap the", "swipe", "read the screen",
  "what's on the screen", "what is on the screen", "what does the screen", "browse to",
  "android_", "navigate to", "type into", "open app",
  "notification", "notifications", "my notifications", "read my notification",
  "check notification", "show notification", "what notification", "any notification",
  "new notification", "recent notification", "latest notification",
  "sms", "send text", "text message", "send a text", "send message",
  "location", "where am i", "take photo", "snap a photo",
  "record screen", "screen record", "record video", "camera clip",
  "read my phone", "check my phone", "what is on my phone", "what's on my phone",
  "phone screen", "my screen", "my phone",
  "transcript", "summarize the video", "summarize that video", "what is the video about",
  "what's the video about", "give me a summary", "summarize what", "tell me what the video",
  "search youtube", "find a youtube", "look up on youtube",
];
const PHONE_COMPOUND_CONNECTOR_PATTERN = String.raw`(?:and\s+then|then|after(?:wards|\s+that)?|also|and)`;
const PHONE_FOLLOW_UP_ACTION_PATTERN = String.raw`(?:open|launch|start|check|get|fetch|read|show|list|view|take|make|create|write|draft|schedule|add|update|delete|remove|archive|summari[sz]e|wait|notify|alert|let\s+me\s+know|play|watch|tap|click|press|swipe|scroll|type|enter|select|share|send|close|pause|subscribe|like|save|download|call|text|message|search|find|look\s+up|look\s+for|navigate\s+to|browse\s+to|back|home|recents|screenshot|screen\s+shot|screen\s+capture|capture|read\s+screen|inspect\s+screen|look\s+at(?:\s+my)?\s+screen|return\s+to|go\s+(?:back|home)|go\s+to|turn\s+(?:on|off)|enable|disable|change|adjust|set|turn\s+(?:the\s+)?volume|raise\s+(?:the\s+)?volume|lower\s+(?:the\s+)?volume|volume\s+(?:up|down))`;
const PHONE_PUNCTUATED_FOLLOW_UP_PATTERN = String.raw`[,;:.!?]\s*(?:(?:now|next|then)[\s,:-]+)?(?:please\s+)?${PHONE_FOLLOW_UP_ACTION_PATTERN}\b`;
const REQUEST_ACTION_CLAUSE_PATTERN = /^\s*(?:(?:please|then|next|now)[\s,:-]+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:check(?:ing)?|get|fetch|read|show|list|research|investigate|analy[sz]e|explain|compare|review|evaluate|calculate|translate|proofread|open|launch|start|take|make|create|send|email|reply|forward|invite|book|buy|order|pay|upload|download|share|post|publish|remind|write|draft|schedule|reschedule|cancel|add|update|change|set|delete|remove|archive|find|search|look\s+up|tell|summari[sz]e|call|text|message|navigate|browse|tap|press|swipe|scroll|type|enter|enable|disable|turn)\b/i;
const REQUEST_QUESTION_CLAUSE_PATTERN = /^\s*(?:what(?:['’]s|\s+is|\s+are)?|who(?:['’]s|\s+is|\s+are)?|where(?:['’]s|\s+is|\s+are)?|when|how|why|which)\b/i;

function hasPunctuatedPhoneFollowUpAction(text: string): boolean {
  return new RegExp(PHONE_PUNCTUATED_FOLLOW_UP_PATTERN, "i").test(text);
}

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

const ANDROID_PACKAGE_NAME_PATTERN = /\b[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\b/;
const PHONE_OPEN_COMMAND_PATTERN = /^\s*(?:(?:hey|hi|okay|ok|alright|now)[\s,;:!.-]+)?(?:jarvis[\s,:-]+)?(?:(?:please|don['’]?t\s+forget\s+to|do\s+not\s+hesitate\s+to)\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need)(?:\s+you)?\s+to\s+|i(?:\s+would|['’]d)\s+like\s+to\s+)?(?:open|launch|start)\b/i;
const PHONE_OPEN_FOLLOW_UP_PATTERN = /\b(?:open|launch|start)(?:\s+up)?\s+(?:it|that|the\s+app)(?:\s+directly)?(?:\s+(?:right\s+)?now)?\b/i;
const NEGATED_PHONE_OPEN_PATTERN = /\b(?:do\s+not|don['’]?t|dont|never|stop)\b[^;.!?\n]{0,48}\b(?:open|launch|start)\b/i;
const RETRACTED_PHONE_OPEN_PATTERN = /\b(?:open|launch|start)\b[\s\S]{0,80}\b(?:(?:actually\s+)?(?:do\s+not|don['’]?t|dont)(?:\s+(?:do\s+it|open|launch|start))?|never\s*mind|cancel(?:\s+(?:that|it))?|scratch\s+that|forget\s+it|stop)\s*[.!?]*$/i;
const DEFERRED_PHONE_OPEN_PATTERN = /\b(?:not\s+(?:now|yet)|tomorrow|tonight|later|this\s+(?:morning|afternoon|evening|night|weekend|week|month|year)|next\s+(?:morning|afternoon|evening|night|day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{1,2}-\d{1,2})|at\s+(?:(?:[01]?\d|2[0-3])(?::[0-5]\d)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:a\.?m\.?|p\.?m\.?))?|at\s+(?:noon|midnight)|in\s+(?:(?:(?:a|one)\s+)?(?:little\s+)?(?:while|bit|moment)|(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|couple(?:\s+of)?)\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?))|(?:after|when|whenever|as\s+soon\s+as|as\s+long\s+as|provided\s+that|if|unless)\s+\S+|once\s+(?!(?:again|more)\b)\S+)\b/i;
const ORDERED_PHONE_ACTION_PATTERN = /\b(?:after|before)\s+(?:(?:you|i|we)\s+)?(?:open(?:ing)?|launch(?:ing)?|start(?:ing)?|read(?:ing)?|check(?:ing)?|view(?:ing)?|captur(?:e|ing)|tak(?:e|ing)|tap(?:ping)?|click(?:ing)?|press(?:ing)?|swip(?:e|ing)|scroll(?:ing)?|typ(?:e|ing)|enter(?:ing)?|select(?:ing)?|play(?:ing)?|watch(?:ing)?|clos(?:e|ing)|return(?:ing)?|go(?:ing)?)\b/i;
const PHONE_WEB_TARGET_QUALIFIER_PATTERN = /\b(?:website|web\s*site|site|webpage|web\s+page)\b/i;
const PHONE_CLAUSE_CONTINUATION_PATTERN = String.raw`(?:(?:(?:actually|instead|wait|no|sorry)[\s,!:-]+)*(?:(?:now|next|then)[\s,:-]+)?(?:please\s+)?${PHONE_FOLLOW_UP_ACTION_PATTERN}\b|(?:wait|no|never\s*mind|cancel(?:\s+(?:that|it))?|scratch\s+that|forget\s+it|stop|(?:do\s+not|don['’]?t|dont))\b)`;
const PHONE_OPEN_CLAUSE_SEPARATOR_PATTERN = new RegExp(
  String.raw`(?:;+|\r?\n+)|(?:[.!?]+|,|:|[&—–]|-(?=\s))(?=\s*${PHONE_CLAUSE_CONTINUATION_PATTERN})`,
  "i",
);

function isNegatedPhoneOpenRequest(text: string): boolean {
  const withoutAffirmativeIdioms = text.replace(
    /\b(?:don['’]?t\s+forget|do\s+not\s+hesitate)\s+to\s+(?=(?:open|launch|start)\b)/gi,
    "",
  );
  return NEGATED_PHONE_OPEN_PATTERN.test(withoutAffirmativeIdioms) ||
    RETRACTED_PHONE_OPEN_PATTERN.test(withoutAffirmativeIdioms);
}

function stripImmediatePhoneOpenQualifier(text: string): string {
  return text.replace(/\s+(?:if(?:\s+at\s+all)?|as\s+soon\s+as)\s+possible(?=\s*[.!?]*$)/i, "");
}

function isDeferredPhoneOpenRequest(text: string): boolean {
  if (ORDERED_PHONE_ACTION_PATTERN.test(text)) return false;
  const immediateText = stripImmediatePhoneOpenQualifier(text);
  const command = immediateText.match(PHONE_OPEN_COMMAND_PATTERN)?.[0];
  const targetAndQualifiers = command ? immediateText.slice(command.length) : immediateText;
  const appSuffixes = [...targetAndQualifiers.matchAll(/\bapp(?:lication)?\b/gi)];
  const appSuffix = appSuffixes[appSuffixes.length - 1];
  if (appSuffix) {
    const qualifierText = targetAndQualifiers.slice((appSuffix.index ?? 0) + appSuffix[0].length);
    return DEFERRED_PHONE_OPEN_PATTERN.test(qualifierText);
  }
  return new RegExp(String.raw`^.+?\s+${DEFERRED_PHONE_OPEN_PATTERN.source}`, "i").test(targetAndQualifiers);
}

function phoneOpenClauses(text: string): string[] {
  return text.split(PHONE_OPEN_CLAUSE_SEPARATOR_PATTERN).map((clause) => clause.trim()).filter(Boolean);
}

function hasAffirmativeWebTargetQualifier(text: string): boolean {
  const qualifier = text.match(PHONE_WEB_TARGET_QUALIFIER_PATTERN);
  if (!qualifier) return false;
  const prefix = text.slice(0, qualifier.index ?? 0);
  return !/\b(?:not|except|avoid|without|instead\s+of)\b[^,;.!?]*$/i.test(prefix);
}

function extractAndroidPackageTarget(text: string): string | null {
  const packageNames = [...text.matchAll(new RegExp(ANDROID_PACKAGE_NAME_PATTERN.source, "g"))]
    .filter((packageMatch) => {
      const packageName = packageMatch[0];
      const index = packageMatch.index ?? 0;
      const prefix = text.slice(Math.max(0, index - 64), index);
      const suffix = text.slice(index + packageName.length, index + packageName.length + 48);
      const isQualified = /\b(?:android\s+app\s+)?package(?:\s+name)?(?:\s+is|\s*[:=])?\s*$/i.test(prefix) ||
        /\bandroid\s+app(?:\s+package(?:\s+name)?)?(?:\s+is|\s*[:=])?\s*$/i.test(prefix) ||
        /^\s*(?:android\s+app|package(?:\s+name)?)\b/i.test(suffix);
      if (!isQualified) return false;
      if (/\b(?:do\s+not|don['’]?t|dont|never|not|except|avoid|without)\b[^,.;!?]*$/i.test(prefix)) return false;
      if (/^\s*[/:?#]/.test(suffix)) return false;
      return !new RegExp(
        String.raw`(?:https?:\/\/|www\.)${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/:?#]|\b)`,
        "i",
      ).test(text);
    })
    .map((packageMatch) => packageMatch[0]);
  const uniquePackageNames = [...new Set(packageNames)];
  return uniquePackageNames.length === 1 ? uniquePackageNames[0] : null;
}

function extractCommandedAndroidPackageTarget(text: string): string | null {
  const command = text.match(PHONE_OPEN_COMMAND_PATTERN)?.[0];
  if (!command) return null;
  const targetText = text.slice(command.length).trim();
  if (!/\b(?:package(?:\s+name)?|android\s+app)\b/i.test(targetText)) return null;
  const packageName = targetText.match(
    new RegExp(
      String.raw`^(?:(?:the\s+)?(?:android\s+app|package(?:\s+name)?)(?:\s+package(?:\s+name)?)?(?:\s+is)?\s+)?(${ANDROID_PACKAGE_NAME_PATTERN.source})(?:\s+(?:android\s+app|package(?:\s+name)?))?(?:\s+(?:please|for\s+me|on\s+(?:my|the)\s+(?:phone|device)|(?:right\s+)?now))*\s*[.!?]*$`,
      "i",
    ),
  )?.[1];
  return packageName || null;
}

function extractExplicitPhoneAppTarget(text: string): string | null {
  if (isNegatedPhoneOpenRequest(text) || isDeferredPhoneOpenRequest(text)) return null;
  const immediateText = stripImmediatePhoneOpenQualifier(text);
  const command = immediateText.match(PHONE_OPEN_COMMAND_PATTERN)?.[0];
  if (!command) return null;
  if (hasAffirmativeWebTargetQualifier(immediateText)) return null;
  const packageName = extractCommandedAndroidPackageTarget(immediateText);
  if (packageName) return packageName;

  const appMatch = immediateText.slice(command.length).trim().match(
    /^(?:up\s+)?(?:the\s+)?(amazon(?:\s+shopping)?|you\s*tube|youtube|yt|facebook\s+(?:lite|messenger)|facebook|fb|linkedin|linked\s+in|instagram|ig|insta|spotify|google\s+chrome|chrome|browser|camera|settings|messages|texts|gmail|google\s+mail|google\s+maps|maps|messenger|whatsapp|whats\s+app|snapchat|snap|tiktok|tik\s+tok|x|twitter|reddit|discord|telegram|slack|zoom|teams|phone|dialer|calculator|calendar|clock|contacts|notes)(?:\s+app(?:lication)?)?\b(?![./?#:@])(?:(?:\s*,\s*|\s+)(?:please|for\s+me|on\s+(?:my|the)\s+(?:phone|device)|(?:right\s+)?now|once\s+(?:again|more)|again))*(?:\s*[,;]?\s*(?:not|instead\s+of)\s+(?:the\s+)?(?:website|web\s*site|site|webpage|web\s+page))?\s*[.!?]*$/i,
  )?.[1];
  if (appMatch) return appMatch.trim();

  const genericTarget = immediateText.slice(command.length).trim().match(
    /^(?:up\s+)?(?:the\s+)?([\p{L}\p{N}][\p{L}\p{N} .&'’+-]{0,79}?)(?:(?:\s*,\s*|\s+)(?:please|for\s+me|on\s+(?:my|the)\s+(?:phone|device)|directly|(?:right\s+)?now|once\s+(?:again|more)|again))*\s*[.!?]*$/iu,
  )?.[1]?.trim();
  const isNonAppObjectTarget = !/\b(?:app|application)\b/i.test(genericTarget ?? "") &&
    /\b(?:attachment|pdf|presentation|slides?|slide\s+deck|spreadsheet|workbook)\b/i.test(genericTarget ?? "");
  if (!genericTarget || isNonAppObjectTarget || /\.(?!\s)/.test(genericTarget) || /^(?:it|that|(?:the\s+)?app)(?:\s|$)/i.test(genericTarget) || /\b(?:search|website|web\s*site|site|webpage|web\s+page|url|link|file|folder|document|project|open|launch|start|not|never|neither|nor|either|or|and|but|except|excluding|without|avoid)\b|\b(?:other|rather)\s+than\b|\binstead\s+of\b/i.test(genericTarget)) {
    return null;
  }
  return genericTarget;
}

function hasAdditionalPhoneAction(text: string): boolean {
  const command = text.match(PHONE_OPEN_COMMAND_PATTERN)?.[0];
  const targetText = command ? text.slice(command.length) : text;
  if (hasPunctuatedPhoneFollowUpAction(targetText)) return true;
  const continuation = targetText
    .split(new RegExp(String.raw`\b${PHONE_COMPOUND_CONNECTOR_PATTERN}\b`, "i"))
    .slice(1)
    .join(" ");
  return continuation.trim().length > 0 &&
    new RegExp(String.raw`\b${PHONE_FOLLOW_UP_ACTION_PATTERN}\b`, "i").test(continuation);
}

function hasCurrentTargetBeforePhoneOpenFollowUp(text: string): boolean {
  const target = text.match(
    /\b(?:open|launch|start)(?:\s+up)?\s+(?:the\s+)?(.+?)\s*(?:and|then|[,—]|-(?=\s))\s*(?:open|launch|start)(?:\s+up)?\s+(?:it|that|the\s+app)\b/i,
  )?.[1]?.trim();
  return !!target && !/^(?:it|that|the\s+app)$/i.test(target);
}

function stripPhoneDiscoursePreamble(clause: string): string {
  return clause
    .replace(/^\s*scratch\s+that(?:\s+and)?[\s,!:-]*/i, "")
    .replace(/^(?:(?:actually|instead|wait|no|sorry)[\s,!:-]+)+/i, "");
}

function cancelsPhoneOpenTarget(clause: string, target: string): boolean {
  if (/^\s*(?:wait|no)\s*[.!?]*$/i.test(clause)) return true;
  const cancellation = stripPhoneDiscoursePreamble(clause);
  if (/^(?:wait|no|never\s*mind|cancel(?:\s+(?:that|it))?|scratch\s+that|forget\s+it|stop|(?:do\s+not|don['’]?t|dont)(?:\s+(?:do\s+(?:it|that)|open|launch|start))?)\s*[.!?]*$/i.test(cancellation)) {
    return true;
  }
  if (!isNegatedPhoneOpenRequest(clause)) return false;
  if (PHONE_OPEN_FOLLOW_UP_PATTERN.test(clause)) return true;
  const affirmativeClause = clause.replace(/^\s*(?:do\s+not|don['’]?t|dont|never)\s+/i, "");
  return extractExplicitPhoneAppTarget(affirmativeClause)?.toLowerCase() === target.toLowerCase();
}

function hasRequestedAction(clause: string): boolean {
  const actionClause = stripPhoneDiscoursePreamble(clause);
  const isResponseQualifier = /^\s*(?:tell\s+me\s+(?:what|about)|summari[sz]e|describe|explain|review|analy[sz]e)\s+(?:it|they|them|that|those)\b/i.test(actionClause);
  return (!isResponseQualifier && (
    REQUEST_ACTION_CLAUSE_PATTERN.test(actionClause) || REQUEST_QUESTION_CLAUSE_PATTERN.test(actionClause)
  )) ||
    isPhoneRuntimeCoveredRequest(actionClause) ||
    isPhoneDeviceControlKeywordRequest(actionClause);
}

function contextualPhoneAppTarget(
  requestText: string,
  recentConversation: string[],
  options: { allowMixedActions?: boolean } = {},
): string | null {
  if (ORDERED_PHONE_ACTION_PATTERN.test(requestText) ||
      (!options.allowMixedActions && hasNonRuntimeActionAlongsidePhoneAction(requestText)) ||
      hasAffirmativeWebTargetQualifier(requestText)) return null;
  const clauses = phoneOpenClauses(requestText);
  const directTargets = clauses
    .map((clause) => ({ clause, target: extractExplicitPhoneAppTarget(clause) }))
    .filter((result): result is { clause: string; target: string } => Boolean(result.target));
  const uniqueDirectTargets = [...new Set(directTargets.map((result) => result.target.toLowerCase()))];
  if (uniqueDirectTargets.length > 1) return null;
  if (directTargets.length > 0) {
    const selected = directTargets[0];
    const selectedClauseIndex = clauses.indexOf(selected.clause);
    const hasEarlierAction = clauses.slice(0, selectedClauseIndex)
      .some((clause) => hasRequestedAction(clause) && !isNegatedPhoneOpenRequest(clause));
    const hasLaterAction = clauses.slice(selectedClauseIndex + 1)
      .some((clause) => hasRequestedAction(clause) || cancelsPhoneOpenTarget(clause, selected.target));
    return hasEarlierAction || hasLaterAction || hasAdditionalPhoneAction(selected.clause) ? null : selected.target;
  }
  if (clauses.length > 1) {
    const affirmativeActionClauses = clauses.filter((clause) => (
      hasRequestedAction(clause) &&
      !/^\s*(?:do\s+not|don['’]?t|dont|never|stop)\b/i.test(stripPhoneDiscoursePreamble(clause))
    ));
    if (affirmativeActionClauses.length !== 1 || !PHONE_OPEN_FOLLOW_UP_PATTERN.test(affirmativeActionClauses[0])) {
      return null;
    }
    requestText = affirmativeActionClauses[0];
  }
  if (isNegatedPhoneOpenRequest(requestText) || isDeferredPhoneOpenRequest(requestText)) return null;
  const hasContextualReference = PHONE_OPEN_FOLLOW_UP_PATTERN.test(requestText) &&
    !hasCurrentTargetBeforePhoneOpenFollowUp(requestText);
  if (isPhoneOpenActionRequest(requestText) && !hasContextualReference) return null;
  if (hasCurrentTargetBeforePhoneOpenFollowUp(requestText)) return null;
  if (!PHONE_OPEN_COMMAND_PATTERN.test(requestText) || !PHONE_OPEN_FOLLOW_UP_PATTERN.test(requestText)) return null;

  const recentExchange = recentConversation.slice(-2);
  for (let index = recentExchange.length - 1; index >= 0; index--) {
    const priorText = recentExchange[index];
    const packageName = extractAndroidPackageTarget(priorText);
    if (packageName) return packageName;
    const priorTarget = extractExplicitPhoneAppTarget(priorText);
    if (priorTarget) return priorTarget;
  }
  return null;
}

export function isContextualPhoneRuntimeCoveredRequest(
  requestText: string,
  recentConversation: string[],
): boolean {
  return contextualPhoneAppTarget(requestText, recentConversation) !== null;
}

export function hasContextualPhoneRuntimeActionRequest(
  requestText: string,
  recentConversation: string[],
): boolean {
  return contextualPhoneAppTarget(requestText, recentConversation, { allowMixedActions: true }) !== null;
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

function isYoutubePhonePlayRequest(text: string): boolean {
  return /^\s*(?:(?:hey|hi|okay|ok|alright|now)[\s,;:!.-]+)?(?:jarvis[\s,:-]+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:play|watch)\b[\s\S]{0,160}\b(?:you\s*tube|youtube|yt)\b/i.test(text);
}

export function isYoutubeServerResearchRequest(text: string): boolean {
  return isYoutubePhoneRequest(text) &&
    /\b(?:summari[sz]e|summary|research|transcript|captions?|analy[sz]e|report|compare|rank|recommend|recommendation|best videos?|top videos?|best result|pick (?:a|the) video|choose (?:a|the) video)\b/i.test(text);
}

export function extractYoutubePhoneSearchQuery(text: string): string | null {
  if (!isYoutubePhoneActionRequest(text) || isYoutubeServerResearchRequest(text)) return null;
  if (/\b(?:don't|do not|dont|never)\b[\s\S]{0,48}\b(?:search|find|look\s+up|look\s+for)\b/i.test(text)) return null;

  const youtube = String.raw`(?:you\s*tube|youtube|yt)`;
  const verb = String.raw`(?:search|find|look\s+up|look\s+for)`;
  const requestPrefix = String.raw`^\s*(?:(?:hey|hi)[\s,;:!.-]+)?(?:jarvis[\s,:-]+)?(?:please\s+)?`;
  const patterns = [
    new RegExp(String.raw`${requestPrefix}(?:open|launch|start)(?:\s+up)?\s+(?:the\s+)?${youtube}(?:\s+app)?\s+(?:and|then)?\s*${verb}\s+(?:me\s+)?(?:for\s+)?(.+?)\s*[.!?]*$`, "i"),
    new RegExp(String.raw`${requestPrefix}${verb}\s+(?:me\s+)?(?:on\s+)?${youtube}\s+(?:for\s+)?(.+?)\s*[.!?]*$`, "i"),
    new RegExp(String.raw`${requestPrefix}${verb}\s+(?:me\s+)?(?:for\s+)?(.+?)\s+(?:on|in)\s+${youtube}\s*[.!?]*$`, "i"),
    new RegExp(String.raw`${requestPrefix}${youtube}\s+${verb}\s+(?:for\s+)?(.+?)\s*[.!?]*$`, "i"),
  ];

  for (const pattern of patterns) {
    const query = text.match(pattern)?.[1]
      ?.replace(/\s+(?:please|for me)\s*$/i, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (query) {
      // A connector inside the captured query may introduce any follow-up
      // phone action. Decline deterministic extraction rather than trying to
      // maintain an incomplete list of action verbs; the normal multi-tool
      // loop can still interpret legitimate search phrases containing one.
      if (new RegExp(String.raw`\b${PHONE_COMPOUND_CONNECTOR_PATTERN}\b`, "i").test(query)) return null;
      if (hasPunctuatedPhoneFollowUpAction(query)) return null;
      return query;
    }
  }
  return null;
}

export function isMemoryPhoneBypassRequest(text: string): boolean {
  return /\b(?:memory|memories|remember|recall|what do you know about me|what have i told you|about me|living context)\b/i.test(text);
}

function isPhoneOpenActionRequest(text: string): boolean {
  const clauses = phoneOpenClauses(text);
  if (clauses.length > 1) {
    return clauses.some((clause, index) => {
      const target = extractExplicitPhoneAppTarget(clause);
      if (target && clauses.slice(index + 1).some((laterClause) => cancelsPhoneOpenTarget(laterClause, target))) {
        return false;
      }
      return isPhoneOpenActionRequest(clause);
    });
  }
  if (isNegatedPhoneOpenRequest(text) || isDeferredPhoneOpenRequest(text)) return false;
  if (!PHONE_OPEN_COMMAND_PATTERN.test(text)) return false;
  if (hasAffirmativeWebTargetQualifier(text)) return false;
  if (/\b(?:project|build|create|make|generate|scaffold|code|web\s+app)\b/i.test(text)) return false;
  if (extractExplicitPhoneAppTarget(text)) return true;
  const initialActionClause = text.split(/\s*(?:[;—]|\b(?:and|then)\b)/i, 1)[0];
  if (initialActionClause !== text && extractExplicitPhoneAppTarget(initialActionClause)) return true;
  return /\b(?:app|application|phone|device)\b/i.test(text);
}

function hasPhoneRuntimeContext(text: string): boolean {
  return /\b(?:android|phone|screen|display|device|app|application|button|keyboard|field|input|notification|notifications)\b/i.test(text) ||
    isYoutubePhoneRequest(text) ||
    isPhoneOpenActionRequest(text);
}

function isNegatedActionClause(text: string): boolean {
  return /^\s*(?:do\s+not|don['’]?t|dont|never|stop)\b/i.test(stripPhoneDiscoursePreamble(text));
}

function hasNonRuntimeActionAlongsidePhoneAction(text: string): boolean {
  const segments = phoneOpenClauses(text).flatMap((clause) => (
    clause.split(new RegExp(String.raw`\b${PHONE_COMPOUND_CONNECTOR_PATTERN}\b`, "i"))
  )).map((segment) => stripPhoneDiscoursePreamble(segment.trim())).filter(Boolean);
  if (segments.length < 2) return false;
  const hasPhoneAction = segments.some((segment) => (
    isPhoneRuntimeCoveredRequest(segment) || PHONE_OPEN_FOLLOW_UP_PATTERN.test(segment)
  ));
  const hasNonRuntimeAction = segments.some((segment) => (
    hasRequestedAction(segment) &&
    !isNegatedActionClause(segment) &&
    !PHONE_OPEN_FOLLOW_UP_PATTERN.test(segment) &&
    !isPhoneRuntimeCoveredRequest(segment)
  ));
  return hasPhoneAction && hasNonRuntimeAction;
}

function hasPhoneRuntimeAction(normalized: string): boolean {
  const youtubePhoneActionRequest = !isYoutubeServerResearchRequest(normalized) &&
    !/\b(?:do\s+not|don['’]?t|dont|never|stop)\b[\s\S]{0,48}\b(?:open|launch|start|search|find|look\s+up|look\s+for|play|watch)\b/i.test(normalized) && (
      extractYoutubePhoneSearchQuery(normalized) !== null ||
      (isYoutubePhoneRequest(normalized) && isPhoneOpenActionRequest(normalized)) ||
      isYoutubePhonePlayRequest(normalized)
    );
  return youtubePhoneActionRequest ||
    hasCurrentTargetBeforePhoneOpenFollowUp(normalized) ||
    isPhoneOpenActionRequest(normalized) ||
    /\b(?:browse to|navigate to|open (?:a )?(?:url|link|website|site))\b/i.test(normalized) ||
    /\b(?:screenshot|screen shot|screen capture)\b/i.test(normalized) ||
    /\b(?:read|inspect|look at|what(?:'s| is))\b.{0,48}\b(?:screen|display|phone)\b/i.test(normalized) ||
    isPhoneNotificationReadRequest(normalized) ||
    (hasPhoneRuntimeContext(normalized) && /\b(?:tap|swipe|scroll|type|press|back|home|recents|enter)\b/i.test(normalized));
}

export function hasPhoneRuntimeActionRequest(text: string): boolean {
  return hasPhoneRuntimeAction(normalizePhoneRuntimeRequestText(text));
}

export function isPhoneRuntimeCoveredRequest(text: string): boolean {
  const normalized = normalizePhoneRuntimeRequestText(text);
  return !hasNonRuntimeActionAlongsidePhoneAction(normalized) && hasPhoneRuntimeAction(normalized);
}

export function isPhoneDeviceControlKeywordRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return PHONE_DEVICE_CONTROL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function hasUnsupportedPhoneDeviceControlRequest(text: string): boolean {
  const normalized = normalizePhoneRuntimeRequestText(text);
  const segments = phoneOpenClauses(normalized).flatMap((clause) => (
    clause.split(new RegExp(String.raw`\b${PHONE_COMPOUND_CONNECTOR_PATTERN}\b`, "i"))
  )).map((segment) => stripPhoneDiscoursePreamble(segment.trim())).filter(Boolean);
  return segments.some((segment) => (
    isPhoneDeviceControlKeywordRequest(segment) && !hasPhoneRuntimeAction(segment)
  ));
}

export function isPhoneNotificationReadRequest(text: string): boolean {
  const normalized = normalizePhoneRuntimeRequestText(text);
  if (!/\bnotifications?\b/i.test(normalized)) return false;
  if (/\b(?:settings?|enabled|disabled|turn(?:ed)?\s+on|turn(?:ed)?\s+off|permission|permissions|access|allowed|blocked|muted|silenced|configure|configured|configuration)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(?:don't|do not|dont|never|stop)\b[^;.!?]{0,48}\b(?:read|show|list|check|view|see)\b[^;.!?]{0,48}\bnotifications?\b/i.test(normalized)) {
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

function hasAdditionalPhoneActionAfterNotificationRead(text: string): boolean {
  const normalized = normalizePhoneRuntimeRequestText(text);
  const notification = normalized.match(/\bnotifications?\b/i);
  if (!notification) return false;
  const afterNotification = normalized.slice((notification.index ?? 0) + notification[0].length);
  if (hasPunctuatedPhoneFollowUpAction(afterNotification)) return true;
  const continuation = afterNotification
    .split(new RegExp(String.raw`\b${PHONE_COMPOUND_CONNECTOR_PATTERN}\b`, "i"))
    .slice(1)
    .join(" ");
  if (continuation.trim() && new RegExp(String.raw`\b${PHONE_FOLLOW_UP_ACTION_PATTERN}\b`, "i").test(continuation)) {
    return true;
  }
  const segments = phoneOpenClauses(normalized).flatMap((clause) => (
    clause.split(new RegExp(String.raw`\b${PHONE_COMPOUND_CONNECTOR_PATTERN}\b`, "i"))
  )).map((segment) => segment.trim()).filter(Boolean);
  return segments.some((segment) => (
    !isPhoneNotificationReadRequest(segment) &&
    !isNegatedPhoneOpenRequest(segment) &&
    (isPhoneRuntimeCoveredRequest(segment) || isPhoneDeviceControlKeywordRequest(segment))
  ));
}

function hasNotificationReadQualifier(text: string): boolean {
  const normalized = normalizePhoneRuntimeRequestText(text);
  if (/\b(?:only|just)\b[\s\S]{0,32}\b(?:count|number|total|how many)\b/i.test(normalized)) return true;
  if (/\b(?:count|number|total|how many)\b[\s\S]{0,48}\bnotifications?\b/i.test(normalized)) return true;
  if (/\bnotifications?\b[\s\S]{0,48}\b(?:count|number|total|how many)\b/i.test(normalized)) return true;
  if (/\b(?:gmail|google|facebook|instagram|slack|discord|telegram|youtube|codex|life360|maps|calendar|messages?|mail|email|outlook|chrome|linkedin|twitter|replit)\s+notifications?\b/i.test(normalized)) return true;
  if (/\bnotifications?\s+(?:from|for|about)\s+[a-z0-9][a-z0-9._-]*/i.test(normalized)) return true;
  return false;
}

export function deterministicPhoneRuntimeToolCallFromRequest(
  requestText: string,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  options: {
    androidActive: boolean;
    phoneRuntimeCoveredRequest: boolean;
    recentConversation?: string[];
  },
): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall | null {
  if (!options.androidActive || !options.phoneRuntimeCoveredRequest) return null;
  const youtubeQuery = extractYoutubePhoneSearchQuery(requestText);
  if (youtubeQuery) {
    const hasYoutubeSearchTool = tools.some((tool) => phoneRuntimeChatToolName(tool) === "android_youtube_search");
    if (!hasYoutubeSearchTool) return null;
    return {
      id: `jarvis_phone_runtime_${Date.now().toString(36)}_0`,
      type: "function",
      function: {
        name: "android_youtube_search",
        arguments: JSON.stringify({ query: youtubeQuery }),
      },
    };
  }
  const openAppTarget = contextualPhoneAppTarget(requestText, options.recentConversation ?? []);
  if (openAppTarget) {
    const hasOpenAppTool = tools.some((tool) => phoneRuntimeChatToolName(tool) === "android_open_app_by_name");
    if (!hasOpenAppTool) return null;
    return {
      id: `jarvis_phone_runtime_${Date.now().toString(36)}_0`,
      type: "function",
      function: {
        name: "android_open_app_by_name",
        arguments: JSON.stringify({ appName: openAppTarget }),
      },
    };
  }
  if (!isPhoneNotificationReadRequest(requestText)) return null;
  if (hasAdditionalPhoneActionAfterNotificationRead(requestText)) return null;
  if (hasNotificationReadQualifier(requestText)) return null;
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
  options: { deterministicToolCall?: boolean } = {},
): string | null {
  if (toolName !== "android_read_notifications") return null;
  if (options.deterministicToolCall !== true) return null;
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
  phoneRuntimeActionRequest: boolean,
): string[] {
  const youtubePhoneActionRequest = isYoutubePhoneRequest(lastUserContent) && isYoutubePhoneActionRequest(lastUserContent);
  const youtubeResearchRequest = isYoutubeServerResearchRequest(lastUserContent);
  if (!isDeviceControlRequest && !phoneRuntimeActionRequest && !youtubePhoneActionRequest && !youtubeResearchRequest) return [];
  const requiredToolNames = new Set<string>();

  if (phoneRuntimeActionRequest) {
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
