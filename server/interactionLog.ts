import { db } from "./db";
import { eq, desc, gte, and } from "drizzle-orm";
import * as schema from "@shared/schema";

export type InteractionChannel =
  | "app_chat"
  | "telegram"
  | "telegram_email_alert"
  | "telegram_curiosity"
  | "telegram_scheduled"
  | "telegram_meeting_brief";

export type InteractionDirection = "inbound" | "outbound";

const MAX_CONTENT_LENGTH = 800;

export async function logInteraction(
  userId: string,
  channel: InteractionChannel,
  direction: InteractionDirection,
  content: string,
  label?: string
): Promise<void> {
  try {
    const truncated = content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + "…"
      : content;
    await db.insert(schema.interactionLog).values({
      userId,
      channel,
      direction,
      content: truncated,
      label: label || null,
    });
  } catch (err) {
    console.error("[InteractionLog] Failed to log interaction:", err);
  }
}

export async function getRecentInteractions(
  userId: string,
  limit = 20,
  withinHours = 48
): Promise<typeof schema.interactionLog.$inferSelect[]> {
  try {
    const since = new Date(Date.now() - withinHours * 60 * 60 * 1000);
    return await db
      .select()
      .from(schema.interactionLog)
      .where(
        and(
          eq(schema.interactionLog.userId, userId),
          gte(schema.interactionLog.createdAt, since)
        )
      )
      .orderBy(desc(schema.interactionLog.createdAt))
      .limit(limit);
  } catch (err) {
    console.error("[InteractionLog] Failed to fetch interactions:", err);
    return [];
  }
}

export function formatInteractionTimeline(
  interactions: typeof schema.interactionLog.$inferSelect[]
): string {
  if (interactions.length === 0) return "";

  const channelLabels: Record<string, string> = {
    app_chat: "App Chat",
    telegram: "Telegram Chat",
    telegram_email_alert: "Telegram – Email Alert",
    telegram_curiosity: "Telegram – Proactive Question",
    telegram_scheduled: "Telegram – Scheduled Message",
    telegram_meeting_brief: "Telegram – Meeting Brief",
  };

  const sorted = [...interactions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const lines = sorted.map((row) => {
    const ts = new Date(row.createdAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const date = new Date(row.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const channelLabel = channelLabels[row.channel] || row.channel;
    const who = row.direction === "inbound" ? "User" : `Jarvis (${channelLabel})`;
    const labelTag = row.label ? ` [${row.label}]` : "";
    return `[${date} ${ts}] ${who}${labelTag}: ${row.content}`;
  });

  return `\n## Recent Cross-Channel Activity (last 48 hours)\nThis shows everything that happened between you and the user across all channels — app conversations, Telegram messages, and any notifications you sent. Use this to understand the full context before responding.\n${lines.join("\n")}`;
}
