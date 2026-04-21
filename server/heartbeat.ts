/**
 * Jarvis Heartbeat — autonomous action daemon.
 *
 * Inspired by OpenClaw's heartbeat pattern (MIT, © 2025 Peter Steinberger).
 * Runs on a fixed interval, walks the JARVIS_HEARTBEAT.md checklist for
 * every linked user, and either acts now / queues a draft for review /
 * stays silent. No Telegram pings unless an action fired.
 */
import * as fs from "fs";
import * as path from "path";
import { db } from "./db";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { sendMessage, isTelegramConfigured } from "./integrations/telegram";
import { notifyUser } from "./channels/registry";
import { getGoogleCalendarEvents, type CalendarEvent } from "./integrations/googleCalendar";
import { getEmailsSince } from "./integrations/gmail";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { createDriveTextFile } from "./integrations/googleDrive";
import { getValidGoogleTokens } from "./userTokenStore";
import { logInteraction } from "./interactionLog";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CHECKLIST_PATH = path.resolve(process.cwd(), "JARVIS_HEARTBEAT.md");

interface UserPrefs {
  timezone?: string;
  eveningWrapUpHour?: number;
  heartbeatEnabled?: boolean;
  [key: string]: unknown;
}

let cachedChecklist: string | null = null;
let cachedChecklistMtime = 0;
function readChecklist(): string {
  try {
    const stat = fs.statSync(CHECKLIST_PATH);
    if (cachedChecklist && stat.mtimeMs === cachedChecklistMtime) return cachedChecklist;
    cachedChecklist = fs.readFileSync(CHECKLIST_PATH, "utf-8");
    cachedChecklistMtime = stat.mtimeMs;
    return cachedChecklist;
  } catch {
    return "";
  }
}

