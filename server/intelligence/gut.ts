/**
 * Jarvis Gut — Reflexive Anomaly Detection
 *
 * A fast, lightweight reflex layer that runs on each heartbeat tick to flag
 * anomalies against the user's established behavioural baseline — before the
 * full agent reasoning loop. It fires a quiet flag, not an alarm.
 *
 * Signal types:
 *  - calendar_anomaly    : Unusual meeting (no agenda, unknown sender, protected block)
 *  - deep_work_erosion   : Rolling 7-day deep-work ratio dropped below baseline
 *  - email_pattern       : Urgency pressure / repeated re-requests from a sender
 *  - project_drift       : Task velocity slowing, scope expanding vs past stalled projects
 *  - relationship_anomaly: Long-dormant contact suddenly re-engaging
 */

import { db } from "../db";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getValidGoogleTokens } from "../userTokenStore";
import { getGoogleCalendarEvents, type CalendarEvent } from "../integrations/googleCalendar";
import { getEmailsSince } from "../integrations/gmail";

// ─── Baseline TTL cache ───────────────────────────────────────────────────────
// Recomputing the baseline on every heartbeat tick is expensive.  Cache per
// user for 6 hours; the heartbeat fires every 5 minutes so this saves ~71
// redundant DB / email calls per user per day.

