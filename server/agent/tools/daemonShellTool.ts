import path from "path";
import { createHash } from "crypto";
import type { AgentTool } from "../types";
import {
  sendDaemonOp,
  isDesktopDaemonActive,
  isAndroidDaemonActive,
  isAndroidDaemonActionAllowed,
  isDaemonActionAllowed,
  getDaemonPermissions,
  getAndroidDaemonPermissions,
  getDaemonDeviceMeta,
  getDaemonLastSeen,
  waitForTrainingTap,
} from "../../daemon/bridge";
import { anthropic, ORCHESTRATOR_MODEL } from "../../lib/anthropicClient";
import { screenshotDiff } from "../../lib/screenshotDiff";
import { db } from "../../db";
import { buttonLocations } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { notifyUser } from "../../channels/registry";

//        Shell safety: server-side preflight for early UX feedback                                                    
// Mirrors the daemon-side commandEscapesRoot strategy so the agent gets a fast
// error message before the round-trip. The daemon is the authoritative boundary.
// The server normalizes absolute paths (to collapse /usr/../etc tricks) but cannot
// resolve relative tokens against the user's ROOT     those are flagged conservatively.

const SAFE_DEVICE_FILES_SET = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/zero"]);

// System command binary prefixes     the first token of each shell segment may be
// an absolute path to a system binary; file arguments must stay inside the workspace.
const CMD_BIN_PREFIXES = [
  "/usr/", "/bin/", "/sbin/", "/opt/homebrew/", "/usr/local/",
  "/nix/", "/home/linuxbrew/", "/Applications/", "/System/", "/Library/",
];

function isCmdBin(p: string): boolean {
  const norm = path.normalize(p);
  return CMD_BIN_PREFIXES.some((prefix) => norm.startsWith(prefix));
}

