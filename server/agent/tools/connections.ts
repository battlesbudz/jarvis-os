import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { getUserOAuthStatus, getValidGoogleToken, getValidMicrosoftToken } from "../../userTokenStore";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { channelLinks, telegramLinks } from "@shared/schema";
import { isUserPaired, isAndroidDaemonActive, isDesktopDaemonActive } from "../../daemon/bridge";
import {
  buildComposioConnectIntent,
  getComposioStatus,
  type ComposioConnectionPlatform,
} from "../../connectors/composio/connectionCenter";

const PROVIDER_TO_PLATFORM: Record<string, ComposioConnectionPlatform> = {
  google: "gmail",
  microsoft: "outlook-mail",
};

export const checkConnectionsTool: AgentTool = {
  name: "check_connections",
  description: "Check which external accounts and messaging channels the user has connected. Returns a structured status for Gmail, calendars, Outlook, Slack, Telegram, WhatsApp, Discord, and Desktop Daemon. Always call this before claiming a service is or is not connected, or before attempting an action on a connected service.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(_args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const [googleToken, msToken, oauthStatus, tgRows, channelRows, composioStatus] = await Promise.all([
        getValidGoogleToken(ctx.userId).catch(() => null),
        getValidMicrosoftToken(ctx.userId).catch(() => null),
        getUserOAuthStatus(ctx.userId).catch(() => ({} as Record<string, any>)),
        db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, ctx.userId)).limit(1),
        db.select().from(channelLinks).where(eq(channelLinks.userId, ctx.userId)),
        getComposioStatus(ctx.userId).catch((error) => ({
          provider: "composio" as const,
          configured: false,
          ready: false,
          dashboardUrl: "",
          connections: [],
          platforms: [],
          nextSteps: [],
          error: error instanceof Error ? error.message : String(error),
        })),
      ]);

      const daemonConnected = isUserPaired(ctx.userId);
      const androidActive = isAndroidDaemonActive(ctx.userId);
      const desktopActive = isDesktopDaemonActive(ctx.userId);
      const daemonParts: string[] = [];
      if (desktopActive) daemonParts.push("Desktop Daemon: online - use shell, notify, file_read, file_write, file_list actions.");
      if (androidActive) daemonParts.push("Android Device Daemon: online - use android_* actions.");
      const daemonLabel = daemonConnected
        ? daemonParts.join(" | ")
        : "Android/Desktop Daemon: not connected";

      const googleEmail = oauthStatus?.google?.email || oauthStatus?.google?.accounts?.[0]?.email || "unknown";
      const msEmail = oauthStatus?.microsoft?.email || oauthStatus?.microsoft?.accounts?.[0]?.email || "unknown";
      const connectedPlatforms = composioStatus.platforms
        .filter((platform) => platform.ready)
        .map((platform) => platform.label)
        .join(", ");

      const lines = [
        `Connected Accounts: ${composioStatus.ready ? connectedPlatforms : composioStatus.error || "no active Composio accounts yet"}`,
        `Google legacy OAuth: ${googleToken ? `token valid - ${googleEmail}` : "not connected or token expired"}`,
        `Microsoft legacy OAuth: ${msToken ? `token valid - ${msEmail}` : "not connected or token expired"}`,
        `Slack OAuth: ${oauthStatus?.slack?.connected ? "connected" : "not connected"}`,
        `Telegram: ${tgRows.length > 0 ? "linked" : "not linked"}`,
        `WhatsApp: ${channelRows.some((r) => r.channel === "whatsapp") ? "linked" : "not linked"}`,
        `Discord: ${channelRows.some((r) => r.channel === "discord") ? "linked" : "not linked"}`,
        daemonLabel,
      ];

      return {
        ok: true,
        content: `Current connection status:\n${lines.join("\n")}`,
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
  description: "Create a Composio Connect Link for Google/Gmail/Calendar or Microsoft/Outlook reconnects.",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: ["google", "microsoft"],
        description: "Which provider to reconnect: google or microsoft.",
      },
    },
    required: ["provider"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const provider = String(args.provider || "").toLowerCase();
    const platform = PROVIDER_TO_PLATFORM[provider];
    if (!platform) {
      return { ok: false, content: `Unknown provider "${provider}". Use google or microsoft.`, label: "Unknown provider" };
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
