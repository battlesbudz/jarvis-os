import type { AgentTool, ToolArgs, ToolResult } from "../types";
import {
  isAndroidDaemonActionAllowed,
  isAndroidDaemonActive,
  sendDaemonOp,
} from "../../daemon/bridge";
import type { DaemonOp } from "../../daemon/bridge";
import { storeDaemonScreenshot } from "../../services/coachRuntimeState";
import {
  explainRuntimeCapabilityPreflight,
  preflightAndroidRuntimeCapabilityAction,
  type RuntimeCapabilityAndroidAction,
} from "../../state/runtimeCapability";
import {
  ANDROID_PHONE_RUNTIME_TOOL_NAMES,
} from "../androidPhoneRuntimeToolNames";
import { summarizeAndroidNotificationDetail } from "../androidNotificationSummary";
import { checkAndIncrementScreenshotBudget } from "./androidDaemonToolHelpers";

export { ANDROID_PHONE_RUNTIME_TOOL_NAMES } from "../androidPhoneRuntimeToolNames";
export { summarizeAndroidNotificationDetail } from "../androidNotificationSummary";

type RuntimeOutcome = {
  ok: boolean;
  label: string;
  detail: Record<string, unknown>;
};

type AndroidRuntimeDeps = {
  isAndroidDaemonActionAllowed: typeof isAndroidDaemonActionAllowed;
  isAndroidDaemonActive: typeof isAndroidDaemonActive;
  sendDaemonOp: typeof sendDaemonOp;
};

let androidRuntimeDepsForTesting: Partial<AndroidRuntimeDeps> | null = null;

export function _setAndroidAppRuntimeDepsForTesting(deps: Partial<AndroidRuntimeDeps> | null): void {
  androidRuntimeDepsForTesting = deps;
}

function androidDaemonActive(userId: string): boolean {
  return (androidRuntimeDepsForTesting?.isAndroidDaemonActive ?? isAndroidDaemonActive)(userId);
}

function androidActionAllowed(
  userId: string,
  permission: Parameters<typeof isAndroidDaemonActionAllowed>[1],
): Promise<boolean> {
  return (androidRuntimeDepsForTesting?.isAndroidDaemonActionAllowed ?? isAndroidDaemonActionAllowed)(userId, permission);
}

function sendAndroidDaemonOp(
  userId: string,
  op: DaemonOp,
  timeoutMs?: number,
): ReturnType<typeof sendDaemonOp> {
  return (androidRuntimeDepsForTesting?.sendDaemonOp ?? sendDaemonOp)(userId, op, timeoutMs);
}

export type AndroidAppCatalogEntry = {
  label: string;
  packageName: string;
  aliases: string[];
};

export type ResolvedAndroidApp = AndroidAppCatalogEntry & {
  source: "live_inventory" | "static_catalog";
  matchedAlias?: string;
};

export const STATIC_ANDROID_APP_CATALOG: AndroidAppCatalogEntry[] = [
  { label: "YouTube", packageName: "com.google.android.youtube", aliases: ["youtube", "yt", "you tube"] },
  { label: "Facebook", packageName: "com.facebook.katana", aliases: ["facebook", "fb"] },
  { label: "Facebook Lite", packageName: "com.facebook.lite", aliases: ["facebook lite", "fb lite"] },
  { label: "LinkedIn", packageName: "com.linkedin.android", aliases: ["linkedin", "linked in"] },
  { label: "Instagram", packageName: "com.instagram.android", aliases: ["instagram", "ig", "insta"] },
  { label: "Google Maps", packageName: "com.google.android.apps.maps", aliases: ["maps", "google maps"] },
  { label: "Gmail", packageName: "com.google.android.gm", aliases: ["gmail", "google mail"] },
  { label: "Chrome", packageName: "com.android.chrome", aliases: ["chrome", "google chrome", "browser"] },
  { label: "Spotify", packageName: "com.spotify.music", aliases: ["spotify"] },
  { label: "Reddit", packageName: "com.reddit.frontpage", aliases: ["reddit"] },
  { label: "Discord", packageName: "com.discord", aliases: ["discord"] },
  { label: "Messenger", packageName: "com.facebook.orca", aliases: ["messenger", "facebook messenger"] },
  { label: "WhatsApp", packageName: "com.whatsapp", aliases: ["whatsapp", "whats app"] },
  { label: "Snapchat", packageName: "com.snapchat.android", aliases: ["snapchat", "snap"] },
  { label: "TikTok", packageName: "com.ss.android.ugc.trill", aliases: ["tiktok", "tik tok"] },
  { label: "X", packageName: "com.twitter.android", aliases: ["x", "twitter"] },
  { label: "Settings", packageName: "com.android.settings", aliases: ["settings", "android settings"] },
  { label: "Camera", packageName: "com.android.camera2", aliases: ["camera", "android camera", "aosp camera"] },
  { label: "Camera", packageName: "com.sec.android.app.camera", aliases: ["samsung camera", "galaxy camera"] },
  { label: "Camera", packageName: "com.google.android.GoogleCamera", aliases: ["google camera", "pixel camera"] },
  { label: "Camera", packageName: "com.oneplus.camera", aliases: ["oneplus camera"] },
  { label: "Camera", packageName: "com.motorola.camera3", aliases: ["motorola camera", "moto camera"] },
  { label: "Messages", packageName: "com.samsung.android.messaging", aliases: ["messages", "texts", "text messages"] },
  { label: "Phone", packageName: "com.samsung.android.dialer", aliases: ["phone", "dialer"] },
  { label: "Contacts", packageName: "com.samsung.android.contacts", aliases: ["contacts"] },
  { label: "Calendar", packageName: "com.samsung.android.calendar", aliases: ["calendar"] },
  { label: "Clock", packageName: "com.sec.android.app.clockpackage", aliases: ["clock", "alarm", "timer"] },
  { label: "Calculator", packageName: "com.sec.android.app.popupcalculator", aliases: ["calculator"] },
  { label: "Samsung Notes", packageName: "com.samsung.android.app.notes", aliases: ["notes", "samsung notes"] },
];