function detectsOutsideRoot(cmd: string): boolean {
  // Always-block patterns
  if (/\bcd\s+\.\./.test(cmd)) return true;
  if (/\bsudo\s+rm/.test(cmd)) return true;
  if (/\brm\s+-rf\s+\//.test(cmd)) return true;

  // Expand ~ and $HOME so resolved paths can be checked.
  // Server doesn't know the user's JARVIS_DAEMON_ROOT, so it flags anything that
  // resolves to an absolute non-bin path (conservative: daemon is the final arbiter).
  const HOME = process.env.HOME || process.env.USERPROFILE || "";
  if (!HOME && /~|\$\{?HOME\}?/.test(cmd)) return true;
  const expanded = HOME
    ? cmd
        .replace(/\$\{HOME\}/g, HOME)
        .replace(/\$HOME(?=[/\s;|&>'")\x60]|$)/g, HOME)
        .replace(/~/g, HOME)
    : cmd;

  if (/\bcd\s+\//.test(expanded)) return true;

  // Redirection targets: normalize and block anything that isn't /dev/* (conservative)
  const redirectMatches = expanded.match(/>\s*(\/[^\s;|&]*)/g) || [];
  for (const redir of redirectMatches) {
    const target = redir.replace(/^>\s*/, "");
    const norm = path.normalize(target);
    if (!SAFE_DEVICE_FILES_SET.has(norm)) return true;
  }

  // Token-level path scan on expanded command
  const segments = expanded.split(/[|;]|&&|\|\|/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/[\s<>()$\x60]+/).map((t) => t.replace(/^['"\x60]|['"\x60]$/g, ""));
    let isCmd = true;
    for (const token of tokens) {
      if (!token) continue;
      if (/^-/.test(token)) continue;

      if (token.startsWith("/")) {
        const norm = path.normalize(token);
        if (!SAFE_DEVICE_FILES_SET.has(norm)) {
          if (isCmd && isCmdBin(norm)) {
            // First token is system binary     allow it.
          } else {
            // Absolute file argument     server can't verify it's in user's ROOT,
            // so flag it; daemon will do the definitive ROOT-containment check.
            return true;
          }
        }
      } else if (token.includes("..")) {
        return true; // Conservative: daemon resolves against ROOT definitively.
      }

      isCmd = false;
    }
  }
  return false;
}

export const daemonShellTool: AgentTool = {
  name: "daemon_shell",
  description:
    "Run a shell command on the user's desktop via the paired desktop daemon. Returns stdout, stderr, exit code, and duration. Use this proactively when the user asks to run a script, build an app, run tests, execute local automation, read a local file via shell, or do any computation on their machine. Requires the desktop daemon to be paired and the 'shell' permission enabled in Profile     Connected Channels     Desktop Daemon     Permissions. When the daemon is offline, returns a clear explanation and how to start it. For desktop notifications, file reads, or screenshots, prefer daemon_action.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute on the user's desktop. Runs inside the daemon workspace root (~/jarvis-workspace by default). Use relative paths for files inside the workspace.",
      },
      cwd: {
        type: "string",
        description: "Optional working directory relative to the daemon workspace root. Defaults to the workspace root.",
      },
      timeout_ms: {
        type: "number",
        description: "Optional timeout in milliseconds (default 30000, max 120000). Increase for long-running builds or test suites.",
      },
    },
    required: ["command"],
  },
  async execute(args, ctx) {
    const command = String(args.command || "").trim();
    if (!command) {
      return { ok: false, content: "command is required.", label: "daemon_shell: no command" };
    }

    if (!isDesktopDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content:
          "Desktop daemon is not connected. To use daemon_shell, the user needs to:\n1. Download jarvis-daemon.js from Profile     Connected Channels     Desktop Daemon\n2. Run: JARVIS_SERVER=<url> JARVIS_PAIR_CODE=<code> node jarvis-daemon.js\nThe daemon reconnects automatically after network drops.",
        label: "daemon_shell: desktop offline",
      };
    }

    const shellAllowed = await isDaemonActionAllowed(ctx.userId, "shell");
    if (!shellAllowed) {
      return {
        ok: false,
        content:
          "Shell execution is not permitted on this daemon. The user must enable it in Profile     Connected Channels     Desktop Daemon     Permissions     Shell Execution.",
        label: "daemon_shell: shell permission denied",
      };
    }

    // Look up the allow_outside_root permission     sent to daemon so it can enforce.
    // The server also does a preflight regex check to surface clear error messages
    // before the round-trip, but the daemon is the authoritative security boundary.
    const allowOutsideRoot = await isDaemonActionAllowed(ctx.userId, "allow_outside_root");

    // Preflight heuristic check (UX-only     daemon enforces authoritatively)
    if (!allowOutsideRoot && detectsOutsideRoot(command)) {
      return {
        ok: false,
        content:
          `The command "${command.slice(0, 80)}" appears to navigate or write outside the daemon workspace root. ` +
          "This is blocked by default. The user can enable unrestricted shell access in " +
          "Profile     Connected Channels     Desktop Daemon     Permissions     Allow Outside Root.",
        label: "daemon_shell: outside-root blocked",
      };
    }

    const timeoutMs = Math.min(
      typeof args.timeout_ms === "number" ? args.timeout_ms : 30000,
      120000,
    );

    const startedAt = Date.now();
    const result = await sendDaemonOp(
      ctx.userId,
      {
        type: "shell",
        cmd: command,
        cwd: args.cwd ? String(args.cwd) : undefined,
        timeoutMs,
        allowOutsideRoot,
      },
      timeoutMs + 5000,
    );

    const durationMs = Date.now() - startedAt;

    if (!result.ok && !result.data) {
      const errMsg = result.error || "unknown error";
      return {
        ok: false,
        content: `Shell command failed: ${errMsg}`,
        label: "daemon_shell: error",
        detail: errMsg,
      };
    }

    const data = (result.data || {}) as Record<string, unknown>;
    const stdout = typeof data.stdout === "string" ? data.stdout : "";
    const stderr = typeof data.stderr === "string" ? data.stderr : "";
    const exitCode = typeof data.code === "number" ? data.code : result.ok ? 0 : 1;

    const parts: string[] = [];
    if (stdout.trim()) parts.push(`STDOUT:\n${stdout.trim()}`);
    if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
    if (parts.length === 0) parts.push(result.ok ? "(no output)" : `Error: ${result.error || "non-zero exit"}`);

    const summary = parts.join("\n\n");
    const content = `Exit code: ${exitCode} | Duration: ${durationMs}ms\n\n${summary}`;

    console.log(`[daemon_shell] userId=${ctx.userId} cmd="${command.slice(0, 60)}" ok=${result.ok} exit=${exitCode} dur=${durationMs}ms`);

    return {
      ok: result.ok,
      content: content.slice(0, 12000),
      label: `Shell: ${command.slice(0, 40)}${command.length > 40 ? "   " : ""}`,
      detail: `exit=${exitCode} dur=${durationMs}ms`,
    };
  },
};

export const daemonStatusTool: AgentTool = {
  name: "daemon_status",
  description:
    "Check the current connection status of the desktop daemon and Android daemon for this user. Returns connected state, last-seen time, hostname, and which capabilities are enabled. Use before running daemon_shell or daemon_action to verify the daemon is online and permissions are correct.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    const desktopActive = isDesktopDaemonActive(ctx.userId);
    const androidActive = isAndroidDaemonActive(ctx.userId);

    const [desktopMeta, androidMeta, desktopPerms, androidPerms, desktopLastSeen, androidLastSeen] = await Promise.all([
      getDaemonDeviceMeta(ctx.userId, "desktop").catch(() => ({ hostname: null, platform: null })),
      getDaemonDeviceMeta(ctx.userId, "android").catch(() => ({ hostname: null, platform: null })),
      getDaemonPermissions(ctx.userId).catch(() => null),
      getAndroidDaemonPermissions(ctx.userId).catch(() => null),
      getDaemonLastSeen(ctx.userId, "desktop").catch(() => null),
      getDaemonLastSeen(ctx.userId, "android").catch(() => null),
    ]);

    const desktopCapabilities: string[] = [];
    if (desktopPerms) {
      if (desktopPerms.shell) desktopCapabilities.push("shell");
      if (desktopPerms.file_read) desktopCapabilities.push("file_read");
      if (desktopPerms.file_write) desktopCapabilities.push("file_write");
      if (desktopPerms.file_list) desktopCapabilities.push("file_list");
      if (desktopPerms.notify) desktopCapabilities.push("notify");
      if (desktopPerms.desktop_screenshot) desktopCapabilities.push("desktop_screenshot");
      if (desktopPerms.desktop_read_screen) desktopCapabilities.push("desktop_read_screen");
      if (desktopPerms.browser_local) desktopCapabilities.push("browser_local");
      if (desktopPerms.allow_outside_root) desktopCapabilities.push("allow_outside_root");
    }

    const androidCapabilities: string[] = [];
    if (androidPerms) {
      if (androidPerms.android_screenshot) androidCapabilities.push("android_screenshot");
      if (androidPerms.android_read_screen) androidCapabilities.push("android_read_screen");
      if (androidPerms.android_open_app) androidCapabilities.push("android_open_app");
      if (androidPerms.android_browse) androidCapabilities.push("android_browse");
      if (androidPerms.android_file_list) androidCapabilities.push("android_file_list");
      if (androidPerms.android_file_read) androidCapabilities.push("android_file_read");
      if (androidPerms.android_tap_type) androidCapabilities.push("android_tap_type");
      if (androidPerms.android_camera) androidCapabilities.push("android_camera");
      if (androidPerms.android_location) androidCapabilities.push("android_location");
      if (androidPerms.android_sms) androidCapabilities.push("android_sms");
      if (androidPerms.android_screen_record) androidCapabilities.push("android_screen_record");
    }

    const status = {
      desktop: {
        connected: desktopActive,
        lastSeen: desktopLastSeen,
        hostname: desktopMeta.hostname,
        capabilities: desktopCapabilities,
      },
      android: {
        connected: androidActive,
        lastSeen: androidLastSeen,
        hostname: androidMeta.hostname,
        capabilities: androidCapabilities,
      },
    };

    const lines: string[] = [];

    if (desktopActive) {
      lines.push(`Desktop daemon: CONNECTED${desktopMeta.hostname ? ` (${desktopMeta.hostname})` : ""}${desktopLastSeen ? `     last seen ${desktopLastSeen}` : ""}`);
      lines.push(`  Enabled capabilities: ${desktopCapabilities.length > 0 ? desktopCapabilities.join(", ") : "none"}`);
      if (!desktopPerms?.shell) {
        lines.push(`  Note: 'shell' is disabled. Enable it in Profile     Connected Channels     Desktop Daemon     Permissions to use daemon_shell.`);
      }
    } else {
      lines.push(`Desktop daemon: OFFLINE${desktopLastSeen ? `     last seen ${desktopLastSeen}` : ""}`);
      lines.push("  To connect: run jarvis-daemon.js with your pair code from Profile     Connected Channels     Desktop Daemon.");
    }

    lines.push("");

    if (androidActive) {
      lines.push(`Android daemon: CONNECTED${androidMeta.hostname ? ` (${androidMeta.hostname})` : ""}${androidLastSeen ? `     last seen ${androidLastSeen}` : ""}`);
      lines.push(`  Enabled capabilities: ${androidCapabilities.length > 0 ? androidCapabilities.join(", ") : "none"}`);
    } else {
      lines.push(`Android daemon: OFFLINE${androidLastSeen ? `     last seen ${androidLastSeen}` : ""}`);
      lines.push("  To connect: install the Jarvis Android APK and pair it from Profile     Connected Channels     Android Device.");
    }

    console.log(`[daemon_status] userId=${ctx.userId} desktop=${desktopActive} android=${androidActive}`);

    return {
      ok: true,
      content: lines.join("\n"),
      label: `Daemon status: desktop=${desktopActive ? "online" : "offline"} android=${androidActive ? "online" : "offline"}`,
      detail: JSON.stringify(status),
    };
  },
};

//        ScreenMap cache                                                                                                                                                                                     
// 500 ms per-user cache so back-to-back calls don't hit Claude Vision twice.
interface ScreenMapEntry {
  ts: number;
  result: string;
}
const screenMapCache = new Map<string, ScreenMapEntry>();

//        Search-bar coordinate cache                                                                                                                                                                          
// Persists the last known (x, y) of the search bar for each userId + app_package pair.
// After a successful discovery, coordinates are written here so repeat searches skip the
// 3-attempt locate loop entirely. The entry is invalidated (overwritten) when discovery
// finds coordinates that differ by more than 30 px, indicating an app layout change.
interface SearchBarCacheEntry {
  x: number;
  y: number;
}
const searchBarCoordCache = new Map<string, SearchBarCacheEntry>();

export interface ScreenElement {
  label: string;
  description: string;
  center_x: number;
  center_y: number;
  bounds: string;
  resource_id: string;
  clickable: boolean;
}

// ── buildScreenMapElements ─────────────────────────────────────────────────────
// Shared ScreenMap acquisition logic used by both android_screen_understand and
// android_tap_element. Captures screenshot + view hierarchy in parallel, calls
// Claude Vision, normalizes the output, updates the cache, and returns elements.
// Callers must check permissions before invoking this.
type BuildScreenMapResult =
  | { ok: true; elements: ScreenElement[] }
  | { ok: false; content: string; label: string };

async function buildScreenMapElements(userId: string): Promise<BuildScreenMapResult> {
  const [screenshotResult, hierarchyResult] = await Promise.all([
    sendDaemonOp(userId, { type: "android_screenshot" }, 30000),
    sendDaemonOp(userId, { type: "android_view_hierarchy" }, 30000),
  ]);

  if (!screenshotResult.ok) {
    return {
      ok: false,
      content: `Failed to capture screenshot: ${screenshotResult.error || "unknown error"}`,
      label: "buildScreenMap: screenshot failed",
    };
  }
  if (!hierarchyResult.ok) {
    return {
      ok: false,
      content: `Failed to dump view hierarchy: ${hierarchyResult.error || "unknown error"}`,
      label: "buildScreenMap: hierarchy failed",
    };
  }

  const screenshotData = screenshotResult.data as Record<string, unknown> | undefined;
  const base64Image = (screenshotData?.screenshot as string) || (screenshotData?.image as string) || "";
  if (!base64Image) {
    return {
      ok: false,
      content: "Screenshot returned no image data.",
      label: "buildScreenMap: no image",
    };
  }

  const hierarchyData = hierarchyResult.data as Record<string, unknown> | undefined;
  const rawElements = hierarchyData?.elements ?? hierarchyData;
  const elementsJson = typeof rawElements === "string" ? rawElements : JSON.stringify(rawElements);

  let screenElements: ScreenElement[] = [];
  try {
    const claudeResponse = await anthropic.messages.create({
      model: ORCHESTRATOR_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: base64Image },
            },
            {
              type: "text",
              text: `You are analyzing an Android screen for UI automation.

Here is the UI Automator element tree (JSON):
${elementsJson}

Look at the screenshot and the element tree above. Return a JSON array of the most important interactive elements visible on screen. For each element include:
- "label": short human-readable name (e.g. "Search bar", "Post button", "Back")
- "description": what this element does or contains
- "center_x": horizontal center pixel coordinate for tapping
- "center_y": vertical center pixel coordinate for tapping
- "bounds": exact bounds string from the element tree (e.g. "[0,100][1080,200]")
- "resource_id": the resource-id from the element tree (empty string if none)
- "clickable": true if the element is clickable or tappable

Prioritize: search bars, input fields, buttons, navigation items, interactive content.
Include elements that have no accessibility label but are visually identifiable as interactive.
Return ONLY a valid JSON array, no explanation, no markdown fences.`,
            },
          ],
        },
      ],
    });

    const responseText = claudeResponse.content[0]?.type === "text"
      ? claudeResponse.content[0].text.trim()
      : "[]";
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const raw = JSON.parse(cleaned);
    screenElements = normalizeScreenElements(Array.isArray(raw) ? raw : []);
  } catch (err) {
    console.error("[buildScreenMapElements] Claude Vision error:", err);
    return {
      ok: false,
      content: `Vision analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      label: "buildScreenMap: vision error",
    };
  }

  const cacheEntry = JSON.stringify({ ok: true, elements: screenElements, count: screenElements.length });
  screenMapCache.set(userId, { ts: Date.now(), result: cacheEntry });
  console.log(`[buildScreenMapElements] userId=${userId} found ${screenElements.length} elements`);

  return { ok: true, elements: screenElements };
}

export const androidScreenUnderstandTool: AgentTool = {
  name: "android_screen_understand",
  description: `Capture and deeply understand the current Android screen by combining a screenshot with the full UI Automator element hierarchy.
Returns a ScreenMap     a structured JSON array of the most important interactive elements, each with: label, description, center_x, center_y (tap coordinates), bounds, resource_id, and clickable flag.

Use this tool when:
- android_read_screen doesn't expose coordinates for the element you need
- You need to find an unlabeled element (icon-only button, search bar with no text)
- Multiple elements share a similar label and you need to disambiguate by position
- You need exact tap coordinates before calling daemon_action with android_tap

After calling this tool, use center_x/center_y from the returned elements as the x/y arguments for android_tap     no coordinate guessing needed.

Results are cached for 500 ms, so two rapid calls will not double-count API usage.`,
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    if (!isAndroidDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it (Profile     Connected Channels     Android Device).",
        label: "android_screen_understand: android offline",
      };
    }

    // Require both screenshot AND read_screen permissions since this tool
    // internally calls android_screenshot and android_view_hierarchy.
    const [screenshotAllowed, readAllowed] = await Promise.all([
      isAndroidDaemonActionAllowed(ctx.userId, "android_screenshot"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_read_screen"),
    ]);
    if (!screenshotAllowed) {
      return {
        ok: false,
        content: "android_screenshot permission is not enabled. Ask the user to enable it in Profile     Connected Channels     Android Device     Permissions.",
        label: "android_screen_understand: screenshot permission denied",
      };
    }
    if (!readAllowed) {
      return {
        ok: false,
        content: "android_read_screen permission is not enabled. Ask the user to enable it in Profile     Connected Channels     Android Device     Permissions.",
        label: "android_screen_understand: read_screen permission denied",
      };
    }

    //        500ms cache check                                                                                                                                                             
    const cached = screenMapCache.get(ctx.userId);
    if (cached && Date.now() - cached.ts < 500) {
      console.log(`[android_screen_understand] userId=${ctx.userId} serving from cache`);
      return { ok: true, content: cached.result, label: "android_screen_understand: cached" };
    }

    // ── Build ScreenMap via shared helper ────────────────────────────────────
    const buildResult = await buildScreenMapElements(ctx.userId);
    if (!buildResult.ok) {
      return { ok: false, content: buildResult.content, label: `android_screen_understand: ${buildResult.label}` };
    }

    const { elements: screenElements } = buildResult;
    const result = JSON.stringify({ ok: true, elements: screenElements, count: screenElements.length });
    console.log(`[android_screen_understand] userId=${ctx.userId} found ${screenElements.length} elements`);

    return {
      ok: true,
      content: result,
      label: `android_screen_understand: ${screenElements.length} elements`,
      detail: `${screenElements.length} interactive elements mapped`,
    };
  },
};

//        Helpers                                                                                                                                                                                                       

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Parse the accessibility text from android_read_screen or android_get_focused_field
 * to check if any focusable field currently has focused=true.
 */
function extractFocusedFieldText(data: unknown): { focused: boolean; text?: string; hint?: string; resourceId?: string } {
  if (!data || typeof data !== "object") return { focused: false };
  const d = data as Record<string, unknown>;
  // android_get_focused_field returns { focused, text, hint, resourceId }
  if (typeof d.focused === "boolean") {
    return {
      focused: d.focused,
      text: typeof d.text === "string" ? d.text : undefined,
      hint: typeof d.hint === "string" ? d.hint : undefined,
      resourceId: typeof d.resourceId === "string" ? d.resourceId : undefined,
    };
  }
  // Fallback: android_read_screen returns raw text     look for focused="true" in XML-like output
  const raw = typeof d.content === "string" ? d.content : typeof d === "string" ? String(d) : "";
  const focused = /focused="true"/i.test(raw) || /\bfocused=true\b/i.test(raw);
  // Try to extract the text from the focused node (between class=... text="..." focused="true")
  const textMatch = raw.match(/focused="true"[^>]*text="([^"]+)"/i)
    || raw.match(/text="([^"]+)"[^>]*focused="true"/i);
  return { focused, text: textMatch?.[1] };
}

/** Check if serialised read_screen output contains any of the given keywords (case-insensitive) */
function screenContains(raw: string, keywords: string[]): boolean {
  const lower = raw.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

//        android_search_in_app                                                                                                                                                                
// High-level macro that orchestrates the full in-app search workflow as a
// resumable, structured sequence. Each step logs its outcome; if any step
// fails, a structured response tells Jarvis exactly where to resume and why.

// ── App-specific search bar detection registry ────────────────────────────────
// Maps known Android package names to search-bar detection hints so the generic
// keyword heuristic is supplemented (or replaced) with reliable app-specific
// signals. The tool checks this map first; generic heuristics are used only as
// a fallback.
interface AppSearchHint {
  /** resource-id substrings to match (case-insensitive partial match) */
  resourceIds: string[];
  /** Additional text / content-desc keywords specific to this app */
  extraKeywords: string[];
  /**
   * When true the search entry point has no visible text label (e.g. TikTok's
   * magnifying-glass icon). Keyword matching is skipped; only resource IDs are
   * tried. The tool must find the element via resource ID alone.
   */
  iconOnly?: boolean;
}

const APP_SEARCH_HINTS: Record<string, AppSearchHint> = {
  "com.facebook.katana": {
    resourceIds: [
      "search_box",
      "search_box_text_field",
      "action_bar_search_text_field",
      "action_search",
      "search_input",
    ],
    extraKeywords: ["search facebook", "search"],
  },
  "com.instagram.android": {
    resourceIds: [
      "action_bar_search_edit_text",
      "search_edit_text",
      "search_bar",
      "igds_search_bar",
    ],
    extraKeywords: ["search"],
  },
  "com.twitter.android": {
    resourceIds: [
      ":id/query",         // full Twitter/X search field resource ID suffix
      "search_src_text",
      "search_bar",
      "toolbar_search_query",
      "search_field",
    ],
    extraKeywords: ["search twitter", "search x", "search"],
  },
  "com.linkedin.android": {
    resourceIds: [
      "com.linkedin.android:id/search_bar_hint",
      "search_bar_hint",
      "search_bar",
      "action_bar_search_text_field",
      "nav_search",
    ],
    extraKeywords: ["search"],
  },
  "com.zhiliaoapp.musically": {
    // TikTok's search is a magnifying-glass icon with no text label.
    // Rely entirely on resource ID — skip keyword matching.
    resourceIds: [
      "et_search",
      "search_bar",
      "action_bar_search",
      "search_icon",
      "title_bar_search",
    ],
    extraKeywords: [],
    iconOnly: true,
  },
};

/**
 * Extract tap coordinates from an accessibility tree node.
 * Returns null when no usable coordinates are present.
 */
function extractNodeCoords(node: Record<string, unknown>): { x: number; y: number } | null {
  const bounds = node.bounds as Record<string, number> | undefined;
  if (
    bounds &&
    typeof bounds.left === "number" &&
    typeof bounds.top === "number" &&
    typeof bounds.right === "number" &&
    typeof bounds.bottom === "number"
  ) {
    return {
      x: Math.round((bounds.left + bounds.right) / 2),
      y: Math.round((bounds.top + bounds.bottom) / 2),
    };
  }
  const cx = node.centerX ?? node.x;
  const cy = node.centerY ?? node.y;
  if (typeof cx === "number" && typeof cy === "number") return { x: cx, y: cy };
  if (typeof node.x === "number" && typeof node.y === "number") {
    return { x: node.x as number, y: node.y as number };
  }
  return null;
}

export const androidSearchInAppTool: AgentTool = {
  name: "android_search_in_app",
  description:
    "High-level macro that performs a complete in-app search on Android as a single resumable sequence: open app     wait for load     detect login walls     locate search bar     tap it (with focus verification)     type query (with text confirmation)     submit     verify results loaded     optional result capture. Returns a structured result with { ok, step_reached, result?, error_at_step?, suggestion? } so Jarvis can tell the user exactly what happened and how to recover. Supply resume_from_step (2-6) after a partial failure to skip the open/load steps and retry from the specific failed step. PREFER this over manually orchestrating individual android_* steps whenever the user asks to search for something inside a specific app.",
  parameters: {
    type: "object",
    properties: {
      app_package: {
        type: "string",
        description: "Android package name of the target app (e.g. \"com.facebook.katana\", \"com.instagram.android\", \"com.twitter.android\")",
      },
      app_name: {
        type: "string",
        description: "Human-readable name of the app (e.g. \"Facebook\", \"Instagram\"). Used in error messages and labels.",
      },
      search_query: {
        type: "string",
        description: "The text to search for inside the app.",
      },
      search_bar_hint: {
        type: "string",
        description: "Optional hint to help identify the search bar     e.g. the placeholder text like \"Search Facebook\" or \"Search Twitter\". When omitted the tool looks for common search bar patterns.",
      },
      action_after_search: {
        type: "string",
        enum: ["screenshot", "read_text"],
        description: "Optional action after search results load: \"screenshot\" returns a base64 PNG of the results; \"read_text\" returns the visible text from the results screen.",
      },
      resume_from_step: {
        type: "number",
        description: "Skip to a specific step (2-6) after a previous partial failure. Use the step_reached value from the prior failure response. Steps 1 (open app) and load-wait are skipped when resuming.",
      },
    },
    required: ["app_package", "app_name", "search_query"],
  },
  async execute(args, ctx) {
    const appPackage = String(args.app_package || "").trim();
    const appName = String(args.app_name || appPackage).trim();
    const searchQuery = String(args.search_query || "").trim();
    const searchBarHint = args.search_bar_hint ? String(args.search_bar_hint).trim() : null;
    const actionAfterSearch = args.action_after_search ? String(args.action_after_search) : null;
    const resumeFromStepRaw = typeof args.resume_from_step === "number" ? Math.floor(args.resume_from_step) : null;
    const resumeFromStep = resumeFromStepRaw;
    if (resumeFromStepRaw !== null && (resumeFromStepRaw < 2 || resumeFromStepRaw > 6)) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: `resume_from_step must be between 2 and 6 (got ${resumeFromStepRaw}). Use the step_reached value returned by a prior partial failure.`,
        }),
      };
    }

    if (!appPackage) return { ok: false, content: JSON.stringify({ ok: false, error: "app_package is required" }) };
    if (!searchQuery) return { ok: false, content: JSON.stringify({ ok: false, error: "search_query is required" }) };

    if (!isAndroidDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          step_reached: 0,
          error_at_step: "preflight",
          error: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it from Profile     Connected Channels     Android Device.",
        }),
      };
    }

    const [canOpenApp, canReadScreen, canTapType] = await Promise.all([
      isAndroidDaemonActionAllowed(ctx.userId, "android_open_app"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_read_screen"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type"),
    ]);

    if (!canOpenApp || !canReadScreen || !canTapType) {
      const missing: string[] = [];
      if (!canOpenApp) missing.push("android_open_app");
      if (!canReadScreen) missing.push("android_read_screen");
      if (!canTapType) missing.push("android_tap_type");
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          step_reached: 0,
          error_at_step: "preflight",
          error: `Missing Android permissions: ${missing.join(", ")}. Ask the user to enable them in Profile     Connected Channels     Android Device     Permissions.`,
        }),
      };
    }

    const label = `android_search_in_app: ${appName}     "${searchQuery.slice(0, 40)}"`;
    console.log(`[${label}] starting${resumeFromStep ? ` (resume from step ${resumeFromStep})` : ""}`);

    // Emit real-time progress to the user.
    //   • If the request arrived via the in-app SSE session (ctx.state.onProgress is set),
    //     use onProgress exclusively — calling notifyUser would create a duplicate inbox
    //     message on top of the streaming SSE indicator, which would be noisy.
    //   • Otherwise (Telegram, Discord, etc.) use notifyUser so the message reaches the
    //     correct external channel. Fire-and-forget so it never blocks execution.
    function emitProgress(message: string): void {
      if (ctx.state.onProgress) {
        ctx.state.onProgress(message);
      } else {
        notifyUser(ctx.userId, "general", message).catch(() => {});
      }
    }

    // Per-step outcome log     included in every response so Jarvis and the user can
    // understand what happened at each stage and which step to retry.
    const stepLog: Array<{ step: number; outcome: string; detail?: string }> = [];

    // Build the search-keyword list once     shared across steps 2 and 3
    const SEARCH_KEYWORDS = ["search", "find", "lookup", "query"];
    if (searchBarHint) SEARCH_KEYWORDS.unshift(searchBarHint.toLowerCase());

    // ── Helper: parse accessibility tree for the best search-bar candidate ────
    // Strategy (in priority order):
    //   1. App-specific resource IDs from APP_SEARCH_HINTS (most reliable — avoids
    //      false positives from coincidental keyword matches)
    //   2. App-specific extra keywords from APP_SEARCH_HINTS (supplement generic list)
    //   3. Generic SEARCH_KEYWORDS fallback (original behaviour for unknown apps)
    // For iconOnly apps (e.g. TikTok) only strategy 1 is attempted because the
    // search entry point has no visible text label.
    function parseSearchElement(raw: string): { found: boolean; x: number | null; y: number | null } {
      const hint = APP_SEARCH_HINTS[appPackage];
      const lower = raw.toLowerCase();

      // Quick presence check — gather all possible signals before the expensive JSON parse.
      const allSignals = hint
        ? [...hint.resourceIds, ...hint.extraKeywords, ...(hint.iconOnly ? [] : SEARCH_KEYWORDS)]
        : SEARCH_KEYWORDS;
      const hasAnySignal = allSignals.some((k) => lower.includes(k.toLowerCase()));

      // Icon-only apps: skip the early return so JSON parsing is still attempted
      // (the resource ID may still be present in the serialised tree).
      if (!hint?.iconOnly && !hasAnySignal) return { found: false, x: null, y: null };

      try {
        const dataObj = JSON.parse(raw);
        const nodes: Array<Record<string, unknown>> = [];
        function collectNodes(obj: unknown) {
          if (!obj || typeof obj !== "object") return;
          if (Array.isArray(obj)) { obj.forEach(collectNodes); return; }
          const o = obj as Record<string, unknown>;
          nodes.push(o);
          Object.values(o).forEach(collectNodes);
        }
        collectNodes(dataObj);

        // ── Strategy 1: app-specific resource ID matching ─────────────────
        if (hint && hint.resourceIds.length > 0) {
          for (const node of nodes) {
            const rid = (
              typeof node.resource_id === "string" ? node.resource_id :
              typeof node.resourceId === "string" ? node.resourceId :
              typeof node["resource-id"] === "string" ? (node["resource-id"] as string) :
              ""
            ).toLowerCase();
            const matchesRid = hint.resourceIds.some((r) => rid.includes(r.toLowerCase()));
            if (!matchesRid) continue;
            const coords = extractNodeCoords(node);
            if (coords) return { found: true, x: coords.x, y: coords.y };
            return { found: true, x: null, y: null };
          }
        }

        // ── Strategy 2 & 3: keyword matching ─────────────────────────────
        // For iconOnly apps (e.g. TikTok) the search entry point has no text label,
        // so keyword matching is meaningless. Return not-found here; Step 2's fallback
        // strategies (home+reopen, swipe-reveal) will retry, and the caller's error
        // message guides the user to tap the icon manually if all attempts fail.
        if (hint?.iconOnly) return { found: false, x: null, y: null };

        const matchKeywords = hint
          ? [...hint.extraKeywords, ...SEARCH_KEYWORDS]
          : SEARCH_KEYWORDS;

        for (const node of nodes) {
          const nodeStr = JSON.stringify(node).toLowerCase();
          const isSearchNode = matchKeywords.some((k) => nodeStr.includes(k));
          if (!isSearchNode) continue;
          const coords = extractNodeCoords(node);
          if (coords) return { found: true, x: coords.x, y: coords.y };
          return { found: true, x: null, y: null };
        }

        return { found: hasAnySignal && !(hint?.iconOnly ?? false), x: null, y: null };
      } catch {
        return { found: hasAnySignal && !(hint?.iconOnly ?? false), x: null, y: null };
      }
    }

    //        Helper: freshly locate the search element from current screen                            
    async function relocateSearchElement(): Promise<{ found: boolean; x: number | null; y: number | null; screenRaw: string }> {
      const r = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
      if (!r.ok) return { found: false, x: null, y: null, screenRaw: "" };
      const raw = JSON.stringify(r.data || "");
      const parsed = parseSearchElement(raw);
      return { ...parsed, screenRaw: raw };
    }

    let screenRaw = "";

    //        Step 1: Open app + wait for load                                                                                                    
    if (!resumeFromStep || resumeFromStep <= 1) {
      emitProgress(`Opening ${appName}…`);
      const openResult = await sendDaemonOp(ctx.userId, { type: "android_open_app", packageName: appPackage }, 20000);
      if (!openResult.ok) {
        emitProgress(`Failed to open ${appName} ✗`);
        return {
          ok: false,
          content: JSON.stringify({
            ok: false,
            step_reached: 1,
            error_at_step: "open_app",
            error: `Failed to open ${appName}: ${openResult.error || "unknown error"}`,
            suggestion: `Make sure ${appName} is installed on the device. You can check installed apps with android_file_list or ask the user.`,
          }),
        };
      }

      // Poll read_screen until no loading spinner or until 12s elapses
      const loadStartedAt = Date.now();
      const loadDeadline = loadStartedAt + 12000;
      let loaded = false;
      while (Date.now() < loadDeadline) {
        await sleep(2000);
        const readResult = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
        if (readResult.ok) {
          screenRaw = JSON.stringify(readResult.data || "");
          const hasSpinner = screenContains(screenRaw, ["loading", "please wait", "spinner", "progress"]);
          if (!hasSpinner) { loaded = true; break; }
          if (Date.now() - loadStartedAt >= 5000 && screenRaw.length > 100) { loaded = true; break; }
        }
      }
      if (!loaded) {
        const finalRead = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
        if (finalRead.ok) { screenRaw = JSON.stringify(finalRead.data || ""); loaded = screenRaw.length > 50; }
      }
      if (!loaded) {
        emitProgress(`${appName} load timed out ✗`);
        return {
          ok: false,
          content: JSON.stringify({
            ok: false,
            step_reached: 1,
            error_at_step: "app_load_timeout",
            error: `${appName} did not finish loading within 12 seconds.`,
            suggestion: "The app may be slow to start, require a network connection, or be stuck. Try android_screenshot to see the current state.",
          }),
        };
      }

      stepLog.push({ step: 1, outcome: "app_loaded" });
      console.log(`[${label}] step 1 complete     app loaded`);
      emitProgress(`${appName} opened ✓`);

      //        Login-wall detection                                                                                                                               
      const loginWallKeywords = ["log in", "login", "sign in", "sign up", "continue as", "create account", "register"];
      if (screenContains(screenRaw, loginWallKeywords)) {
        stepLog.push({ step: 1, outcome: "blocked_by_login_wall" });
        emitProgress(`${appName} requires login — search blocked ✗`);
        return {
          ok: false,
          content: JSON.stringify({
            ok: false,
            step_reached: 1,
            blocked_by_login_wall: true,
            error_at_step: "login_wall",
            error: `${appName} is showing a login or sign-up screen. The user must be logged in before searching.`,
            suggestion: `Ask the user to log into ${appName} manually, then try again. You can use android_screenshot to show them the current state.`,
            steps: stepLog,
          }),
        };
      }
    } else {
      // Resuming from a later step     read current screen state
      const r = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
      if (r.ok) screenRaw = JSON.stringify(r.data || "");
    }

    // Shared coords: populated by step 2 locate logic, used as fallback in step 3 tap loop.
    // Declared outside both step blocks so step 3 can reference them even when step 2 was skipped.
    let searchX: number | null = null;
    let searchY: number | null = null;

    // ── Step 2: Locate search element ─────────────────────────────────────
    // Strategy (fast-path first):
    //   0. Cache fast-path (fresh calls only, not retries):
    //      Use cached (x, y) directly — no screen read. Step 3 verifies focus by
    //      tapping those coords; if step 3 fails the agent retries with
    //      resume_from_step: 2, which clears the stale cache entry and runs the
    //      full discovery loop to find the corrected position.
    //   1. Read current screen as-is
    //   2. Press Home then re-open the app to reach its main screen
    //   3. Swipe down from top to reveal a hidden search bar
    const coordCacheKey = `${ctx.userId}:${appPackage}`;
    if (!resumeFromStep || resumeFromStep <= 2) {
      let searchElementFound = false;

      emitProgress(`Locating search bar in ${appName}…`);

      // ── Cache fast-path (skip discovery on repeat calls) ─────────────────────
      // Applied only on fresh invocations (resumeFromStep is null/undefined).
      // When the agent retries step 2 it means the cached coords failed step 3
      // focus verification — the entry is stale and must be cleared so the
      // discovery loop can locate the correct position.
      if (!resumeFromStep) {
        const cachedSearchCoords = searchBarCoordCache.get(coordCacheKey);
        if (cachedSearchCoords) {
          // Trust cached coordinates directly — no screen read required.
          // Step 3's tap + focus check is the verification gate.
          searchX = cachedSearchCoords.x;
          searchY = cachedSearchCoords.y;
          searchElementFound = true;
          stepLog.push({ step: 2, outcome: "cache_hit", detail: `using cached coordinates (${searchX}, ${searchY}) — discovery loop skipped` });
          console.log(`[${label}] step 2 — cache hit for ${appPackage}: using (${searchX}, ${searchY}) (no screen read)`);
        }
      } else if (resumeFromStep === 2) {
        // Retry path: clear the stale cache entry so this run's discovery result
        // replaces it, and subsequent fresh calls benefit from the new coordinates.
        const hadEntry = searchBarCoordCache.delete(coordCacheKey);
        if (hadEntry) {
          console.log(`[${label}] step 2 — stale cache cleared for ${appPackage} (retry path)`);
        }
      }

      // ── Full 3-attempt discovery loop (cache miss or retry) ──────────────────
      if (!searchElementFound) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (attempt > 1) {
            emitProgress(`Search bar not found, trying strategy ${attempt}/3…`);
          }
          // Always re-read the screen on each attempt so coordinates are fresh
          const located = await relocateSearchElement();
          screenRaw = located.screenRaw || screenRaw;

          if (located.found) {
            searchElementFound = true;
            searchX = located.x;
            searchY = located.y;
            break;
          }

          if (attempt === 1) {
            // Navigate to home then reopen the app so we land on the main screen
            await sendDaemonOp(ctx.userId, { type: "android_press_key", key: "home" }, 10000);
            await sleep(800);
            await sendDaemonOp(ctx.userId, { type: "android_open_app", packageName: appPackage }, 15000);
            await sleep(2000);
          } else if (attempt === 2) {
            // Swipe down from near the top to reveal pull-to-reveal search bars
            await sendDaemonOp(ctx.userId, { type: "android_swipe", x1: 540, y1: 200, x2: 540, y2: 800, durationMs: 400 }, 10000);
            await sleep(800);
          }
        }
      }

      // ── Vision fallback for iconOnly apps (e.g. TikTok) ────────────────────
      // When resource-ID matching fails for an icon-only search entry point, use
      // Claude Vision (android_screen_understand internally) to locate the magnifying-
      // glass icon visually. This avoids asking the user to intervene manually.
      if (!searchElementFound && APP_SEARCH_HINTS[appPackage]?.iconOnly) {
        emitProgress(`Trying vision-based search button detection…`);
        stepLog.push({ step: 2, outcome: "vision_fallback_attempt", detail: "resource IDs not found; trying vision-based detection for icon-only search button" });
        console.log(`[${label}] step 2 — iconOnly app: resource IDs exhausted, attempting vision fallback via buildScreenMapElements`);

        const canScreenshot = await isAndroidDaemonActionAllowed(ctx.userId, "android_screenshot");
        if (canScreenshot) {
          const visionResult = await buildScreenMapElements(ctx.userId);
          if (visionResult.ok) {
            // Prefer elements with strong search semantics before falling back to
            // generic terms ("find", "lookup") that could match unrelated UI.
            // Tier 1: "search" or "magnif" (magnifying glass) — unambiguous search signals
            // Tier 2: "find" or "lookup" — only tried when tier 1 yields nothing
            const SEARCH_VISION_TIER1 = ["search", "magnif"];
            const SEARCH_VISION_TIER2 = ["find", "lookup"];
            const findByTerms = (terms: string[]) =>
              visionResult.elements.find((el) => {
                const combined = `${el.label} ${el.description}`.toLowerCase();
                return terms.some((term) => combined.includes(term));
              });
            const searchVisionElement = findByTerms(SEARCH_VISION_TIER1) ?? findByTerms(SEARCH_VISION_TIER2);

            if (searchVisionElement) {
              searchElementFound = true;
              searchX = typeof searchVisionElement.center_x === "number" ? searchVisionElement.center_x : null;
              searchY = typeof searchVisionElement.center_y === "number" ? searchVisionElement.center_y : null;
              stepLog.push({
                step: 2,
                outcome: "vision_fallback_success",
                detail: `vision found "${searchVisionElement.label}" at (${searchX}, ${searchY}): ${searchVisionElement.description}`,
              });
              console.log(`[${label}] step 2 — vision fallback succeeded: "${searchVisionElement.label}" at (${searchX}, ${searchY})`);
            } else {
              stepLog.push({ step: 2, outcome: "vision_fallback_no_match", detail: `vision returned ${visionResult.elements.length} elements but none matched search/magnifying-glass terms` });
              console.log(`[${label}] step 2 — vision fallback found no search element among ${visionResult.elements.length} elements`);
            }
          } else {
            stepLog.push({ step: 2, outcome: "vision_fallback_error", detail: "buildScreenMapElements failed — screenshot or vision unavailable" });
            console.log(`[${label}] step 2 — vision fallback failed: buildScreenMapElements returned not-ok`);
          }
        } else {
          stepLog.push({ step: 2, outcome: "vision_fallback_skipped", detail: "android_screenshot permission not granted; cannot use vision fallback" });
          console.log(`[${label}] step 2 — vision fallback skipped: android_screenshot permission not granted`);
        }
      }

      if (!searchElementFound) {
        const isIconOnly = !!APP_SEARCH_HINTS[appPackage]?.iconOnly;
        const locationSummary = isIconOnly
          ? "3 accessibility-tree strategies (current screen, home+reopen, swipe-reveal) and a vision-based fallback"
          : "3 location strategies (current screen, home+reopen, swipe-reveal)";
        stepLog.push({ step: 2, outcome: "failed", detail: `search element not found after ${locationSummary}` });
        emitProgress(`Search bar not found in ${appName} after 3 attempts ✗`);
        return {
          ok: false,
          content: JSON.stringify({
            ok: false,
            step_reached: 2,
            error_at_step: "locate_search_bar",
            error: `Could not find a search bar in ${appName} after ${locationSummary}.`,
            suggestion: "Use android_read_screen to inspect the current screen, then android_tap the search icon manually. Some apps hide the search bar behind a magnifying glass icon. If found, retry with resume_from_step: 3.",
            steps: stepLog,
          }),
        };
      }

      // ── Cache write: persist newly discovered coordinates ─────────────────────
      // Compare against the current map entry (may have been updated by the cache-hit
      // path above). Write only when: (a) no entry exists yet, or (b) the coords
      // differ by more than 30 px (stale cache — the discovery loop found new ones).
      // This handles first-time writes, stale-cache refreshes, and avoids no-op rewrites.
      if (searchX !== null && searchY !== null) {
        const currentEntry = searchBarCoordCache.get(coordCacheKey);
        const isFirstWrite = !currentEntry;
        const coordsDiffer = currentEntry &&
          (Math.abs(searchX - currentEntry.x) > 30 || Math.abs(searchY - currentEntry.y) > 30);
        if (isFirstWrite || coordsDiffer) {
          searchBarCoordCache.set(coordCacheKey, { x: searchX, y: searchY });
          console.log(`[${label}] step 2 — ${isFirstWrite ? "cached" : "cache refreshed"}: (${searchX}, ${searchY}) for ${appPackage}`);
        }
      }

      stepLog.push({ step: 2, outcome: "success", detail: `found at (${searchX}, ${searchY})` });
      console.log(`[${label}] step 2 complete — search element found at (${searchX}, ${searchY})`);
      emitProgress(`Search bar found ✓`);
    }

    // ── Step 3: Tap search bar with locate-then-act loop ──────────────────
    // Kept as a separate resumable step so resume_from_step: 3 re-runs only the
    // tap/focus-verify logic without repeating the full locate strategies above.
    // On the first attempt: use coordinates already established by step 2 (cache
    // hit or fresh discovery) without an extra screen read. On subsequent attempts
    // (focus not yet verified): re-locate to get fresher coordinates in case the
    // layout shifted between step 2 and the tap.
    if (!resumeFromStep || resumeFromStep <= 3) {
      let tapVerified = false;
      for (let attempt = 1; attempt <= 4; attempt++) {
        emitProgress(
          attempt === 1
            ? `Tapping search bar, verifying focus…`
            : `Retrying tap (attempt ${attempt}/4)…`,
        );

        let tapX: number | null = null;
        let tapY: number | null = null;

        if (attempt === 1 && searchX !== null && searchY !== null) {
          // First attempt: trust coordinates from step 2 (cache hit or discovery) —
          // no extra screen read needed, saving one round-trip.
          tapX = searchX;
          tapY = searchY;
        } else {
          // Subsequent attempts or no prior coords: re-locate for fresh coordinates.
          const freshLocated = await relocateSearchElement();
          screenRaw = freshLocated.screenRaw || screenRaw;
          tapX = freshLocated.x ?? searchX;
          tapY = freshLocated.y ?? searchY;
        }

        if (tapX !== null && tapY !== null) {
          await sendDaemonOp(ctx.userId, { type: "android_tap", x: tapX, y: tapY }, 10000);
        } else {
          // Last resort: tap the top-centre of the screen where search bars commonly live
          await sendDaemonOp(ctx.userId, { type: "android_tap", x: 540, y: 150 }, 10000);
        }
        await sleep(1200);

        const afterTap = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
        if (afterTap.ok) {
          const afterRaw = JSON.stringify(afterTap.data || "");
          // Strong signal: accessibility explicitly reports an active input field.
          // "isFocused\":true" / "focused\":true" appear in most Android a11y trees
          // when an EditText is active; "inputmethod" indicates the keyboard is shown.
          // Deliberately avoids "cursor" (too generic) and "keyboard" alone (varies by app).
          const isFocused = screenContains(afterRaw, ["\"isFocused\":true", "\"focused\":true", "inputmethod", "edittext"]);
          // Acceptable weaker signal: screen transitioned to a dedicated search activity.
          // "Cancel" (standalone) + a search keyword is specific to search UX patterns
          // in apps like Facebook, Instagram, Twitter. Excludes generic commerce "cancel".
          const isSearchActivity = screenContains(afterRaw, ["\"cancel\"", "cancel\""]) &&
            !screenContains(afterRaw, ["cancel subscription", "cancel order", "cancel payment", "cancel booking"]) &&
            screenContains(afterRaw, SEARCH_KEYWORDS);
          stepLog.push({ step: 3, outcome: tapVerified ? "focus_ok" : "checking", detail: `attempt ${attempt}: isFocused=${isFocused} isSearchActivity=${isSearchActivity}` });
          if (isFocused || isSearchActivity) {
            screenRaw = afterRaw;
            tapVerified = true;
            break;
          }
        }
      }

      if (!tapVerified) {
        stepLog.push({ step: 3, outcome: "failed", detail: "4 tap attempts, no focus confirmed" });
        emitProgress(`Could not focus search bar after 4 taps ✗`);
        return {
          ok: false,
          content: JSON.stringify({
            ok: false,
            step_reached: 3,
            error_at_step: "tap_search_bar",
            error: `Tapped the search element 4 times but could not confirm focus in ${appName}. The app may have navigated to a separate search activity with a non-standard accessibility layout.`,
            suggestion: "Use android_read_screen to check the current screen, then tap the visible input field manually with android_tap. Once focused, retry with resume_from_step: 4.",
            steps: stepLog,
          }),
        };
      }

      stepLog.push({ step: 3, outcome: "success" });
      console.log(`[${label}] step 3 complete     search bar focused`);
      emitProgress(`Search bar tapped, keyboard open ✓`);
    }

    //        Step 4: Focus-verify     type     confirm text appeared                                              
    if (!resumeFromStep || resumeFromStep <= 4) {
      // Confirm focus before typing (skip re-verify if we just verified in step 3)
      if (resumeFromStep === 4) {
        const focusCheck = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
        if (focusCheck.ok) {
          const fcRaw = JSON.stringify(focusCheck.data || "");
          const isFocused = screenContains(fcRaw, ["focused", "edittext", "cursor", "inputmethod", "keyboard"]);
          screenRaw = fcRaw;
          if (!isFocused) {
            emitProgress(`Search field lost focus — cannot type ✗`);
            return {
              ok: false,
              content: JSON.stringify({
                ok: false,
                step_reached: 4,
                error_at_step: "type_query_no_focus",
                error: `Resumed at step 4 but the search field no longer appears focused in ${appName}.`,
                suggestion: "Retry from step 3 (resume_from_step: 3) to re-tap and focus the search bar.",
              }),
            };
          }
        }
      }

      emitProgress(`Typing "${searchQuery.slice(0, 40)}${searchQuery.length > 40 ? "…" : ""}"…`);
      await sendDaemonOp(ctx.userId, { type: "android_type", text: searchQuery }, 15000);
      await sleep(800);

      // Confirm the query text appeared on screen
      const afterType = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
      let typeVerified = false;
      if (afterType.ok) {
        const afterTypeRaw = JSON.stringify(afterType.data || "");
        const queryWords = searchQuery.split(/\s+/).filter((w) => w.length > 1);
        typeVerified = queryWords.length === 0 ||
          queryWords.some((w) => afterTypeRaw.toLowerCase().includes(w.toLowerCase()));
        screenRaw = afterTypeRaw;
      }

      if (!typeVerified) {
        stepLog.push({ step: 4, outcome: "failed", detail: "query text not found in screen after android_type" });
        emitProgress(`Text did not appear in search field ✗`);
        return {
          ok: false,
          content: JSON.stringify({
            ok: false,
            step_reached: 4,
            error_at_step: "type_query",
            error: `Typed "${searchQuery.slice(0, 60)}" but could not confirm the text appeared in ${appName}'s search field.`,
            suggestion: "The keyboard may not have appeared or the field lost focus. Use android_screenshot to inspect the state, then retry from step 3 (resume_from_step: 3).",
            steps: stepLog,
          }),
        };
      }

      stepLog.push({ step: 4, outcome: "success", detail: `query confirmed in accessibility tree` });
      console.log(`[${label}] step 4 complete     query typed and confirmed`);
      emitProgress(`Query entered ✓`);
    }

    //        Step 5: Submit search and verify results loaded                                                             
    if (!resumeFromStep || resumeFromStep <= 5) {
      emitProgress(`Submitting search…`);
      // Capture pre-submit screen fingerprint: length + node count for change detection
      const preSubmitLen = screenRaw.length;
      const preSubmitNodeCount = (screenRaw.match(/"type"|"className"|"contentDesc"/g) || []).length;

      // Primary: send Enter/newline     triggers IME Search/Go action on most keyboards
      await sendDaemonOp(ctx.userId, { type: "android_type", text: "\n" }, 10000);
      await sleep(2500);

      function isResultsState(raw: string): boolean {
        // Results screen criteria (all must be true):
        // 1. Keyboard/IME has been dismissed     no active input method in a11y tree
        const keyboardDismissed = !screenContains(raw, ["\"inputmethod\"", "inputmethod_service", "\"isFocused\":true", "\"focused\":true"]);
        // 2. Screen content changed significantly     more nodes than the typing state
        const newNodeCount = (raw.match(/"type"|"className"|"contentDesc"/g) || []).length;
        const contentGrew = newNodeCount > preSubmitNodeCount + 2 || raw.length > preSubmitLen + 300;
        // 3. Screen is not showing an error dialog that typically indicates failure
        const isErrorDialog = screenContains(raw, ["network error", "something went wrong", "no connection", "retry"]) &&
          !screenContains(raw, SEARCH_KEYWORDS);
        return keyboardDismissed && contentGrew && !isErrorDialog;
      }

      const afterSearch = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
      let resultsLoaded = false;
      if (afterSearch.ok) {
        const afterSearchRaw = JSON.stringify(afterSearch.data || "");
        resultsLoaded = isResultsState(afterSearchRaw);
        screenRaw = afterSearchRaw;
        stepLog.push({ step: 5, outcome: "enter_sent", detail: `resultsLoaded=${resultsLoaded} after Enter` });
      }

      // Fallback: locate and tap a visible search/go button
      if (!resultsLoaded) {
        emitProgress(`Retrying submission via search button…`);
        const btnLocated = await relocateSearchElement();
        if (btnLocated.found && btnLocated.x !== null && btnLocated.y !== null) {
          await sendDaemonOp(ctx.userId, { type: "android_tap", x: btnLocated.x, y: btnLocated.y }, 10000);
          await sleep(2500);
          const retryRead = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
          if (retryRead.ok) {
            const retryRaw = JSON.stringify(retryRead.data || "");
            resultsLoaded = isResultsState(retryRaw);
            screenRaw = retryRaw;
            stepLog.push({ step: 5, outcome: "button_tap_fallback", detail: `resultsLoaded=${resultsLoaded} after button tap` });
          }
        }
      }

      // Step 5 is strict     if results did not load after both attempts, return a structured failure
      if (!resultsLoaded) {
        stepLog.push({ step: 5, outcome: "failed", detail: "results screen not detected after Enter + button tap" });
        emitProgress(`Search results did not load ✗`);
        return {
          ok: false,
          content: JSON.stringify({
            ok: false,
            step_reached: 5,
            error_at_step: "execute_search",
            error: `Search was submitted in ${appName} but the results screen did not appear. The app may require a different submission method, may have shown a network error, or may not have recognised the search input.`,
            suggestion: "Use android_screenshot to see the current state. If results are visually present but the accessibility tree is sparse, retry with resume_from_step: 6 and action_after_search: 'screenshot'.",
            steps: stepLog,
          }),
        };
      }

      stepLog.push({ step: 5, outcome: "success" });
      console.log(`[${label}] step 5 complete     results loaded`);
      emitProgress(`Search results loaded ✓`);
    }

    //        Step 6: Optional result action                                                                                                             
    let resultContent: string | undefined;
    let screenshotB64: string | undefined;

    if (actionAfterSearch === "screenshot") {
      const canScreenshot = await isAndroidDaemonActionAllowed(ctx.userId, "android_screenshot");
      if (canScreenshot) {
        const ssResult = await sendDaemonOp(ctx.userId, { type: "android_screenshot" }, 20000);
        if (ssResult.ok && ssResult.data) {
          const ssData = ssResult.data as Record<string, unknown>;
          screenshotB64 = typeof ssData.image === "string" ? ssData.image
            : typeof ssData.screenshot === "string" ? ssData.screenshot
            : undefined;
        }
      }
    } else if (actionAfterSearch === "read_text") {
      const readResult = await sendDaemonOp(ctx.userId, { type: "android_read_screen" }, 15000);
      if (readResult.ok && readResult.data) {
        resultContent = JSON.stringify(readResult.data).slice(0, 8000);
      }
    }

    stepLog.push({ step: 6, outcome: actionAfterSearch ?? "none" });

    const response: Record<string, unknown> = {
      ok: true,
      step_reached: 6,
      app: appName,
      query: searchQuery,
      results_loaded: true,
      steps: stepLog,
    };
    if (resultContent !== undefined) response.result = resultContent;
    if (screenshotB64 !== undefined) response.screenshot = screenshotB64;

    console.log(`[${label}] done     ok=true step_reached=6`);

    const isScreenshot = actionAfterSearch === "screenshot" && screenshotB64;
    return {
      ok: true,
      content: isScreenshot ? JSON.stringify(response) : JSON.stringify(response).slice(0, 12000),
      label,
    };
  },
};

