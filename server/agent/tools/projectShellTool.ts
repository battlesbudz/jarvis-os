/**
 * projectShellTool — sandboxed shell execution for standalone app projects.
 *
 * Unlike runShellTool (which allows a fixed set of Jarvis-internal commands),
 * this tool runs npm/npx/node/git/zip and other build commands freely, but
 * enforces:
 *   - An allowlist of executables
 *   - cwd is always the project's workspaceDir (cannot escape the sandbox)
 *   - Timeout: 300s for npm install/build, 30s for all others
 *   - Dev server commands run in the background, returning the local URL + PID
 */

import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AgentTool } from "../types";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getProjectWorkspaceDir, getProjectWorkspaceRoot } from "../../projectStorage";
import { hydrateProjectWorkspace, snapshotProjectWorkspace } from "../../projectArtifacts";

const ALLOWED_EXECUTABLES = new Set([
  "npm", "npx", "node", "git", "zip", "unzip",
  "ls", "cat", "mkdir", "cp", "mv", "rm", "echo", "curl",
  "touch", "chmod", "tsc",
]);

const DEV_SERVER_COMMANDS = [
  /npm\s+run\s+dev/i,
  /npm\s+start/i,
  /npx\s+vite/i,
  /next\s+dev/i,
  /node\s+.*server/i,
];

const LONG_RUNNING_COMMANDS = [
  /npm\s+(install|ci|run\s+build|run\s+dev|start)/i,
  /npx\s+(create-|vite|next)/i,
  /yarn\s+(install|build|dev|start)/i,
  /pnpm\s+(install|build|dev|start)/i,
];

const PORT_RANGE_START = 3001;
const PORT_RANGE_END = 3999;

const runningServers = new Map<string, { pid: number; port: number; workspaceDir: string }>();

// ── PID file helpers ────────────────────────────────────────────────────────
// Persist {pid, port} to <workspaceDir>/.jarvis-dev-server.json so orphaned
// processes can be killed on the next server startup even after a restart.

function pidFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, ".jarvis-dev-server.json");
}

function writePidFile(workspaceDir: string, pid: number, port: number): void {
  try {
    fs.writeFileSync(pidFilePath(workspaceDir), JSON.stringify({ pid, port }), "utf8");
  } catch {
    // Non-fatal — cleanup is best-effort
  }
}

function removePidFile(workspaceDir: string): void {
  try {
    fs.unlinkSync(pidFilePath(workspaceDir));
  } catch {
    // Already gone — ignore
  }
}

/**
 * Called from server/index.ts on boot. Scans all known project workspace
 * directories for leftover .jarvis-dev-server.json files, kills surviving
 * processes, and removes the files so ports are not leaked across restarts.
 */
export function cleanupOrphanedDevServers(): void {
  const projectsRoot = getProjectWorkspaceRoot();
  if (!fs.existsSync(projectsRoot)) return;

  let entries: string[];
  try {
    entries = fs.readdirSync(projectsRoot);
  } catch {
    return;
  }

  for (const entry of entries) {
    const pidFile = path.join(projectsRoot, entry, ".jarvis-dev-server.json");
    if (!fs.existsSync(pidFile)) continue;

    let data: { pid?: number; port?: number } = {};
    try {
      data = JSON.parse(fs.readFileSync(pidFile, "utf8"));
    } catch {
      // Corrupt file — just delete it
    }

    if (data.pid) {
      try {
        process.kill(data.pid, "SIGTERM");
        console.log(`[ProjectShell] cleanupOrphanedDevServers: killed stale PID ${data.pid} (project=${entry})`);
      } catch {
        // Already dead
      }
    }

    try {
      fs.unlinkSync(pidFile);
    } catch {
      // Ignore
    }
  }
}

/**
 * Shell chaining/injection/redirect characters. Used as a defense-in-depth check
 * before spawning without a shell, ensuring clearly malicious command strings are
 * rejected with an informative error rather than failing silently at spawn time:
 *   ;  &  &&  ||  |  `  $(  \n  > <
 */