function localDateKey(now: Date, tz: string): string {
  const d = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localHour(now: Date, tz: string): number {
  return new Date(now.toLocaleString("en-US", { timeZone: tz })).getHours();
}

async function alreadyLogged(userId: string, messageType: string, sentDate: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.proactiveScheduleLog.id })
    .from(schema.proactiveScheduleLog)
    .where(
      and(
        eq(schema.proactiveScheduleLog.userId, userId),
        eq(schema.proactiveScheduleLog.messageType, messageType),
        eq(schema.proactiveScheduleLog.sentDate, sentDate),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function recordLog(userId: string, messageType: string, sentDate: string): Promise<void> {
  try {
    await db.insert(schema.proactiveScheduleLog).values({ userId, messageType, sentDate });
  } catch (err) {
    console.error("[Heartbeat] recordLog error:", err);
  }
}

// ============================================================
// Job 1 — Pre-meeting research brief (30–60 min ahead)
// ============================================================
async function runMeetingBriefs(
  userId: string,
  chatId: string,
  token: string,
  memories: { content: string; category: string }[],
  now: Date,
  tz: string,
  userEmail: string | null,
): Promise<number> {
  const localKey = localDateKey(now, tz);
  let events: CalendarEvent[] = [];
  try {
    events = await getGoogleCalendarEvents(localKey, undefined, undefined, token);
  } catch (err) {
    console.error(`[Heartbeat] calendar fetch failed for ${userId}:`, err);
    return 0;
  }
  if (events.length === 0) return 0;

  const userDomain = userEmail && userEmail.includes("@")
    ? userEmail.split("@")[1].toLowerCase()
    : null;
  const userEmailLower = userEmail?.toLowerCase() || null;

  const nowMs = now.getTime();
  let fired = 0;

  for (const event of events) {
    const startMs = new Date(event.start).getTime();
    const minutesUntil = (startMs - nowMs) / 60000;
    if (minutesUntil < 30 || minutesUntil > 60) continue;

    const attendees = (event.attendees || []).filter((a) => !a.self);
    if (attendees.length === 0) continue;

    // External attendee gating: at least one attendee must be from a
    // different domain than the user (or simply not be the user themselves
    // when we don't know the user's domain). Skip purely-internal meetings.
    const externalAttendees = attendees.filter((a) => {
      const email = a.email?.toLowerCase();
      if (!email || !email.includes("@")) return false;
      if (userEmailLower && email === userEmailLower) return false;
      const domain = email.split("@")[1];
      if (userDomain) return domain !== userDomain;
      // Without a known user domain, treat any non-self attendee as external.
      return true;
    });
    if (externalAttendees.length === 0) continue;

    const messageType = `meeting_brief:${event.id}`;
    if (await alreadyLogged(userId, messageType, localKey)) continue;

    // Pull related emails
    let emailContext = "";
    try {
      const titleWords = event.title.split(/[\s,\-—]+/).filter((w) => w.length > 3).map((w) => w.toLowerCase());
      if (titleWords.length > 0) {
        const recent = await getEmailsSince(Date.now() - 7 * 24 * 60 * 60 * 1000, token);
        const matches = recent
          .filter((e) => titleWords.some((w) => e.subject.toLowerCase().includes(w)))
          .slice(0, 3);
        if (matches.length > 0) {
          emailContext = matches.map((e) => `- "${e.subject}" from ${e.from.replace(/<.*>/, "").trim()}`).join("\n");
        }
      }
    } catch {}

    // Light web search keyed on the first external attendee or their company
    let webContext = "";
    try {
      const focal = externalAttendees[0];
      const query = focal.displayName || focal.email.split("@")[1] || event.title;
      if (query && query.length > 2) {
        const result = await tavilySearch(query, 3);
        const formatted = formatSearchResults(result).slice(0, 1500);
        if (formatted) webContext = formatted;
      }
    } catch {}

    const attendeeList = attendees.length > 0
      ? attendees.slice(0, 6).map((a) => a.displayName || a.email).join(", ")
      : "no listed attendees";

    let memoryContext = "";
    try {
      const { retrieveRelevantMemories: retrieveMemories } = await import("./memory/retrieve");
      const seedQuery = [event.title, attendeeList, event.description?.slice(0, 200) || ""].filter(Boolean).join(" • ");
      const ranked = await retrieveMemories(userId, seedQuery, 8);
      if (ranked.length > 0) {
        memoryContext = ranked.map((m) => `- [${m.category}] ${m.content}`).join("\n");
      }
    } catch {
      memoryContext = memories.length > 0
        ? memories.slice(0, 10).map((m) => `- [${m.category}] ${m.content}`).join("\n")
        : "";
    }

    // Pull matching `people` rows for the external attendees so the brief
    // can reference relationship history (Phase 4 relationship intelligence).
    let peopleContext = "";
    try {
      const emails = externalAttendees.map((a) => a.email.toLowerCase()).filter(Boolean);
      if (emails.length > 0) {
        const peopleRows = await db
          .select()
          .from(schema.people)
          .where(and(eq(schema.people.userId, userId), sql`lower(${schema.people.email}) = ANY(${emails})`));
        if (peopleRows.length > 0) {
          peopleContext = peopleRows
            .map((p) => {
              const bits = [`${p.name}${p.email ? ` <${p.email}>` : ""}`];
              if (p.relationship) bits.push(`relationship: ${p.relationship}`);
              if (p.interactionCount && p.interactionCount > 0) bits.push(`prior interactions: ${p.interactionCount}`);
              if (p.lastInteractionAt) bits.push(`last seen: ${new Date(p.lastInteractionAt).toISOString().slice(0, 10)}`);
              if (p.notes) bits.push(`notes: ${p.notes.slice(0, 200)}`);
              return `- ${bits.join(" — ")}`;
            })
            .join("\n");
        }
      }
    } catch (err) {
      console.error("[Heartbeat] people lookup failed:", err);
    }

    const eventTime = new Date(event.start).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz,
    });

    const prompt = `Compose a tight pre-meeting briefing for the user.

Meeting: "${event.title}"
Time: ${eventTime} (${tz})
Attendees: ${attendeeList}
${event.location ? `Location: ${event.location}\n` : ""}${event.description ? `Description: ${event.description.slice(0, 400)}\n` : ""}
${emailContext ? `\nRelated recent emails:\n${emailContext}\n` : ""}${webContext ? `\nWeb context:\n${webContext}\n` : ""}${peopleContext ? `\nRelationship history with attendees:\n${peopleContext}\n` : ""}${memoryContext ? `\nWhat we know about the user:\n${memoryContext}\n` : ""}

Output exactly 3 short bullets (one line each, no headers):
• Who/what — one line on the meeting and key person/company
• Why it matters — one line on stakes or context
• Suggested focus — one specific thing to drive in the meeting

Plain text, no markdown asterisks, no preamble.`;

    let brief = "";
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 600,
      });
      brief = resp.choices[0]?.message?.content?.trim() || "";
    } catch (err) {
      console.error(`[Heartbeat] brief generation failed for "${event.title}":`, err);
      continue;
    }
    if (!brief) continue;

    const header = `📅 Meeting in ~${Math.round(minutesUntil)} min — ${event.title} (${eventTime})`;
    const fullMsg = `${header}\n\n${brief}`;
    try {
      // Route through channel preferences (telegram/whatsapp/slack/daemon).
      // Falls back to telegram by default if the user hasn't set prefs.
      await notifyUser(userId, "meeting_brief", fullMsg);
      await recordLog(userId, messageType, localKey);
      logInteraction(userId, "notification", "outbound", fullMsg, "meeting_brief").catch(() => {});
      fired++;
      console.log(`[Heartbeat] sent meeting brief for "${event.title}" to ${userId}`);
    } catch (err) {
      console.error(`[Heartbeat] send brief failed:`, err);
    }
  }
  return fired;
}

