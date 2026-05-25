import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const probeTimeoutMs = Math.max(1_000, Number(process.env.JARVIS_OAUTH_GATEWAY_HEALTH_TIMEOUT_MS || 30_000));

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

async function probe(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, sample: text.slice(0, 180) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function scheduledTaskStatus() {
  if (process.platform !== "win32") return { checked: false, note: "Scheduled Task check is Windows-only." };
  try {
    const result = await execFileAsync("schtasks.exe", ["/Query", "/TN", "Jarvis Codex OAuth Gateway", "/FO", "LIST"], {
      timeout: 10_000,
      windowsHide: true,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const status = output.match(/Status:\s*(.+)/i)?.[1]?.trim() || "unknown";
    const taskToRun = output.match(/Task To Run:\s*(.+)/i)?.[1]?.trim() || "";
    return { checked: true, installed: true, status, taskToRun };
  } catch (error) {
    return {
      checked: true,
      installed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

loadEnvFile(join(repoRoot, ".env"));
loadEnvFile(join(repoRoot, ".env.local"), { override: true });

const logDir = resolve(process.env.JARVIS_OAUTH_GATEWAY_LOG_DIR || join(repoRoot, ".jarvis", "logs"));
const statusPath = join(logDir, "jarvis-oauth-gateway-status.json");
const local = await probe(localHealthUrl());
const token = process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim();
const publicUrl = publicHealthUrl();
const publicProbe = publicUrl
  ? await probe(publicUrl, token ? { Authorization: `Bearer ${token}` } : {})
  : null;
const task = await scheduledTaskStatus();
const lastSupervisorStatus = existsSync(statusPath)
  ? JSON.parse(readFileSync(statusPath, "utf8"))
  : null;

const summary = {
  checkedAt: new Date().toISOString(),
  local,
  public: publicUrl ? { url: publicUrl, ...publicProbe } : null,
  scheduledTask: task,
  lastSupervisorStatus,
  recommendations: [],
};

if (!task.installed) {
  summary.recommendations.push("Install the keepalive task: npm.cmd run jarvis:oauth:gateway:install-startup");
}
if (!local.ok) {
  if (task.status === "Running") {
    summary.recommendations.push("The keepalive task is running but the local gateway is not answering yet. Check .jarvis/logs/jarvis-oauth-gateway.log and restart the task if it stays unhealthy after the startup grace window.");
  } else {
    summary.recommendations.push("Start or restart the local supervisor: npm.cmd run jarvis:oauth:gateway:supervisor");
  }
}
if (local.ok && publicProbe && !publicProbe.ok) {
  summary.recommendations.push("The local gateway is alive but the public URL is not. Restart/re-enable the tunnel and update Railway JARVIS_CODEX_GATEWAY_URL if the URL changed.");
}
if (local.ok && (!publicProbe || publicProbe.ok)) {
  summary.recommendations.push("Gateway checks are healthy. If chat still fails, verify Railway has the same gateway URL and token.");
}

console.log(JSON.stringify(summary, null, 2));
