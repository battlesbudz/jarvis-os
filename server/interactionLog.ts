import { db } from "./db";
import { eq, desc, gte, and } from "drizzle-orm";
import * as schema from "@shared/schema";

export type InteractionChannel = "app_chat" | "telegram" | "notification" | "whatsapp" | "slack" | "daemon" | "gateway";

export type InteractionDirection = "inbound" | "outbound";

const DISPLAY_TRUNCATE_LENGTH = 1200;

export async function logInteraction(
  userId: string,
  channel: InteractionChannel,
  direction: InteractionDirection,
  content: string,
  label?: string
): Promise<void> {
  try {
    await db.insert(schema.interactionLog).values({
      userId,
      channel,
      direction,
      content,
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

    let channelLabel: string;
    if (row.channel === "app_chat") {
      channelLabel = "App";
    } else if (row.channel === "telegram") {
      channelLabel = "Telegram";
    } else {
      channelLabel = row.label ? `Notification – ${row.label}` : "Notification";
    }

    const who = row.direction === "inbound" ? "User" : `Jarvis (${channelLabel})`;
    const labelTag = row.channel !== "notification" && row.label ? ` [${row.label}]` : "";

    const displayContent = row.content.length > DISPLAY_TRUNCATE_LENGTH
      ? row.content.slice(0, DISPLAY_TRUNCATE_LENGTH) + "…"
      : row.content;

    return `[${date} ${ts}] ${who}${labelTag}: ${displayContent}`;
  });

  return `\n## Recent Cross-Channel Activity (last 48 hours)\nThis shows everything that happened between you and the user across all channels — app conversations, Telegram messages, and any notifications you sent. Use this to understand the full context before responding.\n${lines.join("\n")}`;
}
