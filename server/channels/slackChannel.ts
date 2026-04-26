import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import { getUserToken } from "../userTokenStore";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";

interface SlackLinkMeta {
  teamId?: string;
  slackUserId?: string;
  imChannelId?: string;
}

export async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || "slack error" };
    return { ok: true, ts: data.ts };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function openSlackDm(botToken: string, slackUserId: string): Promise<string | null> {
  try {
    const res = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ users: slackUserId }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("[slackChannel] conversations.open failed:", data.error);
      return null;
    }
    return data.channel?.id ?? null;
  } catch (err) {
    console.error("[slackChannel] conversations.open exception:", err);
    return null;
  }
}

async function lookupLink(userId: string): Promise<{ address: string; meta: SlackLinkMeta } | null> {
  try {
    const rows = await db.select()
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "slack")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { address: row.address, meta: (row.metadata as SlackLinkMeta) || {} };
  } catch (err) {
    console.error("[slackChannel] link lookup failed:", err);
    return null;
  }
}

export async function getSlackBotToken(userId: string): Promise<string | null> {
  const tok = await getUserToken(userId, "slack");
  return tok?.accessToken ?? null;
}

export const slackChannel: Channel = {
  name: "slack",
  // Coaching + comms — task/calendar/email management over Slack DM.
  toolGroups: ["coaching", "calendar", "email", "memory", "connections"],
  // "Configured" if any user has a slack OAuth — we check on demand per user.
  isConfigured: () => true,
  async isLinkedFor(userId) {
    const link = await lookupLink(userId);
    if (!link) return false;
    const tok = await getSlackBotToken(userId);
    return !!tok;
  },
  async sendMessage(userId, text, opts: ChannelSendOpts = {}) {
    const link = await lookupLink(userId);
    if (!link) return { ok: false, error: "no slack link" };
    const botToken = await getSlackBotToken(userId);
    if (!botToken) return { ok: false, error: "no slack bot token" };

    let target = link.meta.imChannelId;
    if (!target && link.meta.slackUserId) {
      target = (await openSlackDm(botToken, link.meta.slackUserId)) || undefined;
      if (target) {
        await db.update(channelLinks)
          .set({ metadata: { ...link.meta, imChannelId: target } })
          .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "slack")));
      }
    }
    if (!target) target = link.address;

    let body = text || "";
    if (opts.attachments && opts.attachments.length > 0) {
      body = body
        ? `${body}\n\n_(${opts.attachments.length} attachment(s) generated — open the GamePlan app to download.)_`
        : `_(${opts.attachments.length} attachment(s) generated — open the GamePlan app to download.)_`;
    }
    const result = await postSlackMessage(botToken, target, body);
    return { ok: result.ok, messageId: result.ts, error: result.error };
  },
};
