import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelPreferences, type ChannelName, type NotificationType } from "@shared/schema";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { logInteraction, type InteractionChannel } from "../interactionLog";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";

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

const DEFAULT_FALLBACK: ChannelName[] = ["telegram", "in_app"];

/**
 * Sentinel stored in channel_preferences.channels to mean "user has explicitly
 * muted this notification type — do not deliver, even via fallback".
 * Distinct from an absent row (never configured → use DEFAULT_FALLBACK).
 */
export const MUTE_SENTINEL = "__muted__";

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
    const row = rows[0];
    if (row) {
      const prefs = row.channels as string[] | undefined;
      // Explicit mute sentinel — user opted out; return empty so notifyUser skips delivery
      if (prefs && prefs.includes(MUTE_SENTINEL)) return [];
      // Explicit non-empty channel selection
      if (prefs && prefs.length > 0) return prefs as ChannelName[];
      // Row exists but channels is [] — treated the same as "no row" (fallback)
    }
  } catch (err) {
    console.error("[channels] preference lookup failed:", err);
  }
  // No row (or row with empty channels) → use fallback
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
    if (result.ok) {
      logInteraction(userId, name as InteractionChannel, "outbound", text).catch(() => {});
      diagEmit({
        userId,
        subsystem: "channel_registry",
        severity: "info",
        message: `Channel ${name} delivered message successfully`,
        metadata: { channel: name, notificationType, recovery: true },
      }).catch(() => {});
    } else {
      diagEmit({
        userId,
        subsystem: "channel_registry",
        severity: "warning",
        message: `Channel ${name} send returned not-ok: ${result.error ?? "unknown"}`,
        metadata: { channel: name, notificationType },
      }).catch(() => {});
    }
    return { channel: name, result };
  } catch (err) {
    console.error(`[channels] ${name} send failed:`, err);
    diagEmit({
      userId,
      subsystem: "channel_registry",
      severity: "error",
      message: `Channel ${name} send threw: ${String(err).slice(0, 200)}`,
      metadata: { channel: name, notificationType },
    }).catch(() => {});
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
  // Empty targets means the user explicitly muted this type — skip delivery and fallback
  if (targets.length === 0) return [];
  const results = await Promise.all(
    targets.map((name) => trySendOnChannel(userId, name, text, opts, notificationType)),
  );

  if (results.some((r) => r.result.ok)) return results;

  const tried = new Set<ChannelName>(targets);
  const fallbackOrder: ChannelName[] = [
    "telegram",
    "in_app",
    ...listChannels().map((c) => c.name).filter((n) => n !== "telegram" && n !== "in_app"),
  ];
  for (const name of fallbackOrder) {
    if (tried.has(name)) continue;
    tried.add(name);
    const r = await trySendOnChannel(userId, name, text, opts, notificationType);
    results.push(r);
    if (r.result.ok) {
      const failedChannels = targets.join(", ");
      console.warn(`[channels] notifyUser fallback delivered via ${name} after preferred targets [${failedChannels}] failed for user ${userId}`);
      const inAppCh = channels.get("in_app");
      if (inAppCh) {
        if (name !== "in_app") {
          inAppCh.sendMessage(
            userId,
            `Your preferred notification channels (${failedChannels}) were unavailable. This message was delivered via ${name} instead. Update your notification settings in Profile.`,
            { notificationType: "general" },
          ).catch(() => {});
        } else {
          inAppCh.sendMessage(
            userId,
            `Your preferred channels (${failedChannels}) were unavailable, so this notification was delivered here in-app. Update your notification settings in Profile if needed.`,
            { notificationType: "general" },
          ).catch(() => {});
        }
      }
      return results;
    }
  }
  return results;
}
