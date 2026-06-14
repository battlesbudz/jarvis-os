import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { createRoutedOpenAIChatShim } from "./agent/routedChatCompletion";

const openai = createRoutedOpenAIChatShim("[InboxRules]", "cheap");

export interface MatchHints {
  senders?: string[];
  subjectKeywords?: string[];
  domains?: string[];
  locationKeywords?: string[];
}

export interface InboxRule {
  id: string;
  userId: string;
  type: string;
  scope: string;
  pattern: string;
  matchHints: MatchHints | null;
  source: string;
  matchCount: number | null;
  active: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ScanItem {
  sourceType: "email" | "calendar";
  sourceId: string;
  sender?: string;
  subject?: string;
  snippet?: string;
  location?: string;
}

function normalizeForMatch(text: string): string {
  return (text || "").toLowerCase().trim();
}

function extractDomain(email: string): string {
  const match = email.match(/@([a-zA-Z0-9.-]+)/);
  return match ? match[1].toLowerCase() : "";
}

function doesRuleMatch(
  rule: InboxRule,
  senderNorm: string,
  senderDomain: string,
  subjectNorm: string,
  snippetNorm: string,
  locationNorm: string,
  allText: string
): boolean {
  const hints = (rule.matchHints || {}) as MatchHints;

  if (hints.domains && hints.domains.length > 0) {
    for (const d of hints.domains) {
      if (senderDomain.includes(d.toLowerCase())) return true;
    }
  }

  if (hints.senders && hints.senders.length > 0) {
    for (const s of hints.senders) {
      if (senderNorm.includes(s.toLowerCase())) return true;
    }
  }

  if (hints.subjectKeywords && hints.subjectKeywords.length > 0) {
    for (const kw of hints.subjectKeywords) {
      if (subjectNorm.includes(kw.toLowerCase()) || snippetNorm.includes(kw.toLowerCase())) return true;
    }
  }

  if (hints.locationKeywords && hints.locationKeywords.length > 0) {
    for (const lk of hints.locationKeywords) {
      if (locationNorm.includes(lk.toLowerCase()) || allText.includes(lk.toLowerCase())) return true;
    }
  }

  const patternWords = rule.pattern
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["from", "any", "all", "the", "about", "with", "that", "this"].includes(w));
  if (patternWords.length > 0) {
    const matchedWords = patternWords.filter((w) => allText.includes(w));
    if (matchedWords.length >= Math.ceil(patternWords.length * 0.6)) return true;
  }

  return false;
}

