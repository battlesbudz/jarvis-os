import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { db } from "../../db";
import { telegramLinkCodes, channelLinkCodes } from "../../../shared/schema";
import { eq, and } from "drizzle-orm";
import { getTelegramBotUsername, isTelegramConfigured } from "../../integrations/telegram";
import { buildSlackAuthorizeUrl } from "../../oauthRoutes";

type Channel = "telegram" | "whatsapp" | "discord" | "slack";

interface ConnectChannelArgs {
  channel?: string;
}

function generateCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export const connectChannelTool: AgentTool = {
  name: "connect_channel",
  description:
    "Generate a one-tap connection link so the user can connect a new messaging channel (Telegram, WhatsApp, Slack, or Discord) to Jarvis. Returns a tappable deep link. Use this proactively when the user asks to connect/link any of these services.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        enum: ["telegram", "whatsapp", "discord", "slack"],
        description: "Which channel to generate a connection link for.",
      },
    },
    required: ["channel"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const channel = String(args.channel || "").toLowerCase() as Channel;
    const userId = ctx.userId;

    if (!["telegram", "whatsapp", "discord", "slack"].includes(channel)) {
      return {
        ok: false,
        content: `Unknown channel "${channel}". Supported: telegram, whatsapp, discord, slack.`,
        label: "Unknown channel",
      };
    }

    try {
      if (channel === "telegram") {
        if (!isTelegramConfigured()) {
          return {
            ok: false,
            content:
              "Telegram bot is not configured on this server. Ask the admin to add TELEGRAM_BOT_TOKEN to secrets.",
            label: "Telegram not configured",
          };
        }
        await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId));
        const code = generateCode(6);
        await db.insert(telegramLinkCodes).values({ code, userId });
        const botUsername = await getTelegramBotUsername();
        if (!botUsername) {
          return {
            ok: false,
            content:
              "Could not fetch bot username from Telegram. Try again in a moment, or connect manually from Profile → Connections.",
            label: "Could not get bot username",
          };
        }
        const url = `https://t.me/${botUsername}?start=${code}`;
        return {
          ok: true,
          content: JSON.stringify({ url, buttonLabel: "Open Telegram", channel: "telegram" }),
          label: "Open Telegram",
          detail: JSON.stringify({ url, buttonLabel: "Open Telegram", channel: "telegram" }),
        };
      }

      if (channel === "whatsapp") {
        const twilioRaw = process.env.TWILIO_WHATSAPP_NUMBER;
        if (!twilioRaw) {
          return {
            ok: false,
            content:
              "WhatsApp is not configured on this server (TWILIO_WHATSAPP_NUMBER is missing). Ask the admin to set it up.",
            label: "WhatsApp not configured",
          };
        }
        const phone = twilioRaw.replace(/^whatsapp:/i, "").replace(/\s+/g, "");
        const code = generateCode(6);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await db
          .delete(channelLinkCodes)
          .where(and(eq(channelLinkCodes.userId, userId), eq(channelLinkCodes.channel, "whatsapp")));
        await db.insert(channelLinkCodes).values({ code, userId, channel: "whatsapp", expiresAt });
        const body = encodeURIComponent(`CONNECT ${code}`);
        const url = `https://wa.me/${phone.replace("+", "")}?text=${body}`;
        return {
          ok: true,
          content: JSON.stringify({ url, buttonLabel: "Open WhatsApp", channel: "whatsapp" }),
          label: "Open WhatsApp",
          detail: JSON.stringify({ url, buttonLabel: "Open WhatsApp", channel: "whatsapp" }),
        };
      }

      if (channel === "slack") {
        if (!process.env.SLACK_CLIENT_ID) {
          return {
            ok: false,
            content:
              "Slack is not configured on this server (SLACK_CLIENT_ID missing). Ask the admin to set it up.",
            label: "Slack not configured",
          };
        }
        const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
        const baseUrl = domain ? `https://${domain}` : "http://localhost:5000";
        const redirectUri = `${baseUrl}/api/oauth/slack/callback`;
        const url = buildSlackAuthorizeUrl(userId, redirectUri);
        if (!url) {
          return { ok: false, content: "Slack OAuth not configured.", label: "Slack not configured" };
        }
        return {
          ok: true,
          content: JSON.stringify({ url, buttonLabel: "Connect Slack", channel: "slack" }),
          label: "Connect Slack",
          detail: JSON.stringify({ url, buttonLabel: "Connect Slack", channel: "slack" }),
        };
      }

      if (channel === "discord") {
        const url = "profile://connections";
        return {
          ok: true,
          content: JSON.stringify({
            url,
            buttonLabel: "Open Discord Setup",
            channel: "discord",
          }),
          label: "Open Discord Setup",
          detail: JSON.stringify({
            url,
            buttonLabel: "Open Discord Setup",
            channel: "discord",
          }),
        };
      }

      return { ok: false, content: "Unexpected channel.", label: "Error" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[connectChannel] failed for ${channel}:`, msg);
      return {
        ok: false,
        content: `Failed to generate connection link: ${msg}`,
        label: "Link generation failed",
        detail: msg,
      };
    }
  },
};
