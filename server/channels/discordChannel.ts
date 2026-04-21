import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import { getUserToken } from "../userTokenStore";
import { getBotStatus, sendToDiscordUser } from "../discord/manager";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";

export const discordChannel: Channel = {
  name: "discord",

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

  async sendMessage(userId: string, text: string, _opts: ChannelSendOpts = {}): Promise<ChannelSendResult> {
    if (!text?.trim()) return { ok: true };
    const sent = await sendToDiscordUser(userId, text);
    if (!sent) return { ok: false, error: "Discord send failed — bot not running or user not linked" };
    return { ok: true };
  },
};
