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
import { activationPlanner } from "./agent/activationPlanner";
import { getGoogleCalendarEvents, type CalendarEvent } from "./integrations/googleCalendar";
import { getEmailsSince } from "./integrations/gmail";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { createDriveTextFile } from "./integrations/googleDrive";
import { getValidGoogleTokens } from "./userTokenStore";
import { parseGmailMessageId } from "./utils/gmailSourceId";
import { logInteraction } from "./interactionLog";
import { logAction, isActionSuppressed } from "./intelligence/actionLog";
import { claimAndMark } from "./lib/proactiveDedup";
import { emit as diagEmit } from "./diagnostics/diagnosticsService";
import { createRoutedOpenAIChatShim } from "./agent/routedChatCompletion";

const openai = createRoutedOpenAIChatShim("[Heartbeat]", "balanced");

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CHECKLIST_PATH = path.resolve(process.cwd(), "JARVIS_HEARTBEAT.md");
const VALIDATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Maximum number of pending crew tasks to batch into a single PRIME routing
 * call per heartbeat tick. Configurable via CREW_BATCH_MAX env var.
 */
const CREW_BATCH_MAX = (() => {
  const v = parseInt(process.env.CREW_BATCH_MAX ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
})();

/**
 * In-process queue of pending crew-routable tasks per userId.
 * Tasks are enqueued via `enqueueCrewTask` and flushed once per tick
 * via `flushCrewBatch`. The queue is intentionally in-memory; tasks
 * are not persisted — they are ephemeral routing signals only.
 */
const crewTaskQueue = new Map<string, string[]>();

/**
 * Enqueue a task string for PRIME routing during the next heartbeat tick.
 * Thread-safe (single-process Node.js event loop).
 */
export function enqueueCrewTask(userId: string, task: string): void {
  const queue = crewTaskQueue.get(userId) ?? [];
  queue.push(task);
  crewTaskQueue.set(userId, queue);
}

// Tracks the last time the integration validator ran so each heartbeat tick
// can gate the (expensive) validation cycle to once per 30 minutes.
let lastValidationRunAt = 0;

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
    if (!(await claimAndMark(userId, messageType, localKey))) continue;

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
      const { getModel } = await import("./lib/modelPrefs");
      const briefModel = await getModel(userId, "planning");
      const resp = await openai.chat.completions.create({
        model: briefModel,
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
      logInteraction(userId, "notification", "outbound", fullMsg, "meeting_brief").catch(() => {});
      logAction(userId, "meeting_brief", { eventTitle: event.title, eventId: event.id }).catch(() => {});
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
    const sourceMessageId = parseGmailMessageId(item.sourceId);
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
      const { getModel } = await import("./lib/modelPrefs");
      const draftModel = await getModel(userId, "planning");
      const resp = await openai.chat.completions.create({
        model: draftModel,
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
      logAction(userId, "email_drafted", { subject, sourceMessageId }).catch(() => {});
      console.log(`[Heartbeat] queued draft reply for "${subject}" (user ${userId})`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "23505") console.error(`[Heartbeat] draft insert failed:`, err);
    }
  }

  if (queued > 0) {
    const localKey = localDateKey(now, "UTC");
    const nudgeKey = `draft_nudge:${queued}`;
    if (await claimAndMark(userId, nudgeKey, localKey)) {
      try {
        await notifyUser(
          userId,
          "email_alert",
          `✉️ ${queued} email draft${queued === 1 ? "" : "s"} waiting for your review in the Inbox tab.`,
        );
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
  // Atomic INSERT … ON CONFLICT DO NOTHING claim — prevents duplicate sends
  // on rapid server restarts (same TOCTOU fix applied to telegramRoutes.ts in
  // task #542). claimAndMark returns true only for the one process that wins
  // the INSERT; all racing restarts get false and skip.
  if (!(await claimAndMark(userId, messageType, localKey))) return false;

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
        // Already updated tonight (shouldn't happen due to claimAndMark, but guard anyway)
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
    const { getModel } = await import("./lib/modelPrefs");
    const wrapModel = await getModel(userId, "planning");
    const resp = await openai.chat.completions.create({
      model: wrapModel,
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
    logAction(userId, "evening_wrap", { date: localKey, completedCount, openCount: open.length }).catch(() => {});
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

  // No recordLog() call here — the slot was already claimed atomically by
  // claimAndMark() at the top of this function before any work began.
  return true;
}

// Dream synthesis and delivery are handled entirely by the scheduler,
// which iterates ALL users (not just telegram-linked) with per-user timezone
// gating. See server/scheduler.ts: runDreamCycleForAllUsers (3am local)
// and runDreamDeliveryForAllUsers (7-10am local).

// ============================================================
// Crew batch flush — PRIME routing (one call per user per tick)
// ============================================================

/**
 * Flush up to CREW_BATCH_MAX pending crew tasks for a user into a single
 * PRIME orchestrator call. Returns the number of tasks processed.
 *
 * All pending tasks are concatenated into one batched request string so PRIME
 * decomposes them together and routes sub-tasks to the correct specialists.
 * This avoids one extra model call per task and ensures PRIME has the full
 * picture when deciding specialist assignments.
 */
/**
 * Collect inbox items surfaced in the past CREW_INBOX_WINDOW_MS that are still
 * pending (no actedAt) and enqueue them for PRIME triage.  Up to CREW_BATCH_MAX
 * items are enqueued so the batch flush can route them in a single PRIME call
 * rather than one orchestration call per item.
 *
 * This is the primary internal call site for enqueueCrewTask within the heartbeat.
 *
 * INBOX_ITEMS WRITE PATH AUDIT (keep this comment up to date):
 *   Legitimate write paths to the inbox_items table:
 *   1. curiosityScanner.ts  — calendar surface-rule hits (google_calendar /
 *      outlook_calendar). These are intentional: calendar events that match a
 *      user surface rule appear in the in-app inbox so the user can prep or
 *      dismiss them.
 *   2. nervous-system/scanner.ts — gut/news watch hits (sourceType
 *      "nervous_system"). Intentional: surfaced signals the user asked Jarvis
 *      to monitor appear in the inbox.
 *   3. channels/inAppChannel.ts — "In-App" notification channel writes
 *      general Jarvis notifications directly to inbox_items so users who prefer
 *      in-app delivery see them there.
 *   4. routes.ts / telegramRoutes.ts — manual inbox item creation via API
 *      (user-triggered or agent-triggered from conversation).
 *   5. agent/tools/applyCodeChangeTool.ts — agent self-edit tool surfaces a
 *      confirmation item after applying a code change.
 *   6. index.ts — initial seed / setup flows.
 *
 *   RETIRED write path (email triage):
 *   Email surface-rule hits (Gmail + Outlook) previously wrote to inbox_items.
 *   This path was retired after email rules were migrated to Telegram delivery.
 *   Email hits now call notifyUser(..., "email_alert", ...) and are recorded in
 *   proactive_questions_sent for dedup — they are NEVER written to inbox_items.
 *   See curiosityScanner.ts (isEmailType guard) for the authoritative check.
 *
 *   Because the email write path is retired, email-sourced items will no longer
 *   appear in this queue. Remaining sources include calendar surface rules,
 *   nervous-system hits, in-app channel writes, and any other path that inserts
 *   a pending inbox_items row — the query does not filter by sourceType so all
 *   pending items within the time window are eligible for PRIME triage.
 */
const CREW_INBOX_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

async function enqueueNewInboxItemsForPrime(userId: string): Promise<number> {
  const windowStart = new Date(Date.now() - CREW_INBOX_WINDOW_MS);
  let items: typeof schema.inboxItems.$inferSelect[] = [];
  try {
    items = await db
      .select()
      .from(schema.inboxItems)
      .where(
        and(
          eq(schema.inboxItems.userId, userId),
          eq(schema.inboxItems.status, "pending"),
          sql`${schema.inboxItems.actedAt} IS NULL`,
          sql`${schema.inboxItems.surfacedAt} >= ${windowStart.toISOString()}`,
        ),
      )
      .limit(CREW_BATCH_MAX);
  } catch (err) {
    console.error(`[Heartbeat/crew] inbox query failed for ${userId}:`, err);
    return 0;
  }
  if (items.length === 0) return 0;
  for (const item of items) {
    const taskDescription = [
      `Triage inbox item: "${item.subject ?? "(no subject)"}"`,
      item.sender ? `from ${item.sender}` : null,
      item.snippet ? `— ${item.snippet.slice(0, 120)}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    enqueueCrewTask(userId, taskDescription);
  }
  console.log(`[Heartbeat/crew] enqueued ${items.length} inbox item(s) for PRIME triage (user ${userId})`);
  return items.length;
}

async function flushCrewBatch(
  userId: string,
  tools: import("./agent/types").AgentTool[],
  toolContext: import("./agent/types").ToolContext,
  systemContext: string,
): Promise<number> {
  const queue = crewTaskQueue.get(userId);
  if (!queue || queue.length === 0) return 0;

  // Drain up to CREW_BATCH_MAX tasks from the queue
  const batch = queue.splice(0, CREW_BATCH_MAX);
  if (queue.length === 0) {
    crewTaskQueue.delete(userId);
  } else {
    crewTaskQueue.set(userId, queue);
  }

  const batchedRequest = batch.length === 1
    ? batch[0]
    : `Process the following ${batch.length} tasks:\n${batch.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

  console.log(`[Heartbeat/crew] flushing ${batch.length} task(s) for user ${userId} via PRIME`);

  try {
    const { runOrchestrator } = await import("./agent/orchestrator");
    const result = await runOrchestrator({
      userId,
      userRequest: batchedRequest,
      systemContext,
      tools,
      toolContext,
      maxRetries: 1,
    });
    console.log(`[Heartbeat/crew] PRIME batch complete — traceId=${result.traceId} subtasks=${result.subtaskCount}`);
    return batch.length;
  } catch (err) {
    console.error(`[Heartbeat/crew] batch orchestration failed for user ${userId}:`, err);
    return 0;
  }
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
    diagEmit({
      subsystem: "heartbeat",
      severity: "error",
      message: `Memory decay job failed: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { task: "memory_decay" },
    }).catch(() => {});
  }

  // Once per UTC day, prune emotional state history rows older than 90 days.
  // The in-memory day-key guard makes this a no-op on subsequent ticks.
  try {
    const { maybeRunDailyHistoryPrune } = await import("./intelligence/emotional-state");
    await maybeRunDailyHistoryPrune();
  } catch (err) {
    console.error("[Heartbeat] emotional state history prune failed:", err);
    diagEmit({
      subsystem: "heartbeat",
      severity: "warning",
      message: `Emotional state history prune failed: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { task: "emotional_state_prune" },
    }).catch(() => {});
  }

  // Integration validator — runs every 30 min (gated here so the validator
  // itself no longer needs its own setInterval).
  if (Date.now() - lastValidationRunAt >= VALIDATION_INTERVAL_MS) {
    lastValidationRunAt = Date.now();
    try {
      const { runValidationCycle } = await import("./intelligence/integrationValidator");
      await runValidationCycle();
    } catch (err) {
      console.error("[Heartbeat] integration validation failed:", err);
      diagEmit({
        subsystem: "integration",
        severity: "error",
        message: `Integration validation cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        metadata: { task: "validation_cycle" },
      }).catch(() => {});
    }
  }

  // Nervous System — runs first, independent of Telegram linkage.
  // The scanner tracks its own per-user 30-min throttle internally.
  try {
    const { runNervousSystemScan } = await import("./nervous-system/scanner");
    await runNervousSystemScan();
  } catch (err) {
    console.error("[Heartbeat] nervous system scan failed:", err);
    diagEmit({
      subsystem: "heartbeat",
      severity: "error",
      message: `Nervous system scan failed: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { task: "nervous_system_scan" },
    }).catch(() => {});
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

    // ── Activation planner — context and manifest for this tick ───────────
    // The planner gathers Foresight predictions, emotional state, skill count,
    // and time-of-day to produce a SessionContext and CapabilityManifest. Its
    // output is used for:
    //
    //   1. Logging urgent signals and capability decisions for observability.
    //   2. Passing session context into runAgent so proactive model sessions
    //      (future feature: Jarvis-initiated outreach) are primed with what to
    //      focus on when they eventually start spinning up in this heartbeat.
    //   3. plan.shouldRun gates those future proactive outreach sessions ONLY.
    //
    // The existing scheduled jobs (runMeetingBriefs, runEmailDrafts,
    // runEveningWrapUp) are NOT gated by plan.shouldRun — they have their own
    // internal eligibility and deduplication logic and are the authoritative
    // source for whether job-level work exists. Gating them on shouldRun would
    // require the planner to inspect job-level signals it does not have access
    // to (upcoming meeting windows, pending email candidates), violating the
    // "all existing behavior preserved" requirement.
    //
    // Non-LLM background tasks (emotional state, gut scan, prediction
    // validation, memory pass) always run — never gated.
    try {
      const plan = await activationPlanner.plan(link.userId, { source: "heartbeat", timezone: tz });
      if (plan.sessionContext.urgentSignals.length > 0) {
        console.log(`[Heartbeat] user ${link.userId} — urgent signals: ${plan.sessionContext.urgentSignals.join(", ")}`);
      }
      if (!plan.shouldRun) {
        console.log(`[Heartbeat] user ${link.userId} — planner note (informational): ${plan.reason}`);
      }
    } catch (err) {
      // Best-effort — never block the heartbeat on a planner failure
      console.warn(`[Heartbeat] activation planner failed for ${link.userId} (non-fatal):`, err);
    }

    // Emotional State Engine — recompute once per tick, per user.
    // Always runs — not gated by the activation planner.
    try {
      const { computeAndStoreEmotionalState } = await import("./intelligence/emotional-state");
      await computeAndStoreEmotionalState(link.userId, tz, now);
    } catch (err) {
      console.error(`[Heartbeat] emotional state computation failed for ${link.userId}:`, err);
    }

    // Gut — reflexive anomaly detection. Runs on every tick; detectors
    // have their own internal deduplication windows (24–72 h per type).
    // Always runs — not gated by the activation planner.
    try {
      const { runGutScanForUser } = await import("./intelligence/gut");
      await runGutScanForUser(link.userId, userEmail, now);
    } catch (err) {
      console.error(`[Heartbeat] gut scan failed for ${link.userId}:`, err);
    }

    // Prediction Validation — validate expired predictions against actual data.
    // Always runs — not gated by the activation planner.
    try {
      const { validateExpiredPredictions } = await import("./intelligence/predictor");
      await validateExpiredPredictions(link.userId, now);
    } catch (err) {
      console.error(`[Heartbeat] prediction validation failed for ${link.userId}:`, err);
    }

    // ── LLM-driven action jobs ─────────────────────────────────────────────
    // Run every tick; each job has its own eligibility and deduplication logic.
    // Not gated by the activation planner — see planner comment block above.
    //
    // Morning brief ownership note: heartbeat does NOT own a morning brief.
    // The morning briefing (type: "morning") is owned entirely by the proactive
    // scheduler in server/telegramRoutes.ts (startProactiveScheduler +
    // runProactiveStartupCatchup). Both paths already use claimAndMark() from
    // server/lib/proactiveDedup.ts. Do not add a duplicate morning send here.
    try {
      if (token && !await isActionSuppressed(link.userId, "meeting_brief"))
        actionsFired += await runMeetingBriefs(link.userId, link.chatId, token, memories, now, tz, userEmail);
    } catch (err) { console.error(`[Heartbeat] meeting briefs failed for ${link.userId}:`, err); }

    try {
      if (token && !await isActionSuppressed(link.userId, "email_drafted"))
        actionsFired += await runEmailDrafts(link.userId, link.chatId, token, now);
    } catch (err) { console.error(`[Heartbeat] email drafts failed for ${link.userId}:`, err); }

    try {
      if (!await isActionSuppressed(link.userId, "evening_wrap") &&
          await runEveningWrapUp(link.userId, link.chatId, token, prefs, now, tz)) actionsFired++;
    } catch (err) { console.error(`[Heartbeat] wrap-up failed for ${link.userId}:`, err); }

    // Phase 4 — heartbeat memory ingestion. Pull anything new since the
    // last tick (recent telegram messages, today's calendar attendees)
    // and push it through the unified extractor + people-sync passes.
    // Always runs — not gated by the activation planner.
    try {
      await runHeartbeatMemoryPass(link.userId, token, now);
    } catch (err) {
      console.error(`[Heartbeat] memory pass failed for ${link.userId}:`, err);
    }

    // ── Crew inbox enqueue — collect freshly surfaced items for PRIME ───────
    // Find inbox items surfaced in the last 30 min that haven't been actioned.
    // Enqueues them so the flush below can route all of them in one PRIME call.
    try {
      await enqueueNewInboxItemsForPrime(link.userId);
    } catch (err) {
      console.error(`[Heartbeat] crew inbox enqueue failed for ${link.userId}:`, err);
    }

    // ── Crew batch flush (one PRIME call per user per tick) ────────────────
    // Drain any pending crew-routable tasks for this user into a single PRIME
    // orchestration call. Populated above by enqueueNewInboxItemsForPrime or
    // by any external caller using enqueueCrewTask().
    // Runs only when there are pending tasks — no-op otherwise.
    if (crewTaskQueue.has(link.userId)) {
      try {
        const { ALL_TOOLS } = await import("./agent/tools/index");
        const crewToolContext: import("./agent/types").ToolContext = {
          userId: link.userId,
          channel: "heartbeat/crew",
          state: { pendingAttachments: [] },
        };
        const crewSystemContext = `You are Jarvis, an AI assistant. The user is ${link.userId}. Timezone: ${tz}.`;
        const batchCount = await flushCrewBatch(
          link.userId,
          ALL_TOOLS,
          crewToolContext,
          crewSystemContext,
        );
        if (batchCount > 0) actionsFired += batchCount;
      } catch (err) {
        console.error(`[Heartbeat] crew batch flush failed for ${link.userId}:`, err);
      }
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

// ── Agent health check ─────────────────────────────────────────────────────────

/**
 * Checks all active agents for signs of being stuck:
 *  - Updates last_heartbeat_at on every active agent.
 *  - If an agent's last_heartbeat_at hasn't been updated for > 2× its loop
 *    interval, it increments heartbeat_fail_count.
 *  - After 3 consecutive failures, marks the agent as stuck and disables it.
 */
export async function runAgentHealthCheck(): Promise<void> {
  try {
    const { discordAgents } = await import("@shared/schema");
    const { disableAgent } = await import("./agent/agentManager");
    const { logAgentEvent } = await import("./agent/agentLogger");

    const now = new Date();
    const THIRTY_MIN_MS = 30 * 60 * 1000;

    // ── 1. Get all active agents ──────────────────────────────────────────────
    const allActive = await db
      .select()
      .from(discordAgents)
      .where(eq(discordAgents.isActive, 1));

    const summaryByUser: Map<string, string[]> = new Map();
    function addSummary(userId: string, line: string) {
      const lines = summaryByUser.get(userId) ?? [];
      lines.push(line);
      summaryByUser.set(userId, lines);
    }

    for (const agent of allActive) {
      // ── 2. Config validity check ────────────────────────────────────────────
      const configIssues: string[] = [];
      if (!agent.name) configIssues.push("missing name");
      if (!agent.role) configIssues.push("missing role");
      if (agent.loopEnabled && !agent.loopPrompt) configIssues.push("loop enabled but no loopPrompt");
      if (configIssues.length > 0) {
        console.warn(`[AgentHealth] agent ${agent.name ?? agent.id} has config issues: ${configIssues.join(", ")}`);
        logAgentEvent({
          event: "heartbeat_check",
          agentId: agent.id,
          userId: agent.userId,
          detail: `config_issues=${configIssues.join(",")}`,
        });
        addSummary(agent.userId, `⚠️ Agent "${agent.name ?? agent.id}" has config issues: ${configIssues.join(", ")}`);
      }

      // ── 3. Loop freeze check (stale heartbeat for loop agents) ─────────────
      if (agent.loopEnabled) {
        const intervalMs = (agent.loopIntervalMinutes ?? 60) * 60 * 1000;
        const staleThresholdMs = intervalMs * 2;
        const lastBeat = agent.lastHeartbeatAt;

        const isStale = lastBeat
          ? now.getTime() - new Date(lastBeat).getTime() > staleThresholdMs
          : false;

        if (isStale) {
          const newFailCount = (agent.heartbeatFailCount ?? 0) + 1;

          if (newFailCount >= 3) {
            await disableAgent(agent.id);
            await db
              .update(discordAgents)
              .set({ stuckSince: agent.stuckSince ?? now, heartbeatFailCount: newFailCount })
              .where(eq(discordAgents.id, agent.id));
            console.warn(`[AgentHealth] auto-disabled stuck agent ${agent.name} (${agent.id}), fails=${newFailCount}`);
            logAgentEvent({
              event: "agent_disabled_stuck",
              agentId: agent.id,
              userId: agent.userId,
              detail: `heartbeat_fails=${newFailCount}`,
            });
            addSummary(agent.userId, `🔴 Agent "${agent.name}" was auto-disabled after ${newFailCount} missed heartbeats.`);
          } else {
            await db
              .update(discordAgents)
              .set({ heartbeatFailCount: newFailCount, stuckSince: agent.stuckSince ?? now })
              .where(eq(discordAgents.id, agent.id));
            console.warn(`[AgentHealth] agent ${agent.name} (${agent.id}) stale — fail ${newFailCount}/3`);
            logAgentEvent({
              event: "heartbeat_check",
              agentId: agent.id,
              userId: agent.userId,
              detail: `stale=true fail=${newFailCount}`,
            });
            addSummary(agent.userId, `🟡 Agent "${agent.name}" missed heartbeat (${newFailCount}/3 before auto-disable).`);
          }
        } else {
          await db
            .update(discordAgents)
            .set({ lastHeartbeatAt: now, heartbeatFailCount: 0, stuckSince: null })
            .where(eq(discordAgents.id, agent.id));
        }
      }

      // ── 4. Channel/platform liveness check ──────────────────────────────────
      // Verify that each platform the agent is registered on is actually
      // connected/reachable, and that configured channelIds still exist.
      const agentPlatforms = (agent.platforms as string[]) ?? ["discord"];
      for (const platform of agentPlatforms) {
        let live = false;
        let reason = "";

        if (platform === "discord") {
          // Discord: check if bot token is set and the configured channel is accessible
          const discordToken = process.env.DISCORD_BOT_TOKEN;
          if (!discordToken) {
            live = false;
            reason = "DISCORD_BOT_TOKEN not configured";
          } else if (agent.channelId) {
            try {
              const resp = await fetch(`https://discord.com/api/v10/channels/${agent.channelId}`, {
                headers: { Authorization: `Bot ${discordToken}` },
              });
              if (resp.status === 200) {
                live = true;
              } else if (resp.status === 404) {
                live = false;
                reason = `Discord channel ${agent.channelId} not found (404)`;
              } else if (resp.status === 403) {
                live = false;
                reason = `No permission to access Discord channel ${agent.channelId} (403)`;
              } else {
                live = true; // non-critical status — treat as live
              }
            } catch {
              live = false;
              reason = "Discord API unreachable";
            }
          } else {
            live = true; // no channel assigned yet — not a failure
          }
        } else if (platform === "telegram") {
          const { isTelegramConfigured } = await import("./integrations/telegram");
          live = isTelegramConfigured();
          if (!live) reason = "Telegram not configured";
        } else {
          live = true; // Other platforms (web, api, council) — not externally verifiable
        }

        if (!live) {
          logAgentEvent({
            event: "heartbeat_check",
            agentId: agent.id,
            userId: agent.userId,
            detail: `platform_dead=${platform} reason=${reason}`,
          });
          addSummary(agent.userId, `⚠️ Agent "${agent.name}" — ${platform} connection issue: ${reason}`);
        }
      }

      // ── 5. Stuck active-job check (> 30 min) ────────────────────────────────
      if (agent.stuckSince) {
        const stuckMs = now.getTime() - new Date(agent.stuckSince).getTime();
        if (stuckMs > THIRTY_MIN_MS) {
          logAgentEvent({
            event: "heartbeat_check",
            agentId: agent.id,
            userId: agent.userId,
            detail: `stuck_since=${agent.stuckSince} duration_min=${Math.round(stuckMs / 60_000)}`,
          });
          addSummary(agent.userId, `🔴 Agent "${agent.name}" has been stuck for ${Math.round(stuckMs / 60_000)} minutes.`);
        }
      }
    }

    // ── 5. User summary notifications (in-app) ────────────────────────────────
    // Send a single consolidated in-app notification per user when any agent
    // has health issues. Rate-limit to at most one notification per hour by
    // checking the notification cache.
    if (summaryByUser.size > 0) {
      try {
        const { inAppChannel } = await import("./channels/inAppChannel");
        for (const [userId, lines] of summaryByUser) {
          const text = `**Agent Health Summary**\n${lines.join("\n")}`;
          await inAppChannel.sendMessage(userId, text, { notificationType: "general" }).catch(() => {});
        }
      } catch (notifErr) {
        console.warn("[AgentHealth] failed to send user summary notifications:", notifErr);
      }
    }

  } catch (err) {
    console.error("[AgentHealth] health check failed:", err);
  }
}

export function startHeartbeat(): void {
  // Agent health check runs unconditionally — not gated by Telegram so agents
  // are monitored even when no Telegram bot is configured.
  setInterval(() => { runAgentHealthCheck().catch((err) => console.error("[AgentHealth] error:", err)); }, 5 * 60 * 1000);
  // Warm up: run first health check after 30s on boot
  setTimeout(() => { runAgentHealthCheck().catch((err) => console.error("[AgentHealth] boot check error:", err)); }, 30_000);

  // Main heartbeat tick is still gated by Telegram (requires a configured bot)
  if (!isTelegramConfigured()) {
    console.log(`[Heartbeat] daemon running (agent health only — Telegram not configured, main tick skipped)`);
    return;
  }
  console.log(`[Heartbeat] daemon started — checklist at ${CHECKLIST_PATH}, interval ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  setTimeout(() => { runHeartbeatTick().catch((err) => console.error("[Heartbeat] tick error:", err)); }, 60 * 1000);
  setInterval(() => { runHeartbeatTick().catch((err) => console.error("[Heartbeat] tick error:", err)); }, HEARTBEAT_INTERVAL_MS);
}