const PHONE_ACTION_NAME_HINTS = [
  "android_",
  "phone",
  "screen",
  "screenshot",
  "capture",
  "youtube",
  "you_tube",
  "open_app",
  "tap",
  "swipe",
  "scroll",
  "type_text",
  "notification",
];

export function explainUnsupportedPhoneRuntimeAction(
  name: string,
  kind: "tool" | "daemon_action",
): RuntimeOutcome | null {
  const normalizedName = String(name || "").trim().toLowerCase();
  if (!normalizedName) return null;
  if (!PHONE_ACTION_NAME_HINTS.some((hint) => normalizedName.includes(hint))) return null;

  return {
    ok: false,
    label: "Unsupported phone action",
    detail: {
      attemptedAction: name,
      attemptedKind: kind,
      error: `The requested phone action "${name}" is not available in Jarvis Phone Runtime.`,
      guidance: "Use deterministic Phone Runtime tools instead of invented tool or daemon action names.",
      availablePhoneRuntimeTools: [...ANDROID_PHONE_RUNTIME_TOOL_NAMES],
      examples: [
        "android_open_app_by_name",
        "android_youtube_search",
        "android_capture_screen",
        "android_read_screen_context",
      ],
      deterministic: true,
    },
  };
}

function normalizeAppLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeApps(apps: AndroidAppCatalogEntry[]): AndroidAppCatalogEntry[] {
  const seen = new Set<string>();
  const result: AndroidAppCatalogEntry[] = [];
  for (const app of apps) {
    if (seen.has(app.packageName)) continue;
    seen.add(app.packageName);
    result.push(app);
  }
  return result;
}

function containsNormalizedPhrase(value: string, phrase: string): boolean {
  return value === phrase ||
    value.startsWith(`${phrase} `) ||
    value.endsWith(` ${phrase}`) ||
    value.includes(` ${phrase} `);
}

const GENERIC_APP_CONTEXT_WORDS = new Set(["android", "app", "application", "device", "phone"]);

function scoreAppMatch(query: string, app: AndroidAppCatalogEntry): { score: number; alias?: string } {
  const normalizedQuery = normalizeAppLookup(query);
  if (!normalizedQuery) return { score: 0 };
  const candidates = [app.label, app.packageName, ...app.aliases];
  let best = { score: 0, alias: undefined as string | undefined };

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeAppLookup(candidate);
    if (!normalizedCandidate) continue;
    const isGenericContextWord = GENERIC_APP_CONTEXT_WORDS.has(normalizedCandidate);
    let score = 0;
    if (normalizedCandidate === normalizedQuery) score = 100;
    else if (normalizedQuery.endsWith(` ${normalizedCandidate}`)) score = isGenericContextWord ? 55 : 90;
    else if (normalizedCandidate.startsWith(normalizedQuery)) score = 80;
    else if (normalizedQuery.startsWith(`${normalizedCandidate} `)) score = isGenericContextWord || normalizedCandidate.length <= 3 ? 55 : 75;
    else if (containsNormalizedPhrase(normalizedQuery, normalizedCandidate)) score = isGenericContextWord ? 55 : 70;
    else if (normalizedQuery.length > 2 && normalizedCandidate.includes(normalizedQuery)) score = 60;
    else if (normalizedQuery.includes(normalizedCandidate)) score = normalizedCandidate.length <= 2 ? 0 : (isGenericContextWord ? 45 : 50);
    if (score > best.score) best = { score, alias: candidate };
  }

  return best;
}