const baselineCache = new Map<string, { baseline: GutBaseline; expiresAt: number }>();
const BASELINE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getCachedBaseline(userId: string): GutBaseline | null {
  const entry = baselineCache.get(userId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.baseline;
}

function setCachedBaseline(userId: string, baseline: GutBaseline): void {
  baselineCache.set(userId, { baseline, expiresAt: Date.now() + BASELINE_TTL_MS });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GutBaseline {
  avgMeetingDurationMins: number;
  knownSenderDomains: string[];
  deepWorkRatio: number;
  avgTaskVelocityPerDay: number;
  confirmThreshold: number;
  dismissThreshold: number;
  /**
   * Per-signal-type gate adjustment (in confidence points).
   * Positive = raise the bar (user has dismissed this pattern often → be stricter).
   * Negative = lower the bar (user has confirmed this pattern often → be more sensitive).
   */
  typeGateAdjustments: Partial<Record<schema.GutSignalType, number>>;
}

export interface GutSignalCandidate {
  signalType: schema.GutSignalType;
  itemRef?: string;
  confidenceScore: number;
  explanation: string;
}

// ─── Baseline helpers ─────────────────────────────────────────────────────────

const DEFAULT_BASELINE: GutBaseline = {
  avgMeetingDurationMins: 45,
  knownSenderDomains: [],
  deepWorkRatio: 0.4,
  avgTaskVelocityPerDay: 3,
  confirmThreshold: 70,
  dismissThreshold: 30,
  typeGateAdjustments: {},
};

/**
 * Compute the effective confidence gate for a specific signal type.
 * Applies the global gate, then adds any per-type learned adjustment.
 * Adjustment > 0 → user dismisses this type a lot (raise bar).
 * Adjustment < 0 → user confirms this type a lot (lower bar / be more sensitive).
 */
function getGateForType(baseline: GutBaseline, signalType: schema.GutSignalType): number {
  const globalGate = Math.max(baseline.confirmThreshold - 10, baseline.dismissThreshold);
  const adj = baseline.typeGateAdjustments[signalType] ?? 0;
  return Math.max(20, Math.min(90, globalGate + adj));
}

async function computeBaseline(userId: string, token: string | null): Promise<GutBaseline> {
  const cached = getCachedBaseline(userId);
  if (cached) return cached;

  const baseline: GutBaseline = { ...DEFAULT_BASELINE };

  try {
    const past = await db
      .select({ content: schema.userMemories.content, category: schema.userMemories.category })
      .from(schema.userMemories)
      .where(and(
        eq(schema.userMemories.userId, userId),
        eq(schema.userMemories.category, "work_patterns"),
      ))
      .limit(30);
    const workText = past.map((m) => m.content).join(" ").toLowerCase();

    if (/deep work|focus block|protected time/.test(workText)) {
      baseline.deepWorkRatio = 0.5;
    }
    if (/short meeting|15.?min|30.?min/.test(workText)) {
      baseline.avgMeetingDurationMins = 30;
    }
  } catch {}

  try {
    const historicPlans = await db
      .select({ data: schema.plans.data })
      .from(schema.plans)
      .where(eq(schema.plans.userId, userId))
      .orderBy(desc(schema.plans.date))
      .limit(14);

    const totalTasks = historicPlans.reduce((sum, p) => {
      const tasks = (p.data as { tasks?: { completed?: boolean }[] })?.tasks || [];
      return sum + tasks.filter((t) => t.completed).length;
    }, 0);
    if (historicPlans.length > 0) {
      baseline.avgTaskVelocityPerDay = Math.max(1, totalTasks / historicPlans.length);
    }
  } catch {}

  try {
    if (token) {
      const pastEmails = await getEmailsSince(Date.now() - 30 * 24 * 60 * 60 * 1000, token);
      const domains = new Set<string>();
      for (const e of pastEmails.slice(0, 100)) {
        const match = e.from.match(/@([\w.-]+)/);
        if (match) domains.add(match[1].toLowerCase());
      }
      baseline.knownSenderDomains = Array.from(domains);
    }
  } catch {}

  try {
    const confirmed = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.gutSignals)
      .where(and(
        eq(schema.gutSignals.userId, userId),
        eq(schema.gutSignals.userResponse, "confirmed"),
      ));
    const dismissed = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.gutSignals)
      .where(and(
        eq(schema.gutSignals.userId, userId),
        eq(schema.gutSignals.userResponse, "dismissed"),
      ));
    const c = Number(confirmed[0]?.count ?? 0);
    const d = Number(dismissed[0]?.count ?? 0);
    if (c + d > 5) {
      const accuracy = c / (c + d);
      if (accuracy > 0.7) baseline.confirmThreshold = Math.min(90, baseline.confirmThreshold + 10);
      if (accuracy < 0.3) baseline.dismissThreshold = Math.min(60, baseline.dismissThreshold + 10);
    }

    // Per-signal-type learning: adjust the gate individually for each pattern
    // so that heavy dismissal of one type doesn't tighten all detectors.
    const allSignalTypes: schema.GutSignalType[] = [
      "calendar_anomaly",
      "deep_work_erosion",
      "email_pattern",
      "project_drift",
      "relationship_anomaly",
    ];
    for (const st of allSignalTypes) {
      const [tc] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.gutSignals)
        .where(and(
          eq(schema.gutSignals.userId, userId),
          eq(schema.gutSignals.signalType, st),
          eq(schema.gutSignals.userResponse, "confirmed"),
        ));
      const [td] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.gutSignals)
        .where(and(
          eq(schema.gutSignals.userId, userId),
          eq(schema.gutSignals.signalType, st),
          eq(schema.gutSignals.userResponse, "dismissed"),
        ));
      const tc_ = Number(tc?.count ?? 0);
      const td_ = Number(td?.count ?? 0);
      if (tc_ + td_ >= 4) {
        const typeAccuracy = tc_ / (tc_ + td_);
        // confirmThreshold high (good catch) → lower the bar for this type (−10)
        // dismissThreshold high (not useful)  → raise the bar for this type (+10)
        if (typeAccuracy > 0.7) baseline.typeGateAdjustments[st] = -10;
        else if (typeAccuracy < 0.3) baseline.typeGateAdjustments[st] = +10;
      }
    }
  } catch {}

  setCachedBaseline(userId, baseline);
  return baseline;
}

// ─── Calendar anomaly detector ────────────────────────────────────────────────

