import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import { db } from "../../db";
import { telegramLinkCodes } from "../../../shared/schema";
import { getTelegramBotUsername, isTelegramConfigured } from "../../integrations/telegram";
import {
  buildComposioConnectIntent,
  isComposioConnectionPlatform,
} from "../../connectors/composio/connectionCenter";

const CHANNEL_TO_PLATFORM: Record<string, string> = {
  google: "gmail",
  microsoft: "outlook-mail",
  gmail: "gmail",
  "google-calendar": "google-calendar",
  "outlook-mail": "outlook-mail",
  "outlook-calendar": "outlook-calendar",
  slack: "slack",
  "google-drive": "google-drive",
  "google-tasks": "google-tasks",
};

const SUPPORTED_CONNECTIONS = ["telegram", ...Object.keys(CHANNEL_TO_PLATFORM)] as const;

export const connectChannelTool: AgentTool = {
  name: "connect_channel",
  description:
    "Connect Telegram directly through Jarvis, or create a Composio Connect Link for external accounts such as Gmail, Google Calendar, Outlook, Slack, Drive, or Tasks.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        enum: SUPPORTED_CONNECTIONS,
        description: "Connection to set up. Telegram is Jarvis-owned; external accounts use Composio Connect Links.",
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

    const platform = CHANNEL_TO_PLATFORM[channel];
    if (!platform || !isComposioConnectionPlatform(platform)) {
      return {
        ok: false,
        content: `Unknown connection "${channel}". Supported: ${SUPPORTED_CONNECTIONS.join(", ")}.`,
        label: "Unknown connection",
      };
    }

    const intent = await buildComposioConnectIntent(ctx.userId, platform);
    return {
      ok: !intent.error,
      content: JSON.stringify(intent),
      label: intent.buttonLabel,
      detail: JSON.stringify(intent),
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
