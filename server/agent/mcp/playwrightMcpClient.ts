/**
 * Playwright MCP client — wraps the @playwright/mcp stdio subprocess.
 *
 * One MCP server process is maintained per user.  Sessions time out after
 * IDLE_TIMEOUT_MS of inactivity and are restarted on demand.
 *
 * Persistent browser profiles per user are stored under:
 *   ~/.jarvis/browser-profiles/<userId>/
 *
 * Screenshot output (files written by MCP tools) land in:
 *   /tmp/jarvis-mcp-screens/<userId>/
 *
 * The JSON-RPC stdio plumbing is delegated to the generic McpClient class,
 * keeping Playwright-specific logic (process args, screenshot dirs) here.
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { McpClient, McpToolResult } from "./mcpClient";
import { isDesktopDaemonActive, isDaemonActionAllowed, sendDaemonOp } from "../../daemon/bridge";

export type { McpContentItem, McpToolResult } from "./mcpClient";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

const MCP_CLI = path.join(process.cwd(), "node_modules/@playwright/mcp/cli.js");

/**
 * Find Playwright's own chromium binary so the MCP subprocess can use it
 * instead of looking for a system "chrome" distribution.
 */
function findPlaywrightChromium(): string | null {
  const cacheDirs = [
    path.join(process.cwd(), ".cache", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ];
  for (const cacheDir of cacheDirs) {
    if (!fs.existsSync(cacheDir)) continue;
    try {
      const dirs = fs.readdirSync(cacheDir)
        .filter((d) => d.startsWith("chromium-"))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const dir of dirs) {
        for (const sub of [
          "chrome-linux64/chrome",
          "chrome-linux/chrome",
          "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
          "chrome.exe",
        ]) {
          const p = path.join(cacheDir, dir, sub);
          if (fs.existsSync(p)) return p;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ── Session ────────────────────────────────────────────────────────────────────

class McpSession {
  readonly userId: string;
  readonly profileDir: string;
  readonly screenshotDir: string;
  lastActive = Date.now();

  private readonly client: McpClient;
  private readonly connectPromise: Promise<void>;

  constructor(userId: string) {
    this.userId = userId;
    this.profileDir = path.join(os.homedir(), ".jarvis", "browser-profiles", userId);
    this.screenshotDir = path.join(os.tmpdir(), "jarvis-mcp-screens", userId);
    fs.mkdirSync(this.profileDir, { recursive: true });
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    const chromiumPath = findPlaywrightChromium();
    const mcpArgs = [
      MCP_CLI,
      "--headless",
      "--no-sandbox",
      "--user-data-dir", this.profileDir,
      "--output-dir", this.screenshotDir,
      "--allow-unrestricted-file-access",
    ];
    if (chromiumPath) mcpArgs.push("--executable-path", chromiumPath);

    this.client = new McpClient({ type: "stdio", command: "node", args: mcpArgs });
    this.connectPromise = this.client.connect().then(() => {
      console.log(`[MCP] session initialized for user ${this.userId}`);
    }).catch((err) => {
      console.error(`[MCP] session init failed for user ${this.userId}:`, (err as Error).message);
      sessions.delete(userId);
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.connectPromise;
    this.lastActive = Date.now();
    return this.client.callTool(name, args);
  }

  close(): void {
    this.client.disconnect();
  }
}

// ── Session registry ───────────────────────────────────────────────────────────

const sessions = new Map<string, McpSession>();

function getOrCreate(userId: string): McpSession {
  let s = sessions.get(userId);
  if (!s) {
    s = new McpSession(userId);
    sessions.set(userId, s);
  }
  return s;
}

/**
 * Call a browser MCP tool.
 *
 * Routing order:
 * 1. If the user's desktop daemon is connected AND the `browser_local` permission
 *    is ON, proxy the call through the daemon's local MCP server (real browser with
 *    the user's existing cookies/logins).
 * 2. Otherwise fall back to the server-side headless MCP instance.
 */
export async function callBrowserTool(
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  if (isDesktopDaemonActive(userId)) {
    const allowed = await isDaemonActionAllowed(userId, "browser_local");
    if (allowed) {
      try {
        const result = await sendDaemonOp(userId, { type: "browser_mcp", tool: toolName, args }, 35000);
        return result.data as McpToolResult ?? {
          content: [{ type: "text", text: result.error ?? "Daemon browser_mcp returned no data" }],
          isError: true,
        };
      } catch (err) {
        console.log(`[MCP] daemon unreachable for ${toolName}, falling back to server:`, (err as Error).message ?? err);
      }
    }
  }
  return getOrCreate(userId).callTool(toolName, args);
}

/**
 * Close the daemon's local MCP browser session (best-effort).
 */
export async function closeDaemonBrowserSession(userId: string): Promise<void> {
  if (!isDesktopDaemonActive(userId)) return;
  try {
    const allowed = await isDaemonActionAllowed(userId, "browser_local");
    if (!allowed) return;
    await sendDaemonOp(userId, { type: "browser_mcp", tool: "browser_close", args: {} }, 10000);
  } catch { /* best effort */ }
}

export function closeMcpSession(userId: string, wipeProfile = false): void {
  const s = sessions.get(userId);
  if (s) {
    s.close();
    sessions.delete(userId);
  }
  if (wipeProfile) {
    const profileDir = path.join(os.homedir(), ".jarvis", "browser-profiles", userId);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

export function hasMcpSession(userId: string): boolean {
  return sessions.has(userId);
}

/**
 * Returns true when there is either:
 * - a live server-side MCP session, OR
 * - a connected desktop daemon with browser_local permission enabled
 */
export async function hasActiveBrowserContext(userId: string): Promise<boolean> {
  if (sessions.has(userId)) return true;
  if (isDesktopDaemonActive(userId)) {
    return isDaemonActionAllowed(userId, "browser_local");
  }
  return false;
}

export function getScreenshotDir(userId: string): string {
  return path.join(os.tmpdir(), "jarvis-mcp-screens", userId);
}

/**
 * Read the most recently written file in the user's screenshot directory,
 * convert to base64, then clean up.
 */
export function popLatestScreenshot(userId: string): string | null {
  const dir = getScreenshotDir(userId);
  try {
    const files = fs.readdirSync(dir)
      .map((f) => ({ f, mt: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt);
    if (!files.length) return null;
    const fp = path.join(dir, files[0].f);
    const data = fs.readFileSync(fp).toString("base64");
    fs.unlinkSync(fp);
    return data;
  } catch { return null; }
}

// ── Idle cleanup ───────────────────────────────────────────────────────────────

const cleanupTimer: ReturnType<typeof setInterval> = setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions.entries()) {
    if (now - session.lastActive > IDLE_TIMEOUT_MS) {
      console.log(`[MCP] closing idle session for user ${userId}`);
      session.close();
      sessions.delete(userId);
    }
  }
}, CLEANUP_INTERVAL_MS);

if ((cleanupTimer as unknown as { unref?: () => void }).unref) {
  (cleanupTimer as unknown as { unref: () => void }).unref();
}
