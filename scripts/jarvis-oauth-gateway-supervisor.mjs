import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const logDir = resolve(process.env.JARVIS_OAUTH_GATEWAY_LOG_DIR || join(repoRoot, ".jarvis", "logs"));
const pidFile = join(logDir, "jarvis-oauth-gateway-supervisor.pid");
const baseRestartDelayMs = Math.max(1_000, Number(process.env.JARVIS_OAUTH_GATEWAY_RESTART_DELAY_MS || 5_000));
const maxRestartDelayMs = Math.max(baseRestartDelayMs, Number(process.env.JARVIS_OAUTH_GATEWAY_MAX_RESTART_DELAY_MS || 60_000));

mkdirSync(logDir, { recursive: true });

const logStream = createWriteStream(join(logDir, "jarvis-oauth-gateway-supervisor.log"), { flags: "a" });
const childLogStream = createWriteStream(join(logDir, "jarvis-oauth-gateway.log"), { flags: "a" });
const childErrStream = createWriteStream(join(logDir, "jarvis-oauth-gateway.err.log"), { flags: "a" });

let child = null;
let stopping = false;
let restartDelayMs = baseRestartDelayMs;

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${timestamp()}] ${message}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSingleton() {
  if (existsSync(pidFile)) {
    const existingPid = Number(readFileSync(pidFile, "utf8").trim());
    if (isProcessAlive(existingPid)) {
      log(`another supervisor is already running: pid=${existingPid}; exiting`);
      process.exit(0);
    }
    rmSync(pidFile, { force: true });
  }
  writeFileSync(pidFile, String(process.pid));
}

function pipeTo(stream, chunk) {
  process.stdout.write(chunk);
  stream.write(chunk);
}

function startGateway() {
  if (stopping) return;

  const command = isWindows ? "node.exe" : "node";
  const args = ["scripts/jarvis-local-oauth-gateway.mjs"];
  log(`starting gateway: ${command} ${args.join(" ")}`);

  child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    shell: false,
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => pipeTo(childLogStream, chunk));
  child.stderr?.on("data", (chunk) => pipeTo(childErrStream, chunk));

  child.on("error", (error) => {
    log(`gateway process error: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) {
      log(`gateway stopped during supervisor shutdown: code=${code ?? "null"} signal=${signal ?? "none"}`);
      return;
    }

    log(`gateway exited: code=${code ?? "null"} signal=${signal ?? "none"}; restarting in ${restartDelayMs}ms`);
    setTimeout(startGateway, restartDelayMs);
    restartDelayMs = Math.min(maxRestartDelayMs, Math.round(restartDelayMs * 1.5));
  });
}

function stopSupervisor(signal) {
  if (stopping) return;
  stopping = true;
  log(`supervisor received ${signal}; stopping gateway`);

  if (child && !child.killed) {
    child.kill();
  }

  setTimeout(() => {
    log("supervisor exiting");
    rmSync(pidFile, { force: true });
    logStream.end();
    childLogStream.end();
    childErrStream.end();
    process.exit(0);
  }, 1_000).unref();
}

process.on("SIGINT", () => stopSupervisor("SIGINT"));
process.on("SIGTERM", () => stopSupervisor("SIGTERM"));

log(`Jarvis OAuth gateway supervisor online; repo=${repoRoot}; logs=${logDir}`);
acquireSingleton();
startGateway();