function appEntriesFromDaemonData(data: unknown): AndroidAppCatalogEntry[] {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const rawApps = Array.isArray(root.apps) ? root.apps : [];
  return rawApps
    .map((raw): AndroidAppCatalogEntry | null => {
      if (!raw || typeof raw !== "object") return null;
      const app = raw as Record<string, unknown>;
      const label = String(app.label || "").trim();
      const packageName = String(app.packageName || app.package || "").trim();
      if (!label || !packageName) return null;
      return { label, packageName, aliases: [label] };
    })
    .filter((app): app is AndroidAppCatalogEntry => Boolean(app));
}

export async function resolveAndroidAppName(
  userId: string,
  appName: string,
  options: { includeLiveInventory?: boolean } = {},
): Promise<{ app: ResolvedAndroidApp | null; liveInventoryAvailable: boolean; liveInventoryError?: string }> {
  const includeLiveInventory = options.includeLiveInventory ?? true;
  let liveInventoryAvailable = false;
  let liveInventoryError: string | undefined;
  const liveApps: AndroidAppCatalogEntry[] = [];

  if (includeLiveInventory && androidDaemonActive(userId)) {
    try {
      const listResult = await sendAndroidDaemonOp(userId, { type: "android_list_apps" }, 10000);
      if (listResult.ok) {
        liveInventoryAvailable = true;
        liveApps.push(...appEntriesFromDaemonData(listResult.data));
      } else {
        liveInventoryError = listResult.error || "android_list_apps failed";
      }
    } catch (error) {
      liveInventoryError = error instanceof Error ? error.message : String(error);
    }
  }

  const sources: Array<{ source: ResolvedAndroidApp["source"]; apps: AndroidAppCatalogEntry[] }> = [
    { source: "live_inventory", apps: dedupeApps(liveApps) },
    { source: "static_catalog", apps: STATIC_ANDROID_APP_CATALOG },
  ];

  for (const source of sources) {
    let best: { app: AndroidAppCatalogEntry; score: number; alias?: string } | null = null;
    for (const app of source.apps) {
      const match = scoreAppMatch(appName, app);
      if (match.score <= 0) continue;
      if (!best || match.score > best.score) best = { app, score: match.score, alias: match.alias };
    }
    if (best && best.score >= 50) {
      return {
        app: { ...best.app, source: source.source, matchedAlias: best.alias },
        liveInventoryAvailable,
        liveInventoryError,
      };
    }
  }

  return { app: null, liveInventoryAvailable, liveInventoryError };
}

function jsonToolResult(outcome: RuntimeOutcome): ToolResult {
  return {
    ok: outcome.ok,
    label: outcome.label,
    detail: JSON.stringify(outcome.detail),
    content: JSON.stringify({
      ok: outcome.ok,
      label: outcome.label,
      ...outcome.detail,
    }),
  };
}

