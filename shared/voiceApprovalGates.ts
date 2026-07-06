export type VoiceApprovalIntent = "approve" | "deny" | "ambiguous" | "unrelated";
export type VoiceRestoreIntent = "restore" | "dismiss" | "ambiguous" | "unrelated";

export type VoiceActionRiskTier = "T0" | "T4";

export interface VoiceApprovalIntentResult {
  intent: VoiceApprovalIntent;
  normalizedText: string;
}

export interface VoiceRestoreIntentResult {
  intent: VoiceRestoreIntent;
  normalizedText: string;
}

export interface VoiceRestoreIntentOptions {
  allowGenericReply?: boolean;
}

export interface VoiceApprovalRiskInput {
  tool?: string;
  requestText?: string;
  preview?: Record<string, unknown> | null;
}

export interface VoiceApprovalRiskDecision {
  riskTier: VoiceActionRiskTier;
  approvalRequired: boolean;
  overlayRequired: boolean;
  prompt: string;
  reason: string;
}

const APPROVE_PATTERNS = [
  /\b(yes|yeah|yep|yup|sure|okay|ok)\b/,
  /\b(go ahead|do it|approve|approved|confirm|confirmed|proceed)\b/,
  /\b(send it|run it|post it|publish it|submit it|save it)\b/,
  /\b(that is fine|that's fine|sounds good|looks good)\b/,
];

const DENY_PATTERNS = [
  /\b(no|nope|nah)\b/,
  /\b(cancel|deny|decline|reject|stop|do not|don't|dont|don t)\b/,
  /\b(not now|leave it|never mind|nevermind)\b/,
];

const AMBIGUOUS_PATTERNS = [
  /\b(maybe|i guess|probably|not sure|unsure)\b/,
  /\b(wait|hold on|what|huh|which one|what action)\b/,
];

const NEGATED_APPROVAL_PATTERNS = [
  /\b(don't|do not|dont|don t|never)\s+(do it|send it|run it|post it|publish it|submit it|save it|proceed|approve|confirm)\b/,
  /\b(not|isn t|isn't|is not|don t|don't|dont)\s+(ok|okay|fine|good)\b/,
  /\b(that is|that's|thats|it is|it's|its)\s+not\s+(ok|okay|fine|good)\b/,
];

const RESTORE_CONTEXT_PATTERNS = [
  /\b(restore|resume|recover)\b.*\b(voice|voice call|voice chat|context|conversation|session)\b/,
  /\b(pick\s+up|continue)\b.*\b(where\s+we\s+left\s+off|context|conversation)\b/,
  /\buse\s+that\s+context\b/,
];

const GENERIC_RESTORE_CONTEXT_PATTERNS = [
  /^(restore|resume|recover)$/,
  /\b(restore|resume|recover)\s+(it|that)\b$/,
  /\b(pick\s+up|continue)\b.*\b(that|it)\b/,
  /\bbring\s+it\s+back\b/,
];

const DISMISS_RESTORE_PATTERNS = [
  /\b(cancel|dismiss|discard|forget|ignore|skip)\b.*\b(context|restore|voice|conversation|session)\b/,
  /\b(don't|do not|dont|don t|never)\s+(restore|resume|recover|continue)\b/,
];

const GENERIC_DISMISS_RESTORE_PATTERNS = [
  /\b(no|nope|nah)\b/,
  /^(cancel|dismiss|discard|forget|ignore|skip)(\s+(it|that))?$/,
  /\b(start\s+fresh|fresh\s+start|new\s+conversation)\b/,
];

const NEGATED_RESTORE_PATTERNS = [
  /\b(don't|do not|dont|don t|never)\s+(restore|resume|recover|continue)\b/,
  /\b(no|nope|nah)\b.*\b(don't|do not|dont|don t|never)\s+(restore|resume|recover|continue)\b/,
];

const HIGH_RISK_PATTERNS = [
  /\b(delete|remove|clear|erase|destroy|wipe)\b/,
  /\b(send|reply|respond)\b.*\b(message|email|text|dm)\b/,
  /\b(message|email|text|dm)\b.*\b(send|reply|respond)\b/,
  /\btext\s+(him|her|them|me|[a-z]+|\+?\d[\d\s().-]*)\b/,
  /\b(post|publish|comment|share publicly|public)\b/,
  /\b(pay|purchase|buy|order|transfer|withdraw|subscribe)\b/,
  /\b(submit|save|apply|authorize|connect|disconnect)\b/,
  /\b(account|password|login|log out|logout|sign out|settings)\b/,
  /\b(book|cancel|reschedule|schedule a meeting)\b/,
  /\b(shell|terminal|command|deploy|merge|push|production|secret)\b/,
];

const LOW_RISK_PHONE_PATTERNS = [
  /\b(open|launch)\b/,
  /\b(read|show|view|look at|summari[sz]e)\b/,
  /\b(search|find)\b/,
  /\b(tap|press|scroll|swipe|type)\b/,
  /\b(screenshot|screen|notifications?|app)\b/,
];

const HIGH_RISK_TOOL_NAMES = [
  "send_email",
  "connected_accounts_execute",
  "project_shell",
  "deploy_app",
  "queue_background_job",
  "daemon_action",
  "discord_post",
  "discord_create_channel",
  "discord_delete_channel",
  "gmail_action",
  "google_calendar_action",
  "slack_post",
  "android_notification_reply",
  "android_sms_send",
  "android_camera_clip",
  "android_screen_record",
];

const EXTERNAL_BOUNDARY_PATTERNS = [
  /\b(delete|remove|clear|erase|destroy|wipe)\b/,
  /\b(send|reply|respond|post|publish|comment|pay|purchase|buy|order|transfer|withdraw|subscribe)\b/,
  /\b(submit|save|apply|authorize|connect|disconnect)\b/,
  /\b(password|log out|logout|sign out|account change|change account)\b/,
  /\b(book|cancel|reschedule|schedule a meeting)\b/,
];

const LOW_RISK_ANDROID_TOOL_NAMES = [
  "android_open_app",
  "android_read_notifications",
  "android_view_screenshot",
  "android_read_screen",
  "android_search",
  "android_tap",
  "android_scroll",
  "android_type",
];

function normalizeSpeechText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function patternMatches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function previewToText(preview?: Record<string, unknown> | null): string {
  if (!preview) return "";
  return Object.values(preview)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => typeof value === "string" ? value : JSON.stringify(value))
    .join(" ");
}

function humanizeToolName(tool?: string): string {
  if (!tool) return "action";
  return tool.replace(/^android_/, "").replace(/_/g, " ");
}

function previewString(preview: Record<string, unknown>, key: string, maxLength = 80): string {
  const value = preview[key];
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function buildAndroidApprovalPrompt(tool: string | undefined, preview: Record<string, unknown>): string {
  const action = typeof preview.action === "string" && preview.action.trim()
    ? preview.action.trim()
    : tool || "";
  const to = previewString(preview, "to", 40);
  const message = previewString(preview, "message", 80);
  const replyText = previewString(preview, "replyText", 80);
  const text = previewString(preview, "text", 80);
  const durationMs = typeof preview.durationMs === "string" && preview.durationMs.trim()
    ? Number(preview.durationMs)
    : typeof preview.durationMs === "number"
      ? preview.durationMs
      : null;
  const durationSeconds = durationMs && Number.isFinite(durationMs)
    ? Math.max(1, Math.round(durationMs / 1000))
    : null;

  if (action === "android_sms_send") {
    const target = to ? ` to ${to}` : "";
    const body = message ? `: "${message}"` : "";
    return `Approve sending this text${target}${body}?`;
  }
  if (action === "android_notification_reply") {
    const body = replyText ? `: "${replyText}"` : "";
    return `Approve sending this notification reply${body}?`;
  }
  if (action === "android_camera_clip") {
    return `Approve recording a camera clip${durationSeconds ? ` for ${durationSeconds} seconds` : ""}?`;
  }
  if (action === "android_screen_record") {
    return `Approve recording your screen${durationSeconds ? ` for ${durationSeconds} seconds` : ""}?`;
  }
  if (
    (action === "android_type" ||
      action === "android_type_text" ||
      (action === "android_operator_action" && preview.operatorActionType === "type_text")) &&
    text
  ) {
    return `Approve submitting this phone text: "${text}"?`;
  }
  return "Approve this phone action?";
}

export function normalizeVoiceApprovalReply(text: string): VoiceApprovalIntentResult {
  const normalizedText = normalizeSpeechText(text);
  if (!normalizedText) return { intent: "unrelated", normalizedText };

  const hasDeny = patternMatches(normalizedText, DENY_PATTERNS);
  const hasApprove = patternMatches(normalizedText, APPROVE_PATTERNS);
  const hasAmbiguity = patternMatches(normalizedText, AMBIGUOUS_PATTERNS);

  if (patternMatches(normalizedText, NEGATED_APPROVAL_PATTERNS)) {
    return { intent: "deny", normalizedText };
  }

  if (hasAmbiguity || (hasDeny && hasApprove)) {
    return { intent: "ambiguous", normalizedText };
  }

  if (hasDeny) {
    return { intent: "deny", normalizedText };
  }

  if (hasApprove) {
    return { intent: "approve", normalizedText };
  }

  return { intent: "unrelated", normalizedText };
}

export function normalizeVoiceRestoreReply(text: string, options: VoiceRestoreIntentOptions = {}): VoiceRestoreIntentResult {
  const normalizedText = normalizeSpeechText(text);
  if (!normalizedText) return { intent: "unrelated", normalizedText };

  const allowGenericReply = options.allowGenericReply === true;
  const hasContextDismiss = patternMatches(normalizedText, DISMISS_RESTORE_PATTERNS);
  const hasGenericDismiss = allowGenericReply && patternMatches(normalizedText, GENERIC_DISMISS_RESTORE_PATTERNS);
  const hasDismiss = hasContextDismiss || hasGenericDismiss;
  const hasRestore = patternMatches(normalizedText, RESTORE_CONTEXT_PATTERNS) ||
    (allowGenericReply && patternMatches(normalizedText, GENERIC_RESTORE_CONTEXT_PATTERNS)) ||
    (allowGenericReply && patternMatches(normalizedText, APPROVE_PATTERNS));
  const hasAmbiguity = patternMatches(normalizedText, AMBIGUOUS_PATTERNS);

  if (patternMatches(normalizedText, NEGATED_RESTORE_PATTERNS)) {
    return { intent: "dismiss", normalizedText };
  }

  if (!hasDismiss && !hasRestore) {
    return { intent: "unrelated", normalizedText };
  }

  if (hasAmbiguity || (hasGenericDismiss && hasRestore && !hasContextDismiss)) {
    return { intent: "ambiguous", normalizedText };
  }

  if (hasDismiss) {
    return { intent: "dismiss", normalizedText };
  }

  if (hasRestore) {
    return { intent: "restore", normalizedText };
  }

  return { intent: "unrelated", normalizedText };
}

export function classifyVoiceApprovalRisk(input: VoiceApprovalRiskInput): VoiceApprovalRiskDecision {
  const tool = input.tool?.trim().toLowerCase();
  const haystack = normalizeSpeechText([
    tool,
    input.requestText,
    previewToText(input.preview),
  ].filter(Boolean).join(" "));

  const highRiskTool = !!tool && HIGH_RISK_TOOL_NAMES.includes(tool);
  const lowRiskAndroidTool = !!tool && LOW_RISK_ANDROID_TOOL_NAMES.includes(tool);
  const highRiskLanguage = patternMatches(haystack, HIGH_RISK_PATTERNS);
  const externalBoundary = patternMatches(haystack, EXTERNAL_BOUNDARY_PATTERNS);
  const lowRiskPhoneLanguage = patternMatches(haystack, LOW_RISK_PHONE_PATTERNS);

  if (highRiskTool) {
    return {
      riskTier: "T4",
      approvalRequired: true,
      overlayRequired: true,
      prompt: buildVoiceApprovalPrompt(input),
      reason: "This action can change external state, affect accounts, spend money, publish, send, delete, or run system-level work.",
    };
  }

  if (lowRiskAndroidTool && !externalBoundary) {
    return {
      riskTier: "T0",
      approvalRequired: false,
      overlayRequired: false,
      prompt: "",
      reason: "This is low-risk phone navigation or read-only device control.",
    };
  }

  if (highRiskLanguage || externalBoundary) {
    return {
      riskTier: "T4",
      approvalRequired: true,
      overlayRequired: true,
      prompt: buildVoiceApprovalPrompt(input),
      reason: "This action can change external state, affect accounts, spend money, publish, send, delete, or run system-level work.",
    };
  }

  if (lowRiskAndroidTool || lowRiskPhoneLanguage) {
    return {
      riskTier: "T0",
      approvalRequired: false,
      overlayRequired: false,
      prompt: "",
      reason: "This is low-risk phone navigation or read-only device control.",
    };
  }

  return {
    riskTier: "T0",
    approvalRequired: false,
    overlayRequired: false,
    prompt: "",
    reason: "No high-risk approval boundary matched.",
  };
}

export function buildVoiceApprovalPrompt(input: VoiceApprovalRiskInput): string {
  const preview = input.preview ?? {};
  const tool = input.tool?.trim().toLowerCase();
  if (tool === "send_email") {
    const to = typeof preview.to === "string" && preview.to.trim() ? ` to ${preview.to.trim()}` : "";
    return `Approve sending this email${to}?`;
  }
  if (tool === "connected_accounts_execute") {
    const platform = typeof preview.platform === "string" && preview.platform.trim() ? ` in ${preview.platform.trim()}` : "";
    return `Approve this connected account action${platform}?`;
  }
  if (tool?.startsWith("android_") || (tool === "daemon_action" && typeof preview.action === "string" && preview.action.startsWith("android_"))) {
    return buildAndroidApprovalPrompt(tool, preview);
  }
  if (tool === "project_shell") {
    return "Approve running this terminal command?";
  }
  return `Approve this ${humanizeToolName(tool)} action?`;
}

export function voiceApprovalClarificationPrompt(): string {
  return "Do you want me to approve it or cancel it?";
}
