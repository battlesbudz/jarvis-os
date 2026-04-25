import type { AgentTool } from "../types";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { userPreferences } from "@shared/schema";
import { sendMessage } from "../../integrations/telegram";

export interface OpenClawBridgeConfig {
  mode: "telegram" | "gateway";
  telegramChatId?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  enabled: boolean;
}

// ── Pending delegation store ─────────────────────────────────────────────────
// Keyed by userId. The Telegram message handler resolves these when a reply
// arrives from the configured OpenClaw chat ID.
export interface PendingDelegation {
  chatId: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const pendingOpenClawDelegations = new Map<string, PendingDelegation>();

// ── SSRF protection ──────────────────────────────────────────────────────────
// Block private/loopback/link-local addresses to prevent server-side request
// forgery from user-supplied gateway URLs.
const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^0\.0\.0\.0$/,
  /^localhost$/i,
];

function isPrivateHost(host: string): boolean {
  // Strip port
  const bareHost = host.replace(/:\d+$/, "");
  return PRIVATE_RANGES.some((re) => re.test(bareHost));
}

function validateGatewayUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Gateway URL is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Gateway URL must use http or https." };
  }
  if (isPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      error:
        "Gateway URL points to a private/loopback address. Use a public tunnel URL (ngrok, Cloudflare, Tailscale funnel).",
    };
  }
  return { ok: true, url: parsed };
}

// ── Config helper ────────────────────────────────────────────────────────────
export async function getOpenClawConfig(userId: string): Promise<OpenClawBridgeConfig | null> {
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const prefs = (rows[0]?.data as Record<string, any>) ?? {};
    const cfg = prefs.openclawBridge as OpenClawBridgeConfig | undefined;
    if (!cfg || !cfg.enabled) return null;
    return cfg;
  } catch {
    return null;
  }
}

