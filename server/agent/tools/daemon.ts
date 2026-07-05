import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import {
  sendDaemonOp,
  isUserPaired,
  isDaemonActionAllowed,
  isAndroidDaemonActionAllowed,
  isAndroidDaemonActive,
  isDesktopDaemonActive,
  clearVoiceNotificationObservation,
  recordVoiceNotificationObservation,
  type DaemonAction,
  type AndroidDaemonAction,
  type DaemonOp,
} from "../../daemon/bridge";
import { checkAndIncrementScreenshotBudget } from "./daemonShellTool";

const DESKTOP_ACTIONS: readonly DaemonAction[] = ["shell", "notify", "file_read", "file_write", "file_list", "desktop_screenshot", "desktop_read_screen"] as const;
const ANDROID_ACTIONS: readonly string[] = [
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
] as const;

function isDesktopAction(value: string): value is DaemonAction {
  return (DESKTOP_ACTIONS as readonly string[]).includes(value);
}

function isAndroidAction(value: string): boolean {
  return ANDROID_ACTIONS.includes(value);
}

// Map android action -> permission key
function androidPermKey(action: string): AndroidDaemonAction | null {
  if (action === "android_screenshot") return "android_screenshot";
  if (action === "android_read_screen") return "android_read_screen";
  if (action === "android_screen_context") return "android_read_screen";
  if (action === "android_open_app") return "android_open_app";
  if (action === "android_browse") return "android_browse";
  if (action === "android_file_list") return "android_file_list";
  if (action === "android_file_read") return "android_file_read";
  if (action === "android_file_search") return "android_file_list";
  if (action === "android_open_file") return "android_file_list";
  if (action === "android_copy_to_clipboard") return "android_file_list";
  if (action === "android_tap" || action === "android_type" || action === "android_swipe" || action === "android_press_key") return "android_tap_type";
  if (action === "android_notification_reply") return "android_tap_type";
  if (action === "android_camera_snap" || action === "android_camera_clip") return "android_camera";
  if (action === "android_location_get") return "android_location";
  if (action === "android_sms_send") return "android_sms";
  if (action === "android_screen_record") return "android_screen_record";
  if (action === "android_view_hierarchy") return "android_read_screen";
  if (action === "android_paste_text") return "android_tap_type";
  if (action === "android_get_focused_field") return "android_tap_type";
  return null;
}

function operatorActionPermKey(operatorAction: Record<string, unknown>): AndroidDaemonAction | null {
  switch (operatorAction.type) {
    case "open_app": return "android_open_app";
    case "tap_element":
    case "tap_coordinates":
    case "type_text":
    case "swipe":
    case "press_key": return "android_tap_type";
    case "wait":
    case "done": return null;
    default: return "android_tap_type";
  }
}

function jsonErrorContent(error: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: false, error, ...extra });
}

