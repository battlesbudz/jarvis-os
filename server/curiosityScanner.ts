import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { sendMessage, isTelegramConfigured } from "./integrations/telegram";
import { getGoogleCalendarEvents } from "./integrations/googleCalendar";
import { getEmailsSince } from "./integrations/gmail";
import { getValidGoogleTokens } from "./userTokenStore";
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
  sourceType: "calendar" | "gmail";
  sourceId: string;
  summary: string;
}

async function generateCuriosityQuestions(
  items: CuriosityItem[],
  memories: { content: string; category: string }[]
): Promise<{ sourceId: string; sourceType: string; question: string }[]> {
  if (items.length === 0) return [];

  const memoriesContext =
    memories.length > 0
      ? `\nWhat I already know about this user:\n${memories
          .map((m) => `- [${m.category}] ${m.content}`)
          .join("\n")}`
      : "";

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

Return JSON: { "questions": [{ "sourceId": "string", "sourceType": "calendar"|"gmail", "question": "string" }] }
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
    const links = await db.select().from(schema.telegramLinks);
    if (links.length === 0) return;

    for (const link of links) {
      try {
        const tokens = await getValidGoogleTokens(link.userId).catch(
          () => []
        );
        if (!tokens || tokens.length === 0) continue;
        const token = tokens[0];

        const alreadyAsked = await getAlreadyAskedSourceIds(link.userId);
        const memories = await getUserMemories(link.userId);

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const todayKey = now.toISOString().slice(0, 10);
        const tomorrowKey = tomorrow.toISOString().slice(0, 10);

        let calendarEvents: any[] = [];
        try {
          const todayEvents = await getGoogleCalendarEvents(
            todayKey,
            undefined,
            undefined,
            token
          );
          const tomorrowEvents = await getGoogleCalendarEvents(
            tomorrowKey,
            undefined,
            undefined,
            token
          );
          calendarEvents = [...todayEvents, ...tomorrowEvents];
        } catch (err) {
          console.error(
            `[Curiosity] Calendar fetch failed for user ${link.userId}:`,
            err
          );
        }

        let recentEmails: any[] = [];
        try {
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          recentEmails = await getEmailsSince(
            oneDayAgo.getTime(),
            token
          );
        } catch (err) {
          console.error(
            `[Curiosity] Email fetch failed for user ${link.userId}:`,
            err
          );
        }

        const { getUserInboxRules, matchItemAgainstRules } = await import("./inboxRules");
        const userRules = await getUserInboxRules(link.userId);

        const items: CuriosityItem[] = [];

        for (const ev of calendarEvents) {
          const eventId = ev.id ? `cal:${ev.id}` : `cal:${ev.title}:${ev.start || ''}`;
          if (alreadyAsked.has(eventId)) continue;

          const ruleResult = matchItemAgainstRules(
            { sourceType: "calendar", sourceId: eventId, subject: ev.title, location: ev.location },
            userRules
          );
          if (ruleResult.verdict === "suppress") continue;

          if (ruleResult.verdict === "surface") {
            try {
              await db.insert(schema.inboxItems).values({
                userId: link.userId,
                sourceType: "calendar",
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
              console.log(`[Curiosity] Surfaced calendar event for user ${link.userId}: ${ev.title}`);
            } catch {}
            continue;
          }

          const startTime = ev.start ? new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
          items.push({
            sourceType: "calendar",
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

          items.push({
            sourceType: "gmail",
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
          memories
        );

        const validQuestions = questions.filter(q =>
          q.sourceId && q.sourceType && q.question &&
          candidateSourceIds.has(q.sourceId)
        );

        let sentCount = 0;
        const MAX_QUESTIONS_PER_SCAN = 2;

        for (const q of validQuestions) {
          if (sentCount >= MAX_QUESTIONS_PER_SCAN) break;
          try {
            await db.insert(schema.proactiveQuestionsSent).values({
              userId: link.userId,
              sourceType: q.sourceType,
              sourceId: q.sourceId,
              question: q.question,
            });

            try {
              await sendMessage(link.chatId, q.question);
              sentCount++;
              logInteraction(link.userId, "notification", "outbound", q.question, "curiosity_question").catch(() => {});
              console.log(
                `[Curiosity] Sent question to user ${link.userId}: ${q.question.slice(0, 60)}...`
              );
            } catch (sendErr) {
              console.error(
                `[Curiosity] DB recorded but Telegram send failed for user ${link.userId}:`,
                sendErr
              );
            }
          } catch (dbErr: any) {
            if (dbErr?.code === '23505') {
              console.log(`[Curiosity] Skipping duplicate source: ${q.sourceId}`);
            } else {
              console.error(
                `[Curiosity] Failed to record question for user ${link.userId}:`,
                dbErr
              );
            }
          }
        }
      } catch (userErr) {
        console.error(
          `[Curiosity] Error processing user ${link.userId}:`,
          userErr
        );
      }
    }
  } catch (err) {
    console.error("[Curiosity] Scanner error:", err);
  }
}

export async function startCuriosityScanner(): Promise<void> {
  if (!isTelegramConfigured()) return;

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