// ── openclaw_delegate tool ───────────────────────────────────────────────────
export const openclawDelegateTool: AgentTool = {
  name: "openclaw_delegate",
  description:
    "Delegate a task to OpenClaw — a locally-running AI agent on the user's machine with full computer-use capabilities: shell execution, browser control, code running, vibe coding (building apps), file operations, and multi-model reasoning. Use this when the user asks to: run or write code, execute shell commands, control the browser, build a new app, create a Replit project, or do anything that requires local compute. Returns OpenClaw's result once the task is complete.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "The full task description for OpenClaw. Be specific and include all context — OpenClaw will act on exactly this message.",
      },
      timeout_minutes: {
        type: "number",
        description:
          "Max minutes to wait for a result (default 10, max 15). For long build tasks use 15.",
      },
    },
    required: ["task"],
  },
  async execute(args, ctx) {
    const task = String(args.task || "").trim();
    if (!task) return JSON.stringify({ error: "task is required" });

    const userId = ctx.userId;
    const cfg = await getOpenClawConfig(userId);

    if (!cfg) {
      return JSON.stringify({
        error:
          "OpenClaw bridge is not configured. Go to Settings → OpenClaw Brain to set up the connection.",
        hint: "Connect via Telegram (enter your OpenClaw Telegram chat ID) or via Gateway URL if you have a tunnel (ngrok/Cloudflare/Tailscale).",
      });
    }

    const timeoutMs = Math.min((Number(args.timeout_minutes) || 10), 15) * 60 * 1000;

    // ── Telegram mode ─────────────────────────────────────────────────────────
    if (cfg.mode === "telegram") {
      const chatId = cfg.telegramChatId?.trim();
      if (!chatId) {
        return JSON.stringify({
          error: "Telegram chat ID is not set. Configure it in Settings → OpenClaw Brain.",
        });
      }

      const prefix = "[JARVIS → OPENCLAW]\n";
      let sentMessageId: number | undefined;

      // Send the task message
      try {
        const res = await sendMessageWithId(chatId, prefix + task);
        sentMessageId = res?.message_id;
      } catch (err) {
        return JSON.stringify({
          error: `Failed to send task to OpenClaw via Telegram: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Register a pending delegation and wait for the reply
      const result = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingOpenClawDelegations.delete(userId);
          reject(new Error("OpenClaw did not reply within the timeout window."));
        }, timeoutMs);

        pendingOpenClawDelegations.set(userId, {
          chatId,
          resolve: (text: string) => {
            clearTimeout(timer);
            resolve(text);
          },
          reject: (err: Error) => {
            clearTimeout(timer);
            reject(err);
          },
          timer,
        });
      }).catch((err) => {
        // Timeout or explicit rejection — return graceful message
        return `[timeout] OpenClaw did not reply within ${Math.round(timeoutMs / 60000)} minutes. The task was sent (message sent to chat ${chatId}${sentMessageId ? ` as message #${sentMessageId}` : ""}). Check your Telegram chat for any partial output from OpenClaw, or try again with a shorter task.`;
      });

      return JSON.stringify({ status: "complete", mode: "telegram", result });
    }

    // ── Gateway mode ──────────────────────────────────────────────────────────
    if (cfg.mode === "gateway") {
      const rawUrl = cfg.gatewayUrl?.trim();
      if (!rawUrl) {
        return JSON.stringify({
          error: "Gateway URL is not set. Configure it in Settings → OpenClaw Brain.",
        });
      }

      const urlCheck = validateGatewayUrl(rawUrl);
      if (!urlCheck.ok) {
        return JSON.stringify({ error: urlCheck.error });
      }
      const gatewayBase = rawUrl.replace(/\/$/, "");

      const authHeaders: Record<string, string> = cfg.gatewayToken
        ? { Authorization: `Bearer ${cfg.gatewayToken}` }
        : {};

      const messageUrl = `${gatewayBase}/api/v1/message`;
      let response: Response;
      try {
        response = await fetch(messageUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ message: task }),
          signal: AbortSignal.timeout(30_000), // 30s for initial response
        });
      } catch (err) {
        return JSON.stringify({
          error: `Could not reach OpenClaw gateway at ${rawUrl}: ${err instanceof Error ? err.message : String(err)}`,
          hint: "Make sure your tunnel (ngrok/Cloudflare/Tailscale) is active and the gateway URL is correct.",
        });
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return JSON.stringify({
          error: `OpenClaw gateway returned HTTP ${response.status}: ${body.slice(0, 300)}`,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";

      // SSE streaming response
      if (contentType.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        if (!reader) {
          return JSON.stringify({ error: "Gateway returned SSE stream but body is unreadable." });
        }
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const { done, value } = await reader
            .read()
            .catch(() => ({ done: true as const, value: undefined }));
          if (done) break;
          if (value) {
            const text = decoder.decode(value);
            for (const line of text.split("\n")) {
              if (line.startsWith("data:")) {
                const payload = line.slice(5).trim();
                if (payload && payload !== "[DONE]") chunks.push(payload);
              }
            }
          }
        }
        reader.cancel().catch(() => {});
        return JSON.stringify({ status: "complete", mode: "gateway", result: chunks.join("") });
      }

      // JSON response — may be immediate result or async job stub
      const data = await response.json().catch(() => null);

      // If the response is an async job (has job_id / id / task_id), poll for completion
      const jobId =
        (data as any)?.job_id ??
        (data as any)?.task_id ??
        ((data as any)?.status === "queued" || (data as any)?.status === "running"
          ? (data as any)?.id
          : undefined);

      if (jobId) {
        // Poll /api/v1/jobs/{jobId} until done or timeout
        const pollUrl = `${gatewayBase}/api/v1/jobs/${jobId}`;
        const deadline = Date.now() + timeoutMs;
        let lastData = data;

        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10_000)); // wait 10s between polls
          try {
            const pollRes = await fetch(pollUrl, {
              method: "GET",
              headers: { "Content-Type": "application/json", ...authHeaders },
              signal: AbortSignal.timeout(15_000),
            });
            if (!pollRes.ok) break;
            lastData = await pollRes.json();
            const status = (lastData as any)?.status;
            if (status === "complete" || status === "done" || status === "finished" || (lastData as any)?.result) {
              return JSON.stringify({ status: "complete", mode: "gateway", result: (lastData as any)?.result ?? lastData });
            }
            if (status === "error" || status === "failed") {
              return JSON.stringify({ status: "error", mode: "gateway", result: (lastData as any)?.error ?? lastData });
            }
          } catch {
            break;
          }
        }

        return JSON.stringify({
          status: "timeout",
          mode: "gateway",
          jobId,
          result: `OpenClaw job ${jobId} did not complete within ${Math.round(timeoutMs / 60000)} minutes. Last status: ${JSON.stringify(lastData)}`,
        });
      }

      // Immediate result
      return JSON.stringify({ status: "complete", mode: "gateway", result: data ?? "(empty response from OpenClaw)" });
    }

    return JSON.stringify({ error: `Unknown bridge mode: ${(cfg as any).mode}` });
  },
};

// ── openclaw_status tool ─────────────────────────────────────────────────────
export const openclawStatusTool: AgentTool = {
  name: "openclaw_status",
  description:
    "Check whether the OpenClaw compute bridge is configured and reachable. Returns online status, the configured mode (telegram or gateway), and latency for gateway mode. Use this before delegating a task if you are unsure whether the bridge is active.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: (_args, ctx) => checkOpenClawStatus(ctx.userId),
};

// Shared status check logic — used by both the agent tool and the REST endpoint
export async function checkOpenClawStatus(userId: string): Promise<string> {
  let rawPrefs: Record<string, any> = {};
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    rawPrefs = (rows[0]?.data as Record<string, any>) ?? {};
  } catch {}

  const cfg = rawPrefs.openclawBridge as OpenClawBridgeConfig | undefined;

  if (!cfg) {
    return JSON.stringify({
      configured: false,
      online: false,
      message: "OpenClaw bridge is not configured. Go to Settings → OpenClaw Brain to set it up.",
    });
  }

  if (!cfg.enabled) {
    return JSON.stringify({
      configured: true,
      online: false,
      mode: cfg.mode,
      message: "OpenClaw bridge is configured but currently disabled. Enable it in Settings → OpenClaw Brain.",
    });
  }

  if (cfg.mode === "telegram") {
    const hasChatId = !!(cfg.telegramChatId?.trim());
    const hasBotToken = !!process.env.TELEGRAM_BOT_TOKEN;
    const online = hasChatId && hasBotToken;
    return JSON.stringify({
      configured: true,
      online,
      mode: "telegram",
      chatId: cfg.telegramChatId ?? null,
      message: online
        ? "OpenClaw Telegram bridge is active. Tasks will be sent to the configured chat and replies forwarded back to Jarvis."
        : !hasBotToken
        ? "Telegram bot token is not set — configure TELEGRAM_BOT_TOKEN."
        : "Telegram chat ID is not set. Enter it in Settings → OpenClaw Brain.",
    });
  }

  if (cfg.mode === "gateway") {
    const rawUrl = cfg.gatewayUrl?.trim();
    if (!rawUrl) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        message: "Gateway URL is not set. Enter it in Settings → OpenClaw Brain.",
      });
    }

    const urlCheck = validateGatewayUrl(rawUrl);
    if (!urlCheck.ok) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        message: `Gateway URL validation failed: ${urlCheck.error}`,
      });
    }

    const checkUrl = `${rawUrl.replace(/\/$/, "")}/api/v1/check`;
    const t0 = Date.now();
    try {
      const res = await fetch(checkUrl, {
        method: "GET",
        headers: cfg.gatewayToken ? { Authorization: `Bearer ${cfg.gatewayToken}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      if (res.ok) {
        return JSON.stringify({
          configured: true,
          online: true,
          mode: "gateway",
          latencyMs,
          gatewayUrl: rawUrl,
          message: `OpenClaw gateway is online (${latencyMs}ms latency).`,
        });
      }
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        latencyMs,
        gatewayUrl: rawUrl,
        message: `Gateway responded with HTTP ${res.status}. Make sure OpenClaw is running and your tunnel is active.`,
      });
    } catch (err) {
      const latencyMs = Date.now() - t0;
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        latencyMs,
        gatewayUrl: rawUrl,
        message: `Cannot reach gateway at ${rawUrl}: ${err instanceof Error ? err.message : String(err)}. Check that your tunnel is active.`,
      });
    }
  }

  return JSON.stringify({ configured: true, online: false, message: `Unknown mode: ${(cfg as any).mode}` });
}

// ── Helper: sendMessage and capture message_id ────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
async function sendMessageWithId(
  chatId: string,
  text: string
): Promise<{ message_id: number } | null> {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; result?: { message_id: number } };
    return data.ok && data.result ? { message_id: data.result.message_id } : null;
  } catch {
    return null;
  }
}