export const androidTypeInFieldTool: AgentTool = {
  name: "android_type_in_field",
  description: `Reliable text input for Android fields. Wraps the full focus-verify     input     confirm sequence:

1. CONFIRM FOCUS: checks if the target field is currently focused using android_get_focused_field.
   If not focused and tap coordinates are provided, taps the field and waits 300 ms for the keyboard to open, then re-checks.

2. INPUT     three-level fallback chain, each dispatched explicitly:
   - Level 1 (android_type): accessibility service ACTION_SET_TEXT     fastest path, works in standard EditText fields
   - Level 2 (android_paste_text): daemon tries "input text" exec (adb-style, %%s escaping) first, then clipboard + ACTION_PASTE     designed for custom-IME fields (Facebook/Instagram search, WebView inputs)
   - Level 3 (android_paste_text retry): explicit retry when Level 2 fails transiently; server escalates from android_type to android_paste_text on verification failure

3. VERIFY: reads the field text after input and confirms it matches what was expected.

4. RESULT: returns { ok, method_used, verified, field_text, steps }.

Use this instead of android_type when:
- Typing fails silently (field shows no text after android_type)
- The field uses a custom input method (e.g. Facebook / Instagram search bars that open a new activity)
- The accessibility service loses focus tracking between tap and type

Requires android_tap_type permission to be enabled.`,
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to type into the field.",
      },
      tap_x: {
        type: "number",
        description: "X pixel coordinate to tap in order to focus the field. Provide if the field is not yet focused.",
      },
      tap_y: {
        type: "number",
        description: "Y pixel coordinate to tap in order to focus the field. Provide if the field is not yet focused.",
      },
      field_description: {
        type: "string",
        description: "Human-readable description of the target field     used in logs and result output (e.g. 'Facebook search bar').",
      },
      submit: {
        type: "boolean",
        description: "If true, press Enter/submit after successfully typing. Default false.",
      },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    const text = String(args.text || "").trim();
    if (!text) {
      return { ok: false, content: "text is required.", label: "android_type_in_field: no text" };
    if (!isAndroidDaemonActive(ctx.userId)) {
    }
      return {
        ok: false,
        content: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it (Profile     Connected Channels     Android Device).",
        label: "android_type_in_field: android offline",
      };
    }

    const tapTypeAllowed = await isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type");
    if (!tapTypeAllowed) {
      return {
        ok: false,
        content: "android_tap_type permission is not enabled. Ask the user to enable it in Profile     Connected Channels     Android Device     Permissions.",
        label: "android_type_in_field: permission denied",
      };
    }

    const fieldDesc = args.field_description ? String(args.field_description) : "input field";
    const hasTapCoords = typeof args.tap_x === "number" && typeof args.tap_y === "number";
    const steps: string[] = [];

    //        Step 1: Confirm focus                                                                                                                                                    
    steps.push("Checking field focus...");
    let focusResult = await sendDaemonOp(ctx.userId, { type: "android_get_focused_field" }, 8000);
    let focusInfo = extractFocusedFieldText(focusResult.data);

    if (!focusInfo.focused) {
      if (hasTapCoords) {
        steps.push(`Field not focused     tapping (${args.tap_x}, ${args.tap_y}) to focus...`);
        await sendDaemonOp(ctx.userId, { type: "android_tap", x: args.tap_x as number, y: args.tap_y as number }, 8000);
        await sleep(300);
        focusResult = await sendDaemonOp(ctx.userId, { type: "android_get_focused_field" }, 8000);
        focusInfo = extractFocusedFieldText(focusResult.data);
        if (focusInfo.focused) {
          steps.push("Field is now focused.");
        } else {
          steps.push("Field still not focused after tap     attempting input anyway.");
        }
      } else {
        steps.push("Field not focused and no tap coordinates provided     attempting input on current focused element.");
      }
    } else {
      steps.push(`Field is focused${focusInfo.resourceId ? ` (${focusInfo.resourceId})` : ""}.`);
    }

    //        Step 2: Three-level input fallback chain                                                                                           
    let methodUsed: string | null = null;
    let inputOk = false;
    let daemonVerified = false;
    let fieldText: string | null = null;

    //        Level 1: android_type (accessibility ACTION_SET_TEXT)                                                    
    steps.push("Level 1     android_type (accessibility ACTION_SET_TEXT)...");
    const typeResult = await sendDaemonOp(ctx.userId, { type: "android_type", text }, 10000);
    if (typeResult.ok) {
      methodUsed = "android_type";
      inputOk = true;
      steps.push("android_type accepted by accessibility service.");
    } else {
      steps.push(`android_type failed (${typeResult.error || "no editable field focused"}). Moving to Level 2.`);
    }

    //        Level 2: android_paste_text (adb input text     clipboard fallback)                
    if (!inputOk) {
      steps.push("Level 2     android_paste_text (adb input text primary, clipboard fallback)...");
      const pasteResult = await sendDaemonOp(ctx.userId, { type: "android_paste_text", text, fieldDescription: fieldDesc }, 15000);
      if (pasteResult.ok) {
        const pasteData = (pasteResult.data || {}) as Record<string, unknown>;
        const daemonMethod = typeof pasteData.method_used === "string" ? pasteData.method_used : "unknown";
        methodUsed = `android_paste_text:${daemonMethod}`;
        inputOk = true;
        daemonVerified = pasteData.verified === true;
        fieldText = typeof pasteData.field_text === "string" ? pasteData.field_text : null;
        steps.push(`android_paste_text succeeded via ${daemonMethod}. Daemon verified: ${daemonVerified}.`);
      } else {
        steps.push(`android_paste_text failed (${pasteResult.error || "unknown error"}). Moving to Level 3.`);
      }
    }

    //        Level 3: Clipboard-only retry (skips adb exec path)                                                       
    if (!inputOk) {
      steps.push("Level 3     android_paste_text retry (clipboard-only path)...");
      const retryResult = await sendDaemonOp(ctx.userId, { type: "android_paste_text", text, fieldDescription: fieldDesc }, 15000);
      if (retryResult.ok) {
        const retryData = (retryResult.data || {}) as Record<string, unknown>;
        const retryMethod = typeof retryData.method_used === "string" ? retryData.method_used : "unknown";
        methodUsed = `android_paste_text:${retryMethod}:L3`;
        inputOk = true;
        daemonVerified = retryData.verified === true;
        fieldText = typeof retryData.field_text === "string" ? retryData.field_text : null;
        steps.push(`Level 3 retry succeeded via ${retryMethod}. Daemon verified: ${daemonVerified}.`);
      } else {
        steps.push(`Level 3 retry failed (${retryResult.error || "unknown"}). All input methods exhausted.`);
      }
    }

    if (!inputOk) {
      steps.push("All three input levels failed.");
      const summary = { ok: false, method_used: null, verified: false, field_text: null, steps, field: fieldDesc };
      console.log(`[android_type_in_field] userId=${ctx.userId} field="${fieldDesc}" ALL_FAILED`);
      return {
        ok: false,
        content: JSON.stringify(summary),
        label: `android_type_in_field: all levels failed for "${fieldDesc}"`,
        detail: steps.join(" | "),
      };
    }

    //        Step 3: Server-side verification                                                                                                                   
    let verified = daemonVerified;

    if (methodUsed === "android_type" || !daemonVerified) {
      await sleep(200);
      steps.push("Verifying text appeared in field via android_get_focused_field...");
      const verifyResult = await sendDaemonOp(ctx.userId, { type: "android_get_focused_field" }, 8000);
      const verifyInfo = extractFocusedFieldText(verifyResult.data);
      fieldText = verifyInfo.text ?? null;

      const isPassword = (verifyResult.data as Record<string, unknown> | null)?.isPassword === true;
      verified = isPassword
        ? verifyInfo.focused
        : typeof fieldText === "string" && (
            fieldText === text ||
            fieldText.trim() === text.trim() ||
            fieldText.includes(text)
          );

      if (!verified && methodUsed === "android_type") {
        steps.push(`Verification failed after android_type (field: "${fieldText ?? "empty"}")     escalating to android_paste_text...`);
        const escalateResult = await sendDaemonOp(ctx.userId, { type: "android_paste_text", text, fieldDescription: fieldDesc }, 15000);
        if (escalateResult.ok) {
          const esc = (escalateResult.data || {}) as Record<string, unknown>;
          const escMethod = typeof esc.method_used === "string" ? esc.method_used : "unknown";
          methodUsed = `android_paste_text:${escMethod}:escalated`;
          daemonVerified = esc.verified === true;
          fieldText = typeof esc.field_text === "string" ? esc.field_text : null;
          verified = daemonVerified;
          steps.push(`Escalation to android_paste_text succeeded via ${escMethod}. Verified: ${verified}.`);
        } else {
          steps.push(`android_paste_text escalation failed: ${escalateResult.error || "unknown"}`);
        }
      }

      if (verified) {
        steps.push("Verification passed: text confirmed in field.");
      } else {
        steps.push(`Verification inconclusive: field text="${fieldText ?? "empty"}". Field may hide text (custom IME, password) or accessibility tree not updated yet.`);
      }
    }

    //        Step 4: Optional submit                                                                                                                                                 
    if (args.submit && inputOk) {
      await sendDaemonOp(ctx.userId, { type: "android_press_key", key: "enter" }, 6000);
      steps.push("Submitted (IME Enter/Go key pressed).");
    }

    const summary = { ok: inputOk, method_used: methodUsed, verified, field_text: fieldText, steps, field: fieldDesc };
    console.log(`[android_type_in_field] userId=${ctx.userId} field="${fieldDesc}" method=${methodUsed} verified=${verified}`);
    return {
      ok: inputOk,
      content: JSON.stringify(summary),
      label: `android_type_in_field: "${text.slice(0, 30)}"     ${methodUsed} verified=${verified}`,
      detail: steps.join(" | "),
    };
  },
};
// ── android_tap_element ────────────────────────────────────────────────────────
// Uses the ScreenMap (Vision-based) to locate an element by fuzzy label match,
// then taps it with a locate-tap-verify retry loop (up to 4 attempts).
// Reuses the screenMapCache so a prior android_screen_understand call within
// 500 ms incurs no extra Vision cost.

