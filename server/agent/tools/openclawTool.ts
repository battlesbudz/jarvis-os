import type { AgentTool, ToolResult } from "../types";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { userPreferences } from "@shared/schema";
import { sendMessage } from "../../integrations/telegram";
import { promises as dns } from "dns";

export interface OpenClawBridgeConfig {
  mode: "telegram" | "gateway";
  telegramChatId?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  enabled: boolean;
}

// ── Pending delegation store ─────────────────────────────────────────────────
// Keyed by userId. The Telegram message handler resolves these when a reply
// arrives from the configured OpenClaw chat ID that contains the expected nonce.
export interface PendingDelegation {
  chatId: string;
  nonce: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const pendingOpenClawDelegations = new Map<string, PendingDelegation>();

// ── SSRF protection ──────────────────────────────────────────────────────────
// Two-layer check: (1) literal hostname/IP patterns, (2) DNS resolution to
// catch public hostnames that resolve to private/internal IPs.
const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\.0\.0\.0$/,
];
const PRIVATE_HOSTNAMES = /^(localhost|.*\.local|.*\.internal|.*\.corp|.*\.intranet)$/i;

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip));
}

async function validateGatewayUrl(
  raw: string
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Gateway URL is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Gateway URL must use http or https." };
  }
  const host = parsed.hostname;

  // Layer 1: literal hostname/IP check
  if (isPrivateIp(host) || PRIVATE_HOSTNAMES.test(host)) {
    return {
      ok: false,
      error:
        "Gateway URL points to a private/loopback address. Use a public tunnel URL (ngrok, Cloudflare Tunnel, Tailscale funnel).",
    };
  }

  // Layer 2: DNS resolution — resolve and check each returned address
  try {
    const addresses = await dns.resolve(host).catch(async () => {
      // Try resolve4 / resolve6 individually as fallback
      const v4 = await dns.resolve4(host).catch(() => [] as string[]);
      const v6 = await dns.resolve6(host).catch(() => [] as string[]);
      return [...v4, ...v6];
    });
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        return {
          ok: false,
          error: `Gateway hostname "${host}" resolves to a private IP address (${addr}). SSRF protection requires a public gateway address.`,
        };
      }
    }
  } catch {
    // DNS lookup failed — treat as unresolvable; block it
    return { ok: false, error: `Cannot resolve gateway hostname "${host}". Ensure the tunnel is active.` };
  }

  return { ok: true, url: parsed };
}