const SHELL_METACHAR_RE = /[;&|`<>\n]|\$\(/;

function hasShellMetachars(command: string): boolean {
  return SHELL_METACHAR_RE.test(command);
}

function parseExecutable(command: string): string {
  return command.trim().split(/\s+/)[0].split("/").pop() ?? "";
}

function isDevServerCommand(command: string): boolean {
  return DEV_SERVER_COMMANDS.some((rx) => rx.test(command));
}

function isLongRunning(command: string): boolean {
  return LONG_RUNNING_COMMANDS.some((rx) => rx.test(command));
}

function findAvailablePort(): number {
  const usedPorts = new Set([...runningServers.values()].map((s) => s.port));
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!usedPorts.has(port)) {
      try {
        execSync(`lsof -i:${port}`, { stdio: "ignore", timeout: 2000 });
      } catch {
        return port;
      }
    }
  }
  return PORT_RANGE_START;
}

function hasCdOutside(command: string, workspaceDir: string): boolean {
  const cdMatch = command.match(/(?:^|\s)cd\s+([^\s;&|]+)/);
  if (!cdMatch) return false;
  const target = cdMatch[1];
  const resolvedWorkspace = path.resolve(workspaceDir);
  const resolvedTarget = path.resolve(workspaceDir, target);
  return !resolvedTarget.startsWith(resolvedWorkspace + path.sep) && resolvedTarget !== resolvedWorkspace;
}

/**
 * Returns true if a string value looks like a filesystem path (absolute, home-relative,
 * or using parent-directory traversal).
 */
function looksLikePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value === ".." ||
    value.startsWith("../") ||
    value.includes("/..") ||
    value.startsWith("~/")
  );
}

/**
 * Resolve a path-like value against workspaceDir and check containment.
 */
function resolvePathValue(value: string, workspaceDir: string): string {
  if (value.startsWith("~/")) {
    return path.resolve(os.homedir(), value.slice(2));
  }
  return path.resolve(workspaceDir, value);
}

function isSafeProjectRelativePath(value: string): boolean {
  if (!value || value.length > 240) return false;
  if (path.isAbsolute(value)) return false;
  const normalized = value.replace(/\\/g, "/");
  if (normalized.includes("\0")) return false;
  return !normalized.split("/").some((part) => part === "..");
}

async function getOrCreateProjectWorkspace(projectId: string): Promise<
  | { ok: true; workspaceDir: string }
  | { ok: false; content: string; label: string }
> {
  const [project] = await db
    .select()
    .from(schema.jarvisProjects)
    .where(eq(schema.jarvisProjects.id, projectId))
    .limit(1);

  if (!project) {
    return { ok: false, content: `Project ${projectId} not found`, label: "Project not found" };
  }

  let workspaceDir = project.workspaceDir;
  if (!workspaceDir) {
    workspaceDir = getProjectWorkspaceDir(projectId);
    fs.mkdirSync(workspaceDir, { recursive: true });
    await db
      .update(schema.jarvisProjects)
      .set({ workspaceDir, updatedAt: new Date() })
      .where(eq(schema.jarvisProjects.id, projectId));
  }

  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }
  await hydrateProjectWorkspace(projectId, workspaceDir).catch((err) => {
    console.warn(`[ProjectShell] failed to hydrate workspace for ${projectId}:`, err);
  });

  return { ok: true, workspaceDir };
}

/**
 * Scan all tokens in the command that look like filesystem paths and reject any
 * that resolve outside the workspace directory.  This prevents commands such as:
 *   cat /etc/passwd               (absolute path outside workspace)
 *   rm -rf ../server              (relative path escaping workspace)
 *   cp /home/runner/.../file .    (absolute path from host)
 *   npm --prefix=/home/... ...    (--key=value flag with path value)
 *
 * Positional tokens starting with `/`, `..`, or `~/` are treated as paths.
 * `--key=value` flag-style tokens are parsed and the value portion is checked.
 * Plain short flags (-r, -rf) and non-path positional args (e.g. lodash) are skipped.
 */
function hasUnsafePathArgs(command: string, workspaceDir: string): boolean {
  const tokens = command.trim().split(/\s+/).slice(1); // skip the executable
  const resolvedWorkspace = path.resolve(workspaceDir);

  function isOutside(resolved: string): boolean {
    return (
      !resolved.startsWith(resolvedWorkspace + path.sep) &&
      resolved !== resolvedWorkspace
    );
  }

  for (const token of tokens) {
    if (!token) continue;

    // Handle --key=value or -key=value patterns
    if (token.startsWith("-") && token.includes("=")) {
      const eqIdx = token.indexOf("=");
      const value = token.slice(eqIdx + 1);
      if (value && looksLikePath(value)) {
        if (isOutside(resolvePathValue(value, workspaceDir))) return true;
      }
      continue;
    }

    // Skip bare flags
    if (token.startsWith("-")) continue;

    // Only check positional tokens that look like paths
    if (!looksLikePath(token)) continue;

    if (isOutside(resolvePathValue(token, workspaceDir))) return true;
  }
  return false;
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const tokens = command.trim().split(/\s+/);
    const executable = tokens[0];
    const args = tokens.slice(1);
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, HOME: os.homedir(), PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      (setTimeout(() => child.kill("SIGKILL"), 3000) as unknown as { unref(): void }).unref();
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, 8000),
        stderr: stderr.slice(0, 4000),
        exitCode: timedOut ? -1 : (code ?? 0),
      });
    });
  });
}

async function runDevServer(
  command: string,
  cwd: string,
  projectId: string,
  port: number,
): Promise<{ pid: number; url: string }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      HOME: os.homedir(),
      PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
      PORT: String(port),
    };

    const devTokens = command.trim().split(/\s+/);
    const devExecutable = devTokens[0];
    const devArgs = devTokens.slice(1);
    const child = spawn(devExecutable, devArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      shell: false,
    });

    const pid = child.pid ?? 0;
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      runningServers.set(projectId, { pid, port, workspaceDir: cwd });
      writePidFile(cwd, pid, port);
      resolve({ pid, url: `http://localhost:${port}` });
    };

    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString();
      if (
        text.toLowerCase().includes("ready") ||
        text.toLowerCase().includes("started") ||
        text.toLowerCase().includes("listening") ||
        text.includes("localhost") ||
        text.includes(String(port))
      ) {
        settle();
      }
    });

    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      if (
        text.toLowerCase().includes("ready") ||
        text.toLowerCase().includes("started") ||
        text.toLowerCase().includes("listening") ||
        text.includes(String(port))
      ) {
        settle();
      }
    });

    (setTimeout(settle, 15000) as unknown as { unref(): void }).unref();

    child.unref();
  });
}

