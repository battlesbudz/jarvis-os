import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks, channelLinkCodes, telegramLinks, NOTIFICATION_TYPES, CHANNEL_NAMES, userPreferences, type ChannelName, type NotificationType } from "@shared/schema";
import { authMiddleware } from "../auth";
import { getAllPreferences, setPreference, getChannel, listChannels, MUTE_SENTINEL } from "./registry";
import { createDaemonPairingCode, createAndroidDaemonBootstrapToken, isUserPaired, closeUserDaemon, getDaemonPermissions, setDaemonPermissions, isDaemonActionAllowed, DEFAULT_DAEMON_PERMISSIONS, getAndroidDaemonPermissions, setAndroidDaemonPermissions, DEFAULT_ANDROID_DAEMON_PERMISSIONS, isAndroidDaemonActive, isDesktopDaemonActive, sendDaemonOp, subscribeWakeWordTrigger, type DaemonAction, type DaemonPermissions, type AndroidDaemonAction, type AndroidDaemonPermissions } from "../daemon/bridge";
import { startUserBot, stopUserBot, getBotStatus, completePairing, getGuildsForUser, getChannelsForGuild, setupDiscordWorkspace, type AllowlistedGuild, type DiscordLinkMeta, WORKSPACE_TOPICS } from "../discord/manager";
import { saveUserToken, getUserToken, deleteUserToken } from "../userTokenStore";
import { createSchedule, listSchedules, deleteSchedule, toggleSchedule, parseCronExpression, SCHEDULE_TEMPLATES, nextRunTime } from "../discord/schedules";
import { discordPendingApprovals, discordAgents, discordChannelSchedules } from "@shared/schema";
import { getPublicBaseUrl } from "../publicUrl";