// ── normalizeScreenElements ────────────────────────────────────────────────────
// LLM-generated JSON may have missing/null fields or non-numeric coordinates.
// Drop malformed entries so downstream code can assume a valid ScreenElement shape.
function normalizeScreenElements(raw: unknown[]): ScreenElement[] {
  return raw.flatMap((el) => {
    if (!el || typeof el !== "object") return [];
    const e = el as Record<string, unknown>;
    const cx = Number(e.center_x);
    const cy = Number(e.center_y);
    if (!isFinite(cx) || !isFinite(cy)) return [];
    return [{
      label: String(e.label ?? ""),
      description: String(e.description ?? ""),
      center_x: cx,
      center_y: cy,
      bounds: String(e.bounds ?? ""),
      resource_id: String(e.resource_id ?? ""),
      clickable: Boolean(e.clickable),
    }];
  });
}

function scoreElement(element: ScreenElement, query: string): number {
  const q = query.toLowerCase().trim();
  // Safely stringify all fields (normalizeScreenElements guarantees strings, but
  // be defensive here since scoreElement may be called from other contexts).
  const resourceId = String(element.resource_id ?? "");
  const resourceIdLocal = resourceId.includes("/") ? (resourceId.split("/").pop() ?? "") : "";
  const fields = [
    String(element.label ?? ""),
    String(element.description ?? ""),
    resourceId,
    resourceIdLocal,
  ].map((f) => f.toLowerCase());

  let textScore = 0;
  for (const field of fields) {
    if (!field) continue;
    if (field === q) { textScore = 100; break; }
  }
  if (textScore === 0) {
    for (const field of fields) {
      if (!field) continue;
      if (field.startsWith(q)) { textScore = 80; break; }
    }
  }
  if (textScore === 0) {
    for (const field of fields) {
      if (!field) continue;
      if (field.includes(q)) { textScore = 60; break; }
    }
  }
  // token-level: every word in query present in some field
  if (textScore === 0) {
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      for (const field of fields) {
        if (!field) continue;
        if (words.every((w) => field.includes(w))) { textScore = 50; break; }
      }
      if (textScore === 0) {
        for (const field of fields) {
          if (!field) continue;
          if (words.some((w) => field.includes(w))) { textScore = 30; break; }
        }
      }
    }
  }

  if (textScore === 0) return 0;

  // Boost score by 1 for clickable elements so ties always resolve in favour of
  // tappable UI components over non-interactive containers with matching labels.
  return element.clickable ? textScore + 1 : textScore;
}

