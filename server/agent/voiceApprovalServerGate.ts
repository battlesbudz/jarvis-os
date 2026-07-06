type AndroidSubmitGateArgs = Record<string, unknown> | null | undefined;

const ANDROID_EXTERNAL_BOUNDARY_PATTERN =
  /\b(send|reply|respond|post|publish|comment|share|pay|purchase|buy|order|transfer|withdraw|subscribe|submit|save|apply|authorize|confirm|delete|remove|clear|erase|destroy|wipe|book|schedule|reschedule|cancel|connect|disconnect|log in|login|sign in|sign out|logout|password|account)\b/i;

const SUBMIT_KEYS = new Set(["enter", "search", "go", "send", "done"]);

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

function collectGateText(args: AndroidSubmitGateArgs, requestText?: string): string {
  const operatorAction = args?.operatorAction;
  return [
    requestText,
    args?.text,
    args?.label,
    args?.description,
    args?.reason,
    args?.buttonText,
    args?.accessibilityLabel,
    args?.contentDescription,
    operatorAction,
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

  if (action === "android_type" || action === "android_type_text") {
    return args?.submit === true;
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
    if (operatorType === "type_text" && operatorAction?.submit === true) return true;
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
  const preview: Record<string, string> = {
    action,
    reason: "This phone action may submit, send, save, pay, publish, or change external state.",
  };
  if (tool !== action) preview.tool = tool;
  if (typeof args?.text === "string" && args.text.trim()) preview.text = args.text.slice(0, 160);
  if (typeof args?.key === "string" && args.key.trim()) preview.key = args.key;
  if (typeof args?.x === "number" && typeof args?.y === "number") preview.target = `${args.x},${args.y}`;
  if (requestText?.trim()) preview.request = requestText.slice(0, 160);
  return preview;
}