export function stopProjectServer(projectId: string): void {
  const server = runningServers.get(projectId);
  if (server) {
    try {
      process.kill(server.pid, "SIGTERM");
    } catch {
      // already gone
    }
    removePidFile(server.workspaceDir);
    runningServers.delete(projectId);
  }
}

export const projectShellTool: AgentTool = {
  name: "project_shell",
  description: `Run shell commands within the current standalone project's isolated workspace directory.
Available executables: npm, npx, node, git, zip, unzip, ls, cat, mkdir, cp, mv, rm, echo, curl, touch, chmod, tsc.
All commands run in the project workspace directory — you cannot escape the sandbox.
Restrictions: shell chaining operators (;, &&, ||, |, >, <, \`, $(...)) are blocked; run one command at a time.
Path arguments that resolve outside the workspace are rejected.
Special: when starting a dev server (npm run dev / npx vite / next dev), use background=true.
The tool returns the local URL where the app is running so you can immediately test it with browser tools.`,
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Full shell command, e.g. 'npm install' or 'npx create-next-app@latest . --typescript --yes'",
      },
      timeout_seconds: {
        type: "number",
        description: "Timeout in seconds (default 30, max 300 for npm install/build)",
      },
      background: {
        type: "boolean",
        description: "Run in background (for dev servers). Returns URL and PID.",
      },
    },
    required: ["command"],
  },
  async execute(args: Record<string, unknown>, ctx) {
    const command = String(args.command ?? "").trim();
    const background = Boolean(args.background ?? false);
    const timeoutSeconds = Math.min(
      Number(args.timeout_seconds ?? (isLongRunning(command) ? 300 : 30)),
      300,
    );

    const projectId = String(ctx?.projectId ?? "");
    if (!projectId) {
      return { ok: false, content: "project_shell requires a projectId in context", label: "No project context" };
    }

    const [project] = await db
      .select()
      .from(schema.jarvisProjects)
      .where(eq(schema.jarvisProjects.id, projectId))
      .limit(1);

    if (!project) {
      return { ok: false, content: `Project ${projectId} not found`, label: "Project not found" };
    }

    let workspaceDir = project.workspaceDir;
    if (!workspaceDir) {
      workspaceDir = getProjectWorkspaceDir(projectId);
      fs.mkdirSync(workspaceDir, { recursive: true });
      await db
        .update(schema.jarvisProjects)
        .set({ workspaceDir, updatedAt: new Date() })
        .where(eq(schema.jarvisProjects.id, projectId));
    }

    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }
    await hydrateProjectWorkspace(projectId, workspaceDir).catch((err) => {
      console.warn(`[ProjectShell] failed to hydrate workspace for ${projectId}:`, err);
    });

    const executable = parseExecutable(command);
    if (!ALLOWED_EXECUTABLES.has(executable)) {
      return {
        ok: false,
        content: `Executable '${executable}' is not in the allowlist. Allowed: ${[...ALLOWED_EXECUTABLES].join(", ")}`,
        label: "Blocked executable",
      };
    }

    if (hasShellMetachars(command)) {
      return {
        ok: false,
        content:
          "Command contains shell chaining operators (;, &&, ||, |, >, <, `, $(...)) which are not allowed. " +
          "Run one command at a time.",
        label: "Shell metachar blocked",
      };
    }

    if (hasUnsafePathArgs(command, workspaceDir)) {
      return {
        ok: false,
        content:
          "Command contains a path argument that resolves outside the project workspace. " +
          "Only paths within the workspace directory are allowed.",
        label: "Unsafe path argument blocked",
      };
    }

    if (hasCdOutside(command, workspaceDir)) {
      return {
        ok: false,
        content: "Command attempts to navigate outside the project workspace. This is not allowed.",
        label: "Sandbox violation",
      };
    }

    if (background || isDevServerCommand(command)) {
      let port = project.devServerPort ?? 0;
      if (!port || port < PORT_RANGE_START || port > PORT_RANGE_END) {
        port = findAvailablePort();
        await db
          .update(schema.jarvisProjects)
          .set({ devServerPort: port, updatedAt: new Date() })
          .where(eq(schema.jarvisProjects.id, projectId));
      }

      stopProjectServer(projectId);

      const { pid, url } = await runDevServer(command, workspaceDir, projectId, port);
      console.log(`[ProjectShell] started dev server for project ${projectId} PID=${pid} port=${port}`);

      return {
        ok: true,
        content: `Dev server started at ${url} (PID ${pid}). Use browser_navigate to test it.`,
        label: "Dev server started",
        detail: url,
        metadata: { background: true, pid, port, url },
      };
    }

    const { stdout, stderr, exitCode } = await runCommand(command, workspaceDir, timeoutSeconds);
    await snapshotProjectWorkspace(projectId, workspaceDir).catch((err) => {
      console.warn(`[ProjectShell] failed to snapshot workspace for ${projectId}:`, err);
    });

    const success = exitCode === 0;
    console.log(
      `[ProjectShell] project=${projectId} cmd="${command.slice(0, 80)}" exit=${exitCode} stdout=${stdout.length}b`,
    );

    const contentParts: string[] = [];
    if (stdout && stdout !== "(no output)") contentParts.push(`STDOUT:\n${stdout}`);
    if (stderr) contentParts.push(`STDERR:\n${stderr}`);
    if (!success) contentParts.push(`Exit code: ${exitCode}`);

    return {
      ok: success,
      content: contentParts.join("\n\n") || "(command completed with no output)",
      label: success ? `Command ok (exit ${exitCode})` : `Command failed (exit ${exitCode})`,
      detail: `cwd: ${workspaceDir}`,
      metadata: { exitCode, workspaceDir },
    };
  },
};

