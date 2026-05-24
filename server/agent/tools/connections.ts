import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { getUserOAuthStatus, getValidGoogleToken, getValidMicrosoftToken } from "../../userTokenStore";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { channelLinks, telegramLinks } from "@shared/schema";
import { isUserPaired, isAndroidDaemonActive, isDesktopDaemonActive } from "../../daemon/bridge";
import { getOneCliConnectionHint, getOneCliConnectUrl, getOneCliSetupStatus, type OneCliConnection } from "../../oneCliConnection";

export const checkConnectionsTool: AgentTool = {
  name: "check_connections",
  description: "Check which external accounts and messaging channels the user has connected. Returns a structured status for Google (Gmail/Calendar), Microsoft (Outlook/Calendar), Slack, Telegram, WhatsApp, Discord, and Desktop Daemon. Always call this before claiming a service is (or isn't) connected, or before attempting an action on a connected service.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(_args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const [googleToken, msToken, oauthStatus, tgRows, channelRows] = await Promise.all([
        getValidGoogleToken(ctx.userId).catch(() => null),
        getValidMicrosoftToken(ctx.userId).catch(() => null),
        getUserOAuthStatus(ctx.userId).catch(() => ({} as Record<string, any>)),
        db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, ctx.userId)).limit(1),
        db.select().from(channelLinks).where(eq(channelLinks.userId, ctx.userId)),
      ]);

      const daemonConnected = isUserPaired(ctx.userId);
      const androidActive = isAndroidDaemonActive(ctx.userId);
      const googleEmail = oauthStatus?.google?.email || oauthStatus?.google?.accounts?.[0]?.email || 'unknown';
      const msEmail = oauthStatus?.microsoft?.email || oauthStatus?.microsoft?.accounts?.[0]?.email || 'unknown';

      const desktopActive = isDesktopDaemonActive(ctx.userId);
      const daemonParts: string[] = [];
      if (desktopActive) daemonParts.push("Desktop Daemon: ✓ online — use shell, notify, file_read, file_write, file_list actions.");
      if (androidActive) daemonParts.push("Android Device Daemon: ✓ online — use android_* actions (android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_file_list, android_file_read).");
      const daemonLabel = daemonConnected
        ? daemonParts.join(" | ")
        : `Android/Desktop Daemon: ✗ not connected`;

      const oneStatus = getOneCliSetupStatus();
      const oneConnectionSummary = oneStatus.ready
        ? oneStatus.connections.map((connection) => `${connection.platform} (${connection.state})`).join(", ")
        : oneStatus.installed
          ? "installed but not ready"
          : "not installed";
      const lines: string[] = [
        `One Connector: ${oneStatus.ready ? `ready — ${oneConnectionSummary}` : `not ready — ${oneConnectionSummary}`}`,
        `Google (Gmail + Calendar): ${googleToken ? `✓ token valid — ${googleEmail}` : '✗ not connected or token expired (reconnect needed)'}`,
        `Microsoft (Outlook + Calendar): ${msToken ? `✓ token valid — ${msEmail}` : '✗ not connected or token expired (reconnect needed)'}`,
        `Slack OAuth: ${oauthStatus?.slack?.connected ? '✓ connected' : '✗ not connected'}`,
        `Telegram: ${tgRows.length > 0 ? '✓ linked' : '✗ not linked'}`,
        `WhatsApp: ${channelRows.some(r => r.channel === 'whatsapp') ? '✓ linked' : '✗ not linked'}`,
        `Discord: ${channelRows.some(r => r.channel === 'discord') ? '✓ linked' : '✗ not linked'}`,
        daemonLabel,
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
  description: "Hand off Google/Gmail/Calendar or Microsoft/Outlook/Calendar reconnects to the One Connector. Returns setup instructions and an optional URL.",
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
  async execute(args: ToolArgs, _ctx: ToolContext): Promise<ToolResult> {
    const provider = String(args.provider || "").toLowerCase();

    if (provider === "google" || provider === "microsoft") {
      const connection = provider as OneCliConnection;
      const url = getOneCliConnectUrl(connection);
      const buttonLabel = provider === "google" ? "Set up Google in One" : "Set up Outlook in One";
      const payload = {
        provider,
        connection,
        buttonLabel: url ? buttonLabel : "Open One setup",
        url,
        one: getOneCliSetupStatus(),
        instructions: getOneCliConnectionHint(connection),
      };
      return {
        ok: true,
        content: JSON.stringify(payload),
        label: payload.buttonLabel,
        detail: JSON.stringify(payload),
      };
    }

    return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
  },
};