// ── Nonce generation ─────────────────────────────────────────────────────────
function generateNonce(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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

// ── Helpers ──────────────────────────────────────────────────────────────────
function ok(content: string, label?: string, detail?: string): ToolResult {
  return { ok: true, content, label, detail };
}
function fail(content: string, label?: string): ToolResult {
  return { ok: false, content, label };
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
  async execute(args, ctx): Promise<ToolResult> {
    const task = String(args.task || "").trim();
    if (!task) return fail("task argument is required.");

    const userId = ctx.userId;
    const cfg = await getOpenClawConfig(userId);

    if (!cfg) {
      return fail(
        "OpenClaw bridge is not configured or disabled. Go to Settings → OpenClaw Brain to set up the connection.",
        "openclaw_not_configured"
      );
    }

    const timeoutMs = Math.min((Number(args.timeout_minutes) || 10), 15) * 60 * 1000;

    // ── Telegram mode ──────────────────────────────────────────────────────
    if (cfg.mode === "telegram") {
      const chatId = cfg.telegramChatId?.trim();
      if (!chatId) {
        return fail(
          "Telegram chat ID is not set. Configure it in Settings → OpenClaw Brain.",
          "openclaw_telegram_no_chatid"
        );
      }

      // Generate a nonce so we can correlate the reply exactly to this request.
      // Sent message: "[JARVIS→OC:{nonce}]\n{task}"
      // Expected reply prefix: "[OC:{nonce}]"
      const nonce = generateNonce();
      const sentText = `[JARVIS→OC:${nonce}]\n${task}`;

      try {
        await sendMessageWithId(chatId, sentText);
      } catch (err) {
        return fail(
          `Failed to send task to OpenClaw via Telegram: ${err instanceof Error ? err.message : String(err)}`,
          "openclaw_telegram_send_failed"
        );
      }

      // Register a pending delegation and wait for a correlated reply.
      // The telegramRoutes.ts intercept only resolves this promise when it
      // receives a message from the same chatId that starts with "[OC:{nonce}]".
      const replyText = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingOpenClawDelegations.delete(userId);
          reject(new Error("OpenClaw did not reply within the timeout window."));
        }, timeoutMs);

        pendingOpenClawDelegations.set(userId, {
          chatId,
          nonce,
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
      }).catch((err: Error) => {
        return `[timeout] ${err.message} The task was sent to chat ${chatId}. Check your Telegram chat for any partial output from OpenClaw, or try again.`;
      });

      return ok(
        replyText,
        "openclaw_delegate",
        `Task delegated via Telegram (nonce: ${nonce})`
      );
    }

    // ── Gateway mode ───────────────────────────────────────────────────────
    if (cfg.mode === "gateway") {
      const rawUrl = cfg.gatewayUrl?.trim();
      if (!rawUrl) {
        return fail(
          "Gateway URL is not set. Configure it in Settings → OpenClaw Brain.",
          "openclaw_gateway_no_url"
        );
      }

      const urlCheck = await validateGatewayUrl(rawUrl);
      if (!urlCheck.ok) {
        return fail(`Gateway URL rejected: ${urlCheck.error}`, "openclaw_ssrf_blocked");
      }
      const gatewayBase = rawUrl.replace(/\/$/, "");

      // Send token in both Authorization header AND request body per spec.
      const authHeaders: Record<string, string> = cfg.gatewayToken
        ? { Authorization: `Bearer ${cfg.gatewayToken}` }
        : {};
      const bodyPayload: Record<string, string> = { message: task };
      if (cfg.gatewayToken) bodyPayload.token = cfg.gatewayToken;

      const messageUrl = `${gatewayBase}/api/v1/message`;
      let response: Response;
      try {
        response = await fetch(messageUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        return fail(
          `Could not reach OpenClaw gateway at ${rawUrl}: ${err instanceof Error ? err.message : String(err)}. Make sure your tunnel (ngrok/Cloudflare/Tailscale) is active.`,
          "openclaw_gateway_unreachable"
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return fail(
          `OpenClaw gateway returned HTTP ${response.status}: ${body.slice(0, 300)}`,
          "openclaw_gateway_error"
        );
      }

      const contentType = response.headers.get("content-type") ?? "";

      // SSE streaming response
      if (contentType.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        if (!reader) {
          return fail("Gateway returned SSE stream but body is unreadable.", "openclaw_sse_error");
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
        const result = chunks.join("");
        return ok(result || "(empty SSE stream)", "openclaw_delegate", "gateway/sse");
      }

      // JSON response — may be immediate result or async job stub
      const data = await response.json().catch(() => null);

      // If the response is an async job (has job_id / id / task_id), poll every 15s
      const jobId =
        (data as any)?.job_id ??
        (data as any)?.task_id ??
        ((data as any)?.status === "queued" || (data as any)?.status === "running"
          ? (data as any)?.id
          : undefined);

      if (jobId) {
        const pollUrl = `${gatewayBase}/api/v1/jobs/${jobId}`;
        const deadline = Date.now() + timeoutMs;
        let lastData = data;

        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 15_000));
          try {
            const pollRes = await fetch(pollUrl, {
              method: "GET",
              headers: { "Content-Type": "application/json", ...authHeaders },
              signal: AbortSignal.timeout(15_000),
            });
            if (!pollRes.ok) break;
            lastData = await pollRes.json();
            const status = (lastData as any)?.status;
            if (
              status === "complete" ||
              status === "done" ||
              status === "finished" ||
              (lastData as any)?.result
            ) {
              const result = (lastData as any)?.result ?? JSON.stringify(lastData);
              return ok(
                typeof result === "string" ? result : JSON.stringify(result),
                "openclaw_delegate",
                `gateway/job/${jobId}`
              );
            }
            if (status === "error" || status === "failed") {
              const errBody = (lastData as any)?.error ?? JSON.stringify(lastData);
              return fail(
                typeof errBody === "string" ? errBody : JSON.stringify(errBody),
                "openclaw_job_failed"
              );
            }
          } catch {
            break;
          }
        }

        return fail(
          `OpenClaw job ${jobId} did not complete within ${Math.round(timeoutMs / 60000)} minutes. Last status: ${JSON.stringify(lastData)}`,
          "openclaw_job_timeout"
        );
      }

      // Immediate result
      const result = data ?? "(empty response from OpenClaw)";
      return ok(
        typeof result === "string" ? result : JSON.stringify(result),
        "openclaw_delegate",
        "gateway/immediate"
      );
    }

    return fail(`Unknown bridge mode: ${(cfg as any).mode}`);
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
  async execute(_args, ctx): Promise<ToolResult> {
    const statusJson = await checkOpenClawStatus(ctx.userId);
    const data = JSON.parse(statusJson);
    return {
      ok: !!(data.online),
      content: statusJson,
      label: "openclaw_status",
      detail: data.message,
    };
  },
};

// ── Shared status check — used by tool + REST endpoint ───────────────────────
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

    const urlCheck = await validateGatewayUrl(rawUrl);
    if (!urlCheck.ok) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        message: `Gateway URL validation failed: ${urlCheck.error}`,
      });
    }

    const checkUrl = `${rawUrl.replace(/\/$/, "")}/api/v1/check`;
    const authHeaders: Record<string, string> = cfg.gatewayToken
      ? { Authorization: `Bearer ${cfg.gatewayToken}` }
      : {};
    const t0 = Date.now();
    try {
      const res = await fetch(checkUrl, {
        method: "GET",
        headers: authHeaders,
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

  return JSON.stringify({
    configured: true,
    online: false,
    message: `Unknown mode: ${(cfg as any).mode}`,
  });
}

// ── Helper: send message and capture message_id ───────────────────────────────
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
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    return data.ok && data.result ? { message_id: data.result.message_id } : null;
  } catch {
    return null;
  }
}
