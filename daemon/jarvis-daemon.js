#!/usr/bin/env node
// GamePlan Jarvis Desktop Daemon
//
// Sandboxed Node.js process that pairs with the GamePlan server over a
// WebSocket and exposes a small set of capabilities (shell, notify,
// file_read, file_write, file_list) to the autonomous agent.
//
// Usage:
//   JARVIS_SERVER=https://gameplanjarvisai.up.railway.app \
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
const { exec, spawn } = require("child_process");

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

// Default shell timeout: 30 seconds (matches daemon_shell tool default), configurable per-op.
const SHELL_DEFAULT_TIMEOUT_MS = 30000;

// Special device files that are always safe to reference in shell commands.
const SAFE_DEVICE_FILES = new Set(['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr', '/dev/zero']);

// Command binary prefixes — when the first token of a shell segment is an absolute
// path, it is the executable itself (not a file arg), and may live in system bin dirs.
// File arguments (non-first tokens) must resolve inside ROOT.
const CMD_BIN_PREFIXES = [
  '/usr/', '/bin/', '/sbin/', '/opt/homebrew/', '/usr/local/',
  '/nix/', '/home/linuxbrew/', '/home/runner/.nix-profile/',
  '/Applications/', '/System/', '/Library/',
];

/** True if an absolute path resolves within JARVIS_DAEMON_ROOT (or is a device file). */
function isInsideRoot(p) {
  const norm = path.normalize(p); // collapses '..' segments, e.g. /usr/../etc → /etc
  if (SAFE_DEVICE_FILES.has(norm)) return true;
  return norm === ROOT || norm.startsWith(ROOT + path.sep);
}

/** True if an absolute path is a known system command binary location. */
function isSystemBin(p) {
  const norm = path.normalize(p);
  return CMD_BIN_PREFIXES.some((prefix) => norm.startsWith(prefix));
}

/**
 * Returns true if the shell command appears to access paths outside JARVIS_DAEMON_ROOT.
 *
 * Enforcement strategy (authoritative security boundary):
 *  1. Reject known-dangerous patterns (cd .., rm -rf /, sudo rm, etc.)
 *  2. Split on shell operators into pipe/chain segments; for each segment:
 *     - The first non-flag token may be a command binary (absolute system-bin path or bare name)
 *     - All other absolute-path tokens must resolve INSIDE ROOT (via path.normalize)
 *     - Relative tokens containing '..' are resolved via path.resolve(ROOT, token)
 *  3. Redirection targets (anything after >) to absolute non-ROOT paths are blocked.
 *
 * Bypassed entirely when the user grants allow_outside_root permission.
 */
