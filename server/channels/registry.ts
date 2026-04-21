import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelPreferences, type ChannelName, type NotificationType } from "@shared/schema";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { logInteraction } from "../interactionLog";

const channels = new Map<ChannelName, Channel>();

export function registerChannel(channel: Channel): void {
  channels.set(channel.name, channel);
}

export function getChannel(name: ChannelName): Channel | undefined {
  return channels.get(name);
}

export function listChannels(): Channel[] {
  return Array.from(channels.values());
}

const DEFAULT_FALLBACK: ChannelName[] = ["telegram"];

export async function getActiveChannelsFor(
  userId: string,
  notificationType: NotificationType,
): Promise<ChannelName[]> {
  try {
    const rows = await db.select()
      .from(channelPreferences)
      .where(and(
        eq(channelPreferences.userId, userId),
        eq(channelPreferences.notificationType, notificationType),
      ))
      .limit(1);
    const prefs = rows[0]?.channels as ChannelName[] | undefined;
    if (prefs && prefs.length > 0) return prefs;
  } catch (err) {
    console.error("[channels] preference lookup failed:", err);
  }
  return DEFAULT_FALLBACK;
}

export async function getAllPreferences(userId: string): Promise<Record<NotificationType, ChannelName[]>> {
  const out: Record<string, ChannelName[]> = {};
  try {
    const rows = await db.select()
      .from(channelPreferences)
      .where(eq(channelPreferences.userId, userId));
    for (const r of rows) {
      out[r.notificationType] = (r.channels as ChannelName[]) || [];
    }
  } catch (err) {
    console.error("[channels] getAllPreferences failed:", err);
  }
  return out as Record<NotificationType, ChannelName[]>;
}

export async function setPreference(
  userId: string,
  notificationType: NotificationType,
  selected: ChannelName[],
): Promise<void> {
  await db.insert(channelPreferences)
    .values({ userId, notificationType, channels: selected, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [channelPreferences.userId, channelPreferences.notificationType],
      set: { channels: selected, updatedAt: new Date() },
    });
}

async function trySendOnChannel(
  userId: string,
  name: ChannelName,
  text: string,
  opts: ChannelSendOpts,
  notificationType: NotificationType,
): Promise<{ channel: ChannelName; result: ChannelSendResult }> {
  const ch = channels.get(name);
  if (!ch) return { channel: name, result: { ok: false, error: "channel not registered" } };
  if (!ch.isConfigured()) return { channel: name, result: { ok: false, error: "channel not configured" } };
  if (!(await ch.isLinkedFor(userId))) return { channel: name, result: { ok: false, error: "user not linked" } };
  try {
    const result = await ch.sendMessage(userId, text, { ...opts, notificationType });
    if (result.ok) logInteraction(userId, name, "outbound", text).catch(() => {});
    return { channel: name, result };
  } catch (err) {
    console.error(`[channels] ${name} send failed:`, err);
    return { channel: name, result: { ok: false, error: String(err) } };
  }
}

// Send a message to whichever channels the user has selected for this
// notification type. Sends to every selected channel in parallel.
// Resilient fallback: if every selected channel failed/missing, walks
// telegram → other configured channels in registration order so a stale
// preference (e.g. WhatsApp unlinked) never silently drops a notification.
export async function notifyUser(
  userId: string,
  notificationType: NotificationType,
  text: string,
  opts: ChannelSendOpts = {},
): Promise<{ channel: ChannelName; result: ChannelSendResult }[]> {
  const targets = await getActiveChannelsFor(userId, notificationType);
  const results = await Promise.all(
    targets.map((name) => trySendOnChannel(userId, name, text, opts, notificationType)),
  );

  if (results.some((r) => r.result.ok)) return results;

  const tried = new Set<ChannelName>(targets);
  const fallbackOrder: ChannelName[] = [
    "telegram",
    ...listChannels().map((c) => c.name).filter((n) => n !== "telegram"),
  ];
  for (const name of fallbackOrder) {
    if (tried.has(name)) continue;
    tried.add(name);
    const r = await trySendOnChannel(userId, name, text, opts, notificationType);
    results.push(r);
    if (r.result.ok) {
      console.warn(`[channels] notifyUser fallback delivered via ${name} after preferred targets [${targets.join(",")}] failed for user ${userId}`);
      return results;
    }
  }
  return results;
}
