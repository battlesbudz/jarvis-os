import type { AgentTool, ToolResult } from "../types";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { userPreferences } from "@shared/schema";
import { promises as dns } from "dns";

export interface OpenClawBridgeConfig {
  mode: "telegram" | "gateway";
  telegramChatId?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  enabled: boolean;
}

// ── Pending delegation store ─────────────────────────────────────────────────
// Keyed by userId.  Resolved by telegramRoutes.ts when a message arrives
// from the configured OpenClaw chat that is a Telegram reply to sentMessageId.
export interface PendingDelegation {
  chatId: string;
  sentMessageId: number | null; // message_id we sent — primary reply_to correlation
  nonce: string;                // embedded nonce — secondary correlation if no reply_to
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const pendingOpenClawDelegations = new Map<string, PendingDelegation>();

// ── Gateway response types ───────────────────────────────────────────────────
interface GatewayImmediateResponse {
  result?: string;
  output?: string;
  content?: string;
  message?: string;
  status?: string;
}

interface GatewayJobResponse {
  id?: string;
  job_id?: string;
  task_id?: string;
  status?: "queued" | "running" | "complete" | "done" | "finished" | "error" | "failed" | string;
  result?: string | object;
  error?: string | object;
}

// ── SSRF protection ──────────────────────────────────────────────────────────
// Two-layer: (1) literal IP/hostname patterns, (2) DNS resolution to catch
// public hostnames resolving to private/internal IPs.
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

  // Layer 2: DNS resolution — resolve and block if any address is private
  try {
    let addresses: string[] = [];
    try {
      addresses = await dns.resolve(host);
    } catch {
      const v4 = await dns.resolve4(host).catch(() => [] as string[]);
      const v6 = await dns.resolve6(host).catch(() => [] as string[]);
      addresses = [...v4, ...v6];
    }
    if (addresses.length === 0) {
      return {
        ok: false,
        error: `Cannot resolve gateway hostname "${host}". Ensure the tunnel is active.`,
      };
    }
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        return {
          ok: false,
          error: `Gateway hostname "${host}" resolves to a private IP (${addr}). SSRF protection requires a public gateway address.`,
        };
      }
    }
  } catch {
    return {
      ok: false,
      error: `Cannot resolve gateway hostname "${host}". Ensure the tunnel is active.`,
    };
  }

  return { ok: true, url: parsed };
}

// ── Nonce ────────────────────────────────────────────────────────────────────
// Short random ID embedded in the sent task message so OpenClaw can echo it
// back as a deterministic secondary correlation key (in case it doesn't
// reply as a Telegram threaded reply to the original message_id).
function generateNonce(): string {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

// ── Config helper ────────────────────────────────────────────────────────────
export async function getOpenClawConfig(userId: string): Promise<OpenClawBridgeConfig | null> {
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const prefs = (rows[0]?.data as Record<string, unknown>) ?? {};
    const cfg = prefs.openclawBridge as OpenClawBridgeConfig | undefined;
    if (!cfg || !cfg.enabled) return null;
    return cfg;
  } catch {
    return null;
  }
}