async function detectCalendarAnomalies(
  userId: string,
  events: CalendarEvent[],
  baseline: GutBaseline,
  userEmail: string | null,
): Promise<GutSignalCandidate[]> {
  const signals: GutSignalCandidate[] = [];
  const now = new Date();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const existing = await db
    .select({ itemRef: schema.gutSignals.itemRef })
    .from(schema.gutSignals)
    .where(and(
      eq(schema.gutSignals.userId, userId),
      eq(schema.gutSignals.signalType, "calendar_anomaly"),
      gte(schema.gutSignals.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000)),
    ))
    .limit(100);
  const flaggedRefs = new Set(existing.map((r) => r.itemRef).filter(Boolean) as string[]);

  for (const event of events) {
    if (flaggedRefs.has(event.id)) continue;
    const startMs = new Date(event.start).getTime();
    if (startMs < now.getTime() || startMs > now.getTime() + sevenDaysMs) continue;

    const durationMins = Math.round(
      (new Date(event.end || event.start).getTime() - startMs) / 60000
    );

    const anomalies: string[] = [];
    let confidence = 0;

    if (durationMins > baseline.avgMeetingDurationMins * 2) {
      anomalies.push(`${durationMins} min — ${Math.round(durationMins / baseline.avgMeetingDurationMins)}× your usual length`);
      confidence += 25;
    }

    if (!event.description || event.description.trim().length < 10) {
      anomalies.push("no agenda");
      confidence += 20;
    }

    if (userEmail) {
      const userDomain = userEmail.split("@")[1]?.toLowerCase();
      const externalUnknown = (event.attendees || []).filter((a) => {
        if (!a.email) return false;
        const domain = a.email.split("@")[1]?.toLowerCase();
        if (!domain || domain === userDomain) return false;
        return !baseline.knownSenderDomains.includes(domain);
      });
      if (externalUnknown.length > 0) {
        anomalies.push(`unknown external attendee (${externalUnknown[0].email})`);
        confidence += 20;
      }
    }

    // Protected-block check: flag meetings that intrude on the user's typical
    // deep-focus windows (before 10am or after 4pm) when they maintain a high
    // deep work ratio. This matches "previously protected block erosion".
    if (baseline.deepWorkRatio >= 0.4 && durationMins >= 30) {
      const eventHour = new Date(event.start).getHours();
      if (eventHour < 10 || eventHour >= 16) {
        const window = eventHour < 10 ? "morning focus block (before 10am)" : "afternoon focus window (after 4pm)";
        anomalies.push(`intrudes on protected ${window}`);
        confidence += 30;
      }
    }

    const calGate = getGateForType(baseline, "calendar_anomaly");
    if (anomalies.length > 0 && confidence >= calGate) {
      signals.push({
        signalType: "calendar_anomaly",
        itemRef: event.id,
        confidenceScore: Math.min(99, confidence),
        explanation: `"${event.title}" — ${anomalies.join(", ")}.`,
      });
    }
  }

  return signals;
}

// ─── Deep work erosion detector ──────────────────────────────────────────────

async function detectDeepWorkErosion(
  userId: string,
  events: CalendarEvent[],
  baseline: GutBaseline,
): Promise<GutSignalCandidate | null> {
  try {
    const already = await db
      .select({ id: schema.gutSignals.id })
      .from(schema.gutSignals)
      .where(and(
        eq(schema.gutSignals.userId, userId),
        eq(schema.gutSignals.signalType, "deep_work_erosion"),
        gte(schema.gutSignals.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000)),
      ))
      .limit(1);
    if (already.length > 0) return null;

    // Use the past 7 days only — the rolling deep-work ratio is a backward-
    // looking metric over actual completed calendar blocks, not future schedule.
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const week = events.filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= now - sevenDaysMs && t <= now;
    });

    let totalMins = 0;
    let meetingMins = 0;
    for (const e of week) {
      const startMs = new Date(e.start).getTime();
      const endMs = new Date(e.end || e.start).getTime();
      const dur = Math.max(0, (endMs - startMs) / 60000);
      if (dur < 8 * 60) {
        totalMins += dur;
        if (e.attendees && e.attendees.length > 0) {
          meetingMins += dur;
        }
      }
    }

    if (totalMins < 60) return null;

    const focusRatio = (totalMins - meetingMins) / totalMins;
    const drop = baseline.deepWorkRatio - focusRatio;

    if (drop > 0.2) {
      const pct = Math.round(drop * 100);
      return {
        signalType: "deep_work_erosion",
        confidenceScore: Math.min(90, 50 + pct),
        explanation: `Your deep work ratio this week is ${Math.round(focusRatio * 100)}% — down ${pct}pp from your usual ${Math.round(baseline.deepWorkRatio * 100)}%.`,
      };
    }
  } catch {}
  return null;
}