interface ClickableElement {
  label: string;
  x: number;
  y: number;
  resourceId?: string;
  contentDesc?: string;
}

function matchStringScore(field: string, query: string): number {
  const f = field.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!f || !q) return 0;
  if (f === q) return 100;
  if (f.startsWith(q)) return 80;
  if (f.includes(q)) return 60;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    if (words.every((w) => f.includes(w))) return 50;
    if (words.some((w) => f.includes(w))) return 30;
  }
  return 0;
}

function findBestElement(
  clickable: ClickableElement[],
  targetDescription: string,
): ClickableElement | null {
  let best: ClickableElement | null = null;
  let bestScore = 0;
  for (const el of clickable) {
    const resourceIdLocal = el.resourceId?.includes("/")
      ? (el.resourceId.split("/").pop() ?? "")
      : (el.resourceId ?? "");
    const score = Math.max(
      matchStringScore(el.label, targetDescription),
      el.resourceId ? matchStringScore(el.resourceId, targetDescription) : 0,
      matchStringScore(resourceIdLocal, targetDescription),
      el.contentDesc ? matchStringScore(el.contentDesc, targetDescription) : 0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Capture a screenshot and return base64 string, or null on failure. */
async function captureScreenshot(userId: string): Promise<string | null> {
  const res = await sendDaemonOp(userId, { type: "android_screenshot" }, 15000);
  if (!res.ok) return null;
  const d = res.data as Record<string, unknown> | undefined;
  if (!d) return null;
  const img = (d.image || d.screenshot || d.base64) as string | undefined;
  if (typeof img === "string" && img.length > 100) return img;
  // Some daemons return the whole data object as the image
  if (typeof res.data === "string" && (res.data as string).length > 100) return res.data as string;
  return null;
}

/** Read the screen and return the clickable element list. */
async function readScreen(userId: string): Promise<ClickableElement[]> {
  const res = await sendDaemonOp(userId, { type: "android_read_screen" }, 20000);
  if (!res.ok || !res.data) return [];
  const d = res.data as Record<string, unknown>;
  const clickable = d.clickable;
  if (!Array.isArray(clickable)) return [];
  const raw = clickable as Record<string, unknown>[];
  const valid = raw.filter((el) => {
    if (!el || typeof el.x !== "number" || typeof el.y !== "number") return false;
    const hasLabel = typeof el.label === "string" && (el.label as string).length > 0;
    const hasResourceId = typeof el.resource_id === "string" && (el.resource_id as string).length > 0;
    return hasLabel || hasResourceId;
  });
  return valid.map((el) => ({
    label: typeof el.label === "string" ? el.label : "",
    x: el.x as number,
    y: el.y as number,
    resourceId: typeof el.resource_id === "string" && el.resource_id ? el.resource_id : undefined,
    contentDesc: typeof el.content_desc === "string" && el.content_desc ? el.content_desc : undefined,
  }));
}

// ── android_swipe_element ──────────────────────────────────────────────────────
// Fuzzy-matches a label/description string against the ScreenMap and fires an
// android_swipe gesture starting from the best-matching element's center, in the
// requested direction. Reuses the screenMapCache (500 ms TTL) just like
// android_tap_element so a prior android_screen_understand call costs nothing.

export const androidSwipeElementTool: AgentTool = {
  name: "android_swipe_element",
  description: `Swipe or scroll on an Android screen element by name instead of raw coordinates.
Accepts a human-readable label or description string, fuzzy-matches it against the current ScreenMap (calling android_screen_understand internally, with a 500 ms cache hit if available), and fires an android_swipe gesture centred on the best-matching element.

Use this tool to scroll lists, swipe carousels, or dismiss elements without knowing pixel coordinates:
  - "swipe up on the feed" — scrolls a feed upward
  - "swipe left on the photo" — advances a carousel
  - "scroll down in the settings list"

Parameters:
  - label: human-readable name of the element to swipe on
  - direction: one of "up", "down", "left", "right"
  - distance_px: how far to swipe in pixels (default 400)
  - max_age_ms: max age of cached ScreenMap to reuse (default 500, 0 = always fresh)

Returns the matched element details and the swipe coordinates used.

Requires: android_screenshot and android_read_screen permissions (same as android_screen_understand), plus android_tap_type permission for the swipe action.`,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "The label, description, or resource_id (or part thereof) of the element to swipe on. Case-insensitive fuzzy match.",
      },
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Direction to swipe: 'up' scrolls content upward (finger moves up), 'down' scrolls content downward, 'left' or 'right' for horizontal swipes.",
      },
      distance_px: {
        type: "number",
        description: "Distance to swipe in pixels (default 400).",
      },
      max_age_ms: {
        type: "number",
        description: "Maximum age in milliseconds for a cached ScreenMap to be reused (default 500). Set to 0 to always capture a fresh screen.",
      },
    },
    required: ["label", "direction"],
  },
  async execute(args, ctx) {
    const label = String(args.label || "").trim();
    if (!label) {
      return { ok: false, content: "label is required.", label: "android_swipe_element: no label" };
    }

    const direction = String(args.direction || "").toLowerCase().trim();
    if (!["up", "down", "left", "right"].includes(direction)) {
      return { ok: false, content: `direction must be one of: up, down, left, right. Got: "${direction}"`, label: "android_swipe_element: invalid direction" };
    }

    if (!isAndroidDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it (Profile → Connected Channels → Android Device).",
        label: "android_swipe_element: android offline",
      };
    }

    // Permission checks
    const [screenshotAllowed, readAllowed, swipeAllowed] = await Promise.all([
      isAndroidDaemonActionAllowed(ctx.userId, "android_screenshot"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_read_screen"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type"),
    ]);
    if (!screenshotAllowed) {
      return {
        ok: false,
        content: "android_screenshot permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_swipe_element: screenshot permission denied",
      };
    }
    if (!readAllowed) {
      return {
        ok: false,
        content: "android_read_screen permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_swipe_element: read_screen permission denied",
      };
    }
    if (!swipeAllowed) {
      return {
        ok: false,
        content: "android_tap_type permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_swipe_element: swipe permission denied",
      };
    }

    // ── Resolve ScreenMap (cache or fresh) ────────────────────────────────────
    const maxAge = typeof args.max_age_ms === "number" ? args.max_age_ms : 500;
    let screenElements: ScreenElement[] = [];

    const cached = screenMapCache.get(ctx.userId);
    if (cached && maxAge > 0 && Date.now() - cached.ts <= maxAge) {
      console.log(`[android_swipe_element] userId=${ctx.userId} using cached ScreenMap`);
      try {
        const parsed = JSON.parse(cached.result) as { elements?: unknown[] };
        screenElements = normalizeScreenElements(Array.isArray(parsed.elements) ? parsed.elements : []);
      } catch {
        screenElements = [];
      }
    }

    if (screenElements.length === 0) {
      const buildResult = await buildScreenMapElements(ctx.userId);
      if (!buildResult.ok) {
        return { ok: false, content: buildResult.content, label: `android_swipe_element: ${buildResult.label}` };
      }
      screenElements = buildResult.elements;
      console.log(`[android_swipe_element] userId=${ctx.userId} fresh ScreenMap: ${screenElements.length} elements`);
    }

    // ── Fuzzy-match ───────────────────────────────────────────────────────────
    let bestElement: ScreenElement | null = null;
    let bestScore = 0;

    for (const el of screenElements) {
      const score = scoreElement(el, label);
      if (score > bestScore) {
        bestScore = score;
        bestElement = el;
      }
    }

    if (!bestElement || bestScore === 0) {
      const elementList = screenElements
        .map((el) => `  • ${el.label}${el.description ? ` — ${el.description}` : ""}`)
        .join("\n");
      return {
        ok: false,
        content: `No element matching "${label}" was found on screen.\n\nAvailable elements:\n${elementList || "  (none)"}`,
        label: `android_swipe_element: no match for "${label}"`,
      };
    }

    // ── Compute swipe coordinates from element center + direction + distance ──
    const { center_x, center_y } = bestElement;
    const distance = typeof args.distance_px === "number" && args.distance_px > 0 ? args.distance_px : 400;
    const half = distance / 2;

    let x1: number, y1: number, x2: number, y2: number;
    if (direction === "up") {
      x1 = center_x; y1 = center_y + half;
      x2 = center_x; y2 = center_y - half;
    } else if (direction === "down") {
      x1 = center_x; y1 = center_y - half;
      x2 = center_x; y2 = center_y + half;
    } else if (direction === "left") {
      x1 = center_x + half; y1 = center_y;
      x2 = center_x - half; y2 = center_y;
    } else {
      // right
      x1 = center_x - half; y1 = center_y;
      x2 = center_x + half; y2 = center_y;
    }

    // ── Clamp to valid screen coordinates ─────────────────────────────────────
    // We don't have the device's actual screen dimensions at call time, so we
    // clamp only to >= 0 (negative coordinates are always off-screen regardless
    // of resolution). This prevents crashes/no-ops for elements near the top or
    // left edge with a large distance_px. Upper-bound clamping would require a
    // screen-size API call which is deferred as a future enhancement.
    x1 = Math.max(0, Math.round(x1));
    y1 = Math.max(0, Math.round(y1));
    x2 = Math.max(0, Math.round(x2));
    y2 = Math.max(0, Math.round(y2));

    // ── Fire the swipe ────────────────────────────────────────────────────────
    const swipeResult = await sendDaemonOp(ctx.userId, { type: "android_swipe", x1, y1, x2, y2, durationMs: 400 }, 15000);

    if (!swipeResult.ok) {
      return {
        ok: false,
        content: `Matched element "${bestElement.label}" at (${center_x}, ${center_y}) but swipe failed: ${swipeResult.error || "unknown error"}`,
        label: `android_swipe_element: swipe failed`,
      };
    }

    console.log(`[android_swipe_element] userId=${ctx.userId} swiped ${direction} on "${bestElement.label}" from (${x1},${y1}) to (${x2},${y2}) score=${bestScore}`);

    return {
      ok: true,
      content: JSON.stringify({
        swiped: {
          label: bestElement.label,
          description: bestElement.description,
          resource_id: bestElement.resource_id,
          center_x,
          center_y,
          bounds: bestElement.bounds,
          match_score: bestScore,
          direction,
          distance_px: distance,
          from: { x: x1, y: y1 },
          to: { x: x2, y: y2 },
        },
      }),
      label: `Swiped ${direction} on "${bestElement.label}" from (${x1},${y1}) to (${x2},${y2})`,
      detail: `match_score=${bestScore} bounds=${bestElement.bounds}`,
    };
  },
};