// ── Result helpers ───────────────────────────────────────────────────────────
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
    const task = String(args.task ?? "").trim();
    if (!task) return fail("task argument is required.");

    const userId = ctx.userId;
    const cfg = await getOpenClawConfig(userId);

    if (!cfg) {
      return fail(
        "OpenClaw bridge is not configured or disabled. Go to Settings → OpenClaw Brain to set up the connection.",
        "openclaw_not_configured"
      );
    }

    const timeoutMs = Math.min(Number(args.timeout_minutes) || 10, 15) * 60 * 1000;

    // ── Telegram mode ─────────────────────────────────────────────────────
    if (cfg.mode === "telegram") {
      const chatId = cfg.telegramChatId?.trim();
      if (!chatId) {
        return fail(
          "Telegram chat ID is not set. Configure it in Settings → OpenClaw Brain.",
          "openclaw_telegram_no_chatid"
        );
      }

      // Generate a per-request nonce and embed it in the task message.
      // telegramRoutes.ts resolves the pending delegation when it receives a
      // message from the same chatId that satisfies EITHER:
      //   (A) reply_to_message.message_id === sentMessageId  [primary — standard reply]
      //   (B) text contains the embedded correlation tag [OC:{nonce}]  [secondary]
      // Both are explicit correlation keys; arbitrary unrelated messages are rejected.
      const nonce = generateNonce();
      const sentText =
        `[JARVIS→OPENCLAW] ref:${nonce}\n${task}\n\n` +
        `(Reply to this message, or start your response with [OC:${nonce}])`;

      const sentResult = await sendMessageWithId(chatId, sentText);
      if (!sentResult) {
        return fail(
          "Failed to send task to OpenClaw via Telegram — bot token may be missing or chat ID is incorrect. Check Settings → OpenClaw Brain.",
          "openclaw_telegram_send_failed"
        );
      }

      // Await a correlated reply.  The existing Telegram poller (processUpdate)
      // checks every incoming message against pendingOpenClawDelegations and
      // resolves this Promise when a matching message arrives.
      let replyText: string;
      try {
        replyText = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingOpenClawDelegations.delete(userId);
            reject(
              new Error(
                `OpenClaw did not reply within ${Math.round(timeoutMs / 60000)} minutes. ` +
                  `The task was sent (message_id=${sentResult.message_id}, nonce=${nonce}). ` +
                  `Check your Telegram chat for partial output.`
              )
            );
          }, timeoutMs);

          pendingOpenClawDelegations.set(userId, {
            chatId,
            sentMessageId: sentResult.message_id,
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
        });
      } catch (err) {
        return fail(
          err instanceof Error ? err.message : String(err),
          "openclaw_telegram_timeout"
        );
      }

      return ok(replyText, "openclaw_delegate", `telegram/message_id=${sentResult.message_id}`);
    }

    // ── Gateway mode ──────────────────────────────────────────────────────
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

      // Send token in both Authorization header AND body per spec ({ message, token })
      const authHeaders: Record<string, string> = cfg.gatewayToken
        ? { Authorization: `Bearer ${cfg.gatewayToken}` }
        : {};
      const bodyPayload: Record<string, string> = { message: task };
      if (cfg.gatewayToken) bodyPayload.token = cfg.gatewayToken;

      let response: Response;
      try {
        response = await fetch(`${gatewayBase}/api/v1/message`, {
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
          "openclaw_gateway_http_error"
        );
      }

      const contentType = response.headers.get("content-type") ?? "";

      // SSE streaming
      if (contentType.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        if (!reader) {
          return fail(
            "Gateway returned SSE stream but body is unreadable.",
            "openclaw_sse_error"
          );
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
            const chunk = decoder.decode(value);
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data:")) {
                const payload = line.slice(5).trim();
                if (payload && payload !== "[DONE]") chunks.push(payload);
              }
            }
          }
        }
        reader.cancel().catch(() => {});
        const result = chunks.join("");
        return ok(result || "(empty SSE stream from OpenClaw)", "openclaw_delegate", "gateway/sse");
      }

      // JSON — either immediate result or async job stub
      const data = (await response.json().catch(() => null)) as
        | GatewayImmediateResponse
        | GatewayJobResponse
        | null;

      // Detect async job
      const jobData = data as GatewayJobResponse | null;
      const jobId =
        jobData?.job_id ??
        jobData?.task_id ??
        ((jobData?.status === "queued" || jobData?.status === "running")
          ? jobData?.id
          : undefined);

      if (jobId) {
        const pollUrl = `${gatewayBase}/api/v1/jobs/${jobId}`;
        const deadline = Date.now() + timeoutMs;
        let lastData: GatewayJobResponse | null = data as GatewayJobResponse;

        while (Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 15_000)); // poll every 15s per spec
          try {
            const pollRes = await fetch(pollUrl, {
              method: "GET",
              headers: { "Content-Type": "application/json", ...authHeaders },
              signal: AbortSignal.timeout(15_000),
            });
            if (!pollRes.ok) break;
            lastData = (await pollRes.json()) as GatewayJobResponse;
            const status = lastData?.status;
            if (
              status === "complete" ||
              status === "done" ||
              status === "finished" ||
              lastData?.result !== undefined
            ) {
              const raw = lastData?.result;
              const resultStr = typeof raw === "string" ? raw : JSON.stringify(raw);
              return ok(resultStr, "openclaw_delegate", `gateway/job/${jobId}`);
            }
            if (status === "error" || status === "failed") {
              const raw = lastData?.error;
              const errStr = typeof raw === "string" ? raw : JSON.stringify(raw);
              return fail(errStr, "openclaw_job_failed");
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
      const immData = data as GatewayImmediateResponse | null;
      const immediateResult =
        immData?.result ??
        immData?.output ??
        immData?.content ??
        immData?.message ??
        (data !== null ? JSON.stringify(data) : "(empty response from OpenClaw)");
      return ok(
        typeof immediateResult === "string" ? immediateResult : JSON.stringify(immediateResult),
        "openclaw_delegate",
        "gateway/immediate"
      );
    }

    return fail(`Unknown bridge mode: ${String((cfg as OpenClawBridgeConfig).mode)}`);
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
    const data = JSON.parse(statusJson) as { online: boolean; message?: string };
    return {
      ok: !!data.online,
      content: statusJson,
      label: "openclaw_status",
      detail: data.message,
    };
  },
};