// ─── Email pattern detector ───────────────────────────────────────────────────

const URGENCY_SIGNALS = /\b(URGENT|ASAP|immediately|right away|as soon as possible|today|by EOD|by end of day|time.?sensitive)\b/i;
const MANIPULATION_SIGNALS = /\b(I.?ve been waiting|you promised|as discussed|per my last|you said|you told me|you never|why haven.?t you)\b/i;

async function detectEmailPatterns(
  userId: string,
  baseline: GutBaseline,
  inboxItems: { id: string; sourceId: string; sender: string | null; snippet: string | null; subject: string | null }[],
): Promise<GutSignalCandidate[]> {
  const signals: GutSignalCandidate[] = [];

  const existing = await db
    .select({ itemRef: schema.gutSignals.itemRef })
    .from(schema.gutSignals)
    .where(and(
      eq(schema.gutSignals.userId, userId),
      eq(schema.gutSignals.signalType, "email_pattern"),
      gte(schema.gutSignals.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000)),
    ))
    .limit(100);
  const flagged = new Set(existing.map((r) => r.itemRef).filter(Boolean) as string[]);

  for (const item of inboxItems.slice(0, 20)) {
    if (flagged.has(item.id)) continue;
    const text = `${item.subject || ""} ${item.snippet || ""}`;
    const hasUrgency = URGENCY_SIGNALS.test(text);
    const hasManipulation = MANIPULATION_SIGNALS.test(text);

    if (!hasUrgency && !hasManipulation) continue;

    let confidence = 0;
    const reasons: string[] = [];
    if (hasUrgency) { confidence += 35; reasons.push("urgency pressure"); }
    if (hasManipulation) { confidence += 45; reasons.push("manipulation signal"); }

    const emailGate = getGateForType(baseline, "email_pattern");
    if (confidence >= emailGate) {
      signals.push({
        signalType: "email_pattern",
        itemRef: item.id,
        confidenceScore: Math.min(95, confidence),
        explanation: `${getSenderName(item.sender)} — ${reasons.join(" + ")} detected.`,
      });
    }
  }

  return signals;
}

function getSenderName(sender: string | null): string {
  if (!sender) return "Unknown sender";
  return sender.replace(/<.*>/, "").trim() || sender;
}

// ─── Project drift detector ───────────────────────────────────────────────────

async function detectProjectDrift(userId: string, baseline: GutBaseline): Promise<GutSignalCandidate[]> {
  const signals: GutSignalCandidate[] = [];

  try {
    const existing = await db
      .select({ id: schema.gutSignals.id })
      .from(schema.gutSignals)
      .where(and(
        eq(schema.gutSignals.userId, userId),
        eq(schema.gutSignals.signalType, "project_drift"),
        gte(schema.gutSignals.createdAt, new Date(Date.now() - 72 * 60 * 60 * 1000)),
      ))
      .limit(1);
    if (existing.length > 0) return signals;

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentPlans = await db
      .select({ data: schema.plans.data, date: schema.plans.date })
      .from(schema.plans)
      .where(and(eq(schema.plans.userId, userId), gte(schema.plans.date, sevenDaysAgo)))
      .orderBy(desc(schema.plans.date))
      .limit(7);

    if (recentPlans.length < 3) return signals;

    const completedPerDay = recentPlans.map((p) => {
      const tasks = (p.data as { tasks?: { completed?: boolean }[] })?.tasks || [];
      return tasks.filter((t) => t.completed).length;
    });
    const avgCompleted = completedPerDay.reduce((s, n) => s + n, 0) / completedPerDay.length;
    const totalOpenRecent = recentPlans.slice(0, 3).reduce((sum, p) => {
      const tasks = (p.data as { tasks?: { completed?: boolean }[] })?.tasks || [];
      return sum + tasks.filter((t) => !t.completed).length;
    }, 0);

    const velocityDrop = baseline.avgTaskVelocityPerDay - avgCompleted;
    const taskAccumulation = totalOpenRecent > baseline.avgTaskVelocityPerDay * 3;

    if (velocityDrop > 1.5 || taskAccumulation) {
      signals.push({
        signalType: "project_drift",
        confidenceScore: Math.min(85, 50 + Math.round(velocityDrop * 10) + (taskAccumulation ? 20 : 0)),
        explanation: `Task completion has slowed to ${avgCompleted.toFixed(1)}/day (usual: ${baseline.avgTaskVelocityPerDay.toFixed(1)}). This pattern matches stalled projects.`,
      });
    }
  } catch {}

  return signals;
}