// ============================================================
// Job 2 — Autonomous email draft queue
// ============================================================
async function runEmailDrafts(
  userId: string,
  chatId: string,
  token: string,
  now: Date,
): Promise<number> {
  // Pick only inbox items that came from the email-alert *classifier*
  // (status=pending, no matched rule, has a jarvis_reason). Rule-surfaced
  // items have matched_rule_id set and are NOT reply-needed candidates.
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  let urgentItems: typeof schema.inboxItems.$inferSelect[] = [];
  try {
    urgentItems = await db
      .select()
      .from(schema.inboxItems)
      .where(
        and(
          eq(schema.inboxItems.userId, userId),
          eq(schema.inboxItems.sourceType, "email"),
          eq(schema.inboxItems.status, "pending"),
          sql`${schema.inboxItems.surfacedAt} > ${twelveHoursAgo}`,
          sql`${schema.inboxItems.jarvisReason} IS NOT NULL`,
          sql`${schema.inboxItems.matchedRuleId} IS NULL`,
        ),
      )
      .limit(10);
  } catch (err) {
    console.error(`[Heartbeat] urgent inbox fetch failed:`, err);
    return 0;
  }
  if (urgentItems.length === 0) return 0;

  // Second filter: the alert reason must read as "reply needed". The email-
  // alert classifier flags several categories (deadline, cancelled meeting,
  // urgent reply, time-sensitive). We only auto-draft for reply-needed ones —
  // a meeting cancellation or a deadline reminder doesn't need a reply.
  const replySignals = /reply|respond|response|answer|follow[- ]?up|confirm|question|asking|requesting/i;
  urgentItems = urgentItems.filter((it) => replySignals.test(it.jarvisReason || ""));
  if (urgentItems.length === 0) return 0;

  // Pull recent email bodies to give the drafter context
  let recentEmails: Awaited<ReturnType<typeof getEmailsSince>> = [];
  try {
    recentEmails = await getEmailsSince(Date.now() - 24 * 60 * 60 * 1000, token);
  } catch {}

  let queued = 0;

  for (const item of urgentItems) {
    const sourceMessageId = item.sourceId.startsWith("gmail:") ? item.sourceId.slice(6) : null;
    if (!sourceMessageId) continue;

    // Idempotency: skip if we already have a draft for this message
    try {
      const existing = await db
        .select({ id: schema.emailDrafts.id })
        .from(schema.emailDrafts)
        .where(
          and(
            eq(schema.emailDrafts.userId, userId),
            eq(schema.emailDrafts.sourceMessageId, sourceMessageId),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
    } catch {}

    const matched = recentEmails.find((e) => e.messageId === sourceMessageId);
    const senderEmail = matched?.from || item.sender || "";
    const recipientMatch = senderEmail.match(/<([^>]+)>/);
    const recipientEmail = recipientMatch ? recipientMatch[1] : senderEmail.trim();
    if (!recipientEmail || !recipientEmail.includes("@")) continue;

    const subject = item.subject || matched?.subject || "(no subject)";
    const snippet = item.snippet || matched?.snippet || "";
    const reason = item.jarvisReason || "";

    const prompt = `You are drafting a reply on the user's behalf. Be polite, direct, on-voice. Plain text, no markdown.

Original email:
From: ${senderEmail}
Subject: ${subject}
Snippet: ${snippet}

Why this needs a reply: ${reason}

Write a concise reply (2–4 short paragraphs max). Do NOT invent commitments, prices, dates, or facts the user has not stated. If you need information from the user, leave a clearly bracketed placeholder like [confirm date] or [add link]. Sign off as the user — do not include a signature line.

Return JSON: { "subject": "Re: ...", "body": "..." }`;

    let draftSubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    let draftBody = "";
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 800,
      });
      const raw = resp.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw) as { subject?: string; body?: string };
      if (parsed.subject) draftSubject = parsed.subject;
      if (parsed.body) draftBody = parsed.body;
    } catch (err) {
      console.error(`[Heartbeat] draft generation failed:`, err);
      continue;
    }
    if (!draftBody.trim()) continue;

    try {
      await db.insert(schema.emailDrafts).values({
        userId,
        sourceMessageId,
        fromSender: senderEmail,
        originalSubject: subject,
        draftSubject,
        draftBody,
        jarvisReason: reason,
      });
      queued++;
      console.log(`[Heartbeat] queued draft reply for "${subject}" (user ${userId})`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "23505") console.error(`[Heartbeat] draft insert failed:`, err);
    }
  }

  if (queued > 0) {
    const localKey = localDateKey(now, "UTC");
    const nudgeKey = `draft_nudge:${queued}`;
    if (!(await alreadyLogged(userId, nudgeKey, localKey))) {
      try {
        await sendMessage(
          chatId,
          `✉️ ${queued} email draft${queued === 1 ? "" : "s"} waiting for your review in the Inbox tab.`,
        );
        await recordLog(userId, nudgeKey, localKey);
        logInteraction(userId, "notification", "outbound", `Draft queue: ${queued} item(s)`, "draft_nudge").catch(() => {});
      } catch (err) {
        console.error(`[Heartbeat] draft nudge send failed:`, err);
      }
    }
  }

  return queued;
}

