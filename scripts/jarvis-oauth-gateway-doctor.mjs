import { Resolver } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tls from "node:tls";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const probeTimeoutMs = Math.max(1_000, Number(process.env.JARVIS_OAUTH_GATEWAY_HEALTH_TIMEOUT_MS || 30_000));

export function loadEnvFile(path, { override = false } = {}) {
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

export function localHealthUrl() {
  const host = process.env.HOST || "127.0.0.1";
  const port = process.env.PORT || "5000";
  return `http://${host}:${port}/api/ping`;
}

export function publicHealthUrl() {
  const raw = (
    process.env.JARVIS_OAUTH_GATEWAY_PUBLIC_URL ||
    process.env.JARVIS_CODEX_GATEWAY_PUBLIC_URL ||
    process.env.JARVIS_CODEX_GATEWAY_URL ||
    ""
  ).trim();
  if (!raw) return null;
  return `${raw.replace(/\/+$/, "")}/api/codex/gateway-health`;
}

export async function probe(url, headers = {}) {
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

export async function scheduledTaskStatus() {
  if (process.platform !== "win32") return { checked: false, note: "Scheduled Task check is Windows-only." };
  try {
    const ps = [
      "$task = Get-ScheduledTask -TaskName 'Jarvis Codex OAuth Gateway' -ErrorAction Stop",
      "$info = Get-ScheduledTaskInfo -TaskName 'Jarvis Codex OAuth Gateway' -ErrorAction Stop",
      "$action = @($task.Actions)[0]",
      "[pscustomobject]@{",
      "  installed = $true",
      "  status = [string]$task.State",
      "  execute = [string]$action.Execute",
      "  arguments = [string]$action.Arguments",
      "  workingDirectory = [string]$action.WorkingDirectory",
      "  lastRunTime = [string]$info.LastRunTime",
      "  lastTaskResult = [int]$info.LastTaskResult",
      "} | ConvertTo-Json -Compress",
    ].join("\n");
    const psResult = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps], {
      timeout: 10_000,
      windowsHide: true,
    });
    const parsed = JSON.parse(psResult.stdout.trim());
    return { checked: true, ...parsed };
  } catch {
    // Fall back to schtasks for older Windows shells or constrained contexts.
  }

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

export async function tailscaleStatus() {
  if (process.platform !== "win32") return { checked: false, note: "Tailscale CLI check is Windows-only here." };
  const command = process.env.TAILSCALE_EXE || "C:\\Program Files\\Tailscale\\tailscale.exe";
  try {
    const [status, serve, funnel] = await Promise.all([
      execFileAsync(command, ["status"], { timeout: 15_000, windowsHide: true }).catch((error) => error),
      execFileAsync(command, ["serve", "status"], { timeout: 15_000, windowsHide: true }).catch((error) => error),
      execFileAsync(command, ["funnel", "status"], { timeout: 15_000, windowsHide: true }).catch((error) => error),
    ]);
    const read = (result) => {
      if (result instanceof Error) {
        return {
          ok: false,
          output: `${result.stdout || ""}${result.stderr || ""}${result.message || ""}`.trim(),
        };
      }
      return { ok: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    };
    const statusResult = read(status);
    return {
      checked: true,
      command,
      status: statusResult,
      serve: read(serve),
      funnel: read(funnel),
      loggedOut: /logged out|NoState|unexpected state:\s*NoState/i.test(statusResult.output),
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isLocalHostname(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function isPrivateOrTailscaleAddress(address) {
  if (!address) return false;
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function shouldProbePublicIngress(rawUrl) {
  if (process.env.JARVIS_OAUTH_GATEWAY_STRICT_PUBLIC_CHECK === "false") return false;
  if (!rawUrl) return false;
  const url = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
  return url.protocol === "https:" && !isLocalHostname(url.hostname);
}

function configuredPublicResolvers() {
  const raw = process.env.JARVIS_OAUTH_GATEWAY_PUBLIC_DNS_SERVERS || "8.8.8.8,1.1.1.1";
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export async function resolvePublicAddresses(hostname, servers = configuredPublicResolvers()) {
  const resolver = new Resolver();
  resolver.setServers(servers);
  const results = [];
  const errors = [];
  await Promise.all([
    resolver.resolve4(hostname)
      .then((addresses) => {
        for (const address of addresses) results.push({ family: 4, address });
      })
      .catch((error) => errors.push({ family: 4, error: error instanceof Error ? error.message : String(error) })),
    resolver.resolve6(hostname)
      .then((addresses) => {
        for (const address of addresses) results.push({ family: 6, address });
      })
      .catch((error) => errors.push({ family: 6, error: error instanceof Error ? error.message : String(error) })),
  ]);
  return { servers, addresses: results, errors };
}

export function buildPublicIngressTargets(rawUrl, dnsResult) {
  const url = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
  const port = Number(url.port || 443);
  const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  return (dnsResult?.addresses || []).map((entry) => ({
    ...entry,
    port,
    servername: url.hostname,
    hostHeader,
    path: `${url.pathname || "/"}${url.search || ""}`,
    publicAddress: !isPrivateOrTailscaleAddress(entry.address),
  }));
}

async function probeHttpsIp(target, headers = {}) {
  return new Promise((resolveProbe) => {
    let settled = false;
    let raw = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(result);
    };
    const socket = tls.connect({
      host: target.address,
      port: target.port,
      servername: target.servername,
      rejectUnauthorized: true,
    });
    const timer = setTimeout(() => {
      socket.destroy();
      finish({ ok: false, address: target.address, family: target.family, error: `Timed out after ${probeTimeoutMs}ms` });
    }, probeTimeoutMs);

    socket.setEncoding("utf8");
    socket.on("secureConnect", () => {
      const requestHeaders = [
        `GET ${target.path} HTTP/1.1`,
        `Host: ${target.hostHeader}`,
        "User-Agent: jarvis-oauth-gateway-doctor",
        "Accept: application/json",
        "Connection: close",
      ];
      for (const [key, value] of Object.entries(headers)) {
        if (value != null && value !== "") requestHeaders.push(`${key}: ${value}`);
      }
      socket.write(`${requestHeaders.join("\r\n")}\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 4096) raw = raw.slice(0, 4096);
    });
    socket.on("error", (error) => {
      finish({ ok: false, address: target.address, family: target.family, error: error.message });
    });
    socket.on("end", () => {
      const status = Number(raw.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1]);
      finish({
        ok: status >= 200 && status < 300,
        address: target.address,
        family: target.family,
        status: Number.isFinite(status) ? status : null,
        sample: raw.slice(0, 180),
      });
    });
    socket.on("close", () => {
      if (!settled && raw) {
        const status = Number(raw.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1]);
        finish({
          ok: status >= 200 && status < 300,
          address: target.address,
          family: target.family,
          status: Number.isFinite(status) ? status : null,
          sample: raw.slice(0, 180),
        });
      } else if (!settled) {
        finish({ ok: false, address: target.address, family: target.family, error: "Connection closed before response." });
      }
    });
  });
}

export async function probePublicIngress(rawUrl, headers = {}) {
  if (!shouldProbePublicIngress(rawUrl)) return { checked: false, note: "Strict public ingress check skipped for this URL." };
  const url = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
  const dns = await resolvePublicAddresses(url.hostname);
  const targets = buildPublicIngressTargets(url, dns);
  const publicTargets = targets.filter((target) => target.publicAddress);
  if (publicTargets.length === 0) {
    return {
      checked: true,
      ok: false,
      dns,
      targets,
      error: "No public ingress addresses resolved. Public DNS may still be returning private Tailscale/MagicDNS records or NXDOMAIN.",
    };
  }
  const attempts = [];
  for (const target of publicTargets) {
    const result = await probeHttpsIp(target, headers);
    attempts.push(result);
    if (result.ok) {
      return { checked: true, ok: true, dns, targets, attempts };
    }
  }
  return { checked: true, ok: false, dns, targets, attempts };
}

export async function buildSummary() {
  loadEnvFile(join(repoRoot, ".env"));
  loadEnvFile(join(repoRoot, ".env.local"), { override: true });

  const logDir = resolve(process.env.JARVIS_OAUTH_GATEWAY_LOG_DIR || join(repoRoot, ".jarvis", "logs"));
  const statusPath = join(logDir, "jarvis-oauth-gateway-status.json");
  const local = await probe(localHealthUrl());
  const token = process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim();
  const publicUrl = publicHealthUrl();
  const publicHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const publicProbe = publicUrl ? await probe(publicUrl, publicHeaders) : null;
  const publicIngress = publicUrl ? await probePublicIngress(publicUrl, publicHeaders) : null;
  const task = await scheduledTaskStatus();
  const tailscale = await tailscaleStatus();
  const lastSupervisorStatus = existsSync(statusPath)
    ? JSON.parse(readFileSync(statusPath, "utf8"))
    : null;

  const summary = {
    checkedAt: new Date().toISOString(),
    local,
    public: publicUrl ? { url: publicUrl, ...publicProbe } : null,
    publicIngress: publicUrl ? { url: publicUrl, ...publicIngress } : null,
    scheduledTask: task,
    tailscale,
    lastSupervisorStatus,
    recommendations: [],
  };

  if (!task.installed) {
    summary.recommendations.push("Install the keepalive task: npm.cmd run jarvis:oauth:gateway:install-startup");
  }
  if (task.installed && task.workingDirectory && resolve(task.workingDirectory) !== repoRoot) {
    summary.recommendations.push(`The keepalive task points at a different checkout (${task.workingDirectory}). Reinstall it from this repo: npm.cmd run jarvis:oauth:gateway:install-startup`);
  }
  if (tailscale.loggedOut) {
    summary.recommendations.push("Tailscale is running but logged out or in NoState. Open Tailscale and sign in, or run `tailscale up --unattended` from an elevated/user session, then rerun the gateway doctor.");
  }
  if (lastSupervisorStatus?.checkedAt) {
    const statusAgeMs = Date.now() - Date.parse(lastSupervisorStatus.checkedAt);
    if (Number.isFinite(statusAgeMs) && statusAgeMs > 2 * 60 * 1000) {
      summary.recommendations.push("The supervisor heartbeat/status file is stale. Restart the keepalive task so the watchdog and supervisor are attached to the current gateway process.");
    }
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
  if (local.ok && publicIngress?.checked && !publicIngress.ok) {
    summary.recommendations.push("The local/private gateway path answers, but the strict public ingress path failed. Reconnect Tailscale, then re-publish Funnel with `tailscale serve --bg 5000` and `tailscale funnel --bg 5000`.");
  }
  if (local.ok && (!publicProbe || publicProbe.ok) && (!publicIngress?.checked || publicIngress.ok)) {
    summary.recommendations.push("Gateway checks are healthy. If chat still fails, verify Railway has the same gateway URL and token.");
  }

  return summary;
}

export async function main() {
  const summary = await buildSummary();
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
