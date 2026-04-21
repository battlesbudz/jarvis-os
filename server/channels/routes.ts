import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks, channelLinkCodes, telegramLinks, NOTIFICATION_TYPES, CHANNEL_NAMES, type ChannelName, type NotificationType } from "@shared/schema";
import { authMiddleware } from "../auth";
import { getAllPreferences, setPreference, getChannel, listChannels } from "./registry";
import { createDaemonPairingCode, isUserPaired } from "../daemon/bridge";

function generateCode(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function registerChannelRoutes(app: Express): void {
  // GET /api/channels — connection status + preferences
  app.get("/api/channels", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    try {
      const [tgRows, channelRows, prefs] = await Promise.all([
        db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1),
        db.select().from(channelLinks).where(eq(channelLinks.userId, userId)),
        getAllPreferences(userId),
      ]);

      const connected: Record<ChannelName, boolean> = {
        telegram: tgRows.length > 0,
        whatsapp: false,
        slack: false,
        daemon: false,
      };
      const meta: Record<string, unknown> = {};

      for (const row of channelRows) {
        const ch = row.channel as ChannelName;
        if (ch === "daemon") {
          connected.daemon = isUserPaired(userId);
          meta.daemon = { hostname: (row.metadata as any)?.hostname, lastSeenAt: row.lastSeenAt, connected: connected.daemon };
        } else if (CHANNEL_NAMES.includes(ch)) {
          connected[ch] = true;
          if (ch === "whatsapp") meta.whatsapp = { phone: row.address, lastSeenAt: row.lastSeenAt };
          if (ch === "slack") meta.slack = { teamId: (row.metadata as any)?.teamId, lastSeenAt: row.lastSeenAt };
        }
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
    const userId = (req as any).user.id;
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
    const userId = (req as any).user.id;
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
    const userId = (req as any).user.id;
    const channel = req.params.channel as ChannelName;
    if (!CHANNEL_NAMES.includes(channel) || channel === "telegram") {
      return res.status(400).json({ error: "channel not unlinkable here" });
    }
    try {
      await db.delete(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, channel)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[channels] unlink failed:", err);
      res.status(500).json({ error: "failed to unlink" });
    }
  });

  // POST /api/channels/daemon/code — generate pairing code for desktop daemon
  app.post("/api/channels/daemon/code", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    try {
      const code = await createDaemonPairingCode(userId);
      res.json({ code, expiresInSec: 15 * 60 });
    } catch (err) {
      console.error("[channels] daemon code failed:", err);
      res.status(500).json({ error: "failed to generate pairing code" });
    }
  });

  // POST /api/channels/daemon/exec — agent / user can run a daemon op
  // Allowed types: shell | file_read | file_write | file_list | notify
  app.post("/api/channels/daemon/exec", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { sendDaemonOp, isUserPaired: paired } = await import("../daemon/bridge");
    if (!paired(userId)) return res.status(409).json({ ok: false, error: "daemon not connected" });
    const { op } = req.body || {};
    const allowed = ["shell", "file_read", "file_write", "file_list", "notify"];
    if (!op || !allowed.includes(op.type)) {
      return res.status(400).json({ ok: false, error: "invalid op" });
    }
    const result = await sendDaemonOp(userId, op, 30000);
    res.json(result);
  });
}