// ─── Relationship anomaly detector ───────────────────────────────────────────

async function detectRelationshipAnomalies(
  userId: string,
  inboxItems: { id: string; sender: string | null; subject: string | null; snippet: string | null }[],
): Promise<GutSignalCandidate[]> {
  const signals: GutSignalCandidate[] = [];

  try {
    const existing = await db
      .select({ itemRef: schema.gutSignals.itemRef })
      .from(schema.gutSignals)
      .where(and(
        eq(schema.gutSignals.userId, userId),
        eq(schema.gutSignals.signalType, "relationship_anomaly"),
        gte(schema.gutSignals.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ))
      .limit(50);
    const flagged = new Set(existing.map((r) => r.itemRef).filter(Boolean) as string[]);

    const people = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.userId, userId));
    const dormantCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    for (const item of inboxItems.slice(0, 10)) {
      if (flagged.has(item.id) || !item.sender) continue;
      const emailMatch = item.sender.match(/<([^>]+)>/) || [null, item.sender.trim()];
      const senderEmail = emailMatch[1]?.toLowerCase();
      if (!senderEmail) continue;

      const person = people.find((p) => p.email?.toLowerCase() === senderEmail);
      if (!person) continue;
      if (!person.lastInteractionAt) continue;
      if (person.lastInteractionAt > dormantCutoff) continue;

      const daysDormant = Math.round((Date.now() - person.lastInteractionAt.getTime()) / 86400000);
      signals.push({
        signalType: "relationship_anomaly",
        itemRef: item.id,
        confidenceScore: Math.min(75, 40 + Math.round(daysDormant / 10)),
        explanation: `${person.name} hasn't reached out in ${daysDormant} days — their contact after a long silence is worth noting.`,
      });
    }
  } catch {}

  return signals;
}

// ─── Persist and dedupe ───────────────────────────────────────────────────────

async function persistSignals(
  userId: string,
  candidates: GutSignalCandidate[],
): Promise<typeof schema.gutSignals.$inferSelect[]> {
  const saved: typeof schema.gutSignals.$inferSelect[] = [];
  for (const c of candidates) {
    try {
      const [row] = await db
        .insert(schema.gutSignals)
        .values({
          userId,
          signalType: c.signalType,
          itemRef: c.itemRef ?? null,
          confidenceScore: c.confidenceScore,
          explanation: c.explanation,
        })
        .returning();
      if (row) saved.push(row);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "23505") console.error("[Gut] signal insert failed:", err);
    }
  }
  return saved;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all gut detectors for a single user. Called from the heartbeat tick.
 * Returns the number of new signals generated.
 */