export const androidTapElementTool: AgentTool = {
  name: "android_tap_element",
  description: `Tap an Android screen element by name instead of raw coordinates.
Accepts a human-readable label or description string, fuzzy-matches it against the current ScreenMap (Vision-based, calling android_screen_understand internally with a 500 ms cache), fires android_tap at the best-matching element's center coordinates, then verifies the tap landed via screenshot pixel diff (≥15%) and/or accessibility hierarchy change. Retries up to 4 times.

If the element is not visible on the initial screen, the tool automatically scrolls down (up to max_scroll_attempts times) and re-reads the screen after each scroll until the element appears or the scroll limit is reached.

Use this tool instead of manually extracting center_x/center_y from android_screen_understand results:
- Faster: one tool call instead of two
- More reliable: coordinate copy-paste errors eliminated, tap verified
- Handles unlabeled or icon-only buttons via description matching
- Automatically scrolls to find off-screen elements

The label is matched (case-insensitive) against each element's label, description, and resource_id. The highest-confidence match is tapped.

Returns the matched element details, tap coordinates, verification status, and how many scroll passes were needed.

Requires: android_screenshot and android_read_screen permissions (same as android_screen_understand), plus android_tap_type permission for the tap action.`,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "The label, description, or resource_id (or part thereof) of the element to tap. Case-insensitive fuzzy match.",
      },
      max_age_ms: {
        type: "number",
        description: "Maximum age in milliseconds for a cached ScreenMap to be reused (default 500). Set to 0 to always capture a fresh screen.",
      },
      verify_with_screenshot: {
        type: "boolean",
        description: "Whether to take before/after screenshots to verify the tap (default true). Set false to rely only on accessibility hierarchy comparison (faster but less reliable).",
      },
      max_scroll_attempts: {
        type: "number",
        description: "Maximum number of downward scroll passes to perform when the element is not visible on the initial screen (default 5). Set to 0 to disable automatic scrolling.",
      },
      scroll_distance: {
        type: "number",
        description: "Pixel distance for each scroll swipe (default 600). Larger values scroll further per swipe.",
      },
    },
    required: ["label"],
  },
  async execute(args, ctx) {
    const label = String(args.label || "").trim();
    if (!label) {
      return { ok: false, content: "label is required.", label: "android_tap_element: no label" };
    }

    if (!isAndroidDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it (Profile → Connected Channels → Android Device).",
        label: "android_tap_element: android offline",
      };
    }

    // Permission checks (parallel)
    const [screenshotAllowed, readAllowed, tapAllowed] = await Promise.all([
      isAndroidDaemonActionAllowed(ctx.userId, "android_screenshot"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_read_screen"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type"),
    ]);
    if (!screenshotAllowed) {
      return {
        ok: false,
        content: "android_screenshot permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_tap_element: screenshot permission denied",
      };
    }
    if (!readAllowed) {
      return {
        ok: false,
        content: "android_read_screen permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_tap_element: read_screen permission denied",
      };
    }
    if (!tapAllowed) {
      return {
        ok: false,
        content: "android_tap_type permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_tap_element: tap permission denied",
      };
    }

    const useScreenshot = args.verify_with_screenshot !== false;

    // ── Resolve ScreenMap (Vision-based, cache or fresh) ──────────────────────
    const maxAge = typeof args.max_age_ms === "number" ? args.max_age_ms : 500;
    let screenElements: ScreenElement[] = [];

    const cached = screenMapCache.get(ctx.userId);
    if (cached && maxAge > 0 && Date.now() - cached.ts <= maxAge) {
      console.log(`[android_tap_element] userId=${ctx.userId} using cached ScreenMap`);
      try {
        const parsed = JSON.parse(cached.result) as { elements?: unknown[] };
        screenElements = normalizeScreenElements(Array.isArray(parsed.elements) ? parsed.elements : []);
      } catch {
        screenElements = [];
      }
    }

    if (screenElements.length === 0) {
      const buildResult = await buildScreenMapElements(ctx.userId);
      if (!buildResult.ok) {
        return { ok: false, content: buildResult.content, label: `android_tap_element: ${buildResult.label}` };
      }
      screenElements = buildResult.elements;
      console.log(`[android_tap_element] userId=${ctx.userId} fresh ScreenMap: ${screenElements.length} elements`);
    }

    // ── Fuzzy-match ───────────────────────────────────────────────────────────
    let bestElement: ScreenElement | null = null;
    let bestScore = 0;

    for (const el of screenElements) {
      const score = scoreElement(el, label);
      if (score > bestScore) {
        bestScore = score;
        bestElement = el;
      }
    }

    // ── Scroll-to-find: swipe down the page until the element appears ─────────
    const rawMaxScrollAttempts = typeof args.max_scroll_attempts === "number" ? args.max_scroll_attempts : 5;
    const maxScrollAttempts = Number.isFinite(rawMaxScrollAttempts) ? Math.max(0, Math.floor(rawMaxScrollAttempts)) : 5;
    const rawScrollDistance = typeof args.scroll_distance === "number" ? args.scroll_distance : 600;
    const scrollDistance = Number.isFinite(rawScrollDistance) ? Math.min(Math.max(100, Math.floor(rawScrollDistance)), 1800) : 600;
    let scrollsPerformed = 0;

    if ((!bestElement || bestScore === 0) && maxScrollAttempts > 0) {
      for (let scroll = 0; scroll < maxScrollAttempts; scroll++) {
        console.log(`[android_tap_element] element not found, scrolling down (pass ${scroll + 1}/${maxScrollAttempts})`);

        // Swipe upward (y1 > y2) to scroll the page down
        const screenMidX = 540;
        const swipeY1 = 1400;
        const swipeY2 = Math.max(100, swipeY1 - scrollDistance);
        const swipeResult = await sendDaemonOp(
          ctx.userId,
          { type: "android_swipe", x1: screenMidX, y1: swipeY1, x2: screenMidX, y2: swipeY2, durationMs: 400 },
          10000,
        );
        if (!swipeResult.ok) {
          console.log(`[android_tap_element] swipe failed on pass ${scroll + 1}: ${swipeResult.error}`);
          break;
        }

        scrollsPerformed = scroll + 1;

        // Brief pause so the page settles before re-reading
        await new Promise((resolve) => setTimeout(resolve, 500));

        const refreshed = await buildScreenMapElements(ctx.userId);
        if (!refreshed.ok) break;

        bestElement = null;
        bestScore = 0;
        for (const el of refreshed.elements) {
          const score = scoreElement(el, label);
          if (score > bestScore) {
            bestScore = score;
            bestElement = el;
          }
        }
        screenElements = refreshed.elements;

        if (bestElement && bestScore > 0) {
          console.log(`[android_tap_element] found "${label}" after ${scrollsPerformed} scroll(s), score=${bestScore}`);
          break;
        }
      }
    }

    if (!bestElement || bestScore === 0) {
      const elementList = screenElements
        .map((el) => `  • ${el.label}${el.description ? ` — ${el.description}` : ""}`)
        .join("\n");
      const scrollNote = maxScrollAttempts > 0
        ? ` Scrolled ${scrollsPerformed} time(s) looking for it.`
        : "";
      return {
        ok: false,
        content: `No element matching "${label}" was found on screen.${scrollNote}\n\nAvailable elements:\n${elementList || "  (none)"}`,
        label: `android_tap_element: no match for "${label}"`,
      };
    }

    // ── Capture pre-tap baselines (once, before any tap) ─────────────────────
    const preScreenshot: string | null = useScreenshot ? await captureScreenshot(ctx.userId) : null;
    const preHierarchyClickable = await readScreen(ctx.userId);
    const preHierarchyCount = preHierarchyClickable.length;
    const preHierarchyLabels = new Set(preHierarchyClickable.map((el) => el.label));

    // ── Retry loop ────────────────────────────────────────────────────────────
    // Attempts 1-3: tap at Vision-located coordinates with small offsets.
    // Attempt 4 (FRESH-LOCATE FALLBACK): re-run buildScreenMapElements to get
    // the freshest Vision coords before the final tap attempt.
    const MAX_ATTEMPTS = 4;
    const SETTLE_MS = 400;
    const OFFSETS: Array<[number, number]> = [[0, 0], [5, 5], [-5, -5]];
    let locatedX = bestElement.center_x;
    let locatedY = bestElement.center_y;
    let tapped_at: { x: number; y: number } | null = null;
    let verified = false;
    let actualAttempts = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      actualAttempts = attempt;

      let tapX: number;
      let tapY: number;

      if (attempt < MAX_ATTEMPTS) {
        const [dx, dy] = OFFSETS[attempt - 1];
        tapX = Math.round(locatedX + dx);
        tapY = Math.round(locatedY + dy);
      } else {
        // Attempt 4: fresh Vision re-locate
        const freshBuild = await buildScreenMapElements(ctx.userId);
        if (!freshBuild.ok) break;
        let freshBest: ScreenElement | null = null;
        let freshBestScore = 0;
        for (const el of freshBuild.elements) {
          const score = scoreElement(el, label);
          if (score > freshBestScore) { freshBestScore = score; freshBest = el; }
        }
        if (!freshBest || freshBestScore === 0) break;
        tapX = Math.round(freshBest.center_x);
        tapY = Math.round(freshBest.center_y);
      }

      const tapResult = await sendDaemonOp(ctx.userId, { type: "android_tap", x: tapX, y: tapY }, 15000);
      tapped_at = { x: tapX, y: tapY };

      if (!tapResult.ok) {
        console.log(`[android_tap_element] attempt ${attempt} tap op failed: ${tapResult.error}`);
        if (attempt < MAX_ATTEMPTS) continue;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

      // Primary: pixel diff verification
      if (useScreenshot && preScreenshot) {
        const postScreenshot = await captureScreenshot(ctx.userId);
        if (postScreenshot) {
          const changeRatio = await screenshotDiff(preScreenshot, postScreenshot).catch(() => 0);
          if (changeRatio >= 0.15) verified = true;
        }
      }

      // Secondary: accessibility hierarchy change vs. pre-tap baseline.
      // Always run this check (not just when screenshot diff fails) so that
      // FLAG_SECURE apps (no screenshot) are handled correctly.
      if (!verified) {
        const postClickable = await readScreen(ctx.userId);
        if (postClickable.length !== preHierarchyCount) {
          verified = true;
        } else {
          // Check if any new labels appeared compared to the pre-tap baseline
          const postLabels = new Set(postClickable.map((el) => el.label));
          if ([...postLabels].some((l) => !preHierarchyLabels.has(l))) verified = true;
        }
      }

      if (verified) break;
      console.log(`[android_tap_element] attempt ${attempt} unverified at (${tapX},${tapY}), retrying...`);
    }

    console.log(`[android_tap_element] userId=${ctx.userId} label="${label}" verified=${verified} attempts=${actualAttempts} scrolls=${scrollsPerformed} at=${JSON.stringify(tapped_at)} score=${bestScore}`);

    if (!verified) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          element_found: true,
          matched: bestElement.label,
          tapped_at,
          attempts: actualAttempts,
          scrolls_performed: scrollsPerformed,
          verified: false,
          reason: `Element "${bestElement.label}" was located (score=${bestScore}) and tapped ${actualAttempts} time(s) but the UI did not detectably change. The tap may have missed or the action may require a different interaction. Try calling android_read_screen to confirm the current screen state.`,
        }),
        label: `android_tap_element: unverified tap on "${bestElement.label}"`,
      };
    }

    return {
      ok: true,
      content: JSON.stringify({
        tapped: {
          label: bestElement.label,
          description: bestElement.description,
          resource_id: bestElement.resource_id,
          center_x: tapped_at!.x,
          center_y: tapped_at!.y,
          bounds: bestElement.bounds,
          match_score: bestScore,
        },
        attempts: actualAttempts,
        scrolls_performed: scrollsPerformed,
        verified: true,
      }),
      label: `Tapped "${bestElement.label}" at (${tapped_at!.x}, ${tapped_at!.y})`,
      detail: `match_score=${bestScore} bounds=${bestElement.bounds} attempts=${actualAttempts} scrolls=${scrollsPerformed}`,
    };
  },
};

// ── Perceptual hash helper (average-hash, 64-bit) ─────────────────────────────
// Down-samples a base64 JPEG/PNG to 8×8 via @napi-rs/canvas and computes the
// average-hash (aHash) as a 16-char hex string.  Falls back to an MD5 of the
// raw bytes when canvas is unavailable.
async function computeScreenshotHash(base64: string): Promise<string> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const strip = (s: string) => s.replace(/^data:[^;]+;base64,/, "");
    const img = await loadImage(Buffer.from(strip(base64), "base64"));
    const canvas = createCanvas(8, 8);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img as never, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    // Convert to grayscale
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      gray.push((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000);
    }
    const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
    // Build 64-bit hash as bits
    let hash = BigInt(0);
    for (let i = 0; i < gray.length; i++) {
      if (gray[i] >= avg) hash |= BigInt(1) << BigInt(i);
    }
    return hash.toString(16).padStart(16, "0");
  } catch {
    // Fallback: MD5 of compressed screenshot bytes
    const strip = (s: string) => s.replace(/^data:[^;]+;base64,/, "");
    return createHash("md5").update(Buffer.from(strip(base64), "base64")).digest("hex").slice(0, 16);
  }
}

// Type guard for the ping op response payload
interface PingData { foregroundPackage?: string; [key: string]: unknown }
function isPingData(d: unknown): d is PingData {
  return typeof d === "object" && d !== null;
}

// Hamming distance between two 16-char hex hashes (0–64 bits)
function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let dist = 0;
  const v1 = BigInt("0x" + a);
  const v2 = BigInt("0x" + b);
  let xor = v1 ^ v2;
  while (xor > BigInt(0)) {
    dist += Number(xor & BigInt(1));
    xor >>= BigInt(1);
  }
  return dist;
}