function jsonObject(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

function compactScreenContext(data: unknown, maxChars = 2500): string {
  const text = typeof data === "string" ? data : JSON.stringify(data ?? {});
  return text.slice(0, maxChars);
}

function daemonDisconnected(): RuntimeOutcome {
  return { ok: false, label: "Android daemon not connected", detail: { error: "Android device control is not connected." } };
}

async function runtimeCapabilityUnavailable(
  userId: string,
  action: RuntimeCapabilityAndroidAction,
): Promise<RuntimeOutcome | null> {
  let preflight;
  try {
    preflight = await preflightAndroidRuntimeCapabilityAction(userId, action);
  } catch (error) {
    console.warn("[AndroidAppRuntime] capability preflight unavailable:", error);
    return null;
  }
  if (preflight.ok) return null;

  const explanation = explainRuntimeCapabilityPreflight(preflight);
  const label = preflight.status === "offline"
    ? "Android daemon not connected"
    : preflight.status === "disabled"
      ? "Permission denied"
      : "Android capability unavailable";
  return {
    ok: false,
    label,
    detail: {
      error: preflight.reason,
      source: preflight.source,
      action: preflight.action,
      status: preflight.status,
      lastCheckedAt: preflight.lastCheckedAt,
      runtimeExplanation: explanation,
    },
  };
}

async function permissionDenied(userId: string, permission: Parameters<typeof isAndroidDaemonActionAllowed>[1]): Promise<RuntimeOutcome | null> {
  if (await androidActionAllowed(userId, permission)) return null;
  return {
    ok: false,
    label: "Permission denied",
    detail: { error: `${permission} permission is not enabled.` },
  };
}

function numberArg(args: ToolArgs, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readScreenIfAllowed(userId: string): Promise<Record<string, unknown>> {
  if (!(await androidActionAllowed(userId, "android_read_screen"))) {
    return { screenContextAvailable: false, screenContextError: "android_read_screen permission is not enabled" };
  }
  const readResult = await sendAndroidDaemonOp(userId, { type: "android_read_screen" }, 10000);
  if (!readResult.ok) {
    return { screenContextAvailable: false, screenContextError: readResult.error || "android_read_screen failed" };
  }
  return {
    screenContextAvailable: true,
    screenContextSource: "android_read_screen_accessibility_tree",
    screenContext: compactScreenContext(readResult.data),
  };
}

export async function runAndroidCaptureScreen(args: ToolArgs, userId: string, budgetCtx?: object): Promise<RuntimeOutcome> {
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_capture_screen");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const permissionError = await permissionDenied(userId, "android_screenshot");
  if (permissionError) return permissionError;
  if (!checkAndIncrementScreenshotBudget(budgetCtx)) {
    return {
      ok: false,
      label: "Screenshot limit reached",
      detail: {
        error: "Screenshot limit reached for this turn (max 4). Use android_read_screen_context to read the current screen content as text because it returns the accessibility tree without requiring another screenshot.",
      },
    };
  }

  const screenshotResult = await sendAndroidDaemonOp(userId, { type: "android_screenshot" }, 20000);
  if (!screenshotResult.ok) {
    return {
      ok: false,
      label: "Screen capture failed",
      detail: { error: screenshotResult.error || "android_screenshot failed" },
    };
  }

  const data = jsonObject(screenshotResult.data);
  const screenshotBase64 = typeof data.screenshot === "string" ? data.screenshot : "";
  if (!screenshotBase64) {
    return {
      ok: false,
      label: "Screen capture failed",
      detail: { error: "Android daemon did not return screenshot data." },
    };
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  storeDaemonScreenshot(id, Buffer.from(screenshotBase64, "base64"));
  const screenContext = await readScreenIfAllowed(userId);
  return {
    ok: true,
    label: "Temporary screen capture",
    detail: {
      screenshotUrl: `/api/daemon/screenshot/${id}`,
      attachmentKind: "temporary_chat_screen_capture",
      galleryPersistence: "temporary_chat_preview; direct capture is not intended to save to Gallery, but Android fallback cleanup is best-effort",
      userFacingSummary: "Attached to this chat as a temporary preview; Gallery save is not intended. Jarvis reads the accessibility screen context for local reasoning.",
      expiresMinutes: 30,
      modelCanSeeImagePixels: false,
      modelUseNote: "The user sees the image preview inline in chat. Use screenContext to understand the current screen; the local model cannot inspect screenshot pixels from the URL directly.",
      ...screenContext,
      note: typeof args.reason === "string" ? args.reason : undefined,
    },
  };
}

export async function runAndroidReadScreenContext(_args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_read_screen");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const permissionError = await permissionDenied(userId, "android_read_screen");
  if (permissionError) return permissionError;
  const readResult = await sendAndroidDaemonOp(userId, { type: "android_read_screen" }, 10000);
  if (!readResult.ok) {
    return { ok: false, label: "Screen read failed", detail: { error: readResult.error || "android_read_screen failed" } };
  }
  return {
    ok: true,
    label: "Screen context read",
    detail: {
      screenContextAvailable: true,
      screenContextSource: "android_read_screen_accessibility_tree",
      screenContext: compactScreenContext(readResult.data, 5000),
    },
  };
}

export async function runAndroidTapScreen(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_tap_type");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const permissionError = await permissionDenied(userId, "android_tap_type");
  if (permissionError) return permissionError;
  const x = numberArg(args, "x");
  const y = numberArg(args, "y");
  if (x === null || y === null) return { ok: false, label: "x/y required", detail: { error: "Provide numeric x and y screen coordinates." } };
  const tapResult = await sendAndroidDaemonOp(userId, { type: "android_tap", x, y }, 6000);
  if (!tapResult.ok) return { ok: false, label: "Tap failed", detail: { x, y, error: tapResult.error || "android_tap failed" } };
  const screenContext = args.readAfter === false ? {} : await readScreenIfAllowed(userId);
  return { ok: true, label: `Tapped ${x},${y}`, detail: { x, y, daemonResult: tapResult.data ?? {}, ...screenContext } };
}

export async function runAndroidTypeText(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_tap_type");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const permissionError = await permissionDenied(userId, "android_tap_type");
  if (permissionError) return permissionError;
  const text = String(args.text || "").trim();
  if (!text) return { ok: false, label: "text required", detail: { error: "Provide text to type." } };
  const submit = Boolean(args.submit);
  const typeResult = await sendAndroidDaemonOp(userId, { type: "android_type", text, submit }, 10000);
  if (!typeResult.ok) return { ok: false, label: "Type failed", detail: { submit, error: typeResult.error || "android_type failed" } };
  const screenContext = args.readAfter === false ? {} : await readScreenIfAllowed(userId);
  return { ok: true, label: submit ? "Typed text and submitted" : "Typed text", detail: { submit, daemonResult: typeResult.data ?? {}, ...screenContext } };
}

export async function runAndroidSwipeScreen(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_tap_type");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const permissionError = await permissionDenied(userId, "android_tap_type");
  if (permissionError) return permissionError;
  const x1 = numberArg(args, "x1");
  const y1 = numberArg(args, "y1");
  const x2 = numberArg(args, "x2");
  const y2 = numberArg(args, "y2");
  if ([x1, y1, x2, y2].some((value) => value === null)) {
    return { ok: false, label: "swipe coordinates required", detail: { error: "Provide numeric x1, y1, x2, and y2." } };
  }
  const durationMs = Math.min(Math.max(numberArg(args, "durationMs") ?? 300, 100), 3000);
  const swipeResult = await sendAndroidDaemonOp(userId, { type: "android_swipe", x1: x1!, y1: y1!, x2: x2!, y2: y2!, durationMs }, 6000);
  if (!swipeResult.ok) return { ok: false, label: "Swipe failed", detail: { error: swipeResult.error || "android_swipe failed" } };
  const screenContext = args.readAfter === false ? {} : await readScreenIfAllowed(userId);
  return { ok: true, label: "Swiped screen", detail: { x1, y1, x2, y2, durationMs, daemonResult: swipeResult.data ?? {}, ...screenContext } };
}

export async function runAndroidPressPhoneKey(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_tap_type");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const permissionError = await permissionDenied(userId, "android_tap_type");
  if (permissionError) return permissionError;
  const allowedKeys = ["back", "home", "recents", "volume_up", "volume_down", "enter"] as const;
  const key = String(args.key || "back") as typeof allowedKeys[number];
  if (!allowedKeys.includes(key)) {
    return { ok: false, label: "invalid key", detail: { error: `key must be one of: ${allowedKeys.join(", ")}` } };
  }
  const keyResult = await sendAndroidDaemonOp(userId, { type: "android_press_key", key }, 5000);
  if (!keyResult.ok) return { ok: false, label: "Key press failed", detail: { key, error: keyResult.error || "android_press_key failed" } };
  const screenContext = args.readAfter === false ? {} : await readScreenIfAllowed(userId);
  return { ok: true, label: `Pressed ${key}`, detail: { key, daemonResult: keyResult.data ?? {}, ...screenContext } };
}

export async function runAndroidWaitForUi(args: ToolArgs, _userId: string): Promise<RuntimeOutcome> {
  const ms = Math.min(Math.max(numberArg(args, "ms") ?? 1500, 200), 10000);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return { ok: true, label: `Waited ${ms}ms`, detail: { ms } };
}

export async function runAndroidReadNotifications(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_read_notifications");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const limit = Math.min(Math.max(numberArg(args, "limit") ?? 20, 1), 60);
  const notificationResult = await sendAndroidDaemonOp(userId, { type: "android_notifications_list", limit }, 10000);
  if (notificationResult.ok) {
    const data = jsonObject(notificationResult.data);
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];
    if (data.listenerEnabled && notifications.length === 0) {
      return {
        ok: true,
        label: "No notifications",
        detail: {
          notifications: [],
          source: "notification_listener",
          userFacingSummary: "I checked your Android notifications. The notification listener is active and reports zero current notifications.",
        },
      };
    }
    if (notifications.length > 0) {
      const detail = { notifications, source: "notification_listener" };
      return {
        ok: true,
        label: `${notifications.length} notifications`,
        detail: {
          ...detail,
          userFacingSummary: summarizeAndroidNotificationDetail(detail),
        },
      };
    }
  }

  const readPermissionError = await permissionDenied(userId, "android_read_screen");
  if (readPermissionError) return readPermissionError;
  const tapPermissionError = await permissionDenied(userId, "android_tap_type");
  if (tapPermissionError) return tapPermissionError;
  const swipeResult = await sendAndroidDaemonOp(userId, { type: "android_swipe", x1: 540, y1: 10, x2: 540, y2: 1200, durationMs: 400 }, 8000);
  if (!swipeResult.ok) {
    return { ok: false, label: "Cannot open notification shade", detail: { error: swipeResult.error || "android_swipe failed" } };
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
  const shadeReadResult = await sendAndroidDaemonOp(userId, { type: "android_read_screen" }, 10000);
  sendAndroidDaemonOp(userId, { type: "android_press_key", key: "back" }, 5000).catch(() => {});
  if (!shadeReadResult.ok) {
    return { ok: false, label: "Could not read notification shade", detail: { error: shadeReadResult.error || "android_read_screen failed" } };
  }
  const shadeDetail = {
    source: "notification_shade_accessibility_tree",
    screenContext: compactScreenContext(shadeReadResult.data, 5000),
  };
  return {
    ok: true,
    label: "Notification shade read",
    detail: {
      ...shadeDetail,
      userFacingSummary: summarizeAndroidNotificationDetail(shadeDetail),
    },
  };
}

export async function runAndroidNotifyUser(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const title = String(args.title || "Jarvis").trim() || "Jarvis";
  const body = String(args.body || "").trim();
  if (!body) return { ok: false, label: "body required", detail: { error: "Provide notification body text." } };
  const notifyResult = await sendAndroidDaemonOp(userId, { type: "android_notify", title, body }, 5000);
  if (!notifyResult.ok) return { ok: false, label: "Notification failed", detail: { title, body, error: notifyResult.error || "notify failed" } };
  return { ok: true, label: "Notification sent", detail: { title, body, daemonResult: notifyResult.data ?? {} } };
}

export async function runAndroidReturnToJarvisChat(_args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const returnResult = await sendAndroidDaemonOp(userId, { type: "android_return_to_jarvis" }, 10000);
  if (!returnResult.ok) return { ok: false, label: "Return to Jarvis failed", detail: { error: returnResult.error || "android_return_to_jarvis failed" } };
  return { ok: true, label: "Returned to Jarvis", detail: { daemonResult: returnResult.data ?? {} } };
}

export async function runAndroidOpenAppByName(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const appName = String(args.appName || args.app_name || args.name || "").trim();
  if (!appName) {
    return { ok: false, label: "appName required", detail: { error: "Provide appName, e.g. Facebook or LinkedIn." } };
  }
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_open_app");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) {
    return { ok: false, label: "Android daemon not connected", detail: { error: "Android device control is not connected." } };
  }
  if (!(await androidActionAllowed(userId, "android_open_app"))) {
    return { ok: false, label: "Permission denied", detail: { error: "android_open_app permission is not enabled." } };
  }

  const resolved = await resolveAndroidAppName(userId, appName);
  if (!resolved.app) {
    return {
      ok: false,
      label: "App not found",
      detail: {
        requestedApp: appName,
        liveInventoryAvailable: resolved.liveInventoryAvailable,
        liveInventoryError: resolved.liveInventoryError,
        error: `Could not resolve an installed Android app named "${appName}".`,
      },
    };
  }

  const openResult = await sendAndroidDaemonOp(userId, {
    type: "android_open_app",
    packageName: resolved.app.packageName,
  }, 20000);
  if (!openResult.ok) {
    return {
      ok: false,
      label: `Open ${resolved.app.label} failed`,
      detail: {
        requestedApp: appName,
        resolvedApp: resolved.app,
        error: openResult.error || "android_open_app failed",
      },
    };
  }

  const screenContext = await readScreenIfAllowed(userId);
  return {
    ok: true,
    label: `Opened ${resolved.app.label}`,
    detail: {
      requestedApp: appName,
      resolvedApp: resolved.app,
      daemonResult: openResult.data ?? {},
      ...screenContext,
    },
  };
}

export function buildAndroidYoutubeSearchUrl(query: string): string {
  return `vnd.youtube://results?search_query=${encodeURIComponent(query)}`;
}

export async function runAndroidYoutubeSearch(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const query = String(args.query || args.searchQuery || args.search_query || "").trim();
  if (!query) {
    return { ok: false, label: "query required", detail: { error: "Provide query, e.g. local Gemma on Android videos." } };
  }
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_browse");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) {
    return { ok: false, label: "Android daemon not connected", detail: { error: "Android device control is not connected." } };
  }

  if (!(await androidActionAllowed(userId, "android_browse"))) {
    return {
      ok: false,
      label: "Permission denied",
      detail: { error: "Missing Android permission: android_browse." },
    };
  }

  const resolved = await resolveAndroidAppName(userId, "YouTube");
  const url = buildAndroidYoutubeSearchUrl(query);
  const browseResult = await sendAndroidDaemonOp(userId, { type: "android_browse", url }, 20000);
  if (!browseResult.ok) {
    return {
      ok: false,
      label: "YouTube search failed",
      detail: {
        query,
        url,
        resolvedApp: resolved.app,
        error: browseResult.error || "android_browse failed",
      },
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 2200));
  const screenContext = await readScreenIfAllowed(userId);
  return {
    ok: true,
    label: `YouTube search: ${query.slice(0, 48)}`,
    detail: {
      query,
      url,
      resolvedApp: resolved.app,
      daemonResult: browseResult.data ?? {},
      verification: "Opened native YouTube search results via deep link.",
      ...screenContext,
    },
  };
}

export async function runAndroidOpenPhoneUrl(args: ToolArgs, userId: string): Promise<RuntimeOutcome> {
  const url = String(args.url || "").trim();
  if (!url) {
    return { ok: false, label: "url required", detail: { error: "Provide a URL or Android deep link to open." } };
  }
  const capabilityError = await runtimeCapabilityUnavailable(userId, "android_browse");
  if (capabilityError) return capabilityError;
  if (!androidDaemonActive(userId)) return daemonDisconnected();
  const permissionError = await permissionDenied(userId, "android_browse");
  if (permissionError) return permissionError;

  const browseResult = await sendAndroidDaemonOp(userId, { type: "android_browse", url }, 20000);
  if (!browseResult.ok) {
    return { ok: false, label: "Open URL failed", detail: { url, error: browseResult.error || "android_browse failed" } };
  }

  await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(numberArg(args, "waitMs") ?? 1500, 0), 10000)));
  const screenContext = args.readAfter === false ? {} : await readScreenIfAllowed(userId);
  return {
    ok: true,
    label: "Opened phone URL",
    detail: {
      url,
      daemonResult: browseResult.data ?? {},
      ...screenContext,
    },
  };
}