export const daemonActionTool: AgentTool = {
  name: "daemon_action",
  description: `Execute a sandboxed action on the user's paired daemon — either a desktop daemon or an Android device daemon.

DESKTOP actions (available when a desktop daemon is paired):
- shell: run a shell command in the workspace root
- notify: send a desktop notification
- file_read: read a text file under the workspace root
- file_write: write a text file under the workspace root
- file_list: list files in a directory under the workspace root
- desktop_screenshot: capture the primary display as a base64-encoded PNG; use this to see what is currently on screen
- desktop_read_screen: capture the screen and extract all visible text via OCR (Tesseract); returns raw text if Tesseract is available, otherwise returns the base64 screenshot only

ANDROID actions (available when an Android device daemon is paired):
- android_open_app: launch an Android app by package name (e.g. "com.google.android.youtube") — confirm with user before launching
- android_browse: open a URL in the default browser
- android_screenshot: capture the current screen as a base64 PNG image.
  CRITICAL — only screenshot when you have confirmed the target content is visible (via android_read_screen). Never screenshot immediately after navigating; always verify first. After capturing, reason from the returned screen/accessibility context unless a vision/OCR path has explicitly provided image details — never invent or summarise content you cannot directly inspect.
- android_read_screen: return the visible text and UI element tree via accessibility.
  Call this immediately after any navigation (android_browse, android_open_app) and after every scroll to understand what is currently on screen before acting.
- android_screen_context: return a structured accessibility-first screen context with stable per-capture element ids, bounds, traits, redaction, and risk hints. Prefer this for operator-style UI navigation before screenshots.
- android_operator_action: execute one narrow operator action through the Android daemon. Payload goes in operatorAction and must use one of: tap_element, tap_coordinates, type_text, swipe, press_key, open_app, wait, done.
- android_tap: tap at x/y pixel coordinates on the screen. Use android_read_screen first to identify the correct coordinates of the element you want to tap.
- android_type: type text using the accessibility service. After typing a search query into a search bar, always follow immediately with \`android_press_key\` {key: \'enter\'} to submit — do not wait for results to appear on their own. Alternatively, use \`android_search_in_app\` which handles the full open → type → submit flow automatically.
- android_swipe: swipe from (x1,y1) to (x2,y2). For scrolling DOWN (reveal content below): x1=540, y1=1600, x2=540, y2=400, durationMs=500. For scrolling UP (reveal content above): x1=540, y1=400, x2=540, y2=1600, durationMs=500. Always call android_read_screen after each swipe to check what became visible before deciding to scroll again.
- android_press_key: press a system key — "back", "home", "recents", "volume_up", "volume_down"
- android_file_list: list files in any path on the device (gallery, downloads, any folder)
- android_file_read: read any file on the device
- android_notifications_list: read current phone notifications, falling back to the notification shade if listener access is disabled
- android_wait: pause server-side for a short UI-settle delay between Android actions
- android_return_to_jarvis: return the phone to the Jarvis app/chat surface
- android_file_search: recursively search for files by name across the device storage — accepts query (substring match), optional root path (defaults to external storage root), optional type filter (image/video/audio/document/any), optional maxDepth (default 4, max 8); returns up to 100 matches with name/path/size/lastModified
- android_open_file: open a file in its native app (e.g. gallery for images) using an ACTION_VIEW Intent — accepts an absolute file path
- android_copy_to_clipboard: copy an image file to the Android clipboard so it can be pasted into Telegram, WhatsApp, or any app that supports image paste — accepts an absolute image file path; falls back gracefully if the target app doesn't support paste
- android_notification_reply: send an inline reply to a notification that exposes a RemoteInput reply action — requires notificationKey (from android_notifications_list), replyText, and approved: true; only works on notifications where hasReplyAction is true; TWO-STEP FLOW: first call without approved to get the confirmation prompt, show the exact reply text to the user, then call again with approved: true once the user has explicitly agreed
- android_camera_snap: take a photo with the device camera — specify facing (front/back, default back); returns base64 JPEG; requires the Jarvis app to be in the foreground and Camera permission granted in daemon settings
- android_camera_clip: record a short video clip from the camera — specify facing (front/back), durationMs (max 30000 ms, default 5000), audio (boolean); returns base64 MP4; REQUIRES explicit user confirmation (privacy-sensitive); app must be foregrounded
- android_location_get: get the device's current GPS coordinates — specify accuracy (coarse/precise, default precise) and optional maxAgeMs (accept cached fix if fresh enough); works in background; returns lat/lng/accuracy/provider
- android_sms_send: send an SMS text message on behalf of the user — requires to (phone number), message (text body); REQUIRES explicit user confirmation showing exact recipient and message text before sending; approved must be true
- android_screen_record: record the phone screen as an MP4 clip — specify durationMs (max 60000 ms, default 10000), fps (default 15), audio (boolean); returns base64 MP4; REQUIRES explicit user confirmation; app must be foregrounded
- android_view_hierarchy: dump the full UI element hierarchy using the accessibility tree; returns a JSON array of every on-screen element with resource-id, content-desc, text, bounds ([x1,y1][x2,y2] pixel coordinates), and clickable/focusable/scrollable flags; use this when android_read_screen doesn't expose element coordinates or when you need to find unlabeled UI elements like icon-only buttons
- android_paste_text: paste text into the currently focused field using clipboard paste as primary method and adb shell input text as fallback — requires text; optional fieldDescription for logging; returns { ok, verified, method_used, field_text }. Use this when android_type fails silently or when the field uses a custom input method (e.g. Facebook search bar). NOTE: For the Facebook search bar and other fields with custom IMEs, android_type may silently fail — use android_paste_text instead, then follow immediately with android_press_key {key: 'enter'} to submit.
- android_get_focused_field: lightweight accessibility check that returns the currently focused input field's text, hint, and resource-id without doing a full hierarchy dump — use before typing to confirm focus

VISUAL BROWSING WORKFLOW — follow this for any task that involves reading or screenshotting content in an app or browser:
1. Navigate: android_browse or android_open_app
2. Read: android_read_screen — understand what is currently visible
3. Check: is the target content (posts, articles, buttons) visible in the element tree?
4. If NOT visible: android_swipe to scroll down (x1=540, y1=1600, x2=540, y2=400, durationMs=500), then go back to step 2
5. Repeat steps 3-4 up to 5 times maximum — stop and report to the user if content is still not found after 5 scrolls
6. When target IS visible (confirmed in read_screen output) and the user needs a visual preview: android_screenshot
7. Use the returned screen/accessibility context for reasoning. Describe pixels only when a vision/OCR path has explicitly provided visual details — no assumptions about off-screen content
8. If target never becomes visible: report back to the user and suggest alternatives (e.g. "I scrolled through the page but couldn't find any posts — the page may require interaction or may be behind a login")

Never skip step 2. Never screenshot before confirming visibility. Never describe content that is not visible in the returned screen context or explicit visual details.

SCREEN READING PREFERENCE: Always prefer android_read_screen for understanding the current screen state — it reads the accessibility tree instantly without using screenshot capture. Only use android_screenshot when you genuinely need a visual chat preview or visual evidence that the accessibility tree cannot describe. Jarvis chat screenshots are temporary inline previews; Android fallback capture paths may briefly use Gallery/MediaStore before cleanup, so do not promise Gallery persistence behavior unless the daemon reports it. Taking one purely for navigation still wastes time and adds latency.

IN-APP SEARCH — IMPORTANT: If the user asks you to search for something inside a specific app (e.g. "search for John on Facebook", "find a recipe in Instagram"), use the android_search_in_app tool instead of manually chaining android_open_app → android_tap → android_type. android_search_in_app handles the full sequence (open, wait for load, login-wall detection, locate search bar, tap, type, submit) and returns structured error recovery info if any step fails. If you have already typed a query manually and the search did not trigger results, press android_press_key {key: 'enter'} immediately — do not take a screenshot or call android_read_screen first; submit the query right away.

RETRY AFTER PARTIAL FAILURE: When android_search_in_app returns ok=false, it always includes step_reached (the step number where the failure occurred) and error_at_step (a short label for the failure type). You can retry independently without restarting from scratch by calling android_search_in_app again with resume_from_step set to the step_reached value from the failure response. This skips the app-open and load-wait steps so recovery is fast. For example: if step_reached=3, call with resume_from_step: 3 to re-attempt only the search-bar tap. Only restart from step 1 (omit resume_from_step) if the app needs to be reopened (e.g. login wall, app crash). Always read the suggestion field in the failure response — it will tell you the right recovery action for the specific failure.

Always confirm with the user before tap/type/swipe actions and before android_notification_reply, android_sms_send, android_camera_clip, and android_screen_record. Use android_read_screen or android_screenshot to understand context before acting. Require confirmation before any destructive shell or file_write actions. When an Android daemon is paired, prefer android_* actions. Returns the daemon's response or an error if not paired.`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "shell", "notify", "file_read", "file_write", "file_list",
          "desktop_screenshot", "desktop_read_screen",
          "android_open_app", "android_browse", "android_screenshot", "android_read_screen",
          "android_screen_context", "android_operator_action",
          "android_tap", "android_type", "android_swipe", "android_press_key",
          "android_file_list", "android_file_read", "android_notifications_list",
          "android_wait", "android_return_to_jarvis",
          "android_file_search", "android_open_file", "android_copy_to_clipboard",
          "android_notification_reply",
          "android_camera_snap", "android_camera_clip",
          "android_location_get", "android_sms_send", "android_screen_record",
          "android_view_hierarchy",
          "android_paste_text", "android_get_focused_field",
        ],
      },
      cmd: { type: "string", description: "Shell command (when action is 'shell')" },
      cwd: { type: "string", description: "Optional working directory relative to workspace root" },
      title: { type: "string", description: "Notification title (when action is 'notify')" },
      body: { type: "string", description: "Notification body (when action is 'notify')" },
      path: { type: "string", description: "File or directory path (desktop: relative to workspace; android: absolute device path)" },
      content: { type: "string", description: "Text content (when action is 'file_write')" },
      timeoutMs: { type: "number", description: "Optional timeout in ms (default 15000)" },
      packageName: { type: "string", description: "Android app package name (when action is 'android_open_app')" },
      url: { type: "string", description: "URL to open (when action is 'android_browse')" },
      x: { type: "number", description: "X coordinate in pixels (when action is 'android_tap')" },
      y: { type: "number", description: "Y coordinate in pixels (when action is 'android_tap')" },
      text: { type: "string", description: "Text to type (when action is 'android_type')" },
      x1: { type: "number", description: "Swipe start X (when action is 'android_swipe')" },
      y1: { type: "number", description: "Swipe start Y (when action is 'android_swipe')" },
      x2: { type: "number", description: "Swipe end X (when action is 'android_swipe')" },
      y2: { type: "number", description: "Swipe end Y (when action is 'android_swipe')" },
      durationMs: { type: "number", description: "Swipe duration in ms (when action is 'android_swipe', default 300)" },
      ms: { type: "number", description: "Milliseconds to pause (when action is 'android_wait', default 1500, max 10000)" },
      key: { type: "string", enum: ["back", "home", "recents", "volume_up", "volume_down", "enter"], description: "System key (when action is 'android_press_key'). 'enter' presses the IME action key (Search/Go/Done)." },
      query: { type: "string", description: "Search term — substring match against filename (when action is 'android_file_search')" },
      root: { type: "string", description: "Root path to start search from (when action is 'android_file_search', defaults to external storage root)" },
      fileType: { type: "string", enum: ["image", "video", "audio", "document", "any"], description: "File type filter (when action is 'android_file_search', default 'any')" },
      maxDepth: { type: "number", description: "Maximum directory depth to recurse (when action is 'android_file_search', default 4, max 8)" },
      limit: { type: "number", description: "Maximum notifications to return (when action is 'android_notifications_list')" },
      notificationKey: { type: "string", description: "Notification status-bar key from android_notifications_list (when action is 'android_notification_reply')" },
      replyText: { type: "string", description: "The reply text to send inline (when action is 'android_notification_reply')" },
      approved: { type: "boolean", description: "Must be true for android_notification_reply and android_sms_send — set only after the user has explicitly confirmed in the conversation" },
      facing: { type: "string", enum: ["front", "back", "both"], description: "Camera facing direction (when action is 'android_camera_snap': front/back/both returns one or both images; android_camera_clip: front/back only; default 'back')" },
      audio: { type: "boolean", description: "Whether to record audio (when action is 'android_camera_clip' or 'android_screen_record')" },
      accuracy: { type: "string", enum: ["coarse", "precise"], description: "Location accuracy mode (when action is 'android_location_get', default 'precise')" },
      maxAgeMs: { type: "number", description: "Accept cached GPS fix if it's this fresh in ms (when action is 'android_location_get')" },
      to: { type: "string", description: "Phone number to send SMS to (when action is 'android_sms_send')" },
      message: { type: "string", description: "SMS message body (when action is 'android_sms_send')" },
      fps: { type: "number", description: "Frames per second for screen recording (when action is 'android_screen_record', default 15)" },
      fieldDescription: { type: "string", description: "Human-readable label for the target field — used for logging only (when action is 'android_paste_text')" },
      operatorAction: { type: "object", description: "Structured operator action payload when action is 'android_operator_action'. Example: { type: 'tap_element', elementId: 3 }" },
    },
    required: ["action"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const rawAction = String(args.action || "");
    const androidActive = isAndroidDaemonActive(ctx.userId);
    const desktopActive = isDesktopDaemonActive(ctx.userId);

    if (!isUserPaired(ctx.userId)) {
      return { ok: false, content: jsonErrorContent("No daemon paired. Ask the user to pair either the desktop daemon (Profile -> Connected Channels -> Desktop Daemon) or Android device control in the main Jarvis Android app (Profile -> Android Device).") };
    }

    // ── Android actions ────────────────────────────────────────────────────
    if (isAndroidAction(rawAction)) {
      if (!androidActive) {
        return { ok: false, content: jsonErrorContent("No Android device control connection is active. Ask the user to open the main Jarvis Android app, go to Profile -> Android Device, and tap Enable Device Control.") };
      }
      const permKey = androidPermKey(rawAction);
      if (permKey && !(await isAndroidDaemonActionAllowed(ctx.userId, permKey))) {
        return { ok: false, content: jsonErrorContent(`Android action '${rawAction}' is not permitted. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.`) };
      }

      let op: DaemonOp;
      if (rawAction === "android_open_app") {
        if (!args.packageName) return { ok: false, content: jsonErrorContent("packageName required") };
        op = { type: "android_open_app", packageName: String(args.packageName) };
      } else if (rawAction === "android_browse") {
        if (!args.url) return { ok: false, content: jsonErrorContent("url required") };
        op = { type: "android_browse", url: String(args.url) };
      } else if (rawAction === "android_screenshot") {
        if (!checkAndIncrementScreenshotBudget(ctx)) {
          return {
            ok: false,
            content: jsonErrorContent("Screenshot limit reached for this turn (max 4). Use android_read_screen to read the current screen content as text because it returns the accessibility tree without requiring a screenshot.", { label: "daemon_action: turn screenshot limit reached" }),
          };
        }
        op = { type: "android_screenshot" };
      } else if (rawAction === "android_read_screen") {
        op = { type: "android_read_screen" };
      } else if (rawAction === "android_screen_context") {
        op = { type: "android_screen_context" };
      } else if (rawAction === "android_operator_action") {
        const operatorAction = (args as { operatorAction?: unknown }).operatorAction;
        if (!operatorAction || typeof operatorAction !== "object" || Array.isArray(operatorAction)) {
          return { ok: false, content: jsonErrorContent("operatorAction object required") };
        }
        const typedOperatorAction = operatorAction as Record<string, unknown>;
        const nestedPermKey = operatorActionPermKey(typedOperatorAction);
        if (nestedPermKey && !(await isAndroidDaemonActionAllowed(ctx.userId, nestedPermKey))) {
          return { ok: false, content: jsonErrorContent(`Android operator action '${String(typedOperatorAction.type || "unknown")}' is not permitted. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.`) };
        }
        op = { type: "android_operator_action", action: typedOperatorAction };
      } else if (rawAction === "android_tap") {
        if (typeof args.x !== "number" || typeof args.y !== "number") return { ok: false, content: jsonErrorContent("x and y required") };
        op = { type: "android_tap", x: args.x, y: args.y };
      } else if (rawAction === "android_type") {
        if (!args.text) return { ok: false, content: jsonErrorContent("text required") };
        op = { type: "android_type", text: String(args.text) };
      } else if (rawAction === "android_swipe") {
        if (typeof args.x1 !== "number" || typeof args.y1 !== "number" || typeof args.x2 !== "number" || typeof args.y2 !== "number") {
          return { ok: false, content: jsonErrorContent("x1, y1, x2, y2 required") };
        }
        op = { type: "android_swipe", x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, durationMs: typeof args.durationMs === "number" ? args.durationMs : 300 };
      } else if (rawAction === "android_press_key") {
        const validKeys = ["back", "home", "recents", "volume_up", "volume_down", "enter"] as const;
        const key = String(args.key || "back") as typeof validKeys[number];
        if (!validKeys.includes(key)) return { ok: false, content: jsonErrorContent("invalid key") };
        op = { type: "android_press_key", key: key as "back" | "home" | "recents" | "volume_up" | "volume_down" | "enter" };
      } else if (rawAction === "android_file_list") {
        if (!args.path) return { ok: false, content: jsonErrorContent("path required") };
        op = { type: "android_file_list", path: String(args.path) };
      } else if (rawAction === "android_file_read") {
        if (!args.path) return { ok: false, content: jsonErrorContent("path required") };
        op = { type: "android_file_read", path: String(args.path) };
      } else if (rawAction === "android_notifications_list") {
        const limit = typeof args.limit === "number" ? Math.min(args.limit, 60) : 20;
        const daemonNotifResult = await sendDaemonOp(ctx.userId, { type: "android_notifications_list", limit }, 10000);

        if (daemonNotifResult.ok) {
          const data = daemonNotifResult.data as Record<string, unknown> | null;
          const listenerEnabled = !!data?.listenerEnabled;
          const notificationsValue = data?.notifications;
          const rawNotifications = Array.isArray(notificationsValue)
            ? notificationsValue as Record<string, unknown>[]
            : [];
          const count = rawNotifications.length;

          if (listenerEnabled && count > 0) {
            recordVoiceNotificationObservation(ctx.userId, rawNotifications);
            const relativeTime = (tsMs: number): string => {
              const diffMs = Date.now() - tsMs;
              const diffMins = Math.round(diffMs / 60000);
              if (diffMins < 1) return "just now";
              if (diffMins < 60) return `${diffMins}m ago`;
              const diffHours = Math.floor(diffMins / 60);
              if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
              return `${Math.floor(diffHours / 24)}d ago`;
            };
            const formatted = rawNotifications.map((notification) => {
              const ago = typeof notification.ts === "number" ? relativeTime(notification.ts) : "?";
              const app = String(notification.app || notification.pkg || "Unknown");
              const title = String(notification.title || "");
              const text = notification.text ? `: ${String(notification.text).slice(0, 120)}` : "";
              const key = String(notification.key || notification.notificationKey || "");
              const hasReplyAction = notification.hasReplyAction === true;
              const replyMeta = key
                ? ` [key: ${key}${hasReplyAction ? ", replyable" : ""}]`
                : hasReplyAction
                  ? " [replyable, missing key]"
                  : "";
              return `- ${app} (${ago}) - ${title}${text}${replyMeta}`;
            }).join("\n");

            return {
              ok: true,
              content: JSON.stringify({
                ok: true,
                data: {
                  result: "success",
                  label: `${count} notification${count !== 1 ? "s" : ""} from phone`,
                  detail: `PHONE NOTIFICATIONS (${count} total) - report the relative ages as shown, without converting them to clock times.\n\n${formatted}`,
                  notifications: rawNotifications.map((notification) => ({
                    key: notification.key || notification.notificationKey || null,
                    app: notification.app || notification.pkg || "Unknown",
                    title: notification.title || "",
                    text: notification.text || "",
                    ts: typeof notification.ts === "number" ? notification.ts : null,
                    hasReplyAction: notification.hasReplyAction === true,
                  })),
                },
              }),
            };
          }

          if (listenerEnabled && count === 0) {
            recordVoiceNotificationObservation(ctx.userId, []);
            return {
              ok: true,
              content: JSON.stringify({
                ok: true,
                data: {
                  result: "success",
                  label: "No notifications",
                  detail: "The notification listener is active on the phone and reports zero current notifications. The tray is clear.",
                },
              }),
            };
          }

          clearVoiceNotificationObservation(ctx.userId);
        } else {
          clearVoiceNotificationObservation(ctx.userId);
        }

        const [canTapType, canReadScreen] = await Promise.all([
          isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type"),
          isAndroidDaemonActionAllowed(ctx.userId, "android_read_screen"),
        ]);
        if (!canTapType || !canReadScreen) {
          return {
            ok: false,
            content: jsonErrorContent(
              `Notification Access is not enabled, and the notification-shade fallback requires ${!canTapType && !canReadScreen ? "tap/swipe and screen-read permissions" : !canTapType ? "tap/swipe permission" : "screen-read permission"}. Ask the user to enable Android Device permissions for ${!canTapType && !canReadScreen ? "Tap/Type and Read Screen" : !canTapType ? "Tap/Type" : "Read Screen"}, or enable Android Notification Access for Jarvis.`,
            ),
          };
        }

        const swipeOp = await sendDaemonOp(ctx.userId, {
          type: "android_swipe",
          x1: 540,
          y1: 10,
          x2: 540,
          y2: 1200,
          durationMs: 400,
        }, 8000);

        if (!swipeOp.ok) {
          return {
            ok: false,
            content: jsonErrorContent(`The Notification Access permission is not granted to Jarvis, and the shade-opening fallback also failed: ${swipeOp.error || "swipe failed"}`),
          };
        }

        await new Promise((resolve) => setTimeout(resolve, 700));
        const shadeReadOp = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 10000);
        sendDaemonOp(ctx.userId, { type: "android_press_key", key: "back" }, 5000).catch(() => {});

        if (!shadeReadOp.ok) {
          return {
            ok: false,
            content: jsonErrorContent(`Could not read notification shade: ${shadeReadOp.error || "unknown"}. Ensure the Accessibility Service is enabled.`),
          };
        }

        const shadeData = shadeReadOp.data;
        const shadeText = typeof shadeData === "string" ? shadeData : JSON.stringify(shadeData || "");
        const emptyShade = !shadeText || shadeText === "{}" || shadeText === "\"\"" || shadeText === "null";
        return {
          ok: true,
          content: JSON.stringify({
            ok: true,
            data: emptyShade
              ? {
                  result: "success",
                  label: "Notification shade appears empty",
                  detail: "No text was detected in the notification shade. Your notification tray may be empty.",
                }
              : {
                  result: "success",
                  label: "Notification shade content read from screen",
                  detail: `SCREEN CONTENT (verbatim from phone - report ONLY what is shown here, do NOT add or infer any details):\n${shadeText}`,
                },
          }),
        };
      } else if (rawAction === "android_file_search") {
        if (!args.query) return { ok: false, content: jsonErrorContent("query required") };
        // Accept both "fileType" (canonical) and legacy "type" alias for compatibility
        const resolvedFileType = args.fileType || (args as any).type;
        op = {
          type: "android_file_search",
          query: String(args.query),
          root: args.root ? String(args.root) : undefined,
          fileType: resolvedFileType ? String(resolvedFileType) : undefined,
          maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : undefined,
        };
      } else if (rawAction === "android_open_file") {
        if (!args.path) return { ok: false, content: jsonErrorContent("path required") };
        op = { type: "android_open_file", path: String(args.path) };
      } else if (rawAction === "android_copy_to_clipboard") {
        if (!args.path) return { ok: false, content: jsonErrorContent("path required") };
        op = { type: "android_copy_to_clipboard", path: String(args.path) };
      } else if (rawAction === "android_notification_reply") {
        if (!args.notificationKey) return { ok: false, content: jsonErrorContent("notificationKey required") };
        if (!args.replyText) return { ok: false, content: jsonErrorContent("replyText required") };
        if (!args.approved) {
          return { ok: false, content: jsonErrorContent(`Confirmation required before sending. Show the user the exact reply and ask them to approve it: "I'll reply inline with: \"${args.replyText}\". Send it?" — then call this action again with approved: true once they confirm.`, { requiresApproval: true }) };
        }
        op = { type: "android_notification_reply", notificationKey: String(args.notificationKey), replyText: String(args.replyText) };
      } else if (rawAction === "android_camera_snap") {
        const facing = String(args.facing || "back") as "front" | "back" | "both";
        op = { type: "android_camera_snap", facing };
      } else if (rawAction === "android_camera_clip") {
        if (!args.approved) {
          return { ok: false, content: jsonErrorContent(`Confirmation required before recording a video clip (privacy-sensitive). Ask the user: "I'll record a ${Math.round((typeof args.durationMs === "number" ? args.durationMs : 5000) / 1000)}s video clip from the ${args.facing || "back"} camera. Is that OK?" — then call again with approved: true.`, { requiresApproval: true }) };
        }
        const facing = String(args.facing || "back") as "front" | "back";
        const durationMs = Math.min(typeof args.durationMs === "number" ? args.durationMs : 5000, 30000);
        op = { type: "android_camera_clip", facing, durationMs, audio: !!args.audio };
      } else if (rawAction === "android_location_get") {
        const accuracy = String(args.accuracy || "precise") as "coarse" | "precise";
        op = { type: "android_location_get", accuracy, maxAgeMs: typeof args.maxAgeMs === "number" ? args.maxAgeMs : undefined };
      } else if (rawAction === "android_sms_send") {
        if (!args.to) return { ok: false, content: jsonErrorContent("to (phone number) required") };
        if (!args.message) return { ok: false, content: jsonErrorContent("message required") };
        if (!args.approved) {
          return { ok: false, content: jsonErrorContent(`Confirmation required before sending SMS. Show the user exactly: "Send SMS to ${args.to}: \"${args.message}\"?" — then call again with approved: true once they confirm.`, { requiresApproval: true }) };
        }
        op = { type: "android_sms_send", to: String(args.to), message: String(args.message) };
      } else if (rawAction === "android_screen_record") {
        if (!args.approved) {
          const dur = Math.min(typeof args.durationMs === "number" ? args.durationMs : 10000, 60000);
          return { ok: false, content: jsonErrorContent(`Confirmation required before recording the screen. Ask the user: "I'll record your screen for ${Math.round(dur / 1000)}s. Is that OK?" — then call again with approved: true.`, { requiresApproval: true }) };
        }
        const durationMs = Math.min(typeof args.durationMs === "number" ? args.durationMs : 10000, 60000);
        op = { type: "android_screen_record", durationMs, fps: typeof args.fps === "number" ? args.fps : 15, audio: !!args.audio };
      } else if (rawAction === "android_view_hierarchy") {
        op = { type: "android_view_hierarchy" };
      } else if (rawAction === "android_paste_text") {
        if (!args.text) return { ok: false, content: jsonErrorContent("text required") };
        op = {
          type: "android_paste_text",
          text: String(args.text),
          fieldDescription: args.fieldDescription ? String(args.fieldDescription) : undefined,
        };
      } else if (rawAction === "android_get_focused_field") {
        op = { type: "android_get_focused_field" };
      } else if (rawAction === "android_return_to_jarvis") {
        op = { type: "android_return_to_jarvis" };
      } else if (rawAction === "android_wait") {
        const rawMs = typeof args.ms === "number" ? args.ms : typeof args.durationMs === "number" ? args.durationMs : 1500;
        const ms = Math.min(Math.max(rawMs, 200), 10000);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return {
          ok: true,
          content: JSON.stringify({
            ok: true,
            data: {
              result: "success",
              label: `Waited ${ms}ms`,
              detail: `Paused ${ms}ms to let the phone UI settle.`,
            },
          }),
        };
      } else {
        return { ok: false, content: jsonErrorContent(`unknown android action ${rawAction}`) };
      }

      // Camera clip and screen record can take up to 60s + overhead; give generous timeouts
      const isCameraClip = rawAction === "android_camera_clip";
      const isScreenRec = rawAction === "android_screen_record";
      const opTimeout = isCameraClip
        ? Math.min(typeof args.durationMs === "number" ? args.durationMs : 5000, 30000) + 15000
        : isScreenRec
          ? Math.min(typeof args.durationMs === "number" ? args.durationMs : 10000, 60000) + 20000
          : rawAction === "android_location_get" ? 20000 : 30000;

      const result = await sendDaemonOp(ctx.userId, op, opTimeout);

      // Translate structured error codes from the daemon into user-friendly Fix instructions
      if (!result.ok && typeof result.error === "string") {
        const err = result.error;
        if (err.startsWith("FOREGROUND_REQUIRED")) {
          return { ok: false, content: jsonErrorContent("This action requires the main Jarvis Android app to be in the foreground on your Android device. Open Jarvis and try again.", { code: "FOREGROUND_REQUIRED" }) };
        }
        if (err.startsWith("CAMERA_PERMISSION_REQUIRED") || err.startsWith("SCREEN_RECORD_PERMISSION_REQUIRED")) {
          const isScreenRec = err.startsWith("SCREEN_RECORD_PERMISSION_REQUIRED");
          const fixNote = isScreenRec
            ? "Screen recording is not available in the unified Jarvis Android app yet because Android's screen-capture grant flow is not wired. Use screenshot, screen context, or camera actions for now."
            : "Camera permission is not granted on the Android device. Open the main Jarvis Android app and tap 'Grant' next to Camera, or go to Settings -> Apps -> Jarvis -> Permissions -> Camera.";
          return { ok: false, content: jsonErrorContent(fixNote, { code: isScreenRec ? "SCREEN_RECORD_PERMISSION_REQUIRED" : "CAMERA_PERMISSION_REQUIRED" }) };
        }
        if (err.startsWith("LOCATION_PERMISSION_REQUIRED")) {
          return { ok: false, content: jsonErrorContent("Location permission is not granted. On the Android device go to Settings -> Apps -> Jarvis -> Permissions -> Location and select 'Allow all the time' or 'Allow only while using the app'.", { code: "LOCATION_PERMISSION_REQUIRED" }) };
        }
        if (err.startsWith("SMS_PERMISSION_REQUIRED")) {
          return { ok: false, content: jsonErrorContent("SEND_SMS permission is not granted. On the Android device go to Settings -> Apps -> Jarvis -> Permissions -> SMS and enable it.", { code: "SMS_PERMISSION_REQUIRED" }) };
        }
        if (err.startsWith("SMS_NOT_SUPPORTED")) {
          return { ok: false, content: jsonErrorContent("This Android device does not support SMS (no SIM / cellular). SMS cannot be sent.", { code: "SMS_NOT_SUPPORTED" }) };
        }
      }

      // Media ops return base64 — don't truncate or base64 will be corrupt
      const isMediaOp = rawAction === "android_camera_snap" || rawAction === "android_camera_clip" || rawAction === "android_screen_record";
      const isStructuredContext = rawAction === "android_screen_context";
      const serialised = JSON.stringify(result);
      return { ok: !!result.ok, content: (isMediaOp || isStructuredContext) ? serialised : serialised.slice(0, 12000) };
    }

    // ── Desktop actions ────────────────────────────────────────────────────
    if (!isDesktopAction(rawAction)) {
      return { ok: false, content: jsonErrorContent(`unknown action ${rawAction}`) };
    }

    if (!desktopActive) {
      return { ok: false, content: jsonErrorContent(`Action '${rawAction}' requires the Desktop Daemon, which is not connected. Ask the user to install and pair the desktop daemon (Profile → Connected Channels → Desktop Daemon).`) };
    }

    const action: DaemonAction = rawAction;
    if (!(await isDaemonActionAllowed(ctx.userId, action))) {
      return { ok: false, content: jsonErrorContent(`Action '${action}' is not permitted on this user's daemon. Ask the user to enable it in Profile → Connected Channels → Desktop Daemon → Permissions.`) };
    }
    let op: DaemonOp;
    if (action === "shell") {
      if (!args.cmd) return { ok: false, content: jsonErrorContent("cmd required") };
      op = { type: "shell", cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : undefined, timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined };
    } else if (action === "notify") {
      op = { type: "notify", title: String(args.title || "JARVIS"), body: String(args.body || "") };
    } else if (action === "file_read") {
      if (!args.path) return { ok: false, content: jsonErrorContent("path required") };
      op = { type: "file_read", path: String(args.path) };
    } else if (action === "file_write") {
      if (!args.path || typeof args.content !== "string") return { ok: false, content: jsonErrorContent("path and content required") };
      op = { type: "file_write", path: String(args.path), content: String(args.content) };
    } else if (action === "file_list") {
      if (!args.path) return { ok: false, content: jsonErrorContent("path required") };
      op = { type: "file_list", path: String(args.path) };
    } else if (action === "desktop_screenshot") {
      op = { type: "desktop_screenshot" };
    } else if (action === "desktop_read_screen") {
      op = { type: "desktop_read_screen" };
    } else {
      return { ok: false, content: jsonErrorContent(`unknown action ${action}`) };
    }
    const isScreenOp = action === "desktop_screenshot" || action === "desktop_read_screen";
    // desktop_read_screen can take up to 30s for OCR — give bridge a 40s window so
    // it never times out before the daemon finishes. desktop_screenshot is faster (20s).
    const screenTimeout = action === "desktop_read_screen" ? 40000 : 20000;
    const result = await sendDaemonOp(ctx.userId, op, action === "shell" ? 30000 : isScreenOp ? screenTimeout : 10000);
    // Screen ops return base64 PNG — do not truncate or the base64 will be corrupt.
    // For all other ops keep the existing 8 000-char safety cap.
    const serialised = JSON.stringify(result);
    return { ok: !!result.ok, content: isScreenOp ? serialised : serialised.slice(0, 8000) };
  },
};
