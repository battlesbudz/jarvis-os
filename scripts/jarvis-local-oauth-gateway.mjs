import { existsSync, readFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";
const codexCommand = process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND || "codex";

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

async function assertCodexOAuthReady() {
  try {
    const result = await execFileAsync(codexCommand, ["login", "status"], { timeout: 30_000 });
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

process.env.NODE_ENV ||= "development";
process.env.HOST ||= "127.0.0.1";
process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
process.env.JARVIS_CODEX_COMMAND ||= codexCommand;

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
