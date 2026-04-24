import { db } from "./db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { notifyUser } from "./channels/registry";
import { getGoogleCalendarEvents } from "./integrations/googleCalendar";
import { getEmailsSince } from "./integrations/gmail";
import { getValidGoogleTokens, getAllGoogleConnectedUserIds, getAllMicrosoftConnectedUserIds, getValidMicrosoftToken } from "./userTokenStore";
import { getOutlookCalendarEvents, getRecentOutlookEmails } from "./integrations/outlook";
import { logInteraction } from "./interactionLog";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function getAlreadyAskedSourceIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ sourceId: schema.proactiveQuestionsSent.sourceId })
    .from(schema.proactiveQuestionsSent)
    .where(eq(schema.proactiveQuestionsSent.userId, userId));
  return new Set(rows.map((r) => r.sourceId));
}

async function getUserMemories(
  userId: string
): Promise<{ content: string; category: string }[]> {
  return db
    .select({
      content: schema.userMemories.content,
      category: schema.userMemories.category,
    })
    .from(schema.userMemories)
    .where(eq(schema.userMemories.userId, userId));
}

interface CuriosityItem {
  sourceType: "google_calendar" | "outlook_calendar" | "gmail" | "outlook_email";
  sourceId: string;
  summary: string;
}

async function generateCuriosityQuestions(
  items: CuriosityItem[],
  memories: { content: string; category: string }[],
  userId?: string,
): Promise<{ sourceId: string; sourceType: string; question: string }[]> {
  if (items.length === 0) return [];

  const memoriesContext =
    memories.length > 0
      ? `\nWhat I already know about this user:\n${memories
          .map((m) => `- [${m.category}] ${m.content}`)
          .join("\n")}`
      : "";

  const { buildAiContextSections } = await import("./memory/promptContext");
  const seed = items.slice(0, 3).map((i) => i.summary).join(" • ");
  const { soulSection, patternSection } = await buildAiContextSections(userId, seed);

  const itemsList = items
    .map(
      (i, idx) =>
        `${idx + 1}. [${i.sourceType}] id="${i.sourceId}" — ${i.summary}`
    )
    .join("\n");

  const prompt = `You are a curious, empathetic personal coach. Given these upcoming calendar events and recent emails, decide which ones are worth asking the user about to learn more about them.

${memoriesContext}

Items to evaluate:
${itemsList}

Rules:
- Skip: recurring standup meetings, automated/system emails, newsletters, marketing, calendar holds with no attendees
- Ask about: meetings with specific people, important-sounding events, emails from real people about substantive topics, anything with "urgent" or "important" markers, blocked focus time (ask what they plan to work on)
- Generate genuinely curious, warm questions that would help you understand the user better
- For calendar events: ask about their goal going in, what a win would look like, how they feel about it
- For emails: ask about the backstory, whether it's something they've been thinking about, what they plan to do about it
- Keep questions conversational and short (1-2 sentences)

Return JSON: { "questions": [{ "sourceId": "string", "sourceType": "google_calendar"|"outlook_calendar"|"gmail"|"outlook_email", "question": "string" }] }
Return only items worth asking about. Return { "questions": [] } if nothing is interesting enough.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 800,
  });

  const content =
    response.choices[0]?.message?.content || '{"questions":[]}';
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.questions) ? parsed.questions : [];
  } catch {
    return [];
  }
}

export async function runCuriosityScan(): Promise<void> {
  try {
    const telegramLinks = await db.select().from(schema.telegramLinks);

    const googleUserIds = await getAllGoogleConnectedUserIds();
    const microsoftUserIds = await getAllMicrosoftConnectedUserIds();

    const telegramOnlyUserIds = telegramLinks
      .filter(l => !googleUserIds.includes(l.userId) && !microsoftUserIds.includes(l.userId))
      .map(l => l.userId);

    const userIds = [
      ...new Set([
        ...googleUserIds,
        ...microsoftUserIds,
        ...telegramOnlyUserIds,
      ]),
    ];

    if (userIds.length === 0) return;

    for (const userId of userIds) {
      try {
        const googleTokens = await getValidGoogleTokens(userId).catch(() => []);
        const googleToken = googleTokens[0] ?? null;
        const msToken = await getValidMicrosoftToken(userId).catch(() => null);

        if (!googleToken && !msToken) continue;

        const alreadyAsked = await getAlreadyAskedSourceIds(userId);
        const memories = await getUserMemories(userId);

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const todayKey = now.toISOString().slice(0, 10);
        const tomorrowKey = tomorrow.toISOString().slice(0, 10);

        type TaggedEvent = { ev: any; provider: "google_calendar" | "outlook_calendar"; prefix: string };
        const taggedCalendarEvents: TaggedEvent[] = [];

        if (googleToken) {
          try {
            const todayEvents = await getGoogleCalendarEvents(todayKey, undefined, undefined, googleToken);
            const tomorrowEvents = await getGoogleCalendarEvents(tomorrowKey, undefined, undefined, googleToken);
            for (const ev of [...todayEvents, ...tomorrowEvents]) {
              taggedCalendarEvents.push({ ev, provider: "google_calendar", prefix: "gcal" });
            }
          } catch (err) {
            console.error(`[Curiosity] Google Calendar fetch failed for user ${userId}:`, err);
          }
        }

        if (msToken) {
          try {
            const todayEvents = await getOutlookCalendarEvents(todayKey, undefined, undefined, msToken);
            const tomorrowEvents = await getOutlookCalendarEvents(tomorrowKey, undefined, undefined, msToken);
            for (const ev of [...todayEvents, ...tomorrowEvents]) {
              taggedCalendarEvents.push({ ev, provider: "outlook_calendar", prefix: "outlookcal" });
            }
          } catch (err) {
            console.error(`[Curiosity] Outlook Calendar fetch failed for user ${userId}:`, err);
          }
        }

        let recentEmails: any[] = [];
        if (googleToken) {
          try {
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            recentEmails = await getEmailsSince(oneDayAgo.getTime(), googleToken);
          } catch (err) {
            console.error(`[Curiosity] Email fetch failed for user ${userId}:`, err);
          }
        }

        let recentOutlookEmails: any[] = [];
        if (msToken) {
          try {
            recentOutlookEmails = await getRecentOutlookEmails(msToken, 25);
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            recentOutlookEmails = recentOutlookEmails.filter((m) => {
              if (!m.date) return false;
              return new Date(m.date).getTime() >= oneDayAgo.getTime();
            });
          } catch (err) {
            console.error(`[Curiosity] Outlook email fetch failed for user ${userId}:`, err);
          }
        }

        const { getUserInboxRules, matchItemAgainstRules } = await import("./inboxRules");
        const userRules = await getUserInboxRules(userId);

        const items: CuriosityItem[] = [];

        for (const { ev, provider, prefix } of taggedCalendarEvents) {
          const eventId = ev.id ? `${prefix}:${ev.id}` : `${prefix}:${ev.title}:${ev.start || ''}`;
          if (alreadyAsked.has(eventId)) continue;

          const ruleResult = matchItemAgainstRules(
            { sourceType: "calendar", sourceId: eventId, subject: ev.title, location: ev.location },
            userRules
          );
          if (ruleResult.verdict === "suppress") continue;

          if (ruleResult.verdict === "surface") {
            try {
              await db.insert(schema.inboxItems).values({
                userId,
                sourceType: provider,
                sourceId: eventId,
                subject: ev.title,
                sender: ev.organizer || null,
                snippet: `${ev.start ? new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}${ev.location ? ' at ' + ev.location : ''}${ev.description ? ' — ' + ev.description : ''}`,
                jarvisReason: "Matched your surface rule",
                suggestedActions: [
                  { label: "Add Prep", actionType: "add_prep_time" },
                  { label: "Save Context", actionType: "save_to_focus" },
                  { label: "Dismiss", actionType: "dismiss" },
                ],
                matchedRuleId: ruleResult.matchedRuleId || null,
              });
              console.log(`[Curiosity] Surfaced ${provider} event for user ${userId}: ${ev.title}`);
            } catch (err) {
              console.error(`[Curiosity] context-rule surface failed for ${userId}:`, err);
            }
            continue;
          }

          const startTime = ev.start ? new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
          items.push({
            sourceType: provider,
            sourceId: eventId,
            summary: `${ev.title}${startTime ? " at " + startTime : ""}${
              ev.location ? " at " + ev.location : ""
            }${ev.description ? " — " + ev.description : ""}`,
          });
        }

        for (const email of recentEmails) {
          const emailId = email.messageId ? `gmail:${email.messageId}` : `gmail:${email.subject}:${email.from || ''}`;
          if (alreadyAsked.has(emailId)) continue;

          const ruleResult = matchItemAgainstRules(
            { sourceType: "email", sourceId: emailId, sender: email.from, subject: email.subject, snippet: email.snippet },
            userRules
          );
          if (ruleResult.verdict === "suppress") continue;

          if (ruleResult.verdict === "surface") {
            try {
              await db.insert(schema.inboxItems).values({
                userId,
                sourceType: "email",
                sourceId: emailId,
                subject: email.subject || "(no subject)",
                sender: email.from || null,
                snippet: email.snippet || null,
                jarvisReason: "Matched your surface rule",
                suggestedActions: [
                  { label: "Reply", actionType: "reply" },
                  { label: "Archive", actionType: "archive" },
                  { label: "Dismiss", actionType: "dismiss" },
                ],
                matchedRuleId: ruleResult.matchedRuleId || null,
              }).onConflictDoNothing();
              console.log(`[Curiosity] Surfaced email for user ${userId}: ${email.subject}`);
            } catch (err) {
              console.error(`[Curiosity] inbox_items insert failed for email ${emailId}:`, err);
            }
            continue;
          }

          items.push({
            sourceType: "gmail",
            sourceId: emailId,
            summary: `From: ${email.from || "unknown"} | Subject: "${
              email.subject || "no subject"
            }"${email.snippet ? " — " + email.snippet : ""}`,
          });
        }

        for (const email of recentOutlookEmails) {
          const emailId = `outlook_email:${email.id || email.subject + ':' + (email.from || '')}`;
          if (alreadyAsked.has(emailId)) continue;

          const ruleResult = matchItemAgainstRules(
            { sourceType: "email", sourceId: emailId, sender: email.from, subject: email.subject, snippet: email.snippet },
            userRules
          );
          if (ruleResult.verdict === "suppress") continue;

          if (ruleResult.verdict === "surface") {
            try {
              await db.insert(schema.inboxItems).values({
                userId,
                sourceType: "outlook_email",
                sourceId: emailId,
                subject: email.subject || "(no subject)",
                sender: email.from || null,
                snippet: email.snippet || null,
                jarvisReason: "Matched your surface rule",
                suggestedActions: [
                  { label: "Reply", actionType: "reply" },
                  { label: "Archive", actionType: "archive" },
                  { label: "Dismiss", actionType: "dismiss" },
                ],
                matchedRuleId: ruleResult.matchedRuleId || null,
              }).onConflictDoNothing();
              console.log(`[Curiosity] Surfaced Outlook email for user ${userId}: ${email.subject}`);
            } catch (err) {
              console.error(`[Curiosity] inbox_items insert failed for Outlook email ${emailId}:`, err);
            }
            continue;
          }

          items.push({
            sourceType: "outlook_email",
            sourceId: emailId,
            summary: `From: ${email.from || "unknown"} | Subject: "${
              email.subject || "no subject"
            }"${email.snippet ? " — " + email.snippet : ""}`,
          });
        }

        if (items.length === 0) continue;

        const candidateSourceIds = new Set(items.map(i => i.sourceId));

        const questions = await generateCuriosityQuestions(
          items.slice(0, 15),
          memories,
          userId,
        );

        const validQuestions = questions.filter(q =>
          q.sourceId && q.sourceType && q.question &&
          candidateSourceIds.has(q.sourceId)
        );

        let sentCount = 0;
        const MAX_QUESTIONS_PER_SCAN = 2;

        for (const q of validQuestions) {
          if (sentCount >= MAX_QUESTIONS_PER_SCAN) break;
          const srcItem = items.find(i => i.sourceId === q.sourceId);

          const canonicalSourceType = srcItem?.sourceType ?? q.sourceType;

          try {
            await db.insert(schema.proactiveQuestionsSent).values({
              userId,
              sourceType: canonicalSourceType,
              sourceId: q.sourceId,
              question: q.question,
            });
          } catch (dbErr: any) {
            if (dbErr?.code === '23505') {
              console.log(`[Curiosity] Skipping duplicate source: ${q.sourceId}`);
              continue;
            } else {
              console.error(`[Curiosity] Failed to record question for user ${userId}:`, dbErr);
              continue;
            }
          }

          try {
            await db.insert(schema.inboxItems).values({
              userId,
              sourceType: canonicalSourceType as "google_calendar" | "outlook_calendar" | "outlook_email" | "email" | "telegram" | "slack" | "discord" | "whatsapp" | "other",
              sourceId: q.sourceId,
              subject: srcItem?.summary?.slice(0, 200) ?? q.question.slice(0, 200),
              snippet: q.question,
              jarvisReason: "Jarvis noticed something worth your attention",
              suggestedActions: [
                { label: "Reply", actionType: "reply" },
                { label: "Dismiss", actionType: "dismiss" },
              ],
            }).onConflictDoNothing();
          } catch (inboxErr) {
            console.error(`[Curiosity] inbox_items insert failed for ${q.sourceId}:`, inboxErr);
          }

          try {
            const results = await notifyUser(userId, "general", q.question);
            const delivered = results.some(r => r.result.ok);
            sentCount++;
            if (delivered) {
              logInteraction(userId, "notification", "outbound", q.question, "curiosity_question").catch(() => {});
              console.log(`[Curiosity] Sent question to user ${userId}: ${q.question.slice(0, 60)}...`);
            } else {
              console.log(`[Curiosity] Surfaced to inbox (no channel delivered) for user ${userId}: ${q.question.slice(0, 60)}...`);
            }
          } catch (sendErr) {
            console.error(`[Curiosity] notify failed for user ${userId}:`, sendErr);
            sentCount++;
          }
        }
      } catch (userErr) {
        console.error(
          `[Curiosity] Error processing user ${userId}:`,
          userErr
        );
      }
    }
  } catch (err) {
    console.error("[Curiosity] Scanner error:", err);
  }
}

export async function startCuriosityScanner(): Promise<void> {
  console.log("[Curiosity] Scanner started — runs every 30 minutes");

  setInterval(
    async () => {
      console.log("[Curiosity] Running scan...");
      await runCuriosityScan();
    },
    30 * 60 * 1000
  );

  setTimeout(() => runCuriosityScan(), 60 * 1000);
}
