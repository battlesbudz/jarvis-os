import express from "express";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isWindows = process.platform === "win32";
const execTimeoutMs = Number(process.env.JARVIS_CODEX_EXEC_TIMEOUT_MS ?? 300_000);

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
      // WindowsApps may be unreadable from background task contexts.
    }
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return configured || "codex";
}

function requireGatewayToken(req, res, next) {
  const expectedToken = process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim();
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!expectedToken || token !== expectedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function runCodexOAuthPrompt(command, prompt, cwd = process.cwd()) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-codex-oauth-"));
  const outputPath = join(dir, "answer.txt");

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        command,
        ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", outputPath, "-"],
        {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          shell: isWindows && /\.(cmd|bat)$/i.test(command),
          windowsHide: true,
        },
      );

      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error("Codex OAuth provider timed out.")));
      }, execTimeoutMs);

      function finish(fn) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      }

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (code) => {
        finish(() => {
          if (code === 0) resolve();
          else reject(new Error(stderr || `Codex OAuth provider exited with ${code}.`));
        });
      });
      child.stdin.end(prompt);
    });

    return (await readFile(outputPath, "utf8")).trim();
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local", { override: true });

process.env.JARVIS_CODEX_COMMAND ||= findInstalledCodexCommand();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, role: "jarvis-codex-oauth-gateway", time: new Date().toISOString() });
});

app.get("/api/codex/gateway-health", requireGatewayToken, (_req, res) => {
  res.json({
    ok: true,
    role: "jarvis-codex-oauth-gateway",
    provider: "chatgpt-codex-oauth",
    commandConfigured: Boolean(process.env.JARVIS_CODEX_COMMAND),
    port: process.env.PORT || "5000",
  });
});

app.post("/api/codex/provider-turn", requireGatewayToken, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt ?? "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    const content = await runCodexOAuthPrompt(process.env.JARVIS_CODEX_COMMAND, prompt);
    return res.json({ content });
  } catch (error) {
    console.error("[CodexGateway] provider turn failed:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/codex/delegate", requireGatewayToken, async (req, res) => {
  try {
    const task = String(req.body?.task ?? "").trim();
    if (!task) return res.status(400).json({ error: "task is required" });
    const cwd = typeof req.body?.cwd === "string" && req.body.cwd.trim() ? req.body.cwd.trim() : process.cwd();
    const output = await runCodexOAuthPrompt(process.env.JARVIS_CODEX_COMMAND, task, cwd);
    return res.json({ ok: true, output, cwd });
  } catch (error) {
    console.error("[CodexGateway] delegation failed:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const port = parseInt(process.env.PORT || "5000", 10);
const host = process.env.HOST || "127.0.0.1";
app.listen({ host, port }, () => {
  console.log(`Jarvis Codex OAuth gateway serving on ${host}:${port}`);
});