export const androidOpenAppByNameTool: AgentTool = {
  name: "android_open_app_by_name",
  description: "Deterministically open an installed Android app by human name. Resolves labels such as Facebook, LinkedIn, YouTube, Maps, or Gmail against the phone's live app inventory when available, with static fallbacks. Prefer this over daemon_action android_open_app when the user gives an app name instead of a package name.",
  parameters: {
    type: "object",
    properties: {
      appName: {
        type: "string",
        description: "Human app name, e.g. Facebook, LinkedIn, YouTube, Gmail, Maps.",
      },
    },
    required: ["appName"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidOpenAppByName(args, ctx.userId));
  },
};

export const androidYoutubeSearchTool: AgentTool = {
  name: "android_youtube_search",
  description: "Phone-control runtime skill: search inside the native YouTube app using a deterministic deep link, wait for the UI to settle, then read the visible screen/accessibility context. Use for requests like 'Search YouTube for local Gemma Android videos'. This operates the user's phone locally; it is not the server-side research search_youtube tool.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The YouTube search query to submit in the native app.",
      },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidYoutubeSearch(args, ctx.userId));
  },
};

export const androidOpenPhoneUrlTool: AgentTool = {
  name: "android_open_phone_url",
  description: "Phone Runtime: open a URL or Android deep link on the phone, then read visible screen context. Use this for deterministic links such as vnd.youtube://watch?v=VIDEO_ID, geo:0,0?q=QUERY, spotify:search:QUERY, or ordinary https URLs.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL or Android deep link to open on the phone." },
      waitMs: { type: "number", description: "Milliseconds to wait after opening before reading screen context. Default 1500." },
      readAfter: { type: "boolean", description: "If false, skip the automatic screen read after opening." },
    },
    required: ["url"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidOpenPhoneUrl(args, ctx.userId));
  },
};

