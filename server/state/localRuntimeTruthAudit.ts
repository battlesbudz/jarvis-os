export type LocalRuntimeCapabilityName =
  | "notifications"
  | "screen"
  | "screenshot"
  | "app_control"
  | "clipboard"
  | "memory";

export type LocalRuntimeCapabilityAvailability = "available" | "unavailable" | "unknown";

export interface LocalRuntimeActionResult {
  toolName: string;
  ok: boolean;
  target?: string | null;
  summary?: string | null;
}

export interface LocalRuntimeTruthAuditInput {
  userMessage: string;
  responseText?: string | null;
  capabilityState?: Partial<Record<LocalRuntimeCapabilityName, LocalRuntimeCapabilityAvailability>>;
  actionResults?: LocalRuntimeActionResult[];
  evidence?: string[];
}

export interface LocalRuntimeToolRepairInput {
  requestedToolName: string;
  availableToolNames: string[];
  repairAttempted?: boolean;
}

export type LocalRuntimeTruthAuditDecision =
  | {
    status: "allow";
    text: string;
  }
  | {
    status: "blocked_false_denial" | "blocked_false_completion" | "blocked_unsupported_claim";
    text: string;
    reason: string;
  };

export type LocalRuntimeToolRepairDecision =
  | {
    status: "repair_tool_call";
    repairedToolName: string;
  }
  | {
    status: "friendly_failure";
    text: string;
    reason: string;
  };

const FRIENDLY_LOCAL_RUNTIME_FAILURE = "I could not complete that cleanly yet. I stopped before doing anything unreliable.";

const TOOL_ALIASES: Record<string, string> = {
  android_view_screenshot: "android_capture_screen",
  android_screenshot: "android_capture_screen",
  android_read_screen: "android_read_screen_context",
  android_read_notification: "android_read_notifications",
  android_notifications_list: "android_read_notifications",
  android_open_app: "android_open_app_by_name",
  copy_to_clipboard: "android_copy_to_clipboard",
};

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

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function aliasToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeToolName(name: string): string {
  return compactText(name)
    .toLowerCase()
    .replace(/\s*[_-]\s*/g, "_")
    .replace(/\s+/g, "_");
}

function capabilityAvailable(
  state: LocalRuntimeTruthAuditInput["capabilityState"],
  capability: LocalRuntimeCapabilityName,
): boolean {
  return state?.[capability] === "available";
}

function actionToolsForCapability(capability: LocalRuntimeCapabilityName): Set<string> {
  switch (capability) {
    case "notifications":
      return new Set(["android_read_notifications"]);
    case "screen":
      return new Set(["android_read_screen_context"]);
    case "screenshot":
      return new Set(["android_capture_screen"]);
    case "app_control":
      return new Set(["android_open_app_by_name", "android_youtube_search", "android_open_phone_url"]);
    case "clipboard":
      return new Set(["android_copy_to_clipboard"]);
    case "memory":
      return new Set(["memory_search", "memory_get", "memory_save"]);
  }
}

function hasFailedActionForCapability(
  capability: LocalRuntimeCapabilityName,
  results: LocalRuntimeActionResult[],
): boolean {
  const toolNames = actionToolsForCapability(capability);
  return results.some((result) => !result.ok && toolNames.has(result.toolName));
}

