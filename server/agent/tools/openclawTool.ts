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

async function getOpenClawConfig(userId: string): Promise<OpenClawBridgeConfig | null> {
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
          "Max minutes to wait for a result in Gateway mode (default 10, max 15). For long build tasks use 15.",
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
        hint: "You can connect via Telegram (enter your OpenClaw Telegram chat ID) or via Gateway URL if you have a tunnel set up.",
      });
    }

    if (cfg.mode === "telegram") {
      const chatId = cfg.telegramChatId?.trim();
      if (!chatId) {
        return JSON.stringify({
          error: "Telegram chat ID is not set. Configure it in Settings → OpenClaw Brain.",
        });
      }

      const prefix = "[JARVIS → OPENCLAW]\n";
      try {
        await sendMessage(chatId, prefix + task);
      } catch (err) {
        return JSON.stringify({
          error: `Failed to send task to OpenClaw via Telegram: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      return JSON.stringify({
        status: "delegated",
        mode: "telegram",
        message:
          "Task sent to OpenClaw via Telegram. OpenClaw will process it and reply directly in your Telegram chat. Check Telegram for the result.",
      });
    }

    if (cfg.mode === "gateway") {
      const gatewayUrl = cfg.gatewayUrl?.trim();
      if (!gatewayUrl) {
        return JSON.stringify({
          error: "Gateway URL is not set. Configure it in Settings → OpenClaw Brain.",
        });
      }

      const timeoutMs = Math.min((Number(args.timeout_minutes) || 10), 15) * 60 * 1000;
      const startAt = Date.now();

      const messageUrl = `${gatewayUrl.replace(/\/$/, "")}/api/v1/message`;
      let response: Response;
      try {
        response = await fetch(messageUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cfg.gatewayToken ? { Authorization: `Bearer ${cfg.gatewayToken}` } : {}),
          },
          body: JSON.stringify({ message: task }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        return JSON.stringify({
          error: `Could not reach OpenClaw gateway at ${gatewayUrl}: ${err instanceof Error ? err.message : String(err)}`,
          hint: "Make sure your tunnel (ngrok/Cloudflare/Tailscale) is active and the gateway URL is correct.",
        });
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return JSON.stringify({
          error: `OpenClaw gateway returned ${response.status}: ${body.slice(0, 300)}`,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        // SSE streaming — collect all data events until stream closes or timeout
        const reader = response.body?.getReader();
        if (!reader) {
          return JSON.stringify({ error: "Gateway returned SSE stream but body is unreadable." });
        }
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        const remaining = timeoutMs - (Date.now() - startAt);
        const deadline = Date.now() + remaining;
        while (Date.now() < deadline) {
          const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
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
        return JSON.stringify({ status: "complete", mode: "gateway", result });
      }

      // Regular JSON response
      const data = await response.json().catch(() => null);
      return JSON.stringify({
        status: "complete",
        mode: "gateway",
        result: data ?? "(empty response from OpenClaw)",
      });
    }

    return JSON.stringify({ error: `Unknown bridge mode: ${(cfg as any).mode}` });
  },
};

export const openclawStatusTool: AgentTool = {
  name: "openclaw_status",
  description:
    "Check whether the OpenClaw compute bridge is configured and reachable. Returns online status, the configured mode (telegram or gateway), and latency for gateway mode. Use this before delegating a task if you are unsure whether the bridge is active.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    const userId = ctx.userId;

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
        message:
          "OpenClaw bridge is not configured. Go to Settings → OpenClaw Brain to set it up.",
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
          ? "OpenClaw bridge is active via Telegram. Tasks will be sent to the configured chat."
          : !hasBotToken
          ? "Telegram bot token is not set — configure TELEGRAM_BOT_TOKEN."
          : "Telegram chat ID is not set. Enter it in Settings → OpenClaw Brain.",
      });
    }

    if (cfg.mode === "gateway") {
      const gatewayUrl = cfg.gatewayUrl?.trim();
      if (!gatewayUrl) {
        return JSON.stringify({
          configured: true,
          online: false,
          mode: "gateway",
          message: "Gateway URL is not set. Enter it in Settings → OpenClaw Brain.",
        });
      }

      const checkUrl = `${gatewayUrl.replace(/\/$/, "")}/api/v1/check`;
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
            gatewayUrl,
            message: `OpenClaw gateway is online (${latencyMs}ms latency).`,
          });
        }
        return JSON.stringify({
          configured: true,
          online: false,
          mode: "gateway",
          latencyMs,
          gatewayUrl,
          message: `Gateway responded with HTTP ${res.status}. Make sure OpenClaw is running and your tunnel is active.`,
        });
      } catch (err) {
        const latencyMs = Date.now() - t0;
        return JSON.stringify({
          configured: true,
          online: false,
          mode: "gateway",
          latencyMs,
          gatewayUrl,
          message: `Cannot reach gateway at ${gatewayUrl}: ${err instanceof Error ? err.message : String(err)}. Check that your tunnel is active.`,
        });
      }
    }

    return JSON.stringify({ configured: true, online: false, message: `Unknown mode: ${(cfg as any).mode}` });
  },
};
