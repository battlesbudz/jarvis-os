import { db, pool } from "./db";
import { eq, and, gt, lt, inArray, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { notifyUser } from "./channels/registry";
import { getGoogleCalendarEvents } from "./integrations/googleCalendar";
import { getEmailsSince } from "./integrations/gmail";
import { getUserTokens, refreshGoogleToken, getAllGoogleConnectedUserIds, getAllMicrosoftConnectedUserIds, getValidMicrosoftToken } from "./userTokenStore";
import { buildGmailSourceId, gmailMessageIdExistsForUser } from "./utils/gmailSourceId";
import { getOutlookCalendarEvents, getRecentOutlookEmails } from "./integrations/outlook";
import { logInteraction } from "./interactionLog";
import { logAction, isActionSuppressed } from "./intelligence/actionLog";
import { createRoutedChatCompletion } from "./agent/routedChatCompletion";
import { containsRawRestrictedContent } from "./memory/writePipeline";

const CURIOSITY_SCAN_LOCK_ID = 7654321098;
let scannerStarted = false;

const ALREADY_ASKED_WINDOW_DAYS = 30;

async function getAlreadyAskedSourceIds(userId: string): Promise<Set<string>> {
  const windowStart = new Date(Date.now() - ALREADY_ASKED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ sourceId: schema.proactiveQuestionsSent.sourceId })
    .from(schema.proactiveQuestionsSent)
    .where(
      and(
        eq(schema.proactiveQuestionsSent.userId, userId),
        gt(schema.proactiveQuestionsSent.sentAt, windowStart)
      )
    );
  return new Set(rows.map((r) => r.sourceId));
}

function extractSenderKey(sender: string | null | undefined): string | null {
  if (!sender) return null;
  const match = sender.match(/<([^>]+)>/);
  const email = match ? match[1] : sender;
  const atIdx = email.indexOf("@");
  if (atIdx > 0) {
    return email.slice(atIdx + 1).toLowerCase().trim();
  }
  return email.toLowerCase().trim();
}

const EMAIL_SOURCE_TYPES = ["email", "gmail", "outlook_email"] as const;
const RESTRICTED_MEMORY_SOURCE_SQL_PATTERN = "%(plaid|bank|banking|financial|transaction|credit_card|credit card|debit_card|debit card|tax_document|tax document|payroll|brokerage|account_balance|account balance|restricted_source|restricted summary|restricted_summary)%";

async function getRecentlySurfacedSenders(userId: string, since: Date): Promise<Set<string>> {
  const sentRows = await db
    .select({ sourceId: schema.proactiveQuestionsSent.sourceId })
    .from(schema.proactiveQuestionsSent)
    .where(
      and(
        eq(schema.proactiveQuestionsSent.userId, userId),
        gt(schema.proactiveQuestionsSent.sentAt, since)
      )
    );

  if (sentRows.length === 0) return new Set();

  const sentSourceIds = sentRows.map((r) => r.sourceId);

  const inboxRows = await db
    .select({ sender: schema.inboxItems.sender })
    .from(schema.inboxItems)
    .where(
      and(
        eq(schema.inboxItems.userId, userId),
        inArray(schema.inboxItems.sourceId, sentSourceIds),
        inArray(schema.inboxItems.sourceType, [...EMAIL_SOURCE_TYPES])
      )
    );

  const keys = new Set<string>();
  for (const row of inboxRows) {
    const key = extractSenderKey(row.sender);
    if (key) keys.add(key);
  }
  return keys;
}

async function getUserMemories(
  userId: string
): Promise<{ content: string; category: string }[]> {
  const rows = await db
    .select({
      content: schema.userMemories.content,
      category: schema.userMemories.category,
    })
    .from(schema.userMemories)
    .where(and(
      eq(schema.userMemories.userId, userId),
      eq(schema.userMemories.pendingReview, false),
      sql`${schema.userMemories.reviewStatus} IN ('active', 'kept', 'edited')`,
      sql`COALESCE(${schema.userMemories.sensitivity}, 'normal') = 'normal'`,
      sql`LOWER(COALESCE(${schema.userMemories.sourceType}, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}`,
      sql`LOWER(COALESCE(${schema.userMemories.sourceRef}, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}`,
    ));
  return rows.filter((row) => !containsRawRestrictedContent(row.content ?? ""));
}

