import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const command = process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND || "codex";

async function run(args) {
  try {
    const result = await execFileAsync(command, args, { timeout: 30_000 });
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
