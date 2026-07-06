type AndroidSubmitGateArgs = Record<string, unknown> | null | undefined;

const ANDROID_EXTERNAL_BOUNDARY_PATTERN =
  /\b(send|reply|respond|tell|ask|text|texts|message|messages|email|mail|dm|dms|post|publish|comment|share|pay|purchase|buy|order|checkout|check[ -]?out|transfer|withdraw|subscribe|submit|save|apply|authorize|confirm|delete|remove|clear|erase|destroy|wipe|book|schedule|reschedule|cancel|connect|disconnect|log in|login|sign in|sign out|logout|password|account)\b/i;

const SUBMIT_KEYS = new Set(["enter", "search", "go", "send", "done"]);
const HIGH_RISK_ANDROID_ACTIONS = new Set([
  "android_sms_send",
  "android_notification_reply",
  "android_camera_clip",
  "android_screen_record",
]);

function normalizeActionName(tool: string, args: AndroidSubmitGateArgs): string {
  if (tool === "daemon_action") {
    return String(args?.action || "");
  }
  return tool;
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function previewString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : "";
}

function collectGateText(args: AndroidSubmitGateArgs, requestText?: string): string {
  const operatorAction = args?.operatorAction as Record<string, unknown> | undefined;
  return [
    requestText,
    args?.text,
    args?.label,
    args?.description,
    args?.reason,
    args?.buttonText,
    args?.accessibilityLabel,
    args?.contentDescription,
    operatorAction?.text,
    operatorAction?.label,
    operatorAction?.description,
    operatorAction?.reason,
    operatorAction?.buttonText,
    operatorAction?.accessibilityLabel,
    operatorAction?.contentDescription,
  ]
    .map(previewValue)
    .filter(Boolean)
    .join(" ");
}

function hasExternalBoundaryLanguage(args: AndroidSubmitGateArgs, requestText?: string): boolean {
  return ANDROID_EXTERNAL_BOUNDARY_PATTERN.test(collectGateText(args, requestText));
}

function hasSubmitKey(args: AndroidSubmitGateArgs): boolean {
  return SUBMIT_KEYS.has(String(args?.key || "").toLowerCase());
}

export function isAndroidSubmitCapableAction(
  tool: string,
  args: AndroidSubmitGateArgs,
  requestText?: string,
): boolean {
  const action = normalizeActionName(tool, args);

  if (HIGH_RISK_ANDROID_ACTIONS.has(action)) {
    return true;
  }

  if (action === "android_type" || action === "android_type_text") {
    return args?.submit === true && hasExternalBoundaryLanguage(args, requestText);
  }

  if (action === "android_press_key" || action === "android_press_phone_key") {
    return hasSubmitKey(args) && hasExternalBoundaryLanguage(args, requestText);
  }

  if (action === "android_tap" || action === "android_tap_screen") {
    return hasExternalBoundaryLanguage(args, requestText);
  }

  if (action === "android_operator_action") {
    const operatorAction = args?.operatorAction as Record<string, unknown> | undefined;
    const operatorType = String(operatorAction?.type || "");
    if (operatorType === "type_text" && operatorAction?.submit === true) {
      return hasExternalBoundaryLanguage(args, requestText);
    }
    if (operatorType === "press_key" && SUBMIT_KEYS.has(String(operatorAction?.key || "").toLowerCase())) {
      return hasExternalBoundaryLanguage(args, requestText);
    }
    if (operatorType === "tap_element" || operatorType === "tap_coordinates") {
      return hasExternalBoundaryLanguage(args, requestText);
    }
  }

  return false;
}

export function buildAndroidSubmitConfirmationPreview(
  tool: string,
  args: AndroidSubmitGateArgs,
  requestText?: string,
): Record<string, string> {
  const action = normalizeActionName(tool, args);
  const operatorAction = args?.operatorAction as Record<string, unknown> | undefined;
  const operatorType = String(operatorAction?.type || "");
  const preview: Record<string, string> = {
    action,
    reason: "This phone action may submit, send, save, pay, publish, or change external state.",
  };
  if (tool !== action) preview.tool = tool;
  if (operatorType) preview.operatorActionType = operatorType.slice(0, 80);
  const text = previewString(args?.text, 160) || previewString(operatorAction?.text, 160);
  const message = previewString(args?.message, 160) || previewString(operatorAction?.message, 160);
  const replyText = previewString(args?.replyText, 160) || previewString(operatorAction?.replyText, 160);
  const to = previewString(args?.to, 120) || previewString(operatorAction?.to, 120);
  const notificationKey = previewString(args?.notificationKey, 120) || previewString(operatorAction?.notificationKey, 120);
  if (text) preview.text = text;
  if (message) preview.message = message;
  if (replyText) preview.replyText = replyText;
  if (to) preview.to = to;
  if (notificationKey) preview.notificationKey = notificationKey;
  if (typeof args?.durationMs === "number" && Number.isFinite(args.durationMs)) {
    preview.durationMs = String(args.durationMs);
  }
  if (typeof args?.key === "string" && args.key.trim()) preview.key = args.key;
  if (!preview.key && typeof operatorAction?.key === "string" && operatorAction.key.trim()) preview.key = operatorAction.key;
  if (typeof args?.x === "number" && typeof args?.y === "number") {
    preview.target = `${args.x},${args.y}`;
  } else if (typeof operatorAction?.x === "number" && typeof operatorAction?.y === "number") {
    preview.target = `${operatorAction.x},${operatorAction.y}`;
  } else if (typeof operatorAction?.elementId === "number") {
    preview.target = `element ${operatorAction.elementId}`;
  }
  if (requestText?.trim()) preview.request = requestText.slice(0, 160);
  return preview;
}
