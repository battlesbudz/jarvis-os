import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";

function loadEnvFile(path) {
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
    if (!process.env[key]) process.env[key] = value;
  }
}

function findInstalledCodexCommand() {
  const configured = process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND;
  if (configured && configured !== "codex") return configured;

  const candidates = [];
  if (isWindows) {
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

async function assertCodexOAuthReady() {
  try {
    const result = await execFileAsync(process.env.JARVIS_CODEX_COMMAND, ["login", "status"], { timeout: 30_000 });
    const output = `${result.stdout}\n${result.stderr}`;
    if (/ChatGPT OAuth|Authenticated:\s*Yes|Logged in using ChatGPT/i.test(output)) return;
    throw new Error("Codex is installed but not logged in with ChatGPT.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ChatGPT/Codex OAuth is not ready on this host: ${message}`);
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

process.env.JARVIS_CODEX_COMMAND = findInstalledCodexCommand();
process.env.NODE_ENV ||= "development";
process.env.HOST ||= "127.0.0.1";
process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put your Railway Postgres public URL in .env.local first.");
  process.exit(1);
}

await assertCodexOAuthReady();

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

const child = spawn(isWindows ? "npx.cmd" : "npx", ["tsx", "server/index.ts"], {
  stdio: "inherit",
  env: process.env,
  shell: isWindows,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
