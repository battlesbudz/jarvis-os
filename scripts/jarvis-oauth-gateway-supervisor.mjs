import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const logDir = resolve(process.env.JARVIS_OAUTH_GATEWAY_LOG_DIR || join(repoRoot, ".jarvis", "logs"));
const pidFile = join(logDir, "jarvis-oauth-gateway-supervisor.pid");
const statusFile = join(logDir, "jarvis-oauth-gateway-status.json");
const baseRestartDelayMs = Math.max(1_000, Number(process.env.JARVIS_OAUTH_GATEWAY_RESTART_DELAY_MS || 5_000));
const maxRestartDelayMs = Math.max(baseRestartDelayMs, Number(process.env.JARVIS_OAUTH_GATEWAY_MAX_RESTART_DELAY_MS || 60_000));
const healthIntervalMs = Math.max(5_000, Number(process.env.JARVIS_OAUTH_GATEWAY_HEALTH_INTERVAL_MS || 30_000));
const healthTimeoutMs = Math.max(1_000, Number(process.env.JARVIS_OAUTH_GATEWAY_HEALTH_TIMEOUT_MS || 30_000));
const startupGraceMs = Math.max(10_000, Number(process.env.JARVIS_OAUTH_GATEWAY_STARTUP_GRACE_MS || 120_000));
const maxLocalFailures = Math.max(1, Number(process.env.JARVIS_OAUTH_GATEWAY_MAX_LOCAL_FAILURES || 2));
const maxPublicFailures = Math.max(1, Number(process.env.JARVIS_OAUTH_GATEWAY_MAX_PUBLIC_FAILURES || 3));
const restartOnPublicFailure = process.env.JARVIS_OAUTH_GATEWAY_RESTART_ON_PUBLIC_FAILURE === "true";

mkdirSync(logDir, { recursive: true });

const logStream = createWriteStream(join(logDir, "jarvis-oauth-gateway-supervisor.log"), { flags: "a" });
const childLogStream = createWriteStream(join(logDir, "jarvis-oauth-gateway.log"), { flags: "a" });
const childErrStream = createWriteStream(join(logDir, "jarvis-oauth-gateway.err.log"), { flags: "a" });

let child = null;
let stopping = false;
let restartDelayMs = baseRestartDelayMs;
let localFailureCount = 0;
let publicFailureCount = 0;
let lastHealth = null;
let childStartedAt = 0;

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${timestamp()}] ${message}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

function localHealthUrl() {
  const host = process.env.HOST || "127.0.0.1";
  const port = process.env.PORT || "5000";
  return `http://${host}:${port}/api/ping`;
}

function publicHealthUrl() {
  const raw = (
    process.env.JARVIS_OAUTH_GATEWAY_PUBLIC_URL ||
    process.env.JARVIS_CODEX_GATEWAY_PUBLIC_URL ||
    process.env.JARVIS_CODEX_GATEWAY_URL ||
    ""
  ).trim();
  if (!raw) return null;
  return `${raw.replace(/\/+$/, "")}/api/codex/gateway-health`;
}

async function probeJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), healthTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const raw = await response.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw.slice(0, 200);
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function writeStatus(status) {
  lastHealth = status;
  try {
    writeFileSync(statusFile, JSON.stringify(status, null, 2));
  } catch (error) {
    log(`failed to write status file: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  const childEnv = { ...process.env };
  childEnv.JARVIS_OAUTH_GATEWAY_SUPERVISED = "true";
  childEnv.JARVIS_CODEX_OAUTH_SKIP_CHECK = "true";
  log(`starting gateway: ${command} ${args.join(" ")}`);
  childStartedAt = Date.now();

  child = spawn(command, args, {
    cwd: repoRoot,
    env: childEnv,
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

function restartGateway(reason) {
  if (stopping) return;
  log(`health restart requested: ${reason}`);
  restartDelayMs = baseRestartDelayMs;
  if (child && !child.killed) {
    child.kill();
    return;
  }
  startGateway();
}

async function checkGatewayHealth() {
  if (stopping) return;
  if (child && Date.now() - childStartedAt < startupGraceMs) {
    const local = await probeJson(localHealthUrl());
    if (!local.ok) {
      writeStatus({
        checkedAt: new Date().toISOString(),
        supervisorPid: process.pid,
        gatewayPid: child.pid ?? null,
        starting: true,
        local: {
          url: localHealthUrl(),
          ok: false,
          status: local.status ?? null,
          error: local.error ?? null,
          failureCount: 0,
        },
        message: `Gateway is inside startup grace period (${startupGraceMs}ms).`,
      });
      return;
    }
    childStartedAt = 0;
    localFailureCount = 0;
  }

  const localUrl = localHealthUrl();
  const publicUrl = publicHealthUrl();
  const local = await probeJson(localUrl);
  const token = process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim();
  const publicResult = publicUrl
    ? await probeJson(publicUrl, token ? { Authorization: `Bearer ${token}` } : {})
    : null;

  localFailureCount = local.ok ? 0 : localFailureCount + 1;
  publicFailureCount = !publicResult || publicResult.ok ? 0 : publicFailureCount + 1;

  const status = {
    checkedAt: new Date().toISOString(),
    supervisorPid: process.pid,
    gatewayPid: child?.pid ?? null,
    local: {
      url: localUrl,
      ok: local.ok,
      status: local.status ?? null,
      error: local.error ?? null,
      failureCount: localFailureCount,
    },
    public: publicUrl ? {
      url: publicUrl,
      ok: publicResult?.ok === true,
      status: publicResult?.status ?? null,
      error: publicResult?.error ?? null,
      failureCount: publicFailureCount,
    } : null,
    restartPolicy: {
      maxLocalFailures,
      maxPublicFailures,
      restartOnPublicFailure,
    },
  };
  writeStatus(status);

  if (!local.ok) {
    log(`local health probe failed (${localFailureCount}/${maxLocalFailures}): ${local.error || local.status || "unknown"}`);
  }
  if (publicResult && !publicResult.ok) {
    log(`public health probe failed (${publicFailureCount}/${maxPublicFailures}): ${publicResult.error || publicResult.status || "unknown"}`);
  }

  if (localFailureCount >= maxLocalFailures) {
    localFailureCount = 0;
    restartGateway(`local gateway health failed ${maxLocalFailures} time(s)`);
    return;
  }

  if (restartOnPublicFailure && publicUrl && publicFailureCount >= maxPublicFailures) {
    publicFailureCount = 0;
    restartGateway(`public gateway health failed ${maxPublicFailures} time(s)`);
  } else if (!restartOnPublicFailure && publicUrl && publicFailureCount >= maxPublicFailures) {
    publicFailureCount = maxPublicFailures;
    log("public gateway health is failing; leaving the local gateway running because public tunnel restarts are disabled by default");
  }
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
setInterval(() => {
  checkGatewayHealth().catch((error) => {
    log(`health check crashed: ${error instanceof Error ? error.message : String(error)}`);
  });
}, healthIntervalMs).unref();
setTimeout(() => {
  checkGatewayHealth().catch((error) => {
    log(`initial health check crashed: ${error instanceof Error ? error.message : String(error)}`);
  });
}, 5_000).unref();
