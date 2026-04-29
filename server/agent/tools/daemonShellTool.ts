import path from "path";
import type { AgentTool } from "../types";
import {
  sendDaemonOp,
  isDesktopDaemonActive,
  isAndroidDaemonActive,
  isDaemonActionAllowed,
  isAndroidDaemonActionAllowed,
  getDaemonPermissions,
  getAndroidDaemonPermissions,
  getDaemonDeviceMeta,
  getDaemonLastSeen,
} from "../../daemon/bridge";
import { anthropic, ORCHESTRATOR_MODEL } from "../../lib/anthropicClient";

// ── Shell safety: server-side preflight for early UX feedback ─────────────────
// Mirrors the daemon-side commandEscapesRoot strategy so the agent gets a fast
// error message before the round-trip. The daemon is the authoritative boundary.
// The server normalizes absolute paths (to collapse /usr/../etc tricks) but cannot
// resolve relative tokens against the user's ROOT — those are flagged conservatively.

const SAFE_DEVICE_FILES_SET = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/zero"]);

// System command binary prefixes — the first token of each shell segment may be
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
            // First token is system binary — allow it.
          } else {
            // Absolute file argument — server can't verify it's in user's ROOT,
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
    "Run a shell command on the user's desktop via the paired desktop daemon. Returns stdout, stderr, exit code, and duration. Use this proactively when the user asks to run a script, build an app, run tests, execute local automation, read a local file via shell, or do any computation on their machine. Requires the desktop daemon to be paired and the 'shell' permission enabled in Profile → Connected Channels → Desktop Daemon → Permissions. When the daemon is offline, returns a clear explanation and how to start it. For desktop notifications, file reads, or screenshots, prefer daemon_action.",
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
          "Desktop daemon is not connected. To use daemon_shell, the user needs to:\n1. Download jarvis-daemon.js from Profile → Connected Channels → Desktop Daemon\n2. Run: JARVIS_SERVER=<url> JARVIS_PAIR_CODE=<code> node jarvis-daemon.js\nThe daemon reconnects automatically after network drops.",
        label: "daemon_shell: desktop offline",
      };
    }

    const shellAllowed = await isDaemonActionAllowed(ctx.userId, "shell");
    if (!shellAllowed) {
      return {
        ok: false,
        content:
          "Shell execution is not permitted on this daemon. The user must enable it in Profile → Connected Channels → Desktop Daemon → Permissions → Shell Execution.",
        label: "daemon_shell: shell permission denied",
      };
    }

    // Look up the allow_outside_root permission — sent to daemon so it can enforce.
    // The server also does a preflight regex check to surface clear error messages
    // before the round-trip, but the daemon is the authoritative security boundary.
    const allowOutsideRoot = await isDaemonActionAllowed(ctx.userId, "allow_outside_root");

    // Preflight heuristic check (UX-only — daemon enforces authoritatively)
    if (!allowOutsideRoot && detectsOutsideRoot(command)) {
      return {
        ok: false,
        content:
          `The command "${command.slice(0, 80)}" appears to navigate or write outside the daemon workspace root. ` +
          "This is blocked by default. The user can enable unrestricted shell access in " +
          "Profile → Connected Channels → Desktop Daemon → Permissions → Allow Outside Root.",
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
      label: `Shell: ${command.slice(0, 40)}${command.length > 40 ? "…" : ""}`,
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
      lines.push(`Desktop daemon: CONNECTED${desktopMeta.hostname ? ` (${desktopMeta.hostname})` : ""}${desktopLastSeen ? ` — last seen ${desktopLastSeen}` : ""}`);
      lines.push(`  Enabled capabilities: ${desktopCapabilities.length > 0 ? desktopCapabilities.join(", ") : "none"}`);
      if (!desktopPerms?.shell) {
        lines.push(`  Note: 'shell' is disabled. Enable it in Profile → Connected Channels → Desktop Daemon → Permissions to use daemon_shell.`);
      }
    } else {
      lines.push(`Desktop daemon: OFFLINE${desktopLastSeen ? ` — last seen ${desktopLastSeen}` : ""}`);
      lines.push("  To connect: run jarvis-daemon.js with your pair code from Profile → Connected Channels → Desktop Daemon.");
    }

    lines.push("");

    if (androidActive) {
      lines.push(`Android daemon: CONNECTED${androidMeta.hostname ? ` (${androidMeta.hostname})` : ""}${androidLastSeen ? ` — last seen ${androidLastSeen}` : ""}`);
      lines.push(`  Enabled capabilities: ${androidCapabilities.length > 0 ? androidCapabilities.join(", ") : "none"}`);
    } else {
      lines.push(`Android daemon: OFFLINE${androidLastSeen ? ` — last seen ${androidLastSeen}` : ""}`);
      lines.push("  To connect: install the Jarvis Android APK and pair it from Profile → Connected Channels → Android Device.");
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

// ── ScreenMap cache ────────────────────────────────────────────────────────────
// 500 ms per-user cache so back-to-back calls don't hit Claude Vision twice.
interface ScreenMapEntry {
  ts: number;
  result: string;
}
const screenMapCache = new Map<string, ScreenMapEntry>();

export interface ScreenElement {
  label: string;
  description: string;
  center_x: number;
  center_y: number;
  bounds: string;
  resource_id: string;
  clickable: boolean;
}

export const androidScreenUnderstandTool: AgentTool = {
  name: "android_screen_understand",
  description: `Capture and deeply understand the current Android screen by combining a screenshot with the full UI Automator element hierarchy.
Returns a ScreenMap — a structured JSON array of the most important interactive elements, each with: label, description, center_x, center_y (tap coordinates), bounds, resource_id, and clickable flag.

Use this tool when:
- android_read_screen doesn't expose coordinates for the element you need
- You need to find an unlabeled element (icon-only button, search bar with no text)
- Multiple elements share a similar label and you need to disambiguate by position
- You need exact tap coordinates before calling daemon_action with android_tap

After calling this tool, use center_x/center_y from the returned elements as the x/y arguments for android_tap — no coordinate guessing needed.

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
        content: "Android daemon is not connected. Ask the user to install the Jarvis Android APK and pair it (Profile → Connected Channels → Android Device).",
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
        content: "android_screenshot permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_screen_understand: screenshot permission denied",
      };
    }
    if (!readAllowed) {
      return {
        ok: false,
        content: "android_read_screen permission is not enabled. Ask the user to enable it in Profile → Connected Channels → Android Device → Permissions.",
        label: "android_screen_understand: read_screen permission denied",
      };
    }

    // ── 500ms cache check ────────────────────────────────────────────────────
    const cached = screenMapCache.get(ctx.userId);
    if (cached && Date.now() - cached.ts < 500) {
      console.log(`[android_screen_understand] userId=${ctx.userId} serving from cache`);
      return { ok: true, content: cached.result, label: "android_screen_understand: cached" };
    }

    // ── Parallel: screenshot + view hierarchy ────────────────────────────────
    const [screenshotResult, hierarchyResult] = await Promise.all([
      sendDaemonOp(ctx.userId, { type: "android_screenshot" }, 30000),
      sendDaemonOp(ctx.userId, { type: "android_view_hierarchy" }, 30000),
    ]);

    if (!screenshotResult.ok) {
      return {
        ok: false,
        content: `Failed to capture screenshot: ${screenshotResult.error || "unknown error"}`,
        label: "android_screen_understand: screenshot failed",
      };
    }
    if (!hierarchyResult.ok) {
      return {
        ok: false,
        content: `Failed to dump view hierarchy: ${hierarchyResult.error || "unknown error"}`,
        label: "android_screen_understand: hierarchy failed",
      };
    }

    // Screenshot data comes back as { screenshot: base64, format: "jpeg" }
    // matching the Android daemon's handleScreenshot() response format.
    const screenshotData = screenshotResult.data as Record<string, unknown> | undefined;
    const base64Image = (screenshotData?.screenshot as string) || (screenshotData?.image as string) || "";
    if (!base64Image) {
      return {
        ok: false,
        content: "Screenshot returned no image data.",
        label: "android_screen_understand: no image",
      };
    }

    // View hierarchy comes back as { elements: [...], count: N, package: "..." }
    // from the Android daemon's handleViewHierarchy() response.
    const hierarchyData = hierarchyResult.data as Record<string, unknown> | undefined;
    const rawElements = hierarchyData?.elements ?? hierarchyData;
    const elementsJson = typeof rawElements === "string"
      ? rawElements
      : JSON.stringify(rawElements);

    // ── Claude Vision call ───────────────────────────────────────────────────
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
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64Image,
                },
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

      // Strip markdown fences if present
      const cleaned = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      screenElements = JSON.parse(cleaned) as ScreenElement[];
      if (!Array.isArray(screenElements)) screenElements = [];
    } catch (err) {
      console.error("[android_screen_understand] Claude Vision error:", err);
      return {
        ok: false,
        content: `Vision analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        label: "android_screen_understand: vision error",
      };
    }

    const result = JSON.stringify({ ok: true, elements: screenElements, count: screenElements.length });
    screenMapCache.set(ctx.userId, { ts: Date.now(), result });
    console.log(`[android_screen_understand] userId=${ctx.userId} found ${screenElements.length} elements`);

    return {
      ok: true,
      content: result,
      label: `android_screen_understand: ${screenElements.length} elements`,
      detail: `${screenElements.length} interactive elements mapped`,
    };
  },
};