// ── Shared status check — used by tool + REST endpoint ───────────────────────
export async function checkOpenClawStatus(userId: string): Promise<string> {
  let rawPrefs: Record<string, unknown> = {};
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    rawPrefs = (rows[0]?.data as Record<string, unknown>) ?? {};
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
      message:
        "OpenClaw bridge is configured but currently disabled. Enable it in Settings → OpenClaw Brain.",
    });
  }

  if (cfg.mode === "telegram") {
    const chatId = cfg.telegramChatId?.trim();
    const hasBotToken = !!process.env.TELEGRAM_BOT_TOKEN;

    if (!chatId) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "telegram",
        message: "Telegram chat ID is not set. Enter it in Settings → OpenClaw Brain.",
      });
    }
    if (!hasBotToken) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "telegram",
        message: "Telegram bot token is not set — configure TELEGRAM_BOT_TOKEN.",
      });
    }

    // Liveness probe: call Telegram getChat API to verify bot can reach the chat
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(chatId)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const body = (await res.json()) as { ok: boolean; result?: { type?: string; title?: string } };
      if (!res.ok || !body.ok) {
        return JSON.stringify({
          configured: true,
          online: false,
          mode: "telegram",
          chatId,
          message:
            "Bot cannot reach the configured Telegram chat. Verify the chat ID in Settings → OpenClaw Brain and ensure the bot is a member of that chat.",
        });
      }
      return JSON.stringify({
        configured: true,
        online: true,
        mode: "telegram",
        chatId,
        chatType: body.result?.type ?? "unknown",
        message:
          "OpenClaw Telegram bridge is active. Tasks will be sent to the configured chat and replies forwarded back to Jarvis.",
      });
    } catch {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "telegram",
        chatId,
        message: "Could not verify Telegram chat reachability — check your connection.",
      });
    }
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
    message: `Unknown mode: ${String((cfg as OpenClawBridgeConfig).mode)}`,
  });
}

// ── Telegram send helper — captures message_id ───────────────────────────────
interface TelegramSendResult {
  message_id: number;
}

async function sendMessageWithId(
  chatId: string,
  text: string
): Promise<TelegramSendResult | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
