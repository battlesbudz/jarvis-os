import { createHash } from "crypto";
import { db } from "../db";
import * as schema from "@shared/schema";
import { and, eq, or, like } from "drizzle-orm";

export function buildGmailSourceId(
  accountEmail: string,
  messageId: string | null | undefined,
  fallbackData?: { subject: string; from: string; receivedAt: number }
): string {
  const acct = accountEmail ? `${accountEmail}:` : '';
  if (messageId) {
    return `gmail:${acct}${messageId}`;
  }
  if (fallbackData) {
    const hash = createHash('sha256')
      .update(JSON.stringify({ subject: fallbackData.subject, from: fallbackData.from, receivedAt: fallbackData.receivedAt }))
      .digest('hex')
      .slice(0, 16);
    return `gmail:fallback:${hash}`;
  }
  return `gmail:unknown`;
}

export function parseGmailMessageId(sourceId: string): string | null {
  if (!sourceId.startsWith("gmail:")) return null;
  const afterPrefix = sourceId.slice(6);
  if (afterPrefix.startsWith("fallback:") || afterPrefix.startsWith("unknown")) return null;
  if (afterPrefix.includes("@")) {
    const colonIdx = afterPrefix.indexOf(":");
    return colonIdx !== -1 ? afterPrefix.slice(colonIdx + 1) : null;
  }
  return afterPrefix || null;
}

export async function gmailMessageIdExistsForUser(
  userId: string,
  messageId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.inboxItems.id })
    .from(schema.inboxItems)
    .where(
      and(
        eq(schema.inboxItems.userId, userId),
        eq(schema.inboxItems.sourceType, "email"),
        or(
          eq(schema.inboxItems.sourceId, `gmail:${messageId}`),
          like(schema.inboxItems.sourceId, `gmail:%:${messageId}`)
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}
