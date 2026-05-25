import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";

function loadEnvFile(path, { override = false } = {}) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || !process.env[key]) process.env[key] = value;
  }
}

function findInstalledCodexCommand() {
  const configured = process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND;
  if (configured && configured !== "codex") return configured;

  const candidates = [];
  if (isWindows) {
    if (process.env.APPDATA) {
      candidates.push(join(process.env.APPDATA, "npm", "codex.cmd"));
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe"));
      candidates.push(join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "codex.exe"));
    }

    const windowsApps = "C:\\Program Files\\WindowsApps";
    try {
      for (const entry of readdirSync(windowsApps)) {
        if (/^OpenAI\.Codex_/i.test(entry)) {
          candidates.push(join(windowsApps, entry, "app", "resources", "codex.exe"));
        }
      }
    } catch {
      // WindowsApps may be unreadable in some contexts. Fall back to PATH.
    }
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  return configured || "codex";
}

function buildCommand(rawCommand, args) {
  const trimmed = rawCommand.trim();
  if (!isWindows) return { command: trimmed, args };
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith(".cmd") && !lower.endsWith(".bat")) return { command: trimmed, args };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", trimmed, ...args],
  };
}

async function assertCodexOAuthReady() {
  try {
    const built = buildCommand(process.env.JARVIS_CODEX_COMMAND, ["login", "status"]);
    const result = await execFileAsync(built.command, built.args, {
      timeout: 30_000,
      windowsHide: true,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    if (/ChatGPT OAuth|Authenticated:\s*Yes|Logged in using ChatGPT/i.test(output)) return;
    throw new Error("Codex is installed but not logged in with ChatGPT.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ChatGPT/Codex OAuth is not ready on this host: ${message}`);
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local", { override: true });

process.env.JARVIS_CODEX_COMMAND = findInstalledCodexCommand();
process.env.NODE_ENV ||= "development";
process.env.HOST ||= "127.0.0.1";
process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
if (process.env.JARVIS_OAUTH_GATEWAY_SUPERVISED === "true") {
  process.env.JARVIS_CODEX_OAUTH_SKIP_CHECK = "true";
}

if (process.env.JARVIS_CODEX_OAUTH_SKIP_CHECK === "true") {
  console.warn("Skipping Codex OAuth startup probe because JARVIS_CODEX_OAUTH_SKIP_CHECK=true.");
} else {
  await assertCodexOAuthReady();
}

if (process.argv.includes("--check")) {
  console.log("Jarvis local OAuth gateway preflight passed.");
  console.log("AI provider: chatgpt-codex-oauth");
  console.log(`Codex command: ${process.env.JARVIS_CODEX_COMMAND}`);
  console.log(`URL: http://${process.env.HOST}:${process.env.PORT || "5000"}`);
  process.exit(0);
}

console.log("Jarvis local OAuth gateway starting.");
console.log("AI provider: chatgpt-codex-oauth");
console.log(`Codex command: ${process.env.JARVIS_CODEX_COMMAND}`);
console.log(`URL: http://${process.env.HOST}:${process.env.PORT || "5000"}`);

const localTsx = join("node_modules", ".bin", isWindows ? "tsx.cmd" : "tsx");
const configuredEntry = process.env.JARVIS_OAUTH_GATEWAY_ENTRY?.trim();
const serverEntry = !configuredEntry || configuredEntry === "server_dist/index.js"
  ? "scripts/jarvis-codex-gateway-server.mjs"
  : configuredEntry;
const serverCommand = serverEntry ? (isWindows ? "node.exe" : "node") : isWindows ? "cmd.exe" : localTsx;
const serverArgs = serverEntry
  ? [serverEntry]
  : isWindows
    ? ["/d", "/s", "/c", localTsx, "server/index.ts"]
    : ["server/index.ts"];

const child = spawn(serverCommand, serverArgs, {
  stdio: "inherit",
  env: process.env,
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