// ============================================================
// Job 3 — Evening wrap-up
// ============================================================
async function runEveningWrapUp(
  userId: string,
  chatId: string,
  token: string | null,
  prefs: UserPrefs,
  now: Date,
  tz: string,
): Promise<boolean> {
  const wrapHour = typeof prefs.eveningWrapUpHour === "number" ? prefs.eveningWrapUpHour : 21;
  const hour = localHour(now, tz);
  if (hour < wrapHour || hour >= 24) return false;

  const localKey = localDateKey(now, tz);
  const messageType = "evening_wrapup";
  if (await alreadyLogged(userId, messageType, localKey)) return false;

  // ── Today's plan ──────────────────────────────────────────
  type PlanTask = { title: string; completed?: boolean; category?: string };
  let tasks: PlanTask[] = [];
  try {
    const planRows = await db
      .select()
      .from(schema.plans)
      .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, localKey)))
      .limit(1);
    const data = (planRows[0]?.data as { tasks?: PlanTask[] }) || {};
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
  } catch {}

  // ── Current stats ─────────────────────────────────────────
  type StatsData = {
    streak?: number;
    bestStreak?: number;
    xp?: number;
    totalCompleted?: number;
    lastStreakDate?: string;
  };
  let statsData: StatsData = {};
  let statsRowExists = false;
  try {
    const statsRows = await db.select().from(schema.stats).where(eq(schema.stats.userId, userId)).limit(1);
    if (statsRows.length > 0) {
      statsData = (statsRows[0].data as StatsData) || {};
      statsRowExists = true;
    }
  } catch {}

  const completed = tasks.filter((t) => t.completed);
  const open = tasks.filter((t) => !t.completed);
  const completedCount = completed.length;

  // ── Update XP, streak, totalCompleted (idempotent via lastStreakDate) ──
  if (completedCount > 0 && statsRowExists) {
    try {
      const yesterday = (() => {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return localDateKey(d, tz);
      })();

      const lastDate = statsData.lastStreakDate || "";
      let newStreak = statsData.streak || 0;

      if (lastDate === localKey) {
        // Already updated tonight (shouldn't happen due to alreadyLogged, but guard anyway)
      } else if (lastDate === yesterday) {
        // Consecutive — extend streak
        newStreak += 1;
      } else if (lastDate < localKey) {
        // Gap or first ever — reset to 1
        newStreak = 1;
      }

      const xpEarned = completedCount * 10;
      const newXp = (statsData.xp || 0) + xpEarned;
      const newTotalCompleted = (statsData.totalCompleted || 0) + completedCount;
      const newBestStreak = Math.max(statsData.bestStreak || 0, newStreak);

      await db
        .update(schema.stats)
        .set({
          data: {
            ...statsData,
            streak: newStreak,
            bestStreak: newBestStreak,
            xp: newXp,
            totalCompleted: newTotalCompleted,
            lastStreakDate: localKey,
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.stats.userId, userId));

      // Refresh for LLM prompt
      statsData = {
        ...statsData,
        streak: newStreak,
        bestStreak: newBestStreak,
        xp: newXp,
        totalCompleted: newTotalCompleted,
        lastStreakDate: localKey,
      };

      console.log(`[Heartbeat] stats updated for ${userId}: streak=${newStreak}, xp+${xpEarned}`);
    } catch (err) {
      console.error(`[Heartbeat] stats update failed (non-fatal):`, err);
    }
  }

  const completedList = completed.length > 0
    ? completed.slice(0, 8).map((t) => `- ${t.title}`).join("\n")
    : "(nothing checked off today)";
  const openList = open.length > 0
    ? open.slice(0, 6).map((t) => `- ${t.title}`).join("\n")
    : "(no open items)";

  // ── Generate 4-line summary + tomorrow seed (single LLM call) ────────
  const llmPrompt = `Compose a short evening wrap-up for the user. Warm but direct — no fluff.

Today (${localKey}):
Streak: ${statsData.streak || 0} days | XP: ${statsData.xp || 0} | Best streak: ${statsData.bestStreak || 0}

Completed today (${completedCount}):
${completedList}

Still open (${open.length}):
${openList}

Return JSON:
{
  "summary": "<4 short sentences: (1) acknowledge what got done, (2) note what's still open, (3) one observation about today's pattern, (4) one specific prompt for tomorrow morning — plain text, no markdown, total ≤90 words>",
  "tomorrowPrompt": "<single sentence: a concrete morning-focus intention for tomorrow, ≤20 words>",
  "observation": "<one sentence pattern observation from today, ≤15 words>"
}`;

  let summary = "";
  let tomorrowPrompt = "";
  let observation = "";
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: llmPrompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 600,
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}") as {
      summary?: string;
      tomorrowPrompt?: string;
      observation?: string;
    };
    summary = parsed.summary?.trim() || "";
    tomorrowPrompt = parsed.tomorrowPrompt?.trim() || "";
    observation = parsed.observation?.trim() || "";
  } catch (err) {
    console.error(`[Heartbeat] wrap-up generation failed:`, err);
    return false;
  }
  if (!summary) return false;

  // ── Send through channel preferences (telegram/whatsapp/slack/daemon) ──
  try {
    await notifyUser(userId, "evening_wrap", `🌙 Evening wrap-up\n\n${summary}`);
    logInteraction(userId, "notification", "outbound", summary, "evening_wrapup").catch(() => {});
  } catch (err) {
    console.error(`[Heartbeat] wrap-up send failed:`, err);
    return false;
  }

  // ── Pre-load tomorrow planning seed into userPreferences ──────────────
  // The morning plan generator can read prefs.data.tomorrowSeed to start
  // the day with carry-over context rather than a blank slate.
  try {
    const tomorrowKey = (() => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return localDateKey(d, tz);
    })();

    const prefRows = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    const prefData = (prefRows[0]?.data as Record<string, unknown>) || {};

    const tomorrowSeed = {
      date: tomorrowKey,
      generatedAt: now.toISOString(),
      carryoverTasks: open.slice(0, 8).map((t) => t.title),
      observation,
      tomorrowPrompt,
    };

    await db
      .update(schema.userPreferences)
      .set({ data: { ...prefData, tomorrowSeed }, updatedAt: new Date() })
      .where(eq(schema.userPreferences.userId, userId));

    console.log(`[Heartbeat] tomorrow seed written for ${userId} (date: ${tomorrowKey})`);
  } catch (err) {
    console.error(`[Heartbeat] tomorrow seed write failed (non-fatal):`, err);
  }

  // ── Save markdown reflection to Drive ────────────────────────────────
  if (token) {
    try {
      const reflection = `# Evening reflection — ${localKey}\n\n${summary}\n\n---\n\n## Completed (${completedCount})\n${completedList}\n\n## Carry into tomorrow (${open.length})\n${openList}\n${observation ? `\n## Pattern note\n${observation}\n` : ""}${tomorrowPrompt ? `\n## Tomorrow morning\n${tomorrowPrompt}\n` : ""}`;
      await createDriveTextFile(token, `reflection-${localKey}.md`, reflection, { convertToDoc: false });
      console.log(`[Heartbeat] reflection saved to Drive for ${userId}`);
    } catch (err) {
      console.error(`[Heartbeat] Drive save failed (non-fatal):`, err);
    }
  }

  await recordLog(userId, messageType, localKey);
  return true;
}