export const androidCaptureScreenTool: AgentTool = {
  name: "android_capture_screen",
  description: "Phone Runtime: capture the current Android screen as a temporary inline chat preview, then read the accessibility screen context for model reasoning. Direct capture is not intended to save to Gallery, but Android fallback capture cleanup is best-effort.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Short reason for the capture, used only for audit/debug context.",
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidCaptureScreen(args, ctx.userId, ctx));
  },
};

export const androidReadScreenContextTool: AgentTool = {
  name: "android_read_screen_context",
  description: "Phone Runtime: read the visible Android UI using the accessibility tree. Prefer this before describing screen content or when screenshots are blocked by FLAG_SECURE apps.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidReadScreenContext(args, ctx.userId));
  },
};

export const androidTapScreenTool: AgentTool = {
  name: "android_tap_screen",
  description: "Phone Runtime: tap an exact screen coordinate on the Android device, then read the visible screen context unless readAfter is false.",
  parameters: {
    type: "object",
    properties: {
      x: { type: "number", description: "X pixel coordinate." },
      y: { type: "number", description: "Y pixel coordinate." },
      readAfter: { type: "boolean", description: "If false, skip the automatic screen read after tapping." },
    },
    required: ["x", "y"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidTapScreen(args, ctx.userId));
  },
};

