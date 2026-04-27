import { db } from "../db";
import { eq } from "drizzle-orm";
import { telegramLinks } from "@shared/schema";
import { sendLongMessage, sendTelegramDocument, isTelegramConfigured } from "../integrations/telegram";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";

const linkCache = new Map<string, string | null>();
const LINK_CACHE_TTL = 60_000;
const linkCacheTimestamps = new Map<string, number>();

async function lookupChatId(userId: string): Promise<string | null> {
  const ts = linkCacheTimestamps.get(userId);
  if (ts && Date.now() - ts < LINK_CACHE_TTL) {
    return linkCache.get(userId) ?? null;
  }
  try {
    const rows = await db.select({ chatId: telegramLinks.chatId })
      .from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1);
    const chatId = rows[0]?.chatId ?? null;
    linkCache.set(userId, chatId);
    linkCacheTimestamps.set(userId, Date.now());
    return chatId;
  } catch (err) {
    console.error("[telegramChannel] link lookup failed:", err);
    return null;
  }
}

export const telegramChannel: Channel = {
  name: "telegram",
  // Full coaching surface — Telegram is Jarvis's primary conversational channel.
  // schedule_jarvis_task is already included via the "coaching" group.
  toolGroups: ["coaching", "calendar", "email", "memory", "documents", "research", "connections", "media", "self_edit", "browser", "mcp"],
  isConfigured: () => isTelegramConfigured(),
  isLinkedFor: async (userId) => !!(await lookupChatId(userId)),
  async sendMessage(userId, text, opts: ChannelSendOpts = {}) {
    const chatId = await lookupChatId(userId);
    if (!chatId) return { ok: false, error: "no telegram link" };
    try {
      if (text && text.trim()) await sendLongMessage(chatId, text);
      for (const att of opts.attachments || []) {
        if (att.kind === "document") {
          await sendTelegramDocument(chatId, att.filename, att.content, att.caption, att.mimeType);
        }
      }
      return { ok: true, messageId: chatId };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