// ============================================================
// Tick — walk the checklist for every linked user
// ============================================================
export async function runHeartbeatTick(): Promise<void> {
  // Phase 4 — once per UTC day, decay stale memories so the SOUL stays fresh.
  // No-op the rest of the day (cheap idempotency check).
  try {
    const { maybeRunDailyDecay } = await import("./memory/decay");
    await maybeRunDailyDecay();
  } catch (err) {
    console.error("[Heartbeat] memory decay failed:", err);
  }

  const checklist = readChecklist();
  if (!checklist) {
    console.warn("[Heartbeat] checklist file missing, skipping tick");
    return;
  }

  let links: typeof schema.telegramLinks.$inferSelect[] = [];
  try {
    links = await db.select().from(schema.telegramLinks);
  } catch (err) {
    console.error("[Heartbeat] failed to load telegram links:", err);
    return;
  }
  if (links.length === 0) return;

  const allPrefs = await db.select().from(schema.userPreferences).catch(() => []);
  const prefsMap: Record<string, UserPrefs> = {};
  for (const p of allPrefs) prefsMap[p.userId] = (p.data as UserPrefs) || {};

  // Load user emails (username is the Google-authed email address) for
  // external-attendee domain detection in the meeting brief job.
  const allUsers = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .catch(() => []);
  const userEmailMap: Record<string, string | null> = {};
  for (const u of allUsers) userEmailMap[u.id] = u.username || null;

  const now = new Date();

  for (const link of links) {
    const prefs = prefsMap[link.userId] || {};
    if (prefs.heartbeatEnabled === false) continue;
    const tz = prefs.timezone || "America/New_York";
    const userEmail = userEmailMap[link.userId] || null;

    let token: string | null = null;
    try {
      const tokens = await getValidGoogleTokens(link.userId);
      token = tokens?.[0] || null;
    } catch {}

    let memories: { content: string; category: string }[] = [];
    try {
      memories = await db
        .select({ content: schema.userMemories.content, category: schema.userMemories.category })
        .from(schema.userMemories)
        .where(eq(schema.userMemories.userId, link.userId))
        .orderBy(desc(schema.userMemories.extractedAt))
        .limit(30);
    } catch {}

    let actionsFired = 0;
    try {
      if (token) actionsFired += await runMeetingBriefs(link.userId, link.chatId, token, memories, now, tz, userEmail);
    } catch (err) { console.error(`[Heartbeat] meeting briefs failed for ${link.userId}:`, err); }

    try {
      if (token) actionsFired += await runEmailDrafts(link.userId, link.chatId, token, now);
    } catch (err) { console.error(`[Heartbeat] email drafts failed for ${link.userId}:`, err); }

    try {
      if (await runEveningWrapUp(link.userId, link.chatId, token, prefs, now, tz)) actionsFired++;
    } catch (err) { console.error(`[Heartbeat] wrap-up failed for ${link.userId}:`, err); }

    // Phase 4 — heartbeat memory ingestion. Pull anything new since the
    // last tick (recent telegram messages, today's calendar attendees)
    // and push it through the unified extractor + people-sync passes.
    try {
      await runHeartbeatMemoryPass(link.userId, token, now);
    } catch (err) {
      console.error(`[Heartbeat] memory pass failed for ${link.userId}:`, err);
    }

    if (actionsFired > 0) {
      console.log(`[Heartbeat] user ${link.userId} — ${actionsFired} action(s) fired`);
    }
  }
}