// ── android_train_button ──────────────────────────────────────────────────────
export const androidTrainButtonTool: AgentTool = {
  name: "android_train_button",
  description: `Start a human-in-the-loop training session to teach Jarvis the location of a button in an Android app.
Sends a START_TRAINING command to the Android daemon which enables a one-shot tap interceptor.
The next button the user physically taps on their screen is captured — coordinates, app package, screen context, element label, and a screenshot are saved to the database.
Confidence starts at 0.5. Use android_find_trained_button in future sessions to recall the stored location.
Use this when:
- The user says "help me find [button name]" or "teach Jarvis where [something] is"
- android_tap_element fails because the button has no accessible label (icon-only buttons, dynamic IDs)
- You want to pre-learn a frequently-used action to avoid repeated screen analysis`,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "Human-readable name for the button being trained, e.g. 'search icon', 'post button', 'like button'.",
      },
      timeout_seconds: {
        type: "number",
        description: "How many seconds to wait for the user to tap (default 60, max 120).",
      },
    },
    required: ["label"],
  },
  async execute(args, ctx) {
    const label = String(args.label || "").trim();
    if (!label) {
      return { ok: false, content: "label is required.", label: "android_train_button: no label" };
    }

    if (!isAndroidDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it (Profile → Connected Channels → Android Device).",
        label: "android_train_button: android offline",
      };
    }

    const tapAllowed = await isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type");
    if (!tapAllowed) {
      return {
        ok: false,
        content: "android_tap_type permission must be enabled to use button training. Enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_train_button: tap permission denied",
      };
    }

    const timeoutMs = Math.min(Math.max((Number(args.timeout_seconds) || 60) * 1000, 15_000), 120_000);

    // 1. Enable training mode on the daemon
    const startResult = await sendDaemonOp(ctx.userId, { type: "android_start_training", label, timeoutMs }, 10_000);
    if (!startResult.ok) {
      return { ok: false, content: `Failed to start training mode: ${startResult.error}`, label: "android_train_button: start failed" };
    }

    // 2. Wait for the user to tap
    let tapEvent;
    try {
      tapEvent = await waitForTrainingTap(ctx.userId, label, timeoutMs);
    } catch (err) {
      return { ok: false, content: String(err), label: "android_train_button: timeout" };
    }

    // 3. Compute screenshot hash (best-effort)
    let screenshotHash: string | null = null;
    if (tapEvent.screenshotBase64) {
      try { screenshotHash = await computeScreenshotHash(tapEvent.screenshotBase64); } catch { /* noop */ }
    }

    // 4. Upsert — key on user+app+screenContext+label to avoid cross-screen collisions
    const existing = await db.select().from(buttonLocations).where(
      and(
        eq(buttonLocations.userId, ctx.userId),
        eq(buttonLocations.appPackage, tapEvent.appPackage),
        eq(buttonLocations.screenContext, tapEvent.screenContext),
        eq(buttonLocations.elementLabel, label),
      )
    ).limit(1);

    if (existing.length > 0) {
      await db.update(buttonLocations).set({
        coordinatesX: tapEvent.x,
        coordinatesY: tapEvent.y,
        screenContext: tapEvent.screenContext,
        screenshotHash: screenshotHash ?? existing[0].screenshotHash,
        screenshotPath: tapEvent.screenshotBase64 ? tapEvent.screenshotBase64.slice(0, 200) : existing[0].screenshotPath,
        confidence: 0.5,
        stale: false,
        updatedAt: new Date(),
      }).where(eq(buttonLocations.id, existing[0].id));
    } else {
      await db.insert(buttonLocations).values({
        userId: ctx.userId,
        appPackage: tapEvent.appPackage,
        screenContext: tapEvent.screenContext,
        elementLabel: label,
        coordinatesX: tapEvent.x,
        coordinatesY: tapEvent.y,
        screenshotHash: screenshotHash ?? null,
        screenshotPath: tapEvent.screenshotBase64 ? tapEvent.screenshotBase64.slice(0, 200) : null,
        confidence: 0.5,
      });
    }

    return {
      ok: true,
      content: JSON.stringify({
        saved: true,
        label,
        appPackage: tapEvent.appPackage,
        screenContext: tapEvent.screenContext,
        x: tapEvent.x,
        y: tapEvent.y,
        confidence: 0.5,
        message: `Learned "${label}" at (${tapEvent.x}, ${tapEvent.y}) in ${tapEvent.appPackage}. Confidence starts at 0.5 — it will increase as the location is confirmed correct.`,
      }),
      label: `Trained "${label}" at (${tapEvent.x},${tapEvent.y}) in ${tapEvent.appPackage}`,
    };
  },
};

// ── android_find_trained_button ───────────────────────────────────────────────
export const androidFindTrainedButtonTool: AgentTool = {
  name: "android_find_trained_button",
  description: `Look up a trained button location for the current Android app and tap it if a confident match is found.
Queries the button_locations database for entries matching the given label and app package.
- High confidence (≥0.7): taps immediately and returns coordinates.
- Borderline confidence (0.3–0.69): taps, returns needs_confirmation=true and entry_id. Call this tool again with outcome="confirm" or outcome="deny" and the entry_id once the user replies.
- Stale entry or confidence < 0.3: offers to re-train the button.
- No entry found: falls back to android_tap_element, then offers training if that also fails.
Use this before android_tap_element when you have previously trained a button, or when the button has no accessible label.
CONFIRM/DENY flow: after the user confirms ("yes") or denies ("no"), call this tool again with outcome="confirm" or outcome="deny" and entry_id from the previous response to update confidence in the database immediately.`,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "The human-readable label used when the button was trained.",
      },
      app_package: {
        type: "string",
        description: "The Android package name of the app, e.g. com.instagram.android. If not provided, Jarvis reads the current foreground app.",
      },
      screen_context: {
        type: "string",
        description: "The current screen/activity context (e.g. 'com.instagram.android.activity.MainTabActivity'). Narrows the DB match to entries trained on the same screen. Read from the most recent android_read_screen or android_screen_understand result if available.",
      },
      skip_fallback: {
        type: "boolean",
        description: "Set true to skip the android_tap_element fallback (just return the DB lookup result without tapping).",
      },
      outcome: {
        type: "string",
        enum: ["confirm", "deny"],
        description: "After a borderline-confidence tap, set to 'confirm' (tap was correct — raise confidence) or 'deny' (tap was wrong — lower confidence and mark stale). Requires entry_id.",
      },
      entry_id: {
        type: "number",
        description: "The numeric ID of the button_locations entry to update. Required when outcome is set.",
      },
    },
    required: ["label"],
  },
  async execute(args, ctx) {
    const label = String(args.label || "").trim();
    if (!label) {
      return { ok: false, content: "label is required.", label: "android_find_trained_button: no label" };
    }

    // ── Confirm / Deny path — update confidence immediately ─────────────────
    const outcome = args.outcome as "confirm" | "deny" | undefined;
    const entryId = typeof args.entry_id === "number" ? args.entry_id : undefined;
    if (outcome && entryId !== undefined) {
      const existing = await db.select().from(buttonLocations).where(
        and(eq(buttonLocations.id, entryId), eq(buttonLocations.userId, ctx.userId))
      ).limit(1);
      if (existing.length === 0) {
        return { ok: false, content: `No button_locations entry found with id ${entryId}.`, label: "android_find_trained_button: entry not found" };
      }
      const row = existing[0];
      if (outcome === "confirm") {
        const newConf = Math.min(1.0, row.confidence + 0.15);
        await db.update(buttonLocations).set({
          confidence: newConf,
          stale: false,
          lastConfirmedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(buttonLocations.id, entryId));
        return {
          ok: true,
          content: JSON.stringify({ updated: true, outcome: "confirm", entry_id: entryId, label: row.elementLabel, confidence: newConf }),
          label: `android_find_trained_button: confirmed "${row.elementLabel}" — confidence now ${newConf.toFixed(2)}`,
        };
      } else {
        // Decrement by 0.2, mark stale when confidence drops below 0.3 — same rule as REST API PATCH /deny
        const newConf = Math.max(0.0, row.confidence - 0.2);
        const nowStale = newConf < 0.3;
        await db.update(buttonLocations).set({
          confidence: newConf,
          stale: nowStale,
          updatedAt: new Date(),
        }).where(eq(buttonLocations.id, entryId));
        return {
          ok: true,
          content: JSON.stringify({ updated: true, outcome: "deny", entry_id: entryId, label: row.elementLabel, confidence: newConf, stale: nowStale, suggest_retraining: nowStale }),
          label: `android_find_trained_button: denied "${row.elementLabel}" — confidence now ${newConf.toFixed(2)}${nowStale ? ", marked stale" : ""}`,
        };
      }
    }

    if (!isAndroidDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content: "Android daemon is not connected.",
        label: "android_find_trained_button: android offline",
      };
    }

    // Resolve app package — use provided, or query foreground from daemon
    let appPackage = String(args.app_package || "").trim();
    if (!appPackage) {
      const pingRes = await sendDaemonOp(ctx.userId, { type: "ping" }, 8_000);
      if (pingRes.ok && isPingData(pingRes.data) && typeof pingRes.data.foregroundPackage === "string") {
        appPackage = pingRes.data.foregroundPackage;
      }
    }

    const screenContextArg = String(args.screen_context || "").trim();

    // Query DB — ordered by confidence; up to 10 rows so we can prefer by screen context
    const rows = await db.select().from(buttonLocations).where(
      and(
        eq(buttonLocations.userId, ctx.userId),
        ...(appPackage ? [eq(buttonLocations.appPackage, appPackage)] : []),
        eq(buttonLocations.elementLabel, label),
      )
    ).orderBy(desc(buttonLocations.confidence)).limit(10);

    if (rows.length === 0) {
      // ── Accessibility-tree fallback ────────────────────────────────────────
      // No trained entry: try readScreen to find a matching visible element
      const skipFallbackEarly = args.skip_fallback === true;
      if (!skipFallbackEarly) {
        const screenElements = await readScreen(ctx.userId);
        const labelLower = label.toLowerCase();
        const match = screenElements.find((e) => e.label.toLowerCase().includes(labelLower));
        if (match) {
          const tapAllowed = await isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type");
          if (tapAllowed) {
            const fallbackTap = await sendDaemonOp(ctx.userId, { type: "android_tap", x: match.x, y: match.y }, 12_000);
            if (fallbackTap.ok) {
              return {
                ok: true,
                content: JSON.stringify({
                  tapped: true,
                  found_via: "accessibility_fallback",
                  label: match.label,
                  x: match.x,
                  y: match.y,
                  suggest_training: true,
                  message: `No trained location exists for "${label}" — found a visible element "${match.label}" via accessibility tree and tapped it at (${match.x},${match.y}). Call android_train_button to save this location for future use.`,
                }),
                label: `android_find_trained_button: fallback tap "${match.label}" at (${match.x},${match.y})`,
              };
            }
          }
        }
      }
      return {
        ok: false,
        content: JSON.stringify({
          found: false,
          message: `No trained location found for "${label}"${appPackage ? ` in ${appPackage}` : ""} and no matching accessible element was visible on screen. Call android_train_button to teach Jarvis where this button is.`,
          suggest_training: true,
        }),
        label: `android_find_trained_button: no entry for "${label}"`,
      };
    }

    // Prefer: exact screen_context match → non-stale → highest confidence
    const sortedRows = [...rows].sort((a, b) => {
      const aCtxMatch = screenContextArg && a.screenContext === screenContextArg ? 1 : 0;
      const bCtxMatch = screenContextArg && b.screenContext === screenContextArg ? 1 : 0;
      if (bCtxMatch !== aCtxMatch) return bCtxMatch - aCtxMatch; // screen context match first
      const aStalePenalty = a.stale ? -1 : 0;
      const bStalePenalty = b.stale ? -1 : 0;
      if (bStalePenalty !== aStalePenalty) return bStalePenalty - aStalePenalty; // non-stale first
      return b.confidence - a.confidence; // highest confidence last tiebreak
    });
    const best = sortedRows[0];

    if (best.stale || best.confidence < 0.3) {
      return {
        ok: false,
        content: JSON.stringify({
          found: true,
          stale: true,
          label: best.elementLabel,
          appPackage: best.appPackage,
          confidence: best.confidence,
          message: `Stored location for "${label}" is stale or low-confidence (${best.confidence.toFixed(2)}). The UI may have changed. Call android_train_button to re-train this button.`,
          suggest_retraining: true,
        }),
        label: `android_find_trained_button: stale entry for "${label}"`,
      };
    }

    const skipFallback = args.skip_fallback === true;
    if (skipFallback) {
      return {
        ok: true,
        content: JSON.stringify({
          found: true,
          id: best.id,
          label: best.elementLabel,
          appPackage: best.appPackage,
          screenContext: best.screenContext,
          x: best.coordinatesX,
          y: best.coordinatesY,
          confidence: best.confidence,
        }),
        label: `Found "${label}" at (${best.coordinatesX},${best.coordinatesY}) confidence=${best.confidence.toFixed(2)}`,
      };
    }

    // ── Screenshot hash check (stale detection before tapping) ─────────────────
    if (best.screenshotHash) {
      const currentScreenshot = await captureScreenshot(ctx.userId);
      if (currentScreenshot) {
        try {
          const currentHash = await computeScreenshotHash(currentScreenshot);
          const dist = hammingDistance(best.screenshotHash, currentHash);
          // dist > 20 out of 64 bits = significant UI change (>31%)
          if (dist > 20) {
            // Mark stale and suggest re-training
            await db.update(buttonLocations).set({ stale: true, updatedAt: new Date() })
              .where(eq(buttonLocations.id, best.id));
            return {
              ok: false,
              content: JSON.stringify({
                found: true,
                stale: true,
                hashDist: dist,
                message: `The screen layout looks different from when "${label}" was trained (hash distance ${dist}/64). The stored location has been marked stale. Call android_train_button to re-train.`,
                suggest_retraining: true,
              }),
              label: `android_find_trained_button: UI changed, stale flagged for "${label}"`,
            };
          }
        } catch { /* hash check is best-effort */ }
      }
    }

    // ── Tap at stored coordinates ───────────────────────────────────────────
    const tapAllowed = await isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type");
    if (!tapAllowed) {
      return {
        ok: false,
        content: `Found "${label}" at (${best.coordinatesX}, ${best.coordinatesY}) but android_tap_type permission is disabled. Enable it in Profile → Connected Channels → Android Device → Permissions.`,
        label: `android_find_trained_button: tap permission denied`,
      };
    }

    // Capture pre-tap state — accessibility tree + screenshot — BEFORE tap
    const preTapElements = await readScreen(ctx.userId);
    const preTapScreenshot = await captureScreenshot(ctx.userId);
    const COORD_RADIUS = 60; // px — element centre must be within this radius of trained coords
    // ClickableElement uses .x/.y (not .center_x/.center_y)
    const preTapNear = preTapElements.filter(
      (e) => Math.abs(e.x - best.coordinatesX) <= COORD_RADIUS && Math.abs(e.y - best.coordinatesY) <= COORD_RADIUS
    );

    // If no clickable element is present near the trained coordinates, the UI has likely changed
    if (preTapNear.length === 0) {
      await db.update(buttonLocations).set({ stale: true, updatedAt: new Date() })
        .where(eq(buttonLocations.id, best.id));
      return {
        ok: false,
        content: JSON.stringify({
          found: true,
          stale: true,
          message: `No element found near the trained coordinates (${best.coordinatesX}, ${best.coordinatesY}) for "${label}" — the UI layout has likely changed. Entry marked stale. Call android_train_button to re-train.`,
          suggest_retraining: true,
        }),
        label: `android_find_trained_button: no element at coords for "${label}"`,
      };
    }

    const tapResult = await sendDaemonOp(ctx.userId, { type: "android_tap", x: best.coordinatesX, y: best.coordinatesY }, 12_000);
    if (!tapResult.ok) {
      await db.update(buttonLocations).set({ stale: true, updatedAt: new Date() })
        .where(eq(buttonLocations.id, best.id));
      return {
        ok: false,
        content: `Tap at stored location (${best.coordinatesX}, ${best.coordinatesY}) failed: ${tapResult.error}. Entry marked stale — call android_train_button to re-train.`,
        label: `android_find_trained_button: tap failed for "${label}"`,
      };
    }

    // ── Post-tap verification (coordinate-aware) ────────────────────────────
    await new Promise((r) => setTimeout(r, 400));
    const postTapElements = await readScreen(ctx.userId);
    const postTapNear = postTapElements.filter(
      (e) => Math.abs(e.x - best.coordinatesX) <= COORD_RADIUS && Math.abs(e.y - best.coordinatesY) <= COORD_RADIUS
    );
    // Verified if: element at coords disappeared (button triggered navigation/dismiss)
    // OR element at coords changed label (state flip, e.g. like → unlike)
    const preTapNearLabels = new Set(preTapNear.map((e) => e.label));
    const postTapNearLabels = new Set(postTapNear.map((e) => e.label));
    const elementGone = preTapNear.length > 0 && postTapNear.length === 0;
    const labelChanged = [...preTapNearLabels].some((l) => !postTapNearLabels.has(l)) ||
                         [...postTapNearLabels].some((l) => !preTapNearLabels.has(l));
    // Fallback: screenshot diff using the true pre-tap screenshot captured before the tap
    let verified = elementGone || labelChanged;
    if (!verified) {
      const postTapScreenshot = await captureScreenshot(ctx.userId);
      if (preTapScreenshot && postTapScreenshot) {
        try {
          const changeRatio = await screenshotDiff(preTapScreenshot, postTapScreenshot);
          if (changeRatio >= 0.15) verified = true;
        } catch { /* screenshot diff is best-effort */ }
      }
    }

    if (!verified) {
      await db.update(buttonLocations).set({ stale: true, updatedAt: new Date() })
        .where(eq(buttonLocations.id, best.id));
      return {
        ok: false,
        content: JSON.stringify({
          tapped: true,
          verified: false,
          label: best.elementLabel,
          x: best.coordinatesX,
          y: best.coordinatesY,
          confidence: best.confidence,
          message: `Tapped the stored location for "${label}" but no element at those coordinates changed state. The location has been marked stale. Call android_train_button to re-train.`,
          suggest_retraining: true,
        }),
        label: `android_find_trained_button: unverified tap on "${label}"`,
      };
    }

    // ── Success — conditionally ask for user confirmation ──────────────────
    const needsConfirm = best.confidence < 0.7;
    return {
      ok: true,
      content: JSON.stringify({
        tapped: true,
        verified: true,
        label: best.elementLabel,
        appPackage: best.appPackage,
        x: best.coordinatesX,
        y: best.coordinatesY,
        confidence: best.confidence,
        entry_id: best.id,
        needs_confirmation: needsConfirm,
        confirmation_prompt: needsConfirm
          ? `I tapped the stored location for "${label}" (confidence ${best.confidence.toFixed(2)}). Was that the right button? Reply "yes" or "no" — I'll call android_find_trained_button with outcome="confirm" or outcome="deny" and entry_id=${best.id} to update my memory immediately.`
          : undefined,
      }),
      label: `Tapped trained "${label}" at (${best.coordinatesX},${best.coordinatesY}) confidence=${best.confidence.toFixed(2)}`,
    };
  },
};

