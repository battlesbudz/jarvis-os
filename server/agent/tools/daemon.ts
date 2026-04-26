import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import {
  sendDaemonOp,
  isUserPaired,
  isDaemonActionAllowed,
  isAndroidDaemonActionAllowed,
  isAndroidDaemonActive,
  isDesktopDaemonActive,
  type DaemonAction,
  type AndroidDaemonAction,
  type DaemonOp,
} from "../../daemon/bridge";

const DESKTOP_ACTIONS: readonly DaemonAction[] = ["shell", "notify", "file_read", "file_write", "file_list", "desktop_screenshot", "desktop_read_screen"] as const;
const ANDROID_ACTIONS: readonly string[] = [
  "android_open_app",
  "android_browse",
  "android_screenshot",
  "android_read_screen",
  "android_tap",
  "android_type",
  "android_swipe",
  "android_press_key",
  "android_file_list",
  "android_file_read",
  "android_file_search",
  "android_open_file",
  "android_copy_to_clipboard",
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
  if (action === "android_open_app") return "android_open_app";
  if (action === "android_browse") return "android_browse";
  if (action === "android_file_list") return "android_file_list";
  if (action === "android_file_read") return "android_file_read";
  if (action === "android_file_search") return "android_file_list";
  if (action === "android_open_file") return "android_file_list";
  if (action === "android_copy_to_clipboard") return "android_file_list";
  if (action === "android_tap" || action === "android_type" || action === "android_swipe" || action === "android_press_key") return "android_tap_type";
  return null;
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
- android_screenshot: capture the current screen as a base64 PNG image
- android_read_screen: return the visible text and UI element tree via accessibility
- android_tap: tap at x/y pixel coordinates on the screen
- android_type: type text using the accessibility service
- android_swipe: swipe from (x1,y1) to (x2,y2)
- android_press_key: press a system key — "back", "home", "recents", "volume_up", "volume_down"
- android_file_list: list files in any path on the device (gallery, downloads, any folder)
- android_file_read: read any file on the device
- android_file_search: recursively search for files by name across the device storage — accepts query (substring match), optional root path (defaults to external storage root), optional type filter (image/video/audio/document/any), optional maxDepth (default 4, max 8); returns up to 100 matches with name/path/size/lastModified
- android_open_file: open a file in its native app (e.g. gallery for images) using an ACTION_VIEW Intent — accepts an absolute file path
- android_copy_to_clipboard: copy an image file to the Android clipboard so it can be pasted into Telegram, WhatsApp, or any app that supports image paste — accepts an absolute image file path; falls back gracefully if the target app doesn't support paste

Always confirm with the user before tap/type/swipe actions. Use android_read_screen or android_screenshot to understand context before acting. Require confirmation before any destructive shell or file_write actions. When an Android daemon is paired, prefer android_* actions. Returns the daemon's response or an error if not paired.`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "shell", "notify", "file_read", "file_write", "file_list",
          "desktop_screenshot", "desktop_read_screen",
          "android_open_app", "android_browse", "android_screenshot", "android_read_screen",
          "android_tap", "android_type", "android_swipe", "android_press_key",
          "android_file_list", "android_file_read",
          "android_file_search", "android_open_file", "android_copy_to_clipboard",
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
      key: { type: "string", enum: ["back", "home", "recents", "volume_up", "volume_down"], description: "System key (when action is 'android_press_key')" },
      query: { type: "string", description: "Search term — substring match against filename (when action is 'android_file_search')" },
      root: { type: "string", description: "Root path to start search from (when action is 'android_file_search', defaults to external storage root)" },
      fileType: { type: "string", enum: ["image", "video", "audio", "document", "any"], description: "File type filter (when action is 'android_file_search', default 'any')" },
      maxDepth: { type: "number", description: "Maximum directory depth to recurse (when action is 'android_file_search', default 4, max 8)" },
    },
    required: ["action"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const rawAction = String(args.action || "");
    const androidActive = isAndroidDaemonActive(ctx.userId);
    const desktopActive = isDesktopDaemonActive(ctx.userId);

    if (!isUserPaired(ctx.userId)) {
      return { ok: false, content: JSON.stringify({ ok: false, error: "No daemon paired. Ask the user to install and pair either the desktop daemon (Profile → Connected Channels → Desktop Daemon) or the Android daemon APK (Profile → Connected Channels → Android Device)." }) };
    }

    // ── Android actions ────────────────────────────────────────────────────
    if (isAndroidAction(rawAction)) {
      if (!androidActive) {
        return { ok: false, content: JSON.stringify({ ok: false, error: "No Android daemon connected. Ask the user to install the Jarvis Android APK and pair it (Profile → Connected Channels → Android Device)." }) };
      }
      const permKey = androidPermKey(rawAction);
      if (permKey && !(await isAndroidDaemonActionAllowed(ctx.userId, permKey))) {
        return { ok: false, content: JSON.stringify({ ok: false, error: `Android action '${rawAction}' is not permitted. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.` }) };
      }

      let op: DaemonOp;
      if (rawAction === "android_open_app") {
        if (!args.packageName) return { ok: false, content: JSON.stringify({ ok: false, error: "packageName required" }) };
        op = { type: "android_open_app", packageName: String(args.packageName) };
      } else if (rawAction === "android_browse") {
        if (!args.url) return { ok: false, content: JSON.stringify({ ok: false, error: "url required" }) };
        op = { type: "android_browse", url: String(args.url) };
      } else if (rawAction === "android_screenshot") {
        op = { type: "android_screenshot" };
      } else if (rawAction === "android_read_screen") {
        op = { type: "android_read_screen" };
      } else if (rawAction === "android_tap") {
        if (typeof args.x !== "number" || typeof args.y !== "number") return { ok: false, content: JSON.stringify({ ok: false, error: "x and y required" }) };
        op = { type: "android_tap", x: args.x, y: args.y };
      } else if (rawAction === "android_type") {
        if (!args.text) return { ok: false, content: JSON.stringify({ ok: false, error: "text required" }) };
        op = { type: "android_type", text: String(args.text) };
      } else if (rawAction === "android_swipe") {
        if (typeof args.x1 !== "number" || typeof args.y1 !== "number" || typeof args.x2 !== "number" || typeof args.y2 !== "number") {
          return { ok: false, content: JSON.stringify({ ok: false, error: "x1, y1, x2, y2 required" }) };
        }
        op = { type: "android_swipe", x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, durationMs: typeof args.durationMs === "number" ? args.durationMs : 300 };
      } else if (rawAction === "android_press_key") {
        const validKeys = ["back", "home", "recents", "volume_up", "volume_down"] as const;
        const key = String(args.key || "back") as typeof validKeys[number];
        if (!validKeys.includes(key)) return { ok: false, content: JSON.stringify({ ok: false, error: "invalid key" }) };
        op = { type: "android_press_key", key };
      } else if (rawAction === "android_file_list") {
        if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
        op = { type: "android_file_list", path: String(args.path) };
      } else if (rawAction === "android_file_read") {
        if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
        op = { type: "android_file_read", path: String(args.path) };
      } else if (rawAction === "android_file_search") {
        if (!args.query) return { ok: false, content: JSON.stringify({ ok: false, error: "query required" }) };
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
        if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
        op = { type: "android_open_file", path: String(args.path) };
      } else if (rawAction === "android_copy_to_clipboard") {
        if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
        op = { type: "android_copy_to_clipboard", path: String(args.path) };
      } else {
        return { ok: false, content: JSON.stringify({ ok: false, error: `unknown android action ${rawAction}` }) };
      }

      const result = await sendDaemonOp(ctx.userId, op, 30000);
      return { ok: !!result.ok, content: JSON.stringify(result).slice(0, 12000) };
    }

    // ── Desktop actions ────────────────────────────────────────────────────
    if (!isDesktopAction(rawAction)) {
      return { ok: false, content: JSON.stringify({ ok: false, error: `unknown action ${rawAction}` }) };
    }

    if (!desktopActive) {
      return { ok: false, content: JSON.stringify({ ok: false, error: `Action '${rawAction}' requires the Desktop Daemon, which is not connected. Ask the user to install and pair the desktop daemon (Profile → Connected Channels → Desktop Daemon).` }) };
    }

    const action: DaemonAction = rawAction;
    if (!(await isDaemonActionAllowed(ctx.userId, action))) {
      return { ok: false, content: JSON.stringify({ ok: false, error: `Action '${action}' is not permitted on this user's daemon. Ask the user to enable it in Profile → Connected Channels → Desktop Daemon → Permissions.` }) };
    }
    let op: DaemonOp;
    if (action === "shell") {
      if (!args.cmd) return { ok: false, content: JSON.stringify({ ok: false, error: "cmd required" }) };
      op = { type: "shell", cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : undefined, timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined };
    } else if (action === "notify") {
      op = { type: "notify", title: String(args.title || "GamePlan"), body: String(args.body || "") };
    } else if (action === "file_read") {
      if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
      op = { type: "file_read", path: String(args.path) };
    } else if (action === "file_write") {
      if (!args.path || typeof args.content !== "string") return { ok: false, content: JSON.stringify({ ok: false, error: "path and content required" }) };
      op = { type: "file_write", path: String(args.path), content: String(args.content) };
    } else if (action === "file_list") {
      if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
      op = { type: "file_list", path: String(args.path) };
    } else if (action === "desktop_screenshot") {
      op = { type: "desktop_screenshot" };
    } else if (action === "desktop_read_screen") {
      op = { type: "desktop_read_screen" };
    } else {
      return { ok: false, content: JSON.stringify({ ok: false, error: `unknown action ${action}` }) };
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