/**
 * Phase 4 — incremental memory + people ingestion called once per user
 * per heartbeat tick. Keeps the SOUL fresh without waiting for the
 * weekly Sunday job.
 */
const lastHeartbeatExtractAt: Record<string, number> = {};
const HEARTBEAT_EXTRACT_INTERVAL_MS = 60 * 60 * 1000; // hourly per user

async function runHeartbeatMemoryPass(userId: string, googleToken: string | null, now: Date): Promise<void> {
  const last = lastHeartbeatExtractAt[userId] || 0;
  if (now.getTime() - last < HEARTBEAT_EXTRACT_INTERVAL_MS) return;
  lastHeartbeatExtractAt[userId] = now.getTime();

  const sinceCutoff = new Date(now.getTime() - HEARTBEAT_EXTRACT_INTERVAL_MS);

  // 1) Telegram messages received in the last hour → memory extraction.
  try {
    const recentMessages = await db
      .select()
      .from(schema.telegramGroupMessages)
      .where(and(eq(schema.telegramGroupMessages.userId, userId), gte(schema.telegramGroupMessages.messageDate, sinceCutoff)))
      .orderBy(desc(schema.telegramGroupMessages.messageDate))
      .limit(20);
    if (recentMessages.length > 0) {
      const text = recentMessages.map((m) => `[${m.fromUser ?? "?"}]: ${m.text}`).join("\n").slice(0, 4000);
      const { extractAndStore } = await import("./memory/extractor");
      await extractAndStore({
        userId,
        source: text,
        sourceType: "heartbeat_telegram",
        sourceRef: `${now.toISOString().slice(0, 13)}`,
      });
    }
  } catch (err) {
    console.error(`[Heartbeat] telegram extract failed for ${userId}:`, err);
  }

  // 2) People sync from today's calendar attendees + recent gmail
  // senders. Each non-self attendee/sender is upserted into the people
  // table with role hints; future runs increment interaction_count.
  try {
    if (googleToken) {
      const { syncPeopleFromGoogle } = await import("./memory/peopleSync");
      await syncPeopleFromGoogle(userId, googleToken, now);
    }
  } catch (err) {
    console.error(`[Heartbeat] people sync failed for ${userId}:`, err);
  }
}

export function startHeartbeat(): void {
  if (!isTelegramConfigured()) return;
  console.log(`[Heartbeat] daemon started — checklist at ${CHECKLIST_PATH}, interval ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  setTimeout(() => { runHeartbeatTick().catch((err) => console.error("[Heartbeat] tick error:", err)); }, 60 * 1000);
  setInterval(() => { runHeartbeatTick().catch((err) => console.error("[Heartbeat] tick error:", err)); }, HEARTBEAT_INTERVAL_MS);
}