// ── android_type_into_element ──────────────────────────────────────────────────
// Combines label-based element resolution (same scoreElement + ScreenMap cache
// as android_tap_element) with the full focus → input → verify chain from
// android_type_in_field.  One tool call replaces: screen understand → extract
// coordinates → tap → type.

export const androidTypeIntoElementTool: AgentTool = {
  name: "android_type_into_element",
  description: `Type text into an Android input field located by name, not by raw coordinates.

Combines android_tap_element (finds the field via fuzzy label match) with android_type_in_field (robust focus-verify → input → confirm sequence) into a single call.

Steps performed internally:
1. Resolve ScreenMap (uses 500 ms cache if available, otherwise captures fresh screenshot + view hierarchy)
2. Fuzzy-match \`label\` against element labels, descriptions, and resource_ids (same scoring as android_tap_element)
3. Tap the matched element to focus it, then wait for the keyboard
4. Optionally clear the field first if \`clear_first\` is true
5. Type via three-level fallback: android_type → android_paste_text → android_paste_text retry
6. Verify the text appeared in the field via android_get_focused_field

Use this instead of manually: reading the screen → finding coordinates → tapping → typing.

Returns: matched field details (label, coordinates, match_score), input method used, and whether the text was verified.

Requires: android_screenshot, android_read_screen, and android_tap_type permissions.`,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "The label, description, or resource_id (or part thereof) of the input field to type into. Case-insensitive fuzzy match.",
      },
      text: {
        type: "string",
        description: "The text to type into the field.",
      },
      clear_first: {
        type: "boolean",
        description: "If true, clear the field contents before typing. Default false.",
      },
      max_age_ms: {
        type: "number",
        description: "Maximum age in milliseconds for a cached ScreenMap to be reused (default 500). Set to 0 to always capture a fresh screen.",
      },
      submit: {
        type: "boolean",
        description: "If true, press Enter/submit after successfully typing. Default false.",
      },
    },
    required: ["label", "text"],
  },
  async execute(args, ctx) {
    const label = String(args.label || "").trim();
    const text = String(args.text || "");
    if (!label) {
      return { ok: false, content: "label is required.", label: "android_type_into_element: no label" };
    }
    if (!text) {
      return { ok: false, content: "text is required.", label: "android_type_into_element: no text" };
    }

    if (!isAndroidDaemonActive(ctx.userId)) {
      return {
        ok: false,
        content: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it (Profile → Connected Channels → Android Device).",
        label: "android_type_into_element: android offline",
      };
    }

    // Permission checks — need screenshot + read_screen for ScreenMap, tap_type for tap + type
    const [screenshotAllowed, readAllowed, tapAllowed] = await Promise.all([
      isAndroidDaemonActionAllowed(ctx.userId, "android_screenshot"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_read_screen"),
      isAndroidDaemonActionAllowed(ctx.userId, "android_tap_type"),
    ]);
    if (!screenshotAllowed) {
      return {
        ok: false,
        content: "android_screenshot permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_type_into_element: screenshot permission denied",
      };
    }
    if (!readAllowed) {
      return {
        ok: false,
        content: "android_read_screen permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_type_into_element: read_screen permission denied",
      };
    }
    if (!tapAllowed) {
      return {
        ok: false,
        content: "android_tap_type permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_type_into_element: tap permission denied",
      };
    }

    // ── Step 1: Resolve ScreenMap (cache or fresh) ────────────────────────────
    const maxAge = typeof args.max_age_ms === "number" ? args.max_age_ms : 500;
    let screenElements: ScreenElement[] = [];

    const cached = screenMapCache.get(ctx.userId);
    if (cached && maxAge > 0 && Date.now() - cached.ts <= maxAge) {
      console.log(`[android_type_into_element] userId=${ctx.userId} using cached ScreenMap`);
      try {
        const parsed = JSON.parse(cached.result) as { elements?: unknown[] };
        screenElements = normalizeScreenElements(Array.isArray(parsed.elements) ? parsed.elements : []);
      } catch {
        screenElements = [];
      }
    }

    if (screenElements.length === 0) {
      const buildResult = await buildScreenMapElements(ctx.userId);
      if (!buildResult.ok) {
        return { ok: false, content: buildResult.content, label: `android_type_into_element: ${buildResult.label}` };
      }
      screenElements = buildResult.elements;
      console.log(`[android_type_into_element] userId=${ctx.userId} fresh ScreenMap: ${screenElements.length} elements`);
    }

    // ── Step 2: Fuzzy-match the element ───────────────────────────────────────
    let bestElement: ScreenElement | null = null;
    let bestScore = 0;

    for (const el of screenElements) {
      const score = scoreElement(el, label);
      if (score > bestScore) {
        bestScore = score;
        bestElement = el;
      }
    }

    if (!bestElement || bestScore === 0) {
      const elementList = screenElements
        .map((el) => `  • ${el.label}${el.description ? ` — ${el.description}` : ""}`)
        .join("\n");
      return {
        ok: false,
        content: `No element matching "${label}" was found on screen.\n\nAvailable elements:\n${elementList || "  (none)"}`,
        label: `android_type_into_element: no match for "${label}"`,
      };
    }

    const { center_x, center_y } = bestElement;
    const fieldDesc = bestElement.label || bestElement.description || label;
    const steps: string[] = [`Matched element "${fieldDesc}" at (${center_x}, ${center_y}) score=${bestScore}.`];

    // ── Step 3: Tap to focus ──────────────────────────────────────────────────
    steps.push(`Tapping (${center_x}, ${center_y}) to focus field...`);
    const tapResult = await sendDaemonOp(ctx.userId, { type: "android_tap", x: center_x, y: center_y }, 15000);
    if (!tapResult.ok) {
      return {
        ok: false,
        content: JSON.stringify({ ok: false, field: fieldDesc, match_score: bestScore, steps, error: `Tap failed: ${tapResult.error || "unknown error"}` }),
        label: `android_type_into_element: tap failed for "${fieldDesc}"`,
      };
    }
    await sleep(300);
    steps.push("Tap sent; waiting for keyboard.");

    // ── Step 4: Optional clear ────────────────────────────────────────────────
    if (args.clear_first) {
      steps.push("Clearing field (android_clear_field)...");
      const clearResult = await sendDaemonOp(ctx.userId, { type: "android_clear_field" }, 8000);
      if (clearResult.ok) {
        steps.push("Field cleared.");
      } else {
        steps.push(`Clear failed (${clearResult.error || "unknown"}); proceeding anyway.`);
      }
    }

    // ── Step 5: Three-level input fallback chain ──────────────────────────────
    let methodUsed: string | null = null;
    let inputOk = false;
    let daemonVerified = false;
    let fieldText: string | null = null;

    // Level 1 — android_type (accessibility ACTION_SET_TEXT)
    steps.push("Level 1 — android_type (accessibility ACTION_SET_TEXT)...");
    const typeResult = await sendDaemonOp(ctx.userId, { type: "android_type", text }, 10000);
    if (typeResult.ok) {
      methodUsed = "android_type";
      inputOk = true;
      steps.push("android_type accepted by accessibility service.");
    } else {
      steps.push(`android_type failed (${typeResult.error || "no editable field focused"}). Moving to Level 2.`);
    }

    // Level 2 — android_paste_text (adb input text → clipboard fallback)
    if (!inputOk) {
      steps.push("Level 2 — android_paste_text (adb input text primary, clipboard fallback)...");
      const pasteResult = await sendDaemonOp(ctx.userId, { type: "android_paste_text", text, fieldDescription: fieldDesc }, 15000);
      if (pasteResult.ok) {
        const pasteData = (pasteResult.data || {}) as Record<string, unknown>;
        const daemonMethod = typeof pasteData.method_used === "string" ? pasteData.method_used : "unknown";
        methodUsed = `android_paste_text:${daemonMethod}`;
        inputOk = true;
        daemonVerified = pasteData.verified === true;
        fieldText = typeof pasteData.field_text === "string" ? pasteData.field_text : null;
        steps.push(`android_paste_text succeeded via ${daemonMethod}. Daemon verified: ${daemonVerified}.`);
      } else {
        steps.push(`android_paste_text failed (${pasteResult.error || "unknown error"}). Moving to Level 3.`);
      }
    }

    // Level 3 — clipboard-only retry
    if (!inputOk) {
      steps.push("Level 3 — android_paste_text retry (clipboard-only path)...");
      const retryResult = await sendDaemonOp(ctx.userId, { type: "android_paste_text", text, fieldDescription: fieldDesc }, 15000);
      if (retryResult.ok) {
        const retryData = (retryResult.data || {}) as Record<string, unknown>;
        const retryMethod = typeof retryData.method_used === "string" ? retryData.method_used : "unknown";
        methodUsed = `android_paste_text:${retryMethod}:L3`;
        inputOk = true;
        daemonVerified = retryData.verified === true;
        fieldText = typeof retryData.field_text === "string" ? retryData.field_text : null;
        steps.push(`Level 3 retry succeeded via ${retryMethod}. Daemon verified: ${daemonVerified}.`);
      } else {
        steps.push(`Level 3 retry failed (${retryResult.error || "unknown"}). All input methods exhausted.`);
      }
    }

    if (!inputOk) {
      const summary = { ok: false, field: fieldDesc, match_score: bestScore, center_x, center_y, text_sent: text, method_used: null, verified: false, field_text: null, steps };
      console.log(`[android_type_into_element] userId=${ctx.userId} field="${fieldDesc}" ALL_FAILED`);
      return {
        ok: false,
        content: JSON.stringify(summary),
        label: `android_type_into_element: all levels failed for "${fieldDesc}"`,
        detail: steps.join(" | "),
      };
    }

    // ── Step 6: Server-side verification ──────────────────────────────────────
    let verified = daemonVerified;

    if (methodUsed === "android_type" || !daemonVerified) {
      await sleep(200);
      steps.push("Verifying text appeared in field via android_get_focused_field...");
      const verifyResult = await sendDaemonOp(ctx.userId, { type: "android_get_focused_field" }, 8000);
      const verifyInfo = extractFocusedFieldText(verifyResult.data);
      fieldText = verifyInfo.text ?? null;

      const isPassword = (verifyResult.data as Record<string, unknown> | null)?.isPassword === true;
      verified = isPassword
        ? verifyInfo.focused
        : typeof fieldText === "string" && (
            fieldText === text ||
            fieldText.trim() === text.trim() ||
            fieldText.includes(text)
          );

      if (!verified && methodUsed === "android_type") {
        steps.push(`Verification failed after android_type (field: "${fieldText ?? "empty"}") — escalating to android_paste_text...`);
        const escalateResult = await sendDaemonOp(ctx.userId, { type: "android_paste_text", text, fieldDescription: fieldDesc }, 15000);
        if (escalateResult.ok) {
          const esc = (escalateResult.data || {}) as Record<string, unknown>;
          const escMethod = typeof esc.method_used === "string" ? esc.method_used : "unknown";
          methodUsed = `android_paste_text:${escMethod}:escalated`;
          daemonVerified = esc.verified === true;
          fieldText = typeof esc.field_text === "string" ? esc.field_text : null;
          verified = daemonVerified;
          steps.push(`Escalation to android_paste_text succeeded via ${escMethod}. Verified: ${verified}.`);
        } else {
          steps.push(`android_paste_text escalation failed: ${escalateResult.error || "unknown"}`);
        }
      }

      if (verified) {
        steps.push("Verification passed: text confirmed in field.");
      } else {
        steps.push(`Verification inconclusive: field text="${fieldText ?? "empty"}". Field may hide text (custom IME, password) or accessibility tree not updated yet.`);
      }
    }

    // ── Step 7: Optional submit ────────────────────────────────────────────────
    if (args.submit && inputOk) {
      await sendDaemonOp(ctx.userId, { type: "android_press_key", key: "enter" }, 6000);
      steps.push("Submitted (IME Enter/Go key pressed).");
    }

    const summary = {
      ok: inputOk,
      field: fieldDesc,
      match_score: bestScore,
      center_x,
      center_y,
      text_sent: text,
      method_used: methodUsed,
      verified,
      field_text: fieldText,
      steps,
    };

    console.log(`[android_type_into_element] userId=${ctx.userId} field="${fieldDesc}" method=${methodUsed} verified=${verified}`);

    return {
      ok: inputOk,
      content: JSON.stringify(summary),
      label: `Typed "${text.slice(0, 30)}" into "${fieldDesc}" via ${methodUsed} verified=${verified}`,
      detail: steps.join(" | "),
    };
  },
};