function commandEscapesRoot(cmd) {
  // ── Always-block patterns (before expansion) ──────────────────────────────
  if (/\bcd\s+\.\./.test(cmd)) return true;       // cd .. traversal
  if (/\bsudo\s+rm/.test(cmd)) return true;        // sudo rm anything
  if (/\brm\s+-rf\s+\//.test(cmd)) return true;   // rm -rf /

  // ── Tilde / $HOME expansion ───────────────────────────────────────────────
  // Expand ~ and $HOME so their resolved paths can be checked against ROOT.
  // If HOME is unavailable, conservatively block any ~ or $HOME reference.
  const HOME = process.env.HOME || process.env.USERPROFILE || '';
  if (!HOME && /~|\$\{?HOME\}?/.test(cmd)) return true;
  const expanded = HOME
    ? cmd
        .replace(/\$\{HOME\}/g, HOME)            // ${HOME}  →  /home/user
        .replace(/\$HOME(?=[/\s;|&>'")\x60]|$)/g, HOME) // $HOME/... → /home/user/...
        .replace(/~/g, HOME)                     // ~/...     → /home/user/...
    : cmd;

  // ── cd to absolute path (checked on expanded command) ────────────────────
  if (/\bcd\s+\//.test(expanded)) return true;

  // ── Redirection targets ───────────────────────────────────────────────────
  const redirectMatch = expanded.match(/>\s*(\/[^\s;|&]*)/g) || [];
  for (const redir of redirectMatch) {
    const target = redir.replace(/^>\s*/, '');
    if (!isInsideRoot(target)) return true;
  }

  // ── Token-level path enforcement (on expanded command) ────────────────────
  // Split on pipe, semicolon, &&, || to process each segment independently.
  const segments = expanded.split(/[|;]|&&|\|\|/);
  for (const segment of segments) {
    // Tokenise on whitespace and common shell metacharacters.
    const tokens = segment.trim().split(/[\s<>()$\x60]+/).map((t) => t.replace(/^['"\x60]|['"\x60]$/g, ''));
    // isCmd tracks whether the next meaningful token is the command binary.
    let isCmd = true;
    for (const token of tokens) {
      if (!token) continue;
      if (/^-/.test(token)) continue; // option flags are not paths

      if (token.startsWith('/')) {
        const norm = path.normalize(token); // collapses /usr/../etc → /etc
        if (!SAFE_DEVICE_FILES.has(norm)) {
          if (isCmd && isSystemBin(norm)) {
            // First token is a system command binary — allowed.
          } else if (!isInsideRoot(norm)) {
            return true; // absolute path escapes ROOT
          }
        }
      } else if (token.includes('..')) {
        // Relative traversal: resolve against ROOT and verify containment.
        const resolved = path.resolve(ROOT, token);
        if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return true;
      }

      isCmd = false;
    }
  }

  return false;
}

function runShell(cmd, cwd, timeoutMs) {
  const workCwd = cwd ? safePath(cwd) : ROOT;
  return new Promise((resolve) => {
    exec(cmd, { cwd: workCwd, timeout: timeoutMs || SHELL_DEFAULT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
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
      // Daemon-side outside-root enforcement: if allowOutsideRoot is not granted,
      // reject commands that appear to escape JARVIS_DAEMON_ROOT.
      // This is the authoritative security boundary (server also does preflight checks).
      if (!op.allowOutsideRoot && commandEscapesRoot(String(op.cmd))) {
        return {
          ok: false,
          error: "Command blocked by daemon: navigates outside workspace root (" + ROOT + "). " +
            "Enable 'allow_outside_root' in daemon permissions to allow unrestricted shell access.",
        };
      }
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
    if (op.type === "desktop_screenshot" || op.type === "desktop_read_screen") {
      const tmpFile = path.join(os.tmpdir(), `jarvis-shot-${Date.now()}.png`);
      const platform = process.platform;

      // Build the platform-specific screenshot command
      let shotCmd;
      if (platform === "darwin") {
        shotCmd = `screencapture -x -t png "${tmpFile}"`;
      } else if (platform === "linux") {
        // Try scrot first; fall back to ImageMagick import
        shotCmd = `scrot "${tmpFile}" 2>/dev/null || import -window root "${tmpFile}"`;
      } else if (platform === "win32") {
        const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${tmpFile}') }`;
        shotCmd = `powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`;
      } else {
        return { ok: false, error: `desktop_screenshot not supported on platform ${platform}` };
      }

      // Capture
      const shotResult = await new Promise((resolve) => {
        exec(shotCmd, { timeout: 15000 }, (err) => {
          if (err) resolve({ ok: false, error: String(err.message || err) });
          else resolve({ ok: true });
        });
      });

      if (!shotResult.ok) {
        return { ok: false, error: `Screenshot command failed: ${shotResult.error}` };
      }

      if (!fs.existsSync(tmpFile)) {
        return { ok: false, error: "Screenshot file was not created. Ensure a display server is running." };
      }

      const imgBuf = fs.readFileSync(tmpFile);
      const imgBase64 = imgBuf.toString("base64");

      // Clean up temp file (best effort)
      try { fs.unlinkSync(tmpFile); } catch (_) { /* noop */ }

      if (op.type === "desktop_screenshot") {
        return { ok: true, image: imgBase64, mimeType: "image/png" };
      }

      // desktop_read_screen — run OCR via tesseract if available
      const ocrTmpPng = path.join(os.tmpdir(), `jarvis-ocr-${Date.now()}-in.png`);
      fs.writeFileSync(ocrTmpPng, imgBuf);

      const ocrResult = await new Promise((resolve) => {
        exec(`tesseract "${ocrTmpPng}" stdout 2>/dev/null`, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
          try { fs.unlinkSync(ocrTmpPng); } catch (_) { /* noop */ }
          if (err || !stdout || !stdout.trim()) {
            resolve({ ok: false, text: null });
          } else {
            resolve({ ok: true, text: stdout.trim() });
          }
        });
      });

      if (ocrResult.ok && ocrResult.text) {
        return { ok: true, text: ocrResult.text, ocrAvailable: true };
      }

      // Tesseract not available or produced no text — return screenshot as fallback
      return { ok: true, text: null, ocrAvailable: false, image: imgBase64, mimeType: "image/png", note: "Tesseract not available; returning raw screenshot for visual inspection." };
    }
    if (op.type === "browser_mcp") {
      return await runLocalMcpTool(op.tool, op.args || {});
    }
    return { ok: false, error: `unknown op type ${op.type}` };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ── Local Playwright MCP bridge ───────────────────────────────────────────────
// Spawns a local @playwright/mcp server against the user's default browser
// profile so the agent can automate the user's real logged-in browser sessions.

let localMcpProc = null;
let localMcpReady = false;
let localMcpBuf = "";
let localMcpPending = new Map();
let localMcpCounter = 0;
let localMcpInitPromise = null;

function findMcpCli() {
  const candidates = [
    path.join(os.homedir(), ".npm", "lib", "node_modules", "@playwright", "mcp", "cli.js"),
    path.join(__dirname, "node_modules", "@playwright", "mcp", "cli.js"),
    "/usr/local/lib/node_modules/@playwright/mcp/cli.js",
    "/usr/lib/node_modules/@playwright/mcp/cli.js",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Try to find the user's real Chrome/Chromium User Data directory so that
 * the local MCP server can reuse existing logged-in sessions.
 * Falls back to ~/.jarvis/daemon-browser-profile if none is found.
 */
function findRealChromiumProfile() {
  const home = os.homedir();
  const platform = process.platform;
  const candidates = [];
  if (platform === "darwin") {
    candidates.push(
      path.join(home, "Library", "Application Support", "Google", "Chrome"),
      path.join(home, "Library", "Application Support", "Chromium"),
      path.join(home, "Library", "Application Support", "Google", "Chrome Beta"),
    );
  } else if (platform === "linux") {
    candidates.push(
      path.join(home, ".config", "google-chrome"),
      path.join(home, ".config", "chromium"),
      path.join(home, ".config", "google-chrome-beta"),
    );
  } else if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    candidates.push(
      path.join(localAppData, "Google", "Chrome", "User Data"),
      path.join(localAppData, "Chromium", "User Data"),
    );
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, "Local State")) || fs.existsSync(path.join(c, "Default"))) {
        return c;
      }
    } catch { /* ignore */ }
  }
  return path.join(home, ".jarvis", "daemon-browser-profile");
}

function ensureLocalMcp() {
  if (localMcpInitPromise) return localMcpInitPromise;
  localMcpInitPromise = new Promise((resolve, reject) => {
    const cli = findMcpCli();
    const userDataDir = findRealChromiumProfile();
    const args = [
      "--no-sandbox",
      "--user-data-dir", userDataDir,
      "--allow-unrestricted-file-access",
    ];

    let proc;
    if (cli) {
      proc = spawn("node", [cli, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    } else {
      proc = spawn("npx", ["@playwright/mcp@latest", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    }

    localMcpProc = proc;

    proc.stdout.on("data", (d) => {
      localMcpBuf += d.toString();
      const lines = localMcpBuf.split("\n");
      localMcpBuf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null) {
            const cb = localMcpPending.get(msg.id);
            if (cb) { localMcpPending.delete(msg.id); cb(msg); }
          }
        } catch (_) { /* not JSON */ }
      }
    });

    proc.stderr.on("data", () => { /* suppress */ });

    proc.on("exit", () => {
      localMcpProc = null;
      localMcpReady = false;
      localMcpInitPromise = null;
      localMcpBuf = "";
    });

    proc.on("error", (err) => {
      reject(err);
      localMcpInitPromise = null;
    });

    function mcpSend(msg) {
      try { proc.stdin.write(JSON.stringify(msg) + "\n"); } catch (_) { /* noop */ }
    }

    function mcpRequest(method, params) {
      return new Promise((res) => {
        const id = ++localMcpCounter;
        const timer = setTimeout(() => {
          localMcpPending.delete(id);
          res({ id, jsonrpc: "2.0", error: { message: `Timeout: ${method}` } });
        }, 30000);
        localMcpPending.set(id, (r) => { clearTimeout(timer); res(r); });
        mcpSend({ jsonrpc: "2.0", id, method, params });
      });
    }

    mcpRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "jarvis-daemon", version: "1.0.0" },
    }).then((r) => {
      if (r.error) { reject(new Error(r.error.message)); return; }
      mcpSend({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      localMcpReady = true;
      console.log("[daemon] local Playwright MCP server ready");
      resolve({ req: mcpRequest });
    }).catch(reject);
  });
  return localMcpInitPromise;
}

async function runLocalMcpTool(toolName, toolArgs) {
  let handle;
  try {
    handle = await ensureLocalMcp();
  } catch (err) {
    return { ok: false, error: `Failed to start local Playwright MCP: ${String(err.message || err)}. Install @playwright/mcp: npm install -g @playwright/mcp` };
  }
  const res = await handle.req("tools/call", { name: toolName, arguments: toolArgs });
  if (res.error) return { ok: false, error: res.error.message };
  const result = res.result || { content: [], isError: false };
  return { ok: !result.isError, data: result };
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
