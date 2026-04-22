#!/usr/bin/env node
// GamePlan Jarvis Desktop Daemon
//
// Sandboxed Node.js process that pairs with the GamePlan server over a
// WebSocket and exposes a small set of capabilities (shell, notify,
// file_read, file_write, file_list) to the autonomous agent.
//
// Usage:
//   JARVIS_SERVER=https://your-gameplan.replit.app \
//   JARVIS_PAIR_CODE=ABCD1234 \
//   JARVIS_DAEMON_ROOT=$HOME/jarvis-workspace \
//   node jarvis-daemon.js
//
// Or pass --server / --code / --root as CLI flags. JARVIS_DAEMON_ROOT
// defaults to ~/jarvis-workspace and is the only directory the daemon
// will read, write, list, or `cd` into for shell commands.

const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const SERVER = arg("server") || process.env.JARVIS_SERVER;
const CODE = arg("code") || process.env.JARVIS_PAIR_CODE;
const ROOT = path.resolve(arg("root") || process.env.JARVIS_DAEMON_ROOT || path.join(os.homedir(), "jarvis-workspace"));

if (!SERVER || !CODE) {
  console.error("Usage: JARVIS_SERVER=<url> JARVIS_PAIR_CODE=<code> node jarvis-daemon.js");
  process.exit(1);
}

if (!fs.existsSync(ROOT)) {
  fs.mkdirSync(ROOT, { recursive: true });
  console.log(`[daemon] created workspace root: ${ROOT}`);
}

function wsUrl(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/daemon/ws";
  u.search = "";
  return u.toString();
}

function safePath(rel) {
  const resolved = path.resolve(ROOT, rel || ".");
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`path escapes workspace root: ${rel}`);
  }
  return resolved;
}

function notify(title, body) {
  const platform = process.platform;
  const escape = (s) => String(s).replace(/"/g, '\\"');
  let cmd;
  if (platform === "darwin") {
    cmd = `osascript -e 'display notification "${escape(body)}" with title "${escape(title)}"'`;
  } else if (platform === "linux") {
    cmd = `notify-send "${escape(title)}" "${escape(body)}"`;
  } else if (platform === "win32") {
    const ps = `New-BurntToastNotification -Text '${escape(title)}','${escape(body)}'`;
    cmd = `powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`;
  } else {
    return Promise.resolve({ ok: false, error: `notify not supported on ${platform}` });
  }
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (err) => {
      if (err) resolve({ ok: false, error: String(err.message || err) });
      else resolve({ ok: true });
    });
  });
}

function runShell(cmd, cwd, timeoutMs) {
  const workCwd = cwd ? safePath(cwd) : ROOT;
  return new Promise((resolve) => {
    exec(cmd, { cwd: workCwd, timeout: timeoutMs || 15000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || "").toString().slice(0, 16000);
      const errOut = (stderr || "").toString().slice(0, 8000);
      if (err && err.killed) resolve({ ok: false, error: "timeout", stdout: out, stderr: errOut });
      else if (err) resolve({ ok: false, error: String(err.message || err), code: err.code, stdout: out, stderr: errOut });
      else resolve({ ok: true, stdout: out, stderr: errOut });
    });
  });
}

async function handleOp(op) {
  try {
    if (op.type === "notify") {
      return await notify(op.title || "GamePlan", op.body || "");
    }
    if (op.type === "shell") {
      return await runShell(String(op.cmd), op.cwd, op.timeoutMs);
    }
    if (op.type === "file_read") {
      const p = safePath(op.path);
      const stat = fs.statSync(p);
      if (stat.size > 512 * 1024) return { ok: false, error: "file too large (>512KB)" };
      const content = fs.readFileSync(p, "utf8");
      return { ok: true, content: content.slice(0, 256 * 1024) };
    }
    if (op.type === "file_write") {
      const p = safePath(op.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(op.content || ""), "utf8");
      return { ok: true, bytes: Buffer.byteLength(String(op.content || ""), "utf8") };
    }
    if (op.type === "file_list") {
      const p = safePath(op.path);
      const entries = fs.readdirSync(p, { withFileTypes: true })
        .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other" }))
        .slice(0, 500);
      return { ok: true, entries };
    }
    return { ok: false, error: `unknown op type ${op.type}` };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

let backoffMs = 1000;
const MAX_BACKOFF = 60000;

// Credentials stored after first successful pair for reconnect auth.
// daemonId and reconnectSecret are server-generated and persisted for the
// lifetime of this process; on Wi-Fi drop / server restart the daemon
// reconnects with reconnectSecret proof-of-possession instead of code.
let storedDaemonId = null;
let storedReconnectSecret = null;

function connect() {
  const url = wsUrl(SERVER);
  console.log(`[daemon] connecting to ${url} (${storedDaemonId ? "reconnect" : "pair"})`);
  const ws = new WebSocket(url);
  let paired = false;
  let pingTimer = null;

  ws.on("open", () => {
    backoffMs = 1000;
    if (storedDaemonId && storedReconnectSecret) {
      // Reconnect using server-issued credentials — no pair code needed
      ws.send(JSON.stringify({
        type: "reconnect",
        daemonId: storedDaemonId,
        reconnectSecret: storedReconnectSecret,
        hostname: os.hostname(),
        platform: process.platform,
      }));
    } else {
      ws.send(JSON.stringify({
        type: "pair",
        code: CODE,
        hostname: os.hostname(),
        platform: process.platform,
      }));
    }
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "hello") {
      if (!msg.ok) {
        console.error("[daemon] pairing rejected:", msg.error);
        // If reconnect secret was rejected, clear it and exit — user must re-pair
        if (msg.error && (msg.error.includes("invalid reconnect secret") || msg.error.includes("re-pair") || msg.error.includes("legacy"))) {
          storedDaemonId = null;
          storedReconnectSecret = null;
        }
        try { ws.close(); } catch (_) { /* noop */ }
        process.exit(2);
        return;
      }
      paired = true;
      // On first pair, server issues daemonId + reconnectSecret. Store for future reconnects.
      if (msg.daemonId && msg.reconnectSecret) {
        storedDaemonId = msg.daemonId;
        storedReconnectSecret = msg.reconnectSecret;
        console.log(`[daemon] credentials stored (daemonId=${storedDaemonId.slice(0, 8)}…)`);
      }
      console.log(`[daemon] paired as user ${msg.userId}; workspace=${ROOT}`);
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch (_) { /* noop */ }
        }
      }, 30000);
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "op" && paired) {
      const result = await handleOp(msg.op || {});
      try {
        ws.send(JSON.stringify({ type: "result", id: msg.id, ...result }));
      } catch (err) {
        console.error("[daemon] failed to send result:", err);
      }
    }
  });

  ws.on("close", (code, reason) => {
    if (pingTimer) clearInterval(pingTimer);
    console.log(`[daemon] disconnected (code=${code}, reason=${reason || "n/a"}); reconnecting in ${backoffMs}ms`);
    setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
  });

  ws.on("error", (err) => {
    console.error("[daemon] socket error:", err.message || err);
  });
}

connect();
