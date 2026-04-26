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
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { isDesktopDaemonActive, isDaemonActionAllowed, sendDaemonOp } from "../../daemon/bridge";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

const MCP_CLI = path.join(process.cwd(), "node_modules/@playwright/mcp/cli.js");

export interface McpContentItem {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: unknown;
}

export interface McpToolResult {
  content: McpContentItem[];
  isError?: boolean;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
  jsonrpc: string;
}

// ── Session ────────────────────────────────────────────────────────────────────

class McpSession {
  readonly userId: string;
  readonly profileDir: string;
  readonly screenshotDir: string;
  lastActive = Date.now();

  private proc: ChildProcess;
  private buf = "";
  private pending = new Map<number, (r: JsonRpcResponse) => void>();
  private counter = 0;
  private initDone = false;
  private readonly initPromise: Promise<void>;

  constructor(userId: string) {
    this.userId = userId;
    this.profileDir = path.join(os.homedir(), ".jarvis", "browser-profiles", userId);
    this.screenshotDir = path.join(os.tmpdir(), "jarvis-mcp-screens", userId);
    fs.mkdirSync(this.profileDir, { recursive: true });
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    this.proc = spawn(
      "node",
      [
        MCP_CLI,
        "--headless",
        "--no-sandbox",
        "--user-data-dir", this.profileDir,
        "--output-dir", this.screenshotDir,
        "--allow-unrestricted-file-access",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      const lines = this.buf.split("\n");
      this.buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id != null) {
            const cb = this.pending.get(msg.id);
            if (cb) { this.pending.delete(msg.id); cb(msg); }
          }
        } catch { /* not a JSON-RPC response */ }
      }
    });

    this.proc.stderr!.on("data", () => { /* suppress MCP subprocess stderr */ });
    this.proc.on("exit", () => {
      console.log(`[MCP] session exited for user ${userId}`);
      sessions.delete(userId);
    });

    this.initPromise = this.initialize();
  }

  private send(msg: unknown): void {
    try { this.proc.stdin!.write(JSON.stringify(msg) + "\n"); } catch { /* ignore */ }
  }

  private request(method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve) => {
      const id = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, jsonrpc: "2.0", error: { code: -32000, message: `Timeout calling ${method}` } });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private async initialize(): Promise<void> {
    const res = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "jarvis", version: "1.0.0" },
    });
    if (res.error) throw new Error(`MCP init failed: ${res.error.message}`);
    this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    this.initDone = true;
    console.log(`[MCP] session initialized for user ${this.userId}`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.initPromise;
    if (!this.initDone) return { content: [{ type: "text", text: "MCP not initialized" }], isError: true };
    this.lastActive = Date.now();

    const res = await this.request("tools/call", { name, arguments: args });
    if (res.error) {
      return { content: [{ type: "text", text: `MCP error: ${res.error.message}` }], isError: true };
    }
    const r = res.result as McpToolResult | undefined;
    return r ?? { content: [], isError: false };
  }

  close(): void {
    try { this.proc.kill("SIGTERM"); } catch { /* noop */ }
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
        if (result.ok && result.data) {
          return result.data as McpToolResult;
        }
        if (!result.ok) {
          console.log(`[MCP] daemon browser_mcp failed for ${toolName}, falling back to server: ${result.error}`);
        }
      } catch (err) {
        console.log(`[MCP] daemon routing error, falling back to server:`, err);
      }
    }
  }
  return getOrCreate(userId).callTool(toolName, args);
}

export function closeMcpSession(userId: string, wipeProfile = false): void {
  const s = sessions.get(userId);
  if (s) {
    s.close();
    sessions.delete(userId);
    if (wipeProfile) {
      try { fs.rmSync(s.profileDir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }
}

export function hasMcpSession(userId: string): boolean {
  return sessions.has(userId);
}

/**
 * Returns true when there is either:
 * - a live server-side MCP session, OR
 * - a connected desktop daemon with browser_local permission enabled
 * (meaning the next callBrowserTool will succeed without navigating first).
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
 * Read the most recently written file in the user's screenshot directory
 * (files put there by browser_take_screenshot calls), convert to base64,
 * then clean up.
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
