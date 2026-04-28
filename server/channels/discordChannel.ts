import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import { getUserToken } from "../userTokenStore";
import { getBotStatus, sendToDiscordUser, sendFileToDiscordUser } from "../discord/manager";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { attachmentToBuffer, collectMarkdownExtras, imageFilename } from "./attachmentHelpers";

const DISCORD_ACTIVE_TTL_MS = 3 * 60 * 1000; // 3 minutes

async function isDiscordRecentlyActive(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ lastSeenAt: channelLinks.lastSeenAt })
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
      .limit(1);
    const ts = rows[0]?.lastSeenAt;
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() < DISCORD_ACTIVE_TTL_MS;
  } catch {
    return false;
  }
}

export const discordChannel: Channel = {
  name: "discord",
  // Research, posting, document export, and media generation — covers web search,
  // Discord management, PDF/PPTX export, and image/video generation tools.
  toolGroups: ["research", "discord", "memory", "documents", "scheduling", "media", "self_edit"],

  isConfigured(): boolean {
    return true; // each user has their own bot token — always "configured" at system level
  },

  async isLinkedFor(userId: string): Promise<boolean> {
    try {
      const [tok, link] = await Promise.all([
        getUserToken(userId, "discord_bot"),
        db
          .select({ id: channelLinks.id })
          .from(channelLinks)
          .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
          .limit(1),
      ]);
      return !!(tok && link.length > 0 && getBotStatus(userId) === "running");
    } catch {
      return false;
    }
  },

  async sendMessage(userId: string, text: string, opts: ChannelSendOpts = {}): Promise<ChannelSendResult> {
    // Low-urgency callers (e.g. Curiosity scanner) set skipIfDiscordActive so
    // that background notifications don't interrupt an ongoing conversation.
    // notifyUser's fallback will reroute to in-app instead.
    if (opts.skipIfDiscordActive && await isDiscordRecentlyActive(userId)) {
      return { ok: false, error: "user_active_in_discord" };
    }

    const attachments = opts.attachments || [];

    // Append markdown attachments to the text message
    const markdownExtra = collectMarkdownExtras(attachments);
    const fullText = markdownExtra ? (text ? `${text}\n\n${markdownExtra}` : markdownExtra) : text;

    let anySent = false;

    if (fullText?.trim()) {
      const sent = await sendToDiscordUser(userId, fullText);
      if (!sent) return { ok: false, error: "Discord send failed — bot not running or user not linked" };
      anySent = true;
    }

    for (const att of attachments) {
      if (att.kind === "document") {
        const fileContent = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
        const sent = await sendFileToDiscordUser(userId, att.filename, fileContent, att.caption);
        if (sent) anySent = true;
        else console.warn(`[discordChannel] file send failed for user ${userId}: ${att.filename}`);
      } else if (att.kind === "image") {
        const buf = await attachmentToBuffer(att).catch(() => null);
        if (buf) {
          const sent = await sendFileToDiscordUser(userId, imageFilename(att.mimeType), buf, att.caption);
          if (sent) anySent = true;
          else console.warn(`[discordChannel] image send failed for user ${userId}`);
        } else {
          console.warn(`[discordChannel] image attachment had no usable source for user ${userId} — skipping`);
        }
      } else if (att.kind === "file") {
        const buf = await attachmentToBuffer(att).catch(() => null);
        if (buf) {
          const sent = await sendFileToDiscordUser(userId, att.filename, buf, att.caption);
          if (sent) anySent = true;
          else console.warn(`[discordChannel] file send failed for user ${userId}: ${att.filename}`);
        } else {
          console.warn(`[discordChannel] file attachment ${att.filename} had no usable source for user ${userId} — skipping`);
        }
      }
      // markdown already merged into fullText above
    }

    if (!anySent && !fullText?.trim()) return { ok: true };
    return { ok: true };
  },
};
