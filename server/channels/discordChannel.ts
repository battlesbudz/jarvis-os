import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import { getUserToken } from "../userTokenStore";
import { getBotStatus, sendToDiscordUser, sendFileToDiscordUser } from "../discord/manager";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";

export const discordChannel: Channel = {
  name: "discord",
  // Research, posting, and document export — covers web search, Discord
  // management, and PDF/PPTX export tools.
  toolGroups: ["research", "discord", "memory", "documents"],

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
    let anySent = false;

    if (text?.trim()) {
      const sent = await sendToDiscordUser(userId, text);
      if (!sent) return { ok: false, error: "Discord send failed — bot not running or user not linked" };
      anySent = true;
    }

    for (const att of opts.attachments || []) {
      if (att.kind === "document") {
        const fileContent = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
        const sent = await sendFileToDiscordUser(userId, att.filename, fileContent, att.caption);
        if (sent) anySent = true;
        else console.warn(`[discordChannel] file send failed for user ${userId}: ${att.filename}`);
      }
    }

    if (!anySent && !text?.trim()) return { ok: true };
    return { ok: true };
  },
};
