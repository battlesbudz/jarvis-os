import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import { db } from "../../db";
import { telegramLinkCodes } from "../../../shared/schema";
import { getTelegramBotUsername, isTelegramConfigured } from "../../integrations/telegram";
import {
  getOneCliConnectionHint,
  getOneCliConnectUrl,
  getOneCliSetupStatus,
  isOneCliConnection,
  ONECLI_CONNECTIONS,
  type OneCliConnection,
} from "../../oneCliConnection";

const SUPPORTED_CONNECTIONS = ["telegram", ...ONECLI_CONNECTIONS] as const;

export const connectChannelTool: AgentTool = {
  name: "connect_channel",
  description:
    "Connect Telegram directly through Jarvis, or hand off WhatsApp, Slack, Discord, Google/Gmail/Calendar, and Microsoft/Outlook/Calendar to the One Connector.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        enum: SUPPORTED_CONNECTIONS,
        description: "Connection to set up. Telegram is Jarvis-owned; all other values use the One Connector.",
      },
    },
    required: ["channel"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const channel = String(args.channel || "").toLowerCase();

    if (channel === "telegram") {
      if (!isTelegramConfigured()) {
        return {
          ok: false,
          content: "Telegram bot is not configured on this server. Ask the admin to add TELEGRAM_BOT_TOKEN to secrets.",
          label: "Telegram not configured",
        };
      }

      const code = generateCode(6);
      await db.insert(telegramLinkCodes).values({ code, userId: ctx.userId });
      const botUsername = await getTelegramBotUsername();
      if (!botUsername) {
        return {
          ok: false,
          content: "Could not fetch bot username from Telegram. Try again in a moment, or connect manually from Profile connections.",
          label: "Could not get bot username",
        };
      }

      const url = `https://t.me/${botUsername}`;
      const payload = { url, buttonLabel: "Open Telegram", channel: "telegram", code };
      return {
        ok: true,
        content: JSON.stringify(payload),
        label: "Open Telegram",
        detail: JSON.stringify(payload),
      };
    }

    if (!isOneCliConnection(channel)) {
      return {
        ok: false,
        content: `Unknown connection "${channel}". Supported: ${SUPPORTED_CONNECTIONS.join(", ")}.`,
        label: "Unknown connection",
      };
    }

    const connection = channel as OneCliConnection;
    const url = getOneCliConnectUrl(connection);
    const one = getOneCliSetupStatus();
    const payload = {
      connection,
      buttonLabel: url ? `Set up ${connection} in One` : "Open One setup",
      url,
      one,
      instructions: getOneCliConnectionHint(connection),
    };

    return {
      ok: true,
      content: JSON.stringify(payload),
      label: payload.buttonLabel,
      detail: JSON.stringify(payload),
    };
  },
};

function generateCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