interface CuriosityItem {
  sourceType: "google_calendar" | "outlook_calendar" | "gmail" | "outlook_email";
  sourceId: string;
  summary: string;
  senderKey?: string | null;
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

  const { getModel } = await import("./lib/modelPrefs");
  const model = await getModel(userId ?? "", "research");

  const response = await createRoutedChatCompletion({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 800,
  }, { tier: "balanced", logPrefix: "[CuriosityScanner]", userId });

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
  let lockClient;
  try {
    lockClient = await pool.connect();
  } catch (connectErr) {
    console.error("[Curiosity] Failed to obtain DB connection for advisory lock — skipping scan:", connectErr);
    return;
  }

  let lockAcquired = false;
  try {
    const lockResult = await lockClient.query(
      `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
      [CURIOSITY_SCAN_LOCK_ID]
    );
    lockAcquired = (lockResult.rows[0] as { acquired: boolean } | undefined)?.acquired === true;
    if (!lockAcquired) {
      console.log("[Curiosity] Scan already in progress (DB advisory lock held) — skipping concurrent run");
      lockClient.release();
      return;
    }
  } catch (lockErr) {
    console.error("[Curiosity] Failed to acquire DB advisory lock — skipping scan:", lockErr);
    lockClient.release();
    return;
  }

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
        const googleTokenObjs = await getUserTokens(userId, 'google').catch(() => []);
        const validGoogleTokenObjs: { accessToken: string; accountEmail: string }[] = [];
        for (const t of googleTokenObjs) {
          if (t.expiresAt && t.expiresAt.getTime() < Date.now() + 60_000) {
            const refreshed = await refreshGoogleToken(t).catch(() => null);
            if (refreshed) validGoogleTokenObjs.push({ accessToken: refreshed.accessToken, accountEmail: t.accountEmail || '' });
          } else {
            validGoogleTokenObjs.push({ accessToken: t.accessToken, accountEmail: t.accountEmail || '' });
          }
        }
        const googleToken = validGoogleTokenObjs[0]?.accessToken ?? null;
        const msToken = await getValidMicrosoftToken(userId).catch(() => null);

        if (!googleToken && !msToken) continue;

        const alreadyAsked = await getAlreadyAskedSourceIds(userId);
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentlySurfacedSenders = await getRecentlySurfacedSenders(userId, oneDayAgo);
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
        if (validGoogleTokenObjs.length > 0) {
          const emailsSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          for (const { accessToken, accountEmail } of validGoogleTokenObjs) {
            try {
              const fetched = await getEmailsSince(emailsSince.getTime(), accessToken);
              for (const e of fetched) {
                recentEmails.push({ ...e, accountEmail });
              }
            } catch (err) {
              console.error(`[Curiosity] Email fetch failed for user ${userId} (${accountEmail}):`, err);
            }
          }
        }

        let recentOutlookEmails: any[] = [];
        if (msToken) {
          try {
            recentOutlookEmails = await getRecentOutlookEmails(msToken, 25);
            const emailsSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            recentOutlookEmails = recentOutlookEmails.filter((m) => {
              if (!m.date) return false;
              return new Date(m.date).getTime() >= emailsSince.getTime();
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

          // Calendar surface-rule hits write to inbox_items (intentional — unlike
          // email hits which go to Telegram only). See heartbeat.ts write-path audit.
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
              }).onConflictDoNothing();
              alreadyAsked.add(eventId);
              await db.insert(schema.proactiveQuestionsSent).values({
                userId,
                sourceType: provider,
                sourceId: eventId,
                question: "Surfaced by inbox rule",
              }).onConflictDoUpdate({
                target: [schema.proactiveQuestionsSent.userId, schema.proactiveQuestionsSent.sourceId],
                set: { sentAt: new Date(), question: "Surfaced by inbox rule" },
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
          const emailId = buildGmailSourceId(
            email.accountEmail || '',
            email.messageId,
            { subject: email.subject || '', from: email.from || '', receivedAt: email.receivedAt || 0 }
          );
          if (alreadyAsked.has(emailId)) continue;
          if (email.messageId && await gmailMessageIdExistsForUser(userId, email.messageId)) {
            alreadyAsked.add(emailId);
            continue;
          }

          const senderKey = extractSenderKey(email.from);

          const ruleResult = matchItemAgainstRules(
            { sourceType: "email", sourceId: emailId, sender: email.from, subject: email.subject, snippet: email.snippet },
            userRules
          );
          if (ruleResult.verdict === "suppress") continue;

          if (ruleResult.verdict === "surface") {
            try {
              alreadyAsked.add(emailId);
              if (senderKey) recentlySurfacedSenders.add(senderKey);
              await db.insert(schema.proactiveQuestionsSent).values({
                userId,
                sourceType: "email",
                sourceId: emailId,
                question: "Surfaced by inbox rule",
              }).onConflictDoUpdate({
                target: [schema.proactiveQuestionsSent.userId, schema.proactiveQuestionsSent.sourceId],
                set: { sentAt: new Date(), question: "Surfaced by inbox rule" },
              });
              const subject = email.subject || "(no subject)";
              const sender = email.from || "unknown sender";
              const snippet = email.snippet ? ` — "${email.snippet.slice(0, 120)}"` : "";
              await notifyUser(userId, "email_alert", `📧 I spotted an email that might need your attention:\n\nFrom: ${sender}\nSubject: ${subject}${snippet}\n\nReply here to tell me what to do with it.`);
              console.log(`[Curiosity] Sent Telegram alert for Gmail email for user ${userId}: ${email.subject}`);
            } catch (err) {
              console.error(`[Curiosity] Telegram email alert failed for ${emailId}:`, err);
            }
            continue;
          }

          if (senderKey && recentlySurfacedSenders.has(senderKey)) {
            console.log(`[Curiosity] Skipping gmail email from already-surfaced sender (${senderKey}): ${email.subject}`);
            continue;
          }

          items.push({
            sourceType: "gmail",
            sourceId: emailId,
            summary: `From: ${email.from || "unknown"} | Subject: "${
              email.subject || "no subject"
            }"${email.snippet ? " — " + email.snippet : ""}`,
            senderKey,
          });
        }

        for (const email of recentOutlookEmails) {
          const emailId = `outlook_email:${email.id || email.subject + ':' + (email.from || '')}`;
          if (alreadyAsked.has(emailId)) continue;

          const senderKey = extractSenderKey(email.from);

          const ruleResult = matchItemAgainstRules(
            { sourceType: "email", sourceId: emailId, sender: email.from, subject: email.subject, snippet: email.snippet },
            userRules
          );
          if (ruleResult.verdict === "suppress") continue;

          if (ruleResult.verdict === "surface") {
            try {
              alreadyAsked.add(emailId);
              if (senderKey) recentlySurfacedSenders.add(senderKey);
              await db.insert(schema.proactiveQuestionsSent).values({
                userId,
                sourceType: "outlook_email",
                sourceId: emailId,
                question: "Surfaced by inbox rule",
              }).onConflictDoUpdate({
                target: [schema.proactiveQuestionsSent.userId, schema.proactiveQuestionsSent.sourceId],
                set: { sentAt: new Date(), question: "Surfaced by inbox rule" },
              });
              const subject = email.subject || "(no subject)";
              const sender = email.from || "unknown sender";
              const snippet = email.snippet ? ` — "${email.snippet.slice(0, 120)}"` : "";
              await notifyUser(userId, "email_alert", `📧 I spotted an Outlook email that might need your attention:\n\nFrom: ${sender}\nSubject: ${subject}${snippet}\n\nReply here to tell me what to do with it.`);
              console.log(`[Curiosity] Sent Telegram alert for Outlook email for user ${userId}: ${email.subject}`);
            } catch (err) {
              console.error(`[Curiosity] Telegram Outlook email alert failed for ${emailId}:`, err);
            }
            continue;
          }

          if (senderKey && recentlySurfacedSenders.has(senderKey)) {
            console.log(`[Curiosity] Skipping Outlook email from already-surfaced sender (${senderKey}): ${email.subject}`);
            continue;
          }

          items.push({
            sourceType: "outlook_email",
            sourceId: emailId,
            summary: `From: ${email.from || "unknown"} | Subject: "${
              email.subject || "no subject"
            }"${email.snippet ? " — " + email.snippet : ""}`,
            senderKey,
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

          const srcSenderKey = srcItem?.senderKey ?? null;
          if (srcSenderKey && recentlySurfacedSenders.has(srcSenderKey)) {
            console.log(`[Curiosity] Skipping curiosity question — sender already notified (${srcSenderKey})`);
            continue;
          }

          try {
            await db.insert(schema.proactiveQuestionsSent).values({
              userId,
              sourceType: canonicalSourceType,
              sourceId: q.sourceId,
              question: q.question,
            }).onConflictDoUpdate({
              target: [schema.proactiveQuestionsSent.userId, schema.proactiveQuestionsSent.sourceId],
              set: { sentAt: new Date(), question: q.question },
            });
          } catch (dbErr: any) {
            console.error(`[Curiosity] Failed to record question for user ${userId}:`, dbErr);
            continue;
          }

          if (srcSenderKey) recentlySurfacedSenders.add(srcSenderKey);

          const isProactiveSuppressed = await isActionSuppressed(userId, "proactive_message").catch(() => false);
          if (isProactiveSuppressed) {
            console.log(`[Curiosity] proactive_message suppressed for user ${userId} (self-correction) — skipping inbox surface`);
            continue;
          }

          // INBOX_ITEMS WRITE GATE — email triage is Telegram-only.
          // Email surface-rule hits (gmail / outlook_email) are already handled above:
          // they call notifyUser(..., "email_alert", ...) and record the dedup entry in
          // proactive_questions_sent, then `continue` past this block.  No email-sourced
          // item should ever reach this point, but the isEmailType guard below is kept as
          // a safety net to prevent any regression from accidentally writing emails to
          // inbox_items.
          //
          // Calendar-derived items (google_calendar / outlook_calendar) DO write to
          // inbox_items — that is intentional so they appear in the in-app inbox.
          //
          // See heartbeat.ts enqueueNewInboxItemsForPrime for the full write-path audit.
          const isEmailType = canonicalSourceType === "email" || canonicalSourceType === "gmail" || canonicalSourceType === "outlook_email";
          let inboxInserted = false;
          if (!isEmailType) {
            try {
              const result = await db.insert(schema.inboxItems).values({
                userId,
                sourceType: canonicalSourceType as "google_calendar" | "outlook_calendar" | "outlook_email" | "email" | "telegram" | "slack" | "discord" | "whatsapp" | "other",
                sourceId: q.sourceId,
                subject: srcItem?.summary?.slice(0, 200) ?? q.question.slice(0, 200),
                sender: srcItem?.senderKey ?? null,
                snippet: q.question,
                jarvisReason: "Jarvis noticed something worth your attention",
                suggestedActions: [
                  { label: "Reply", actionType: "reply" },
                  { label: "Dismiss", actionType: "dismiss" },
                ],
              }).onConflictDoNothing().returning({ id: schema.inboxItems.id });
              inboxInserted = result.length > 0;
            } catch (inboxErr) {
              console.error(`[Curiosity] inbox_items insert failed for ${q.sourceId}:`, inboxErr);
            }
          }

          if (inboxInserted || isEmailType) {
            logAction(userId, "proactive_message", { type: "curiosity_question", sourceId: q.sourceId }).catch(() => {});
          }

          try {
            const results = await notifyUser(userId, "general", q.question, { skipIfDiscordActive: true });
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
  } finally {
    await lockClient.query(
      `SELECT pg_advisory_unlock($1::bigint)`,
      [CURIOSITY_SCAN_LOCK_ID]
    ).catch(() => {});
    lockClient.release();
  }
}

const CLEANUP_RETENTION_DAYS = 60;

async function cleanupOldCuriosityHistory(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(schema.proactiveQuestionsSent)
      .where(lt(schema.proactiveQuestionsSent.sentAt, cutoff))
      .returning({ id: schema.proactiveQuestionsSent.id });
    console.log(`[Curiosity] Cleanup: deleted ${deleted.length} rows older than ${CLEANUP_RETENTION_DAYS} days from proactive_questions_sent`);
  } catch (err) {
    console.error("[Curiosity] Cleanup failed:", err);
  }
}

export async function startCuriosityScanner(): Promise<void> {
  if (scannerStarted) {
    console.log("[Curiosity] Scanner already started — ignoring duplicate call");
    return;
  }
  scannerStarted = true;
  console.log("[Curiosity] Scanner started — runs every 30 minutes");

  setInterval(
    async () => {
      console.log("[Curiosity] Running scan...");
      await runCuriosityScan();
    },
    30 * 60 * 1000
  );

  setInterval(
    async () => {
      console.log("[Curiosity] Running daily history cleanup...");
      await cleanupOldCuriosityHistory();
    },
    24 * 60 * 60 * 1000
  );

  setTimeout(() => runCuriosityScan(), 60 * 1000);
  setTimeout(() => cleanupOldCuriosityHistory(), 5 * 60 * 1000);
}