export const androidTypeTextTool: AgentTool = {
  name: "android_type_text",
  description: "Phone Runtime: type text into the focused Android field, optionally submitting with the keyboard action, then read screen context unless readAfter is false.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to type into the focused field." },
      submit: { type: "boolean", description: "If true, press the IME Search/Go/Enter action after typing." },
      readAfter: { type: "boolean", description: "If false, skip the automatic screen read after typing." },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidTypeText(args, ctx.userId));
  },
};

export const androidSwipeScreenTool: AgentTool = {
  name: "android_swipe_screen",
  description: "Phone Runtime: perform a swipe gesture on the Android screen, then read screen context unless readAfter is false.",
  parameters: {
    type: "object",
    properties: {
      x1: { type: "number", description: "Swipe start X coordinate." },
      y1: { type: "number", description: "Swipe start Y coordinate." },
      x2: { type: "number", description: "Swipe end X coordinate." },
      y2: { type: "number", description: "Swipe end Y coordinate." },
      durationMs: { type: "number", description: "Swipe duration in milliseconds, clamped to 100-3000." },
      readAfter: { type: "boolean", description: "If false, skip the automatic screen read after swiping." },
    },
    required: ["x1", "y1", "x2", "y2"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidSwipeScreen(args, ctx.userId));
  },
};

