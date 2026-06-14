import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const command = process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND || "codex";

function buildCommand(rawCommand, args) {
  const trimmed = rawCommand.trim();
  if (process.platform !== "win32") return { command: trimmed, args };
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith(".cmd") && !lower.endsWith(".bat")) return { command: trimmed, args };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", trimmed, ...args],
  };
}

async function run(args) {
  try {
    const built = buildCommand(command, args);
    const result = await execFileAsync(built.command, built.args, { timeout: 30_000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
    };
  }
}

const status = await run(["login", "status"]);
console.log("=== codex login status ===");
console.log((status.stdout || status.stderr || "").trim());

if (!status.ok) {
  console.error("Codex status probe failed. ChatGPT/Codex OAuth is not ready on this host.");
  process.exit(1);
}

const statusText = `${status.stdout}\n${status.stderr}`;
if (!/ChatGPT OAuth|Authenticated:\s*Yes|Logged in using ChatGPT/i.test(statusText)) {
  console.error("Codex is installed but does not appear authenticated with ChatGPT OAuth.");
  process.exit(2);
}

console.log("Jarvis ChatGPT/Codex OAuth appears available on this host.");
