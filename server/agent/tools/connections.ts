import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { getUserOAuthStatus } from "../../userTokenStore";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { channelLinks, telegramLinks } from "@shared/schema";
import { isUserPaired } from "../../daemon/bridge";

function getServerBaseUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(',')[0];
  if (domain) {
    const isDev = process.env.REPLIT_DEV_DOMAIN === domain;
    return isDev ? `https://${domain}:5000` : `https://${domain}`;
  }
  return 'http://localhost:5000';
}

export const checkConnectionsTool: AgentTool = {
  name: "check_connections",
  description: "Check which external accounts and messaging channels the user has connected. Returns a structured status for Google (Gmail/Calendar), Microsoft (Outlook/Calendar), Slack, Telegram, WhatsApp, Discord, and Desktop Daemon. Always call this before claiming a service is (or isn't) connected, or before attempting an action on a connected service.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(_args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const [oauthStatus, tgRows, channelRows] = await Promise.all([
        getUserOAuthStatus(ctx.userId),
        db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, ctx.userId)).limit(1),
        db.select().from(channelLinks).where(eq(channelLinks.userId, ctx.userId)),
      ]);

      const daemonConnected = isUserPaired(ctx.userId);

      const lines: string[] = [
        `Google (Gmail + Calendar): ${oauthStatus.google?.connected ? `✓ connected as ${oauthStatus.google.email || 'unknown'}` : '✗ not connected'}`,
        `Microsoft (Outlook + Calendar): ${oauthStatus.microsoft?.connected ? `✓ connected as ${oauthStatus.microsoft.email || 'unknown'}` : '✗ not connected'}`,
        `Slack OAuth: ${oauthStatus.slack?.connected ? `✓ connected` : '✗ not connected'}`,
        `Telegram: ${tgRows.length > 0 ? '✓ linked' : '✗ not linked'}`,
        `WhatsApp: ${channelRows.some(r => r.channel === 'whatsapp') ? '✓ linked' : '✗ not linked'}`,
        `Discord: ${channelRows.some(r => r.channel === 'discord') ? '✓ linked' : '✗ not linked'}`,
        `Desktop Daemon: ${daemonConnected ? '✓ online' : '✗ not connected'}`,
      ];

      const summary = lines.join('\n');
      return {
        ok: true,
        content: `Current connection status:\n${summary}`,
        label: "Connections checked",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `check_connections failed: ${msg}`, label: "Check connections failed" };
    }
  },
};

export const generateReconnectLinkTool: AgentTool = {
  name: "generate_reconnect_link",
  description: "Generate a fresh OAuth authorization URL to reconnect a disconnected or expired account. Returns a URL and a button label. Use after check_connections shows a service is not connected. provider must be 'google' (Gmail + Calendar) or 'microsoft' (Outlook + Calendar).",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: ["google", "microsoft"],
        description: "Which provider to reconnect: 'google' or 'microsoft'",
      },
    },
    required: ["provider"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const provider = String(args.provider || "").toLowerCase();
    const baseUrl = getServerBaseUrl();

    if (provider === "google") {
      const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
      if (!clientId) {
        return { ok: false, content: "Google OAuth is not configured on this server.", label: "Google not configured" };
      }
      const redirectUri = `${baseUrl}/api/oauth/google/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: [
          "openid", "email",
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
          "https://www.googleapis.com/auth/gmail.modify",
        ].join(" "),
        access_type: "offline",
        prompt: "consent",
        state: ctx.userId,
      });
      const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      return {
        ok: true,
        content: `Google reconnect link ready. Present this to the user as a tappable button labelled "Reconnect Google". URL: ${url}`,
        label: "Reconnect Google",
        detail: JSON.stringify({ url, buttonLabel: "Reconnect Google", provider: "google" }),
      };
    }

    if (provider === "microsoft") {
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      if (!clientId) {
        return { ok: false, content: "Microsoft OAuth is not configured on this server.", label: "Microsoft not configured" };
      }
      const redirectUri = `${baseUrl}/api/oauth/microsoft/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "offline_access Calendars.ReadWrite Mail.Read Mail.Send User.Read",
        state: ctx.userId,
        response_mode: "query",
      });
      const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
      return {
        ok: true,
        content: `Microsoft reconnect link ready. Present this to the user as a tappable button labelled "Reconnect Outlook". URL: ${url}`,
        label: "Reconnect Outlook",
        detail: JSON.stringify({ url, buttonLabel: "Reconnect Outlook", provider: "microsoft" }),
      };
    }

    return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
  },
};