export const androidPressPhoneKeyTool: AgentTool = {
  name: "android_press_phone_key",
  description: "Phone Runtime: press a supported Android system key such as back, home, recents, or enter, then read screen context unless readAfter is false.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        enum: ["back", "home", "recents", "volume_up", "volume_down", "enter"],
        description: "Android key to press.",
      },
      readAfter: { type: "boolean", description: "If false, skip the automatic screen read after pressing the key." },
    },
    required: ["key"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidPressPhoneKey(args, ctx.userId));
  },
};

export const androidWaitForUiTool: AgentTool = {
  name: "android_wait_for_ui",
  description: "Phone Runtime: wait for Android UI animations or network loading to settle before the next phone action.",
  parameters: {
    type: "object",
    properties: {
      ms: { type: "number", description: "Milliseconds to wait, clamped to 200-10000. Default 1500." },
    },
    required: [],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidWaitForUi(args, ctx.userId));
  },
};

export const androidReadNotificationsTool: AgentTool = {
  name: "android_read_notifications",
  description: "Phone Runtime: read current Android notifications. Uses the notification listener when available and falls back to opening/reading the notification shade through accessibility.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Maximum notifications to return, 1-60. Default 20." },
    },
    required: [],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidReadNotifications(args, ctx.userId));
  },
};

export const androidNotifyUserTool: AgentTool = {
  name: "android_notify_user",
  description: "Phone Runtime: send a local Android notification banner to the user at the end of a multi-step phone task.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Notification title. Default Jarvis." },
      body: { type: "string", description: "One-line notification body." },
    },
    required: ["body"],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidNotifyUser(args, ctx.userId));
  },
};

export const androidReturnToJarvisChatTool: AgentTool = {
  name: "android_return_to_jarvis_chat",
  description: "Phone Runtime: return the Android device to the Jarvis app/chat surface after completing a multi-step phone task.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(args, ctx) {
    return jsonToolResult(await runAndroidReturnToJarvisChat(args, ctx.userId));
  },
};

export const androidPhoneRuntimeTools: AgentTool[] = [
  androidOpenAppByNameTool,
  androidYoutubeSearchTool,
  androidOpenPhoneUrlTool,
  androidCaptureScreenTool,
  androidReadScreenContextTool,
  androidTapScreenTool,
  androidTypeTextTool,
  androidSwipeScreenTool,
  androidPressPhoneKeyTool,
  androidWaitForUiTool,
  androidReadNotificationsTool,
  androidNotifyUserTool,
  androidReturnToJarvisChatTool,
];