function incrementMatchCount(rule: InboxRule): void {
  db.update(schema.inboxRules)
    .set({
      matchCount: (rule.matchCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.inboxRules.id, rule.id))
    .catch(() => {});
}

export function matchItemAgainstRules(
  item: ScanItem,
  rules: InboxRule[]
): { verdict: "surface" | "suppress" | "default"; matchedRuleId?: string } {
  const senderNorm = normalizeForMatch(item.sender || "");
  const subjectNorm = normalizeForMatch(item.subject || "");
  const snippetNorm = normalizeForMatch(item.snippet || "");
  const locationNorm = normalizeForMatch(item.location || "");
  const senderDomain = item.sender ? extractDomain(item.sender) : "";
  const allText = `${senderNorm} ${subjectNorm} ${snippetNorm} ${locationNorm}`;

  const activeRules = rules.filter(
    (r) => r.active !== false && (r.scope === "both" || r.scope === item.sourceType)
  );

  const suppressRules = activeRules.filter((r) => r.type === "suppress");
  const surfaceRules = activeRules.filter((r) => r.type === "surface");

  for (const rule of suppressRules) {
    if (doesRuleMatch(rule, senderNorm, senderDomain, subjectNorm, snippetNorm, locationNorm, allText)) {
      incrementMatchCount(rule);
      return { verdict: "suppress" as const, matchedRuleId: rule.id };
    }
  }

  for (const rule of surfaceRules) {
    if (doesRuleMatch(rule, senderNorm, senderDomain, subjectNorm, snippetNorm, locationNorm, allText)) {
      incrementMatchCount(rule);
      return { verdict: "surface" as const, matchedRuleId: rule.id };
    }
  }

  return { verdict: "default" as const };
}

export async function getUserInboxRules(userId: string): Promise<InboxRule[]> {
  return db
    .select()
    .from(schema.inboxRules)
    .where(eq(schema.inboxRules.userId, userId)) as Promise<InboxRule[]>;
}

export async function learnFromDismissal(
  userId: string,
  itemId: string,
  telegramChatId?: string
): Promise<{ learned: boolean; ruleName?: string }> {
  const [item] = await db
    .select()
    .from(schema.inboxItems)
    .where(and(eq(schema.inboxItems.id, itemId), eq(schema.inboxItems.userId, userId)));
  if (!item) return { learned: false };
  if (item.sourceType !== "email") return { learned: false };

  const newCount = (item.dismissCount ?? 0) + 1;
  await db
    .update(schema.inboxItems)
    .set({ dismissCount: newCount, status: "dismissed", actedAt: new Date() })
    .where(eq(schema.inboxItems.id, itemId));

  const senderDomain = item.sender ? extractDomain(item.sender) : "";
  if (!senderDomain) return { learned: false };

  const dismissed = await db
    .select()
    .from(schema.inboxItems)
    .where(
      and(
        eq(schema.inboxItems.userId, userId),
        eq(schema.inboxItems.status, "dismissed")
      )
    );
  const domainDismissals = dismissed.filter(
    (d) => d.sender && extractDomain(d.sender) === senderDomain
  ).length;

  if (domainDismissals >= 3) {
    const existing = await db
      .select()
      .from(schema.inboxRules)
      .where(
        and(
          eq(schema.inboxRules.userId, userId),
          eq(schema.inboxRules.type, "suppress"),
          eq(schema.inboxRules.source, "learned")
        )
      );
    const alreadyHas = existing.some((r) => {
      const hints = (r.matchHints as MatchHints) || {};
      return hints.domains?.includes(senderDomain);
    });

    if (!alreadyHas) {
      const ruleName = `Auto: suppress ${senderDomain}`;
      await db.insert(schema.inboxRules).values({
        userId,
        type: "suppress",
        scope: "email",
        pattern: ruleName,
        matchHints: { domains: [senderDomain] },
        source: "learned",
      });
      console.log(`[InboxRules] Learned suppress rule for ${senderDomain} (user ${userId})`);

      if (telegramChatId) {
        try {
          const { sendMessage } = await import("./integrations/telegram");
          await sendMessage(
            telegramChatId,
            `🧠 I've learned to stop surfacing emails from ${senderDomain} — you've dismissed them ${domainDismissals} times. You can review or remove this rule in your Inbox Rules settings.`
          );
        } catch {}
      }

      return { learned: true, ruleName };
    }
  }

  return { learned: false };
}

export async function createRuleFromText(
  userId: string,
  text: string,
  type: "surface" | "suppress",
  scope: "email" | "calendar" | "both"
): Promise<InboxRule> {
  let matchHints: MatchHints = {};

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract matching hints from this inbox rule description. Return JSON only:
{ "senders": [], "subjectKeywords": [], "domains": [], "locationKeywords": [] }

Examples:
- "suppress deployment notifications" -> { "senders": ["deploy"], "subjectKeywords": ["deployment"], "domains": [], "locationKeywords": [] }
- "always surface New York events" → { "senders": [], "subjectKeywords": ["new york"], "domains": [], "locationKeywords": ["new york", "nyc", "manhattan"] }
- "suppress newsletters" → { "senders": [], "subjectKeywords": ["newsletter", "unsubscribe"], "domains": [], "locationKeywords": [] }`,
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || "{}";
    matchHints = JSON.parse(content);
  } catch (err) {
    console.error("[InboxRules] Failed to extract match hints:", err);
  }

  const [rule] = await db
    .insert(schema.inboxRules)
    .values({
      userId,
      type,
      scope,
      pattern: text,
      matchHints,
      source: "user",
    })
    .returning();

  return rule as unknown as InboxRule;
}
