import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { isUserPaired, sendDaemonOp, isDaemonActionAllowed } from "../daemon/bridge";

async function lookupDaemon(userId: string): Promise<boolean> {
  try {
    const rows = await db.select({ id: channelLinks.id })
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.error("[daemonChannel] link lookup failed:", err);
    return false;
  }
}

export const daemonChannel: Channel = {
  name: "daemon",
  // Desktop automation channel — needs system commands, task/calendar management.
  toolGroups: ["coaching", "calendar", "memory", "connections", "scheduling", "system"],
  isConfigured: () => true,
  async isLinkedFor(userId) {
    return (await lookupDaemon(userId)) && isUserPaired(userId);
  },
  async sendMessage(userId, text, _opts: ChannelSendOpts = {}) {
    if (!isUserPaired(userId)) return { ok: false, error: "daemon not connected" };
    // Per-action permission gate: notifications must be explicitly allowed
    // (default ON) so a user that disabled notify sees no desktop popups
    // even when this channel is selected for a notification type.
    if (!(await isDaemonActionAllowed(userId, "notify"))) {
      return { ok: false, error: "daemon notify permission disabled by user" };
    }
    try {
      const title = "GamePlan Coach";
      const result = await sendDaemonOp(userId, { type: "notify", title, body: text }, 5000);
      if (!result.ok) return { ok: false, error: result.error || "daemon notify failed" };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