export async function runGutScanForUser(
  userId: string,
  userEmail: string | null,
  now: Date,
): Promise<number> {
  let token: string | null = null;
  try {
    const tokens = await getValidGoogleTokens(userId);
    token = tokens?.[0] ?? null;
  } catch {}

  const baseline = await computeBaseline(userId, token);

  const candidates: GutSignalCandidate[] = [];

  let events: CalendarEvent[] = [];
  if (token) {
    try {
      const today = now.toISOString().slice(0, 10);
      // Fetch a rolling 14-day window (7 days back + 7 days forward) so that
      // both the deep-work erosion ratio (past week) and upcoming calendar
      // anomaly detectors (next 7 days) receive the data they need.
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      events = await getGoogleCalendarEvents(today, sevenDaysAgo, sevenDaysAhead, token);
    } catch {}
  }

  const calAnomalies = await detectCalendarAnomalies(userId, events, baseline, userEmail);
  candidates.push(...calAnomalies);

  const erosion = await detectDeepWorkErosion(userId, events, baseline);
  if (erosion) candidates.push(erosion);

  const driftSignals = await detectProjectDrift(userId, baseline);
  candidates.push(...driftSignals);

  let recentInboxItems: { id: string; sourceId: string; sender: string | null; snippet: string | null; subject: string | null }[] = [];
  try {
    recentInboxItems = await db
      .select({ id: schema.inboxItems.id, sourceId: schema.inboxItems.sourceId, sender: schema.inboxItems.sender, snippet: schema.inboxItems.snippet, subject: schema.inboxItems.subject })
      .from(schema.inboxItems)
      .where(and(
        eq(schema.inboxItems.userId, userId),
        eq(schema.inboxItems.status, "pending"),
        gte(schema.inboxItems.surfacedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      ))
      .orderBy(desc(schema.inboxItems.surfacedAt))
      .limit(30);
  } catch {}

  if (recentInboxItems.length > 0) {
    const emailSignals = await detectEmailPatterns(userId, baseline, recentInboxItems);
    candidates.push(...emailSignals);
  }

  const relSignals = await detectRelationshipAnomalies(userId, recentInboxItems);
  candidates.push(...relSignals);

  if (candidates.length === 0) return 0;
  const saved = await persistSignals(userId, candidates);
  if (saved.length > 0) {
    console.log(`[Gut] ${saved.length} new signal(s) for user ${userId}`);
  }
  return saved.length;
}

/**
 * Get recent gut signals for a user, optionally filtered to a specific inbox item.
 */
export async function getGutSignalsForUser(
  userId: string,
  opts?: { itemRef?: string; limit?: number; includeResponded?: boolean },
): Promise<typeof schema.gutSignals.$inferSelect[]> {
  const limit = opts?.limit ?? 50;

  const conditions = [eq(schema.gutSignals.userId, userId)];
  if (opts?.itemRef) {
    conditions.push(eq(schema.gutSignals.itemRef, opts.itemRef));
  }
  if (!opts?.includeResponded) {
    conditions.push(
      sql`(${schema.gutSignals.userResponse} is null or ${schema.gutSignals.userResponse} = 'ignored')`
    );
  }

  const rows = await db
    .select()
    .from(schema.gutSignals)
    .where(and(...conditions))
    .orderBy(desc(schema.gutSignals.createdAt))
    .limit(limit);

  return rows;
}

/**
 * Store a user's response to a gut signal (confirmed / dismissed).
 */
export async function respondToGutSignal(
  userId: string,
  signalId: string,
  response: schema.GutUserResponse,
): Promise<void> {
  await db
    .update(schema.gutSignals)
    .set({ userResponse: response, respondedAt: new Date() })
    .where(and(eq(schema.gutSignals.id, signalId), eq(schema.gutSignals.userId, userId)));
  // Invalidate cached baseline so the per-type gate adjustment is recomputed
  // on the very next heartbeat tick rather than waiting up to 6h for TTL expiry.
  baselineCache.delete(userId);
  console.log(`[Gut] user ${userId} responded ${response} to signal ${signalId}`);
}

/**
 * Return high-confidence, unresolved signals from the last 24 h for
 * inclusion in the morning brief. Marks them as delivered.
 */
export async function getAndMarkMorningBriefSignals(
  userId: string,
): Promise<typeof schema.gutSignals.$inferSelect[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(schema.gutSignals)
    .where(and(
      eq(schema.gutSignals.userId, userId),
      eq(schema.gutSignals.deliveredInMorningBrief, false),
      gte(schema.gutSignals.createdAt, since),
      sql`${schema.gutSignals.userResponse} IS NULL`,
    ))
    .orderBy(desc(schema.gutSignals.confidenceScore))
    .limit(3);

  const highConf = rows.filter((r) => r.confidenceScore >= 60);
  if (highConf.length === 0) return [];

  const selectedIds = highConf.map((r) => r.id);
  await db
    .update(schema.gutSignals)
    .set({ deliveredInMorningBrief: true })
    .where(inArray(schema.gutSignals.id, selectedIds));

  return highConf;
}
