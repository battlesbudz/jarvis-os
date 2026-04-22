import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks, channelLinkCodes, telegramLinks, NOTIFICATION_TYPES, CHANNEL_NAMES, type ChannelName, type NotificationType } from "@shared/schema";
import { authMiddleware } from "../auth";
import { getAllPreferences, setPreference, getChannel, listChannels } from "./registry";
import { createDaemonPairingCode, isUserPaired, closeUserDaemon, getDaemonPermissions, setDaemonPermissions, isDaemonActionAllowed, DEFAULT_DAEMON_PERMISSIONS, getAndroidDaemonPermissions, setAndroidDaemonPermissions, DEFAULT_ANDROID_DAEMON_PERMISSIONS, isAndroidDaemonActive, type DaemonAction, type DaemonPermissions, type AndroidDaemonAction, type AndroidDaemonPermissions } from "../daemon/bridge";
import { startUserBot, stopUserBot, getBotStatus, completePairing, getGuildsForUser, getChannelsForGuild, setupDiscordWorkspace, type AllowlistedGuild, type DiscordLinkMeta, WORKSPACE_TOPICS } from "../discord/manager";
import { saveUserToken, getUserToken, deleteUserToken } from "../userTokenStore";

function generateCode(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function registerChannelRoutes(app: Express): void {
  // GET /api/channels — connection status + preferences
  app.get("/api/channels", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const [tgRows, channelRows, prefs] = await Promise.all([
        db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1),
        db.select().from(channelLinks).where(eq(channelLinks.userId, userId)),
        getAllPreferences(userId),
      ]);

      const discordTok = await getUserToken(userId, "discord_bot").catch(() => null);
      const connected: Record<ChannelName, boolean> = {
        telegram: tgRows.length > 0,
        whatsapp: false,
        slack: false,
        daemon: false,
        discord: false,
      };
      const meta: Record<string, unknown> = {};

      for (const row of channelRows) {
        const ch = row.channel as ChannelName;
        if (ch === "daemon") {
          const daemonMeta = row.metadata as any;
          const platform = daemonMeta?.platform || "desktop";
          connected.daemon = isUserPaired(userId);
          meta.daemon = { hostname: daemonMeta?.hostname, lastSeenAt: row.lastSeenAt, connected: connected.daemon, platform };
        } else if (ch === "discord") {
          // A channel_links row exists → account IS paired (connected = true).
          // Bot runtime state is exposed separately so the UI can distinguish
          // "paired & bot running" from "paired but bot offline."
          connected.discord = true;
          const discordMeta = row.metadata as DiscordLinkMeta;
          const botStatus = getBotStatus(userId);
          meta.discord = {
            discordUsername: discordMeta?.discordUsername,
            botStatus,
            botRunning: botStatus === "running",
            isPaired: true,
            hasBotToken: !!discordTok,
            lastSeenAt: row.lastSeenAt,
            allowlistedGuilds: discordMeta?.allowlistedGuilds ?? [],
          };
        } else if (CHANNEL_NAMES.includes(ch)) {
          connected[ch] = true;
          if (ch === "whatsapp") meta.whatsapp = { phone: row.address, lastSeenAt: row.lastSeenAt };
          if (ch === "slack") meta.slack = { teamId: (row.metadata as Record<string, unknown>)?.teamId, lastSeenAt: row.lastSeenAt };
        }
      }

      // Discord bot token saved but NOT yet paired (no channel_links row).
      // connected.discord remains false — the pairing UI stays visible.
      if (discordTok && !connected.discord) {
        const botStatus = getBotStatus(userId);
        meta.discord = {
          hasBotToken: true,
          botStatus,
          botRunning: botStatus === "running",
          isPaired: false,
        };
      }

      const channels = listChannels().map((c) => ({
        name: c.name,
        configured: c.isConfigured(),
        connected: connected[c.name],
      }));

      res.json({
        channels,
        connected,
        meta,
        notificationTypes: NOTIFICATION_TYPES,
        preferences: prefs,
      });
    } catch (err) {
      console.error("[channels] GET /api/channels failed:", err);
      res.status(500).json({ error: "failed to load channel state" });
    }
  });

  // PUT /api/channels/preferences — body: { notificationType, channels: ChannelName[] }
  app.put("/api/channels/preferences", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { notificationType, channels } = req.body || {};
    if (!NOTIFICATION_TYPES.includes(notificationType)) {
      return res.status(400).json({ error: "invalid notificationType" });
    }
    if (!Array.isArray(channels) || channels.some((c) => !CHANNEL_NAMES.includes(c))) {
      return res.status(400).json({ error: "invalid channels" });
    }
    try {
      const unique = [...new Set(channels)] as ChannelName[];
      await setPreference(userId, notificationType as NotificationType, unique);
      res.json({ ok: true, notificationType, channels: unique });
    } catch (err) {
      console.error("[channels] preference update failed:", err);
      res.status(500).json({ error: "failed to update preference" });
    }
  });

  // POST /api/channels/whatsapp/code — generate link code; user texts it from WhatsApp
  app.post("/api/channels/whatsapp/code", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const code = generateCode(6);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await db.insert(channelLinkCodes).values({ code, userId, channel: "whatsapp", expiresAt });
      res.json({ code, expiresAt, twilioNumber: process.env.TWILIO_WHATSAPP_NUMBER || null });
    } catch (err) {
      console.error("[channels] whatsapp code failed:", err);
      res.status(500).json({ error: "failed to generate code" });
    }
  });

  // DELETE /api/channels/:channel — unlink
  app.delete("/api/channels/:channel", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const channel = req.params.channel as ChannelName;
    if (!CHANNEL_NAMES.includes(channel) || channel === "telegram") {
      return res.status(400).json({ error: "channel not unlinkable here" });
    }
    try {
      if (channel === "daemon") {
        closeUserDaemon(userId);
      }
      if (channel === "discord") {
        stopUserBot(userId);
        await deleteUserToken(userId, "discord_bot").catch(() => {});
        // Invalidate any outstanding pairing codes so a previously-issued
        // DM code cannot be used to re-pair after unlinking.
        await db.delete(channelLinkCodes)
          .where(and(eq(channelLinkCodes.userId, userId), eq(channelLinkCodes.channel, "discord")))
          .catch(() => {});
      }
      await db.delete(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, channel)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[channels] unlink failed:", err);
      res.status(500).json({ error: "failed to unlink" });
    }
  });

  // GET /api/channels/daemon/permissions — current per-action allow/deny
  app.get("/api/channels/daemon/permissions", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const perms = await getDaemonPermissions(userId);
      res.json({ permissions: perms, defaults: DEFAULT_DAEMON_PERMISSIONS });
    } catch (err) {
      console.error("[channels] daemon permissions GET failed:", err);
      res.status(500).json({ error: "failed to load permissions" });
    }
  });

  // PUT /api/channels/daemon/permissions — body: { permissions: Partial<DaemonPermissions> }
  app.put("/api/channels/daemon/permissions", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const incoming = (req.body?.permissions || {}) as Record<string, unknown>;
    const ACTIONS: readonly DaemonAction[] = ["shell", "notify", "file_read", "file_write", "file_list"] as const;
    const sanitized: Partial<DaemonPermissions> = {};
    for (const k of ACTIONS) {
      if (k in incoming) sanitized[k] = !!incoming[k];
    }
    try {
      const merged = await setDaemonPermissions(userId, sanitized);
      res.json({ ok: true, permissions: merged });
    } catch (err) {
      console.error("[channels] daemon permissions PUT failed:", err);
      res.status(500).json({ error: "failed to update permissions" });
    }
  });

  // POST /api/channels/daemon/code — generate pairing code for desktop daemon
  app.post("/api/channels/daemon/code", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const code = await createDaemonPairingCode(userId);
      res.json({ code, expiresInSec: 15 * 60 });
    } catch (err) {
      console.error("[channels] daemon code failed:", err);
      res.status(500).json({ error: "failed to generate pairing code" });
    }
  });

  // POST /api/channels/daemon/exec — agent / user can run a daemon op
  // Desktop-daemon ops only: shell | file_read | file_write | file_list | notify
  // Android ops (android_*) are routed exclusively via the agent daemon_action tool;
  // bridge-layer gating in sendDaemonOp rejects android_* ops sent here.
  app.post("/api/channels/daemon/exec", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { sendDaemonOp, isUserPaired: paired } = await import("../daemon/bridge");
    if (!paired(userId)) return res.status(409).json({ ok: false, error: "daemon not connected" });
    const { op } = req.body || {};
    const allowed = ["shell", "file_read", "file_write", "file_list", "notify"];
    if (!op || !allowed.includes(op.type)) {
      return res.status(400).json({ ok: false, error: "invalid op" });
    }
    if (!(await isDaemonActionAllowed(userId, op.type as DaemonAction))) {
      return res.status(403).json({ ok: false, error: `Action '${op.type}' is not permitted. Enable it in Profile → Connected Channels → Desktop Daemon → Permissions.` });
    }
    const result = await sendDaemonOp(userId, op, 30000);
    res.json(result);
  });

  // ── Android daemon routes ───────────────────────────────────────────────

  // GET /api/channels/android-daemon/permissions — current per-action allow/deny
  app.get("/api/channels/android-daemon/permissions", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const perms = await getAndroidDaemonPermissions(userId);
      res.json({ permissions: perms, defaults: DEFAULT_ANDROID_DAEMON_PERMISSIONS });
    } catch (err) {
      console.error("[channels] android daemon permissions GET failed:", err);
      res.status(500).json({ error: "failed to load android permissions" });
    }
  });

  // PUT /api/channels/android-daemon/permissions — body: { permissions: Partial<AndroidDaemonPermissions> }
  app.put("/api/channels/android-daemon/permissions", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const incoming = (req.body?.permissions || {}) as Record<string, unknown>;
    const ANDROID_ACTIONS: readonly AndroidDaemonAction[] = [
      "android_screenshot", "android_read_screen", "android_open_app", "android_browse",
      "android_file_list", "android_file_read", "android_tap_type",
    ] as const;
    const sanitized: Partial<AndroidDaemonPermissions> = {};
    for (const k of ANDROID_ACTIONS) {
      if (k in incoming) sanitized[k] = !!incoming[k];
    }
    try {
      const merged = await setAndroidDaemonPermissions(userId, sanitized);
      res.json({ ok: true, permissions: merged });
    } catch (err) {
      console.error("[channels] android daemon permissions PUT failed:", err);
      res.status(500).json({ error: "failed to update android permissions" });
    }
  });

  // ── Discord routes ──────────────────────────────────────────────────────

  // POST /api/channels/discord/token — save bot token and start gateway
  app.post("/api/channels/discord/token", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { botToken } = req.body || {};
    if (!botToken || typeof botToken !== "string" || botToken.trim().length < 20) {
      return res.status(400).json({ error: "Invalid bot token" });
    }
    try {
      // Persist the token first so startUserBot can retrieve it if needed.
      await saveUserToken({
        userId,
        provider: "discord_bot",
        accessToken: botToken.trim(),
        accountEmail: "",
      });
      try {
        // Start (or restart) the gateway — this validates the token with Discord.
        await startUserBot(userId, botToken.trim());
      } catch (loginErr: any) {
        // Token is invalid or login failed — remove it so it won't be retried on boot.
        await deleteUserToken(userId, "discord_bot").catch(() => {});
        throw loginErr;
      }
      res.json({ ok: true, botStatus: getBotStatus(userId) });
    } catch (err: any) {
      console.error("[channels] discord token save failed:", err);
      res.status(400).json({ ok: false, error: err?.message || "Failed to connect bot — check the token and ensure Message Content + Server Members intents are enabled in the Discord Developer Portal." });
    }
  });

  // POST /api/channels/discord/pair — complete pairing with code from Discord DM
  app.post("/api/channels/discord/pair", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { code } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "code required" });
    }
    const result = await completePairing(userId, code.trim().toUpperCase());
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, discordUsername: result.discordUsername });
  });

  // GET /api/channels/discord/guilds — guilds the bot is currently in
  app.get("/api/channels/discord/guilds", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const guilds = getGuildsForUser(userId);
    res.json({ guilds });
  });

  // GET /api/channels/discord/channels/:guildId — text channels in a guild
  app.get("/api/channels/discord/channels/:guildId", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { guildId } = req.params;
    const channels = await getChannelsForGuild(userId, guildId);
    res.json({ channels });
  });

  // PUT /api/channels/discord/allowlist — add a guild channel to the allowlist
  app.put("/api/channels/discord/allowlist", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { guildId, guildName, channelId, channelName, requireMention } = req.body || {};
    if (!guildId || !channelId) {
      return res.status(400).json({ error: "guildId and channelId required" });
    }
    try {
      const rows = await db
        .select()
        .from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Discord account not linked" });
      const meta = (rows[0].metadata as DiscordLinkMeta) || ({} as DiscordLinkMeta);
      const guilds: AllowlistedGuild[] = meta.allowlistedGuilds || [];
      const existing = guilds.findIndex((g) => g.guildId === guildId && g.channelId === channelId);
      const entry: AllowlistedGuild = {
        guildId,
        guildName: guildName || guildId,
        channelId,
        channelName: channelName || channelId,
        requireMention: requireMention !== false,
      };
      if (existing >= 0) {
        guilds[existing] = entry;
      } else {
        guilds.push(entry);
      }
      await db
        .update(channelLinks)
        .set({ metadata: { ...meta, allowlistedGuilds: guilds } })
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
      res.json({ ok: true, allowlistedGuilds: guilds });
    } catch (err) {
      console.error("[channels] discord allowlist update failed:", err);
      res.status(500).json({ error: "failed to update allowlist" });
    }
  });

  // DELETE /api/channels/discord/allowlist/:guildId/:channelId — remove from allowlist
  app.delete("/api/channels/discord/allowlist/:guildId/:channelId", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { guildId, channelId } = req.params;
    try {
      const rows = await db
        .select()
        .from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Discord account not linked" });
      const meta = (rows[0].metadata as DiscordLinkMeta) || ({} as DiscordLinkMeta);
      const guilds: AllowlistedGuild[] = (meta.allowlistedGuilds || []).filter(
        (g) => !(g.guildId === guildId && g.channelId === channelId),
      );
      await db
        .update(channelLinks)
        .set({ metadata: { ...meta, allowlistedGuilds: guilds } })
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
      res.json({ ok: true, allowlistedGuilds: guilds });
    } catch (err) {
      console.error("[channels] discord allowlist delete failed:", err);
      res.status(500).json({ error: "failed to update allowlist" });
    }
  });

  // POST /api/channels/discord/workspace/setup — create Jarvis Workspace channels in a guild
  app.post("/api/channels/discord/workspace/setup", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { guildId } = req.body as { guildId?: string };
    if (!guildId) return res.status(400).json({ error: "guildId is required" });
    try {
      const result = await setupDiscordWorkspace(userId, guildId);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, workspace: result.workspace, topics: WORKSPACE_TOPICS });
    } catch (err) {
      console.error("[channels] discord workspace setup failed:", err);
      res.status(500).json({ error: "failed to set up workspace" });
    }
  });

  // GET /api/channels/discord/workspace/topics — list all available topics
  app.get("/api/channels/discord/workspace/topics", authMiddleware, (_req: Request, res: Response) => {
    res.json({ topics: WORKSPACE_TOPICS });
  });
}