function isMemoryDataAbsenceAnswer(text: string): boolean {
  return /\b(?:i\s+)?(?:can(?:not|'t)|do\s+not|don't|unable\s+to|not\s+able\s+to)\s+(?:remember|find|see|know|recall|have)\b/i.test(text) &&
    !/\b(?:access|search|query|use|check)\b[\s\S]{0,32}\b(?:memory|memories|profile|memoryos)\b/i.test(text);
}

function isExplicitMemoryWriteRequest(text: string): boolean {
  const value = compactText(text);
  if (/^\s*(?:do|did)\s+you\s+remember\b/i.test(value)) return false;
  return /\b(?:remember|save|store|record|note)\b[\s\S]{0,80}\b(?:this|that|my|to memory|in memory|as memory)\b/i.test(value);
}

function bareStartTarget(text: string): string | null {
  const match = text.match(/\bstart\b(?![-\s]+source\b)\s+(?:the\s+)?([a-z0-9][a-z0-9 ._'-]{1,60}?)(?:[.!?]|$)/i);
  const target = match?.[1] ? normalizeOpenedTarget(match[1]) : "";
  if (!target) return null;
  if (/^(?:until|unless|if|when|by|with|without|after|before)\b/i.test(target)) return null;
  if (/^(?:task|work|process|draft|outline|plan|summary|response|analysis|review|conversation|chat|setup|account)\b/i.test(target)) return null;
  return target;
}

function userAskedToStartTarget(userMessage: string, target: string): boolean {
  const text = compactText(userMessage).toLowerCase();
  const normalizedTarget = normalizeOpenedTarget(target).toLowerCase();
  return !!normalizedTarget &&
    /\bstart\b(?![-\s]+source\b)/i.test(text) &&
    text.includes(normalizedTarget);
}

function normalizeOpenedTarget(value: string): string {
  return value
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:the\s+)/i, "")
    .replace(/\s+(?:app|application)$/i, "")
    .trim();
}

function deniedAvailableCapability(
  text: string,
  userMessage: string,
  capabilities: LocalRuntimeTruthAuditInput["capabilityState"],
): LocalRuntimeCapabilityName | null {
  const denial = /\b(?:i\s+)?(?:can(?:not|'t)|do\s+not\s+have\s+access|unable\s+to|not\s+able\s+to)\b/i;
  if (!denial.test(text)) return null;

  const bareStart = bareStartTarget(text);
  if (
    capabilityAvailable(capabilities, "app_control") &&
    (/\bstart\b(?![-\s]+source\b)\s+(?:the\s+)?[a-z0-9][a-z0-9 ._'-]{1,60}?(?:\s+(?:app|application)|\s+on\s+(?:your\s+phone|your\s+device|my\s+phone|the\s+device))\b/i.test(text) ||
      (bareStart !== null && userAskedToStartTarget(userMessage, bareStart)))
  ) {
    return "app_control";
  }

  const checks: Array<[LocalRuntimeCapabilityName, RegExp]> = [
    ["notifications", /\bnotifications?\b/i],
    ["screen", /\b(?:screen|display)\b/i],
    ["screenshot", /\b(?:screenshot|screen\s+shot|screen\s+grab|capture)\b/i],
    ["app_control", /\b(?:open|launch)\b(?![-\s]+source\b)(?:\s+(?:the\s+)?[a-z0-9][a-z0-9 ._'-]{1,60})?/i],
    ["clipboard", /\bclipboard\b/i],
    ["memory", /\b(?:memory|remember|know about you|who you are|who i am)\b/i],
  ];

  for (const [capability, pattern] of checks) {
    if (
      capability === "memory" &&
      isMemoryDataAbsenceAnswer(text) &&
      !isExplicitMemoryWriteRequest(userMessage)
    ) continue;
    if (capabilityAvailable(capabilities, capability) && pattern.test(text)) return capability;
  }
  return null;
}

function completionClaimTarget(text: string): { toolName: string; target?: string } | null {
  const openedUrl = text.match(/\b(?:i\s+)?(?:opened|launched|started)\s+((?:https?:\/\/|[a-z][a-z0-9+.-]*:\/\/|www\.|(?:geo|spotify|tel|sms|mailto|market|intent|vnd\.[a-z0-9_.-]+|google\.navigation|waze):)[^\s<>"']{2,160})/i);
  if (openedUrl?.[1]) {
    return { toolName: "android_open_app_by_name", target: normalizeOpenedTarget(openedUrl[1]) };
  }
  const opened = text.match(/\b(?:i\s+)?(?:opened|launched)\s+([a-z0-9 ._-]{2,80}?)(?:\s+for\s+you|\s+on\s+your\s+phone|\s+on\s+the\s+device|[.!?]|$)/i);
  if (opened?.[1]) {
    return { toolName: "android_open_app_by_name", target: normalizeOpenedTarget(opened[1]) };
  }
  const startedApp = text.match(/\b(?:i\s+)?started\s+(?:the\s+)?([a-z0-9 ._-]{2,80}?)(?:\s+(?:app|application)|\s+on\s+(?:your\s+phone|your\s+device|my\s+phone|the\s+device))(?:[.!?]|$)/i);
  if (startedApp?.[1]) {
    return { toolName: "android_open_app_by_name", target: normalizeOpenedTarget(startedApp[1]) };
  }
  if (/\b(?:i\s+)?(?:captured|took)\s+(?:a\s+)?screenshot\b/i.test(text)) {
    return { toolName: "android_capture_screen" };
  }
  if (/\b(?:i\s+)?copied\b[\s\S]{0,48}\bclipboard\b/i.test(text)) {
    return { toolName: "android_copy_to_clipboard" };
  }
  return null;
}

function userAskedForAuditedLocalAction(
  userMessage: string,
  claim: { toolName: string; target?: string },
): boolean {
  const text = compactText(userMessage).toLowerCase();
  if (!text) return false;

  switch (claim.toolName) {
    case "android_capture_screen":
      return /\b(?:screenshot|screen\s+shot|screen\s+grab|capture)\b/i.test(text);
    case "android_copy_to_clipboard":
      return /\b(?:copy|clipboard)\b/i.test(text);
    case "android_open_app_by_name": {
      if (/\bopen[-\s]+source\b/i.test(text)) return false;
      if (/\bsearch\b[\s\S]{0,40}\byoutube\b|\byoutube\b[\s\S]{0,40}\bsearch\b/i.test(text)) return true;
      if (!/\b(?:open|launch|start|browse|visit|go\s+to|navigate(?:\s+to)?|pull\s+up)\b/i.test(text)) return false;
      const target = compactText(claim.target).toLowerCase();
      return !target || text.includes(target);
    }
    default:
      return false;
  }
}

function hasConfirmingActionResult(
  claim: { toolName: string; target?: string },
  results: LocalRuntimeActionResult[],
): boolean {
  const target = compactText(claim.target).toLowerCase();
  const confirmingToolNames = claim.toolName === "android_open_app_by_name"
    ? new Set(["android_open_app_by_name", "android_youtube_search", "android_open_phone_url"])
    : new Set([claim.toolName]);
  return results.some((result) => {
    if (!result.ok || !confirmingToolNames.has(result.toolName)) return false;
    if (!target) return true;
    if (result.toolName === "android_youtube_search" && target === "youtube") return true;
    const resultTarget = compactText(`${result.target ?? ""} ${result.summary ?? ""}`).toLowerCase();
    return actionTargetsMatch(target, resultTarget);
  });
}

function appPackageNameForTarget(value: string): string | null {
  const normalized = compactText(value).toLowerCase();
  if (!normalized) return null;
  const exactPackage = Object.values(ANDROID_APP_PACKAGE_ALIASES).find((packageName) => packageName === normalized);
  if (exactPackage) return exactPackage;
  return ANDROID_APP_PACKAGE_ALIASES[aliasToken(normalized)] ?? null;
}

function appTargetVariants(value: string): Set<string> {
  const variants = new Set<string>();
  const normalized = normalizeOpenedTarget(value).toLowerCase();
  if (normalized) variants.add(normalized);
  const packageName = appPackageNameForTarget(normalized);
  if (packageName) {
    variants.add(packageName);
    for (const [alias, candidatePackageName] of Object.entries(ANDROID_APP_PACKAGE_ALIASES)) {
      if (candidatePackageName === packageName) variants.add(alias.replace(/_/g, " "));
    }
  }
  return variants;
}

function actionTargetsMatch(claimTarget: string, resultTarget: string): boolean {
  if (!claimTarget) return true;
  if (resultTarget.includes(claimTarget)) return true;
  const claimVariants = appTargetVariants(claimTarget);
  const resultVariants = appTargetVariants(resultTarget);
  for (const variant of claimVariants) {
    if (resultTarget.includes(variant) || resultVariants.has(variant)) return true;
  }
  return false;
}

function strongPersonalClaim(text: string): string | null {
  const claim = text.match(/\b(?:[Yy]our\s+name\s+is|[Yy]ou\s+are|[Yy]ou're)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
  return claim?.[0] ?? null;
}

function evidenceSupportsClaim(claim: string, evidence: string[]): boolean {
  const normalizedClaim = claim.toLowerCase();
  const claimedName = claim.match(/\b(?:your\s+name\s+is|you\s+are|you're)\s+(.+)$/i)?.[1]?.trim().toLowerCase() ?? "";
  return evidence.some((item) => {
    const normalizedItem = item.toLowerCase();
    if (normalizedItem.includes(normalizedClaim)) return true;
    return !!claimedName &&
      /\b(?:preferred\s+name|name|identity|profile|soul|user)\b/i.test(item) &&
      normalizedItem.includes(claimedName);
  });
}

export function localRuntimeFriendlyFailure(): string {
  return FRIENDLY_LOCAL_RUNTIME_FAILURE;
}

export function auditLocalRuntimeResponse(input: LocalRuntimeTruthAuditInput): LocalRuntimeTruthAuditDecision {
  const rawText = typeof input.responseText === "string" ? input.responseText.trim() : "";
  const text = compactText(rawText);
  if (!text) {
    return {
      status: "blocked_unsupported_claim",
      text: FRIENDLY_LOCAL_RUNTIME_FAILURE,
      reason: "empty_response",
    };
  }

  const deniedCapability = deniedAvailableCapability(text, input.userMessage, input.capabilityState);
  if (deniedCapability && !hasFailedActionForCapability(deniedCapability, input.actionResults ?? [])) {
    return {
      status: "blocked_false_denial",
      text: "I can do that locally. Let me try again.",
      reason: `available_capability_denied:${deniedCapability}`,
    };
  }

  const actionResults = input.actionResults ?? [];
  const completionClaim = completionClaimTarget(text);
  if (
    completionClaim &&
    (actionResults.length > 0 || userAskedForAuditedLocalAction(input.userMessage, completionClaim)) &&
    !hasConfirmingActionResult(completionClaim, actionResults)
  ) {
    return {
      status: "blocked_false_completion",
      text: "I have not completed that yet.",
      reason: "missing_confirming_action_result",
    };
  }

  const personalClaim = strongPersonalClaim(text);
  if (personalClaim && !evidenceSupportsClaim(personalClaim, input.evidence ?? [])) {
    return {
      status: "blocked_unsupported_claim",
      text: "I need to check JARVIS memory or profile before saying that.",
      reason: "unsupported_personal_claim",
    };
  }

  return { status: "allow", text: rawText };
}

export function repairLocalRuntimeToolCall(input: LocalRuntimeToolRepairInput): LocalRuntimeToolRepairDecision {
  if (input.repairAttempted) {
    return {
      status: "friendly_failure",
      text: FRIENDLY_LOCAL_RUNTIME_FAILURE,
      reason: "repair_already_attempted",
    };
  }

  const available = new Set(input.availableToolNames.map(normalizeToolName));
  const requested = normalizeToolName(input.requestedToolName);
  const repaired = TOOL_ALIASES[requested] ?? requested;
  if (available.has(repaired)) {
    return {
      status: "repair_tool_call",
      repairedToolName: repaired,
    };
  }

  return {
    status: "friendly_failure",
    text: FRIENDLY_LOCAL_RUNTIME_FAILURE,
    reason: "no_safe_tool_repair",
  };
}
