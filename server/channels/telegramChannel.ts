import { db } from "../db";
import { eq } from "drizzle-orm";
import { telegramLinks } from "@shared/schema";
import { sendLongMessage, sendTelegramDocument, sendPhoto, isTelegramConfigured } from "../integrations/telegram";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { attachmentToBuffer, collectMarkdownExtras } from "./attachmentHelpers";

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
  toolGroups: ["coaching", "calendar", "email", "memory", "documents", "research", "connections", "scheduling", "media", "self_edit", "browser", "mcp"],
  isConfigured: () => isTelegramConfigured(),
  isLinkedFor: async (userId) => !!(await lookupChatId(userId)),
  async sendMessage(userId, text, opts: ChannelSendOpts = {}) {
    const chatId = await lookupChatId(userId);
    if (!chatId) return { ok: false, error: "no telegram link" };
    try {
      const attachments = opts.attachments || [];

      // Append markdown attachments to the text message
      const markdownExtra = collectMarkdownExtras(attachments);
      const fullText = markdownExtra ? (text ? `${text}\n\n${markdownExtra}` : markdownExtra) : text;

      if (fullText && fullText.trim()) await sendLongMessage(chatId, fullText);

      for (const att of attachments) {
        if (att.kind === "document") {
          await sendTelegramDocument(chatId, att.filename, att.content, att.caption, att.mimeType);
        } else if (att.kind === "image") {
          const buf = await attachmentToBuffer(att).catch(() => null);
          if (buf) {
            await sendPhoto(chatId, buf, att.caption); // sendPhoto uses inline Telegram photo bubble regardless of filename
          } else {
            console.warn("[telegramChannel] image attachment had no usable source — skipping");
          }
        } else if (att.kind === "file") {
          const buf = await attachmentToBuffer(att).catch(() => null);
          if (buf) {
            await sendTelegramDocument(chatId, att.filename, buf, att.caption, att.mimeType);
          } else {
            console.warn(`[telegramChannel] file attachment ${att.filename} had no usable source — skipping`);
          }
        }
        // markdown already merged into text above
      }
      return { ok: true, messageId: chatId };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