function generateCode(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const _p = (v: string | string[]): string => Array.isArray(v) ? (v[0] ?? "") : v;

export function registerChannelRoutes(app: Express): void {
  // GET /api/channels — connection status + preferences
  app.get("/api/channels", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
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
        in_app: true,
        webchat: false,
      };
      const meta: Record<string, unknown> = {};

      const desktopDaemonConnected = isDesktopDaemonActive(userId);
      const androidDaemonConnected = isAndroidDaemonActive(userId);

      for (const row of channelRows) {
        const ch = row.channel as ChannelName;
        if (ch === "daemon") {
          const daemonMeta = row.metadata as any;
          const platform = (daemonMeta?.platform as string | undefined) || "desktop";
          connected.daemon = isUserPaired(userId);
          if (platform === "android") {
            if (!meta.android_daemon) {
              meta.android_daemon = { hostname: daemonMeta?.hostname, lastSeenAt: row.lastSeenAt, connected: androidDaemonConnected };
            }
          } else {
            if (!meta.desktop_daemon) {
              meta.desktop_daemon = { hostname: daemonMeta?.hostname, lastSeenAt: row.lastSeenAt, connected: desktopDaemonConnected };
            }
          }
          // Legacy single meta.daemon field for backwards compat
          if (!meta.daemon) {
            meta.daemon = { hostname: daemonMeta?.hostname, lastSeenAt: row.lastSeenAt, connected: connected.daemon, platform };
          }
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
            sharedBotAvailable: !!process.env.DISCORD_BOT_TOKEN,
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
          sharedBotAvailable: !!process.env.DISCORD_BOT_TOKEN,
        };
      }

      // No per-user token saved, but shared bot is running — still expose the flag
      // so the profile UI can show the correct "Add to Discord" instructions.
      if (!discordTok && !connected.discord && process.env.DISCORD_BOT_TOKEN) {
        meta.discord = { hasBotToken: false, isPaired: false, sharedBotAvailable: true };
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
        desktop_daemon_connected: desktopDaemonConnected,
        android_daemon_connected: androidDaemonConnected,
      });
    } catch (err) {
      console.error("[channels] GET /api/channels failed:", err);
      res.status(500).json({ error: "failed to load channel state" });
    }
  });

  // PUT /api/channels/preferences — body: { notificationType, channels: ChannelName[] | ["__muted__"] }
  app.put("/api/channels/preferences", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { notificationType, channels } = req.body || {};
    if (!NOTIFICATION_TYPES.includes(notificationType)) {
      return res.status(400).json({ error: "invalid notificationType" });
    }
    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: "invalid channels" });
    }
    // Allow the mute sentinel; all other values must be valid ChannelNames
    const isMute = channels.length === 1 && channels[0] === MUTE_SENTINEL;
    if (!isMute && channels.some((c: string) => !CHANNEL_NAMES.includes(c as ChannelName))) {
      return res.status(400).json({ error: "invalid channels" });
    }
    try {
      if (!isMute) {
        // Validate that all selected channels are actually connected for this user
        const [tgRows, chRows] = await Promise.all([
          db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1).catch(() => []),
          db.select({ channel: channelLinks.channel }).from(channelLinks).where(eq(channelLinks.userId, userId)).catch(() => []),
        ]);
        const connectedSet = new Set<ChannelName>(["in_app"]);
        if (tgRows.length > 0) connectedSet.add("telegram");
        for (const row of chRows) {
          const ch = row.channel as ChannelName;
          if (ch === "daemon") { if (isUserPaired(userId)) connectedSet.add("daemon"); }
          else if (CHANNEL_NAMES.includes(ch)) connectedSet.add(ch);
        }
        const disconnected = channels.filter((c: string) => !connectedSet.has(c as ChannelName));
        if (disconnected.length > 0) {
          return res.status(400).json({ error: `channels not connected: ${disconnected.join(", ")} — connect them first in Profile` });
        }
      }
      const unique = isMute ? [MUTE_SENTINEL] : ([...new Set(channels)] as ChannelName[]);
      await setPreference(userId, notificationType as NotificationType, unique as ChannelName[]);
      res.json({ ok: true, notificationType, channels: unique, muted: isMute });
    } catch (err) {
      console.error("[channels] preference update failed:", err);
      res.status(500).json({ error: "failed to update preference" });
    }
  });

  // GET /api/notification-routing — returns all current routing preferences
  app.get("/api/notification-routing", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const prefs = await getAllPreferences(userId);
      res.json({ notificationTypes: NOTIFICATION_TYPES, channels: CHANNEL_NAMES, preferences: prefs });
    } catch (err) {
      console.error("[channels] GET /api/notification-routing failed:", err);
      res.status(500).json({ error: "failed to load routing preferences" });
    }
  });

  // PATCH /api/notification-routing — bulk update; body: { preferences: Record<NotificationType, ChannelName[]> }
  app.patch("/api/notification-routing", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const incoming = (req.body?.preferences || {}) as Record<string, string[]>;
    const errors: string[] = [];
    const saved: Record<string, string[]> = {};

    // Determine which channels are actually connected for this user
    const [tgRows, chRows] = await Promise.all([
      db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1).catch(() => []),
      db.select({ channel: channelLinks.channel }).from(channelLinks).where(eq(channelLinks.userId, userId)).catch(() => []),
    ]);
    const connectedSet = new Set<ChannelName>();
    connectedSet.add("in_app"); // always available
    if (tgRows.length > 0) connectedSet.add("telegram");
    for (const row of chRows) {
      const ch = row.channel as ChannelName;
      if (ch === "daemon") {
        if (isUserPaired(userId)) connectedSet.add("daemon");
      } else if (CHANNEL_NAMES.includes(ch)) {
        connectedSet.add(ch);
      }
    }

    for (const [nt, chs] of Object.entries(incoming)) {
      if (!NOTIFICATION_TYPES.includes(nt as typeof NOTIFICATION_TYPES[number])) {
        errors.push(`unknown notificationType: ${nt}`);
        continue;
      }
      if (!Array.isArray(chs)) {
        errors.push(`invalid channels for ${nt}`);
        continue;
      }
      const isMute = chs.length === 1 && chs[0] === MUTE_SENTINEL;
      if (!isMute && chs.some((c) => !CHANNEL_NAMES.includes(c as typeof CHANNEL_NAMES[number]))) {
        errors.push(`invalid channels for ${nt}`);
        continue;
      }
      if (!isMute) {
        const disconnected = chs.filter((c) => !connectedSet.has(c as ChannelName));
        if (disconnected.length > 0) {
          errors.push(`channels not connected for ${nt}: ${disconnected.join(", ")} — connect them first in Profile`);
          continue;
        }
      }
      const unique = isMute ? [MUTE_SENTINEL] : ([...new Set(chs)] as ChannelName[]);
      try {
        await setPreference(userId, nt as NotificationType, unique as ChannelName[]);
        saved[nt] = unique;
      } catch (err) {
        errors.push(`failed to save ${nt}`);
      }
    }

    const prefs = await getAllPreferences(userId).catch(() => ({}));
    res.json({ ok: errors.length === 0, saved, errors, preferences: prefs });
  });

  // POST /api/channels/whatsapp/code — generate link code; user texts it from WhatsApp
  app.post("/api/channels/whatsapp/code", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
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

  // DELETE /api/channels/desktop-daemon — unlink only the desktop daemon
  app.delete("/api/channels/desktop-daemon", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      closeUserDaemon(userId, "desktop");
      // Remove only the desktop daemon DB row (platform === "desktop" or no platform)
      const rows = await db.select().from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
      for (const row of rows) {
        const meta = (row.metadata as Record<string, unknown> | null) || {};
        const p = (meta.platform as string | undefined) || "desktop";
        if (p === "desktop") {
          await db.delete(channelLinks).where(eq(channelLinks.id, row.id));
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[channels] desktop-daemon unlink failed:", err);
      res.status(500).json({ error: "failed to unlink desktop daemon" });
    }
  });

  // DELETE /api/channels/android-daemon — unlink only the android daemon
  app.delete("/api/channels/android-daemon", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      closeUserDaemon(userId, "android");
      // Remove only the android daemon DB row
      const rows = await db.select().from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
      for (const row of rows) {
        const meta = (row.metadata as Record<string, unknown> | null) || {};
        const p = (meta.platform as string | undefined) || "desktop";
        if (p === "android") {
          await db.delete(channelLinks).where(eq(channelLinks.id, row.id));
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[channels] android-daemon unlink failed:", err);
      res.status(500).json({ error: "failed to unlink android daemon" });
    }
  });

  // DELETE /api/channels/:channel — unlink
  app.delete("/api/channels/:channel", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const channel = _p(req.params.channel) as ChannelName;
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
    const userId = req.userId!;
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
    const userId = req.userId!;
    const incoming = (req.body?.permissions || {}) as Record<string, unknown>;
    const ACTIONS: readonly DaemonAction[] = ["shell", "notify", "file_read", "file_write", "file_list", "desktop_screenshot", "desktop_read_screen", "browser_local", "allow_outside_root"] as const;
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
    const userId = req.userId!;
    try {
      const code = await createDaemonPairingCode(userId);
      res.json({ code, expiresInSec: 15 * 60 });
    } catch (err) {
      console.error("[channels] daemon code failed:", err);
      res.status(500).json({ error: "failed to generate pairing code" });
    }
  });

  // POST /api/channels/android-daemon/bootstrap — authenticated in-app token for this phone
  app.post("/api/channels/android-daemon/bootstrap", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const bootstrapToken = await createAndroidDaemonBootstrapToken(userId);
      res.json({ bootstrapToken, expiresInSec: 5 * 60 });
    } catch (err) {
      console.error("[channels] android daemon bootstrap failed:", err);
      res.status(500).json({ error: "failed to create Android daemon bootstrap token" });
    }
  });

  // POST /api/channels/daemon/exec — agent / user can run a daemon op
  // Desktop-daemon ops only: shell | file_read | file_write | file_list | notify
  // Android ops (android_*) are routed exclusively via the agent daemon_action tool;
  // bridge-layer gating in sendDaemonOp rejects android_* ops sent here.
  app.post("/api/channels/daemon/exec", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
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
    const userId = req.userId!;
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
    const userId = req.userId!;
    const incoming = (req.body?.permissions || {}) as Record<string, unknown>;
    const ANDROID_ACTIONS: readonly AndroidDaemonAction[] = [
      "android_screenshot", "android_read_screen", "android_open_app", "android_browse",
      "android_file_list", "android_file_read", "android_tap_type",
      "android_camera", "android_location", "android_sms", "android_screen_record",
      "android_local_model",
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
    const userId = req.userId!;
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

  // GET /api/channels/discord/interactions-config — return the interactions URL and public-key status
  // Used by the Profile screen to show the slash-command setup instructions.
  app.get("/api/channels/discord/interactions-config", authMiddleware, (req: Request, res: Response) => {
    const interactionsUrl = `${getPublicBaseUrl(req)}/api/discord/interactions`;
    const publicKeyConfigured = !!process.env.DISCORD_PUBLIC_KEY;
    res.json({ interactionsUrl, publicKeyConfigured });
  });

  // POST /api/channels/discord/pair — complete pairing with code from Discord DM
  app.post("/api/channels/discord/pair", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
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
    const userId = req.userId!;
    const guilds = getGuildsForUser(userId);
    res.json({ guilds });
  });

  // GET /api/channels/discord/channels/:guildId — text channels in a guild
  app.get("/api/channels/discord/channels/:guildId", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const guildId = _p(req.params.guildId);
    const channels = await getChannelsForGuild(userId, guildId);
    res.json({ channels });
  });

  // PUT /api/channels/discord/allowlist — add a guild channel to the allowlist
  app.put("/api/channels/discord/allowlist", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
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
    const userId = req.userId!;
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
    const userId = req.userId!;
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

  // ── Discord OS: channel schedules ──────────────────────────────────────────

  // GET /api/discord/schedules — list all schedules, enriched with nextRun
  app.get("/api/discord/schedules", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const raw = await listSchedules(userId);
      const schedules = raw.map((s) => ({
        ...s,
        nextRun: nextRunTime(s.cronExpression) ?? null,
      }));
      res.json({ schedules, templates: SCHEDULE_TEMPLATES });
    } catch (err) {
      console.error("[channels] discord schedules list failed:", err);
      res.status(500).json({ error: "Failed to list schedules" });
    }
  });

  // POST /api/discord/schedules — create a new schedule
  app.post("/api/discord/schedules", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { guildId, channelId, channelName, label, cronExpression, scheduleTime, prompt, pipelineNext } = req.body || {};
    if (!channelName || !label || !prompt) {
      return res.status(400).json({ error: "channelName, label, and prompt are required" });
    }
    try {
      const resolvedCron = cronExpression
        || (scheduleTime ? parseCronExpression(scheduleTime) : null)
        || "0 7 * * *";
      const schedule = await createSchedule(userId, {
        guildId: guildId ?? undefined,
        channelId: channelId ?? undefined,
        channelName,
        label,
        cronExpression: resolvedCron,
        prompt,
        pipelineNext: pipelineNext ?? undefined,
      });
      res.json({ ok: true, schedule });
    } catch (err) {
      console.error("[channels] discord schedule create failed:", err);
      res.status(500).json({ error: "Failed to create schedule" });
    }
  });

  // PATCH /api/discord/schedules/:id — update enabled status and/or prompt
  app.patch("/api/discord/schedules/:id", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = _p(req.params.id);
    const { enabled, prompt, cronExpression } = req.body || {};
    try {
      if (enabled !== undefined) {
        await toggleSchedule(userId, id, enabled === true || enabled === "true");
      }
      if (prompt !== undefined || cronExpression !== undefined) {
        const updates: Record<string, any> = {};
        if (typeof prompt === "string" && prompt.trim()) updates.prompt = prompt.trim();
        if (typeof cronExpression === "string" && cronExpression.trim()) updates.cronExpression = cronExpression.trim();
        if (Object.keys(updates).length > 0) {
          const { db } = await import("../db");
          const { discordChannelSchedules } = await import("@shared/schema");
          const { eq, and } = await import("drizzle-orm");
          await db
            .update(discordChannelSchedules)
            .set(updates)
            .where(and(eq(discordChannelSchedules.id, id), eq(discordChannelSchedules.userId, userId)));
        }
      }
      const schedules = await listSchedules(userId);
      const updated = schedules.find((s) => s.id === id);
      res.json({ ok: true, schedule: updated ?? null });
    } catch (err) {
      console.error("[channels] discord schedule update failed:", err);
      res.status(500).json({ error: "Failed to update schedule" });
    }
  });

  // DELETE /api/discord/schedules/:id — remove a schedule
  app.delete("/api/discord/schedules/:id", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = _p(req.params.id);
    try {
      const deleted = await deleteSchedule(userId, id);
      res.json({ ok: deleted });
    } catch (err) {
      console.error("[channels] discord schedule delete failed:", err);
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  // POST /api/discord/schedules/:id/toggle — enable or disable a schedule (app toggle button)
  app.post("/api/discord/schedules/:id/toggle", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = _p(req.params.id);
    const { enabled } = req.body || {};
    try {
      await toggleSchedule(userId, id, enabled === true || enabled === "true");
      const schedules = await listSchedules(userId);
      const updated = schedules.find((s) => s.id === id);
      res.json({ ok: true, schedule: updated ? { ...updated, nextRun: nextRunTime(updated.cronExpression) } : null });
    } catch (err) {
      console.error("[channels] discord schedule toggle failed:", err);
      res.status(500).json({ error: "Failed to toggle schedule" });
    }
  });

  // ── Discord OS: approvals ──────────────────────────────────────────────────

  // GET /api/discord/approvals — list pending approval items
  app.get("/api/discord/approvals", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const approvals = await db
        .select()
        .from(discordPendingApprovals)
        .where(
          and(
            eq(discordPendingApprovals.userId, userId),
            eq(discordPendingApprovals.status, "pending"),
          ),
        );
      res.json({ approvals });
    } catch (err) {
      console.error("[channels] discord approvals list failed:", err);
      res.status(500).json({ error: "Failed to list approvals" });
    }
  });

  // POST /api/discord/approvals/:messageId/resolve — approve or reject from the app
  app.post("/api/discord/approvals/:messageId/resolve", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const messageId = _p(req.params.messageId);
    const { action } = req.body || {};

    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }

    try {
      const rows = await db
        .select()
        .from(discordPendingApprovals)
        .where(
          and(
            eq(discordPendingApprovals.messageId, messageId),
            eq(discordPendingApprovals.userId, userId),
            eq(discordPendingApprovals.status, "pending"),
          ),
        )
        .limit(1);

      if (!rows[0]) return res.status(404).json({ error: "Approval not found or already resolved" });
      const approval = rows[0];

      const newStatus = action === "approve" ? "approved" : "rejected";
      await db
        .update(discordPendingApprovals)
        .set({ status: newStatus, resolvedAt: new Date() })
        .where(eq(discordPendingApprovals.messageId, messageId));

      // Record preference signal
      const { recordApprovalSignal } = await import("../discord/approvalLearning");
      recordApprovalSignal({
        userId,
        approved: action === "approve",
        contentType: approval.type,
        content: approval.content,
        channelId: approval.channelId,
        messageId,
      }).catch(() => {});

      // Execute action asynchronously
      const actionData = action === "approve" ? approval.onApprove : approval.onReject;
      if (actionData) {
        const { executeApprovalAction } = await import("../discord/approvalActions");
        executeApprovalAction(
          userId,
          actionData as any,
          approval.content,
          approval.channelId,
        ).catch((err) => console.error("[channels] approval action failed:", err));
      }

      res.json({ ok: true, status: newStatus });
    } catch (err) {
      console.error("[channels] discord approval resolve failed:", err);
      res.status(500).json({ error: "Failed to resolve approval" });
    }
  });

  // ── Discord OS: named agents ───────────────────────────────────────────────

  // GET /api/discord/agents — list all named agents
  app.get("/api/discord/agents", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const agents = await db
        .select()
        .from(discordAgents)
        .where(eq(discordAgents.userId, userId));
      res.json({ agents });
    } catch (err) {
      console.error("[channels] discord agents list failed:", err);
      res.status(500).json({ error: "Failed to list agents" });
    }
  });

  // POST /api/discord/agents/:id/toggle — enable or disable an agent's loop
  app.post("/api/discord/agents/:id/toggle", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = _p(req.params.id);
    const { loopEnabled } = req.body || {};
    try {
      await db
        .update(discordAgents)
        .set({ loopEnabled: loopEnabled ? 1 : 0 })
        .where(and(eq(discordAgents.id, id), eq(discordAgents.userId, userId)));
      const rows = await db.select().from(discordAgents).where(eq(discordAgents.id, id)).limit(1);
      res.json({ ok: true, agent: rows[0] ?? null });
    } catch (err) {
      console.error("[channels] discord agent toggle failed:", err);
      res.status(500).json({ error: "Failed to toggle agent loop" });
    }
  });

  // ── Discord OS: activity feed ─────────────────────────────────────────────

  // GET /api/discord/activity — chronological feed of recent agent/schedule activity
  app.get("/api/discord/activity", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const [schedules, agents] = await Promise.all([
        db.select().from(discordChannelSchedules).where(eq(discordChannelSchedules.userId, userId)),
        db.select().from(discordAgents).where(eq(discordAgents.userId, userId)),
      ]);

      const items: { id: string; createdAt: Date; content: string; direction: string }[] = [];

      for (const s of schedules) {
        if (s.lastRun && s.lastOutput) {
          items.push({
            id: `sched-${s.id}`,
            createdAt: s.lastRun,
            content: `📅 ${s.label}: ${s.lastOutput.slice(0, 120)}${s.lastOutput.length > 120 ? "…" : ""}`,
            direction: `#${s.channelName}`,
          });
        }
      }

      for (const a of agents) {
        if (a.lastLoopRun) {
          items.push({
            id: `agent-${a.id}`,
            createdAt: a.lastLoopRun,
            content: `🤖 ${a.name} (${a.role}) loop ran`,
            direction: `#${a.channelName ?? a.name.toLowerCase()}`,
          });
        }
      }

      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      res.json({ activity: items.slice(0, 20) });
    } catch (err) {
      console.error("[channels] discord activity failed:", err);
      res.status(500).json({ error: "Failed to get activity" });
    }
  });

  // ── Voice / Wake Word Settings ────────────────────────────────────────────

  app.get("/api/voice/wake-settings", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
      const prefs = (rows[0]?.data ?? {}) as Record<string, any>;
      res.json({
        wakeWordEnabled: prefs.wakeWordEnabled ?? false,
        talkModeEnabled: prefs.talkModeEnabled ?? false,
        wakeWords: prefs.wakeWords ?? ["hey jarvis", "jarvis", "computer"],
      });
    } catch (err) {
      console.error("[voice] get wake-settings failed:", err);
      res.status(500).json({ error: "Failed to get wake settings" });
    }
  });

  app.put("/api/voice/wake-settings", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { wakeWordEnabled, talkModeEnabled, wakeWords } = req.body as {
      wakeWordEnabled?: boolean;
      talkModeEnabled?: boolean;
      wakeWords?: string[];
    };
    try {
      const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
      const existing = (rows[0]?.data ?? {}) as Record<string, any>;
      const updated = {
        ...existing,
        ...(wakeWordEnabled !== undefined && { wakeWordEnabled }),
        ...(talkModeEnabled !== undefined && { talkModeEnabled }),
        ...(wakeWords !== undefined && { wakeWords }),
      };
      await db.insert(userPreferences)
        .values({ userId, data: updated })
        .onConflictDoUpdate({ target: userPreferences.userId, set: { data: updated } });

      const result = {
        wakeWordEnabled: updated.wakeWordEnabled ?? false,
        talkModeEnabled: updated.talkModeEnabled ?? false,
        wakeWords: updated.wakeWords ?? ["hey jarvis", "jarvis", "computer"],
      };

      // Sync to Android daemon if connected — fire-and-forget
      if (isAndroidDaemonActive(userId)) {
        if (wakeWordEnabled !== undefined || wakeWords !== undefined) {
          sendDaemonOp(userId, {
            type: "voice_set_wake_words",
            enabled: result.wakeWordEnabled,
            words: result.wakeWords,
            talkMode: result.talkModeEnabled,
          }, 5000).catch((e: unknown) => console.error("[voice] daemon sync error:", e));
        } else if (talkModeEnabled !== undefined) {
          sendDaemonOp(userId, {
            type: "voice_set_talk_mode",
            enabled: result.talkModeEnabled,
          }, 5000).catch((e: unknown) => console.error("[voice] daemon sync error:", e));
        }
      }

      res.json(result);
    } catch (err) {
      console.error("[voice] put wake-settings failed:", err);
      res.status(500).json({ error: "Failed to save wake settings" });
    }
  });

  // Mobile app notifies server that TTS playback finished — server relays to Android daemon for Talk Mode re-arm
  app.post("/api/voice/tts-done", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      if (isAndroidDaemonActive(userId)) {
        sendDaemonOp(userId, { type: "voice_tts_finished" }, 3000)
          .catch((e: unknown) => console.error("[voice] tts-done daemon relay failed:", e));
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[voice] tts-done failed:", err);
      res.status(500).json({ error: "Failed to relay tts-done" });
    }
  });

  // SSE endpoint — mobile app subscribes to wake word trigger events
  app.get("/api/voice/wake-events", authMiddleware, (req: Request, res: Response) => {
    const userId = req.userId!;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Keep-alive ping every 25 s so hosting proxies do not close the connection
    const keepalive = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(keepalive); }
    }, 25000);

    const unsubscribe = subscribeWakeWordTrigger(userId, (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        unsubscribe();
        clearInterval(keepalive);
      }
    });

    req.on("close", () => {
      unsubscribe();
      clearInterval(keepalive);
    });
  });
}