export const projectWriteFileTool: AgentTool = {
  name: "project_write_file",
  description: `Write or replace a text file inside the current standalone app project's isolated workspace.
Use this for app source files, CSS, package.json, Vite config, HTML, and README files.
Path must be relative to the project workspace, for example 'src/App.jsx' or 'package.json'.`,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path inside the project workspace, e.g. 'src/App.jsx'.",
      },
      content: {
        type: "string",
        description: "Complete file content to write.",
      },
    },
    required: ["path", "content"],
  },
  async execute(args: Record<string, unknown>, ctx) {
    const projectId = String(ctx?.projectId ?? "");
    if (!projectId) {
      return { ok: false, content: "project_write_file requires a projectId in context", label: "No project context" };
    }

    const relativePath = String(args.path ?? "").trim();
    const content = String(args.content ?? "");
    if (!isSafeProjectRelativePath(relativePath)) {
      return {
        ok: false,
        content: "Invalid path. Use a relative path inside the project workspace without '..' segments.",
        label: "Unsafe path blocked",
      };
    }
    if (content.length > 1_000_000) {
      return { ok: false, content: "File content is too large for project_write_file.", label: "Content too large" };
    }

    const workspace = await getOrCreateProjectWorkspace(projectId);
    if (!workspace.ok) return workspace;

    const root = path.resolve(workspace.workspaceDir);
    const fullPath = path.resolve(root, relativePath);
    if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
      return {
        ok: false,
        content: "Resolved file path escapes the project workspace.",
        label: "Unsafe path blocked",
      };
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    await snapshotProjectWorkspace(projectId, workspace.workspaceDir).catch((err) => {
      console.warn(`[ProjectShell] failed to snapshot workspace for ${projectId}:`, err);
    });

    console.log(`[ProjectWriteFile] project=${projectId} path="${relativePath}" bytes=${content.length}`);
    return {
      ok: true,
      content: `Wrote ${relativePath} (${content.length} bytes).`,
      label: "File written",
      detail: `cwd: ${workspace.workspaceDir}`,
      metadata: { path: relativePath, bytes: content.length, workspaceDir: workspace.workspaceDir },
    };
  },
};
