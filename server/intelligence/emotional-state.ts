/**
 * Jarvis Emotional State Engine
 *
 * Aggregates objective signals to compute a stress (0–10) and flow (0–10)
 * score per user. Called once per heartbeat cycle and stored in
 * user_emotional_state. The result is injected into every AI prompt so all
 * Jarvis interactions adapt their tone accordingly.
 *
 * Signal sources:
 *  1. Calendar density — events in the next 24h
 *  2. Energy check-in history — last 3 check-ins
 *  3. Task completion rate — last 7 days
 *  4. Late-night activity — any interaction log entries after 23:00 local
 *  5. Message sentiment — recent chat log analysis (lightweight heuristic)
 */

import { db } from "../db";
import { eq, desc, and, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getValidGoogleTokens } from "../userTokenStore";
import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { notifyUser } from "../channels/registry";
import { logInteraction } from "../interactionLog";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmotionalState {
  stressScore: number;
  flowScore: number;
  label: string;
  explanation: string;
  signalSources: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function localHour(now: Date, tz: string): number {
  return new Date(now.toLocaleString("en-US", { timeZone: tz })).getHours();
}

function localDateKey(now: Date, tz: string): string {
  const d = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDayOfWeek(now: Date, tz: string): number {
  return new Date(now.toLocaleString("en-US", { timeZone: tz })).getDay(); // 0=Sun … 6=Sat
}

// Basic sentiment heuristic (no LLM call to keep it cheap in the heartbeat)
const NEGATIVE_WORDS = /overwhelm|stressed|anxious|exhaust|stuck|behind|panic|crisis|urgent|deadline|overload|can'?t|fail/gi;
const POSITIVE_WORDS = /great|crush|flow|focus|win|done|finish|accomplish|energiz|excited|nail|ahead|confident|progress/gi;

function sentimentScore(text: string): number {
  const neg = (text.match(NEGATIVE_WORDS) || []).length;
  const pos = (text.match(POSITIVE_WORDS) || []).length;
  if (neg + pos === 0) return 0;
  return clamp((neg - pos) / (neg + pos), -1, 1);
}

// ─── Signal computation ───────────────────────────────────────────────────────

interface Signals {
  calendarDensity: number;
  avgEnergyScore: number | null;
  taskCompletionRate: number | null;
  lateNightFlag: boolean;
  messageSentiment: number;
  sources: string[];
}

async function gatherSignals(userId: string, tz: string, now: Date): Promise<Signals> {
  const signals: Signals = {
    calendarDensity: 0,
    avgEnergyScore: null,
    taskCompletionRate: null,
    lateNightFlag: false,
    messageSentiment: 0,
    sources: [],
  };

  // ── 1. Calendar density (next 24h event count) ──────────────────────────────
  try {
    const tokens = await getValidGoogleTokens(userId);
    const token = tokens?.[0];
    if (token) {
      const dateKey = localDateKey(now, tz);
      const events = await getGoogleCalendarEvents(dateKey, undefined, undefined, token);
      const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const upcoming = events.filter((e) => {
        const start = new Date(e.start);
        return start >= now && start <= next24h;
      });
      signals.calendarDensity = upcoming.length;
      signals.sources.push(`calendar (${upcoming.length} events in 24h)`);
    }
  } catch {
    // non-fatal
  }

  // ── 2. Energy check-in history (last 3) ────────────────────────────────────
  try {
    const rows = await db
      .select()
      .from(schema.energyCheckins)
      .where(eq(schema.energyCheckins.userId, userId))
      .orderBy(desc(schema.energyCheckins.updatedAt))
      .limit(3);

    if (rows.length > 0) {
      const scores: number[] = [];
      for (const row of rows) {
        const data = row.data as { energy?: number; mood?: number; score?: number } | null;
        const score = data?.energy ?? data?.mood ?? data?.score;
        if (typeof score === "number" && score >= 1 && score <= 10) scores.push(score);
      }
      if (scores.length > 0) {
        signals.avgEnergyScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        signals.sources.push(`energy check-ins (avg ${signals.avgEnergyScore.toFixed(1)}/10)`);
      }
    }
  } catch {
    // non-fatal
  }

  // ── 3. Task completion rate (last 7 days) ──────────────────────────────────
  try {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentPlans = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.userId, userId))
      .orderBy(desc(schema.plans.updatedAt))
      .limit(7);

    let totalTasks = 0;
    let completedTasks = 0;
    for (const plan of recentPlans) {
      const data = plan.data as { tasks?: Array<{ completed?: boolean }> };
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      totalTasks += tasks.length;
      completedTasks += tasks.filter((t) => t.completed).length;
    }
    if (totalTasks > 0) {
      signals.taskCompletionRate = completedTasks / totalTasks;
      signals.sources.push(`task completion (${Math.round(signals.taskCompletionRate * 100)}% in 7d)`);
    }
  } catch {
    // non-fatal
  }

  // ── 4. Late-night activity flag ────────────────────────────────────────────
  // Detects whether the user was active during late-night hours (23:00–04:00)
  // either right now, or within the past 16 hours. Each row's actual createdAt
  // timestamp is evaluated in the user's local timezone.
  try {
    const hour = localHour(now, tz);
    if (hour >= 23 || hour < 4) {
      signals.lateNightFlag = true;
      signals.sources.push("late-night activity detected");
    } else {
      const windowStart = new Date(now.getTime() - 16 * 60 * 60 * 1000);
      const recentActivity = await db
        .select({ createdAt: schema.interactionLog.createdAt })
        .from(schema.interactionLog)
        .where(
          and(
            eq(schema.interactionLog.userId, userId),
            gte(schema.interactionLog.createdAt, windowStart),
          ),
        )
        .orderBy(desc(schema.interactionLog.createdAt))
        .limit(20);
      for (const row of recentActivity) {
        const actHour = localHour(new Date(row.createdAt), tz);
        if (actHour >= 23 || actHour < 4) {
          signals.lateNightFlag = true;
          signals.sources.push("late-night activity detected");
          break;
        }
      }
    }
  } catch {
    // non-fatal
  }

  // ── 5. Message sentiment (last 10 outbound interactions) ───────────────────
  try {
    const recent = await db
      .select({ content: schema.interactionLog.content })
      .from(schema.interactionLog)
      .where(
        and(
          eq(schema.interactionLog.userId, userId),
          eq(schema.interactionLog.direction, "inbound"),
        ),
      )
      .orderBy(desc(schema.interactionLog.createdAt))
      .limit(10);

    if (recent.length > 0) {
      const combinedText = recent.map((r) => r.content).join(" ");
      signals.messageSentiment = sentimentScore(combinedText);
      if (Math.abs(signals.messageSentiment) > 0.1) {
        signals.sources.push(`message sentiment (${signals.messageSentiment > 0 ? "negative" : "positive"} trend)`);
      }
    }
  } catch {
    // non-fatal
  }

  return signals;
}

// ─── Score computation ────────────────────────────────────────────────────────

function computeScores(signals: Signals): { stressScore: number; flowScore: number; label: string; explanation: string } {
  let stress = 3;
  let flow = 5;
  const notes: string[] = [];

  // Calendar density: 0=0, 3=2, 6=4, 9+=6
  const calStress = clamp(signals.calendarDensity * 0.7, 0, 6);
  stress += calStress;
  if (signals.calendarDensity >= 5) notes.push("packed calendar");
  else if (signals.calendarDensity >= 3) notes.push("busy calendar");

  // Energy: low energy → higher stress, lower flow; high energy → lower stress, higher flow
  if (signals.avgEnergyScore !== null) {
    const e = signals.avgEnergyScore;
    stress += clamp((5 - e) * 0.6, -3, 3);
    flow += clamp((e - 5) * 0.8, -4, 4);
    if (e >= 7) notes.push("high energy");
    else if (e <= 3) notes.push("low energy");
  }

  // Task completion rate: high rate = lower stress, higher flow
  if (signals.taskCompletionRate !== null) {
    const r = signals.taskCompletionRate;
    stress += clamp((0.5 - r) * 3, -2, 2);
    flow += clamp((r - 0.5) * 4, -3, 3);
    if (r >= 0.7) notes.push("strong task completion");
    else if (r < 0.3) notes.push("low task completion");
  }

  // Late-night: +2 stress, -2 flow
  if (signals.lateNightFlag) {
    stress += 2;
    flow -= 2;
    notes.push("late-night pattern");
  }

  // Message sentiment: negative = +stress -flow, positive = -stress +flow
  stress += clamp(signals.messageSentiment * 3, -2, 2);
  flow -= clamp(signals.messageSentiment * 2, -2, 2);

  stress = clamp(Math.round(stress), 0, 10);
  flow = clamp(Math.round(flow), 0, 10);

  let label: string;
  if (stress >= 7) label = "overwhelmed";
  else if (stress >= 5) label = "stressed";
  else if (flow >= 7) label = "in flow";
  else if (flow >= 5) label = "focused";
  else label = "calm";

  const explanation = notes.length > 0
    ? `Based on: ${notes.join(", ")}.`
    : "No strong signals detected — baseline state.";

  return { stressScore: stress, flowScore: flow, label, explanation };
}

/** Re-derive a label from adjusted scores (same thresholds as computeScores). */
function deriveLabel(stress: number, flow: number): string {
  if (stress >= 7) return "overwhelmed";
  if (stress >= 5) return "stressed";
  if (flow >= 7) return "in flow";
  if (flow >= 5) return "focused";
  return "calm";
}

// ─── Baseline / Pattern Learning ─────────────────────────────────────────────

const DOW_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const MIN_BASELINE_SAMPLES = 7;
const HISTORY_WINDOW_DAYS = 90;

/** Appends one heartbeat snapshot to the history table. */
async function appendToHistory(
  userId: string,
  stressScore: number,
  flowScore: number,
  label: string,
  now: Date,
  tz: string,
): Promise<void> {
  try {
    await db.insert(schema.userEmotionalStateHistory).values({
      userId,
      stressScore,
      flowScore,
      label,
      dayOfWeek: localDayOfWeek(now, tz),
      hourOfDay: localHour(now, tz),
      recordedAt: now,
    });
  } catch {
    // non-fatal
  }
}

interface BaselineResult {
  avgStress: number | null;
  avgFlow: number | null;
  sampleCount: number;
  patternNote: string | null;
}

/**
 * Computes a rolling baseline from the user's history.
 * Returns null avg values when there is insufficient data.
 */
async function computeBaseline(userId: string, now: Date, tz: string): Promise<BaselineResult> {
  const windowStart = new Date(now.getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({
        stressScore: schema.userEmotionalStateHistory.stressScore,
        flowScore: schema.userEmotionalStateHistory.flowScore,
        dayOfWeek: schema.userEmotionalStateHistory.dayOfWeek,
      })
      .from(schema.userEmotionalStateHistory)
      .where(
        and(
          eq(schema.userEmotionalStateHistory.userId, userId),
          gte(schema.userEmotionalStateHistory.recordedAt, windowStart),
        ),
      )
      .orderBy(desc(schema.userEmotionalStateHistory.recordedAt))
      .limit(500);

    if (rows.length < MIN_BASELINE_SAMPLES) {
      return { avgStress: null, avgFlow: null, sampleCount: rows.length, patternNote: null };
    }

    const avgStress = rows.reduce((acc, r) => acc + r.stressScore, 0) / rows.length;
    const avgFlow = rows.reduce((acc, r) => acc + r.flowScore, 0) / rows.length;

    // Day-of-week pattern: is today notably different from the overall average?
    const currentDow = localDayOfWeek(now, tz);
    const dowRows = rows.filter((r) => r.dayOfWeek === currentDow);
    let patternNote: string | null = null;

    if (dowRows.length >= 3) {
      const dowAvgStress = dowRows.reduce((acc, r) => acc + r.stressScore, 0) / dowRows.length;
      const dowAvgFlow = dowRows.reduce((acc, r) => acc + r.flowScore, 0) / dowRows.length;
      const dayName = DOW_NAMES[currentDow];
      const notes: string[] = [];

      if (dowAvgStress >= avgStress + 1.0) {
        notes.push(`${dayName} tend to be high-stress for you (avg ${dowAvgStress.toFixed(1)} vs usual ${avgStress.toFixed(1)})`);
      } else if (dowAvgStress <= avgStress - 1.0) {
        notes.push(`${dayName} tend to be low-stress for you (avg ${dowAvgStress.toFixed(1)})`);
      }

      if (dowAvgFlow >= avgFlow + 1.0) {
        notes.push(`your flow is typically higher on ${dayName} (avg ${dowAvgFlow.toFixed(1)})`);
      } else if (dowAvgFlow <= avgFlow - 1.0) {
        notes.push(`your flow tends to dip on ${dayName} (avg ${dowAvgFlow.toFixed(1)})`);
      }

      if (notes.length > 0) patternNote = notes.join("; ");
    }

    return { avgStress, avgFlow, sampleCount: rows.length, patternNote };
  } catch {
    return { avgStress: null, avgFlow: null, sampleCount: 0, patternNote: null };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const HIGH_STRESS_THRESHOLD = 7;
const SUSTAINED_STRESS_CYCLES = 3;
const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function computeAndStoreEmotionalState(
  userId: string,
  tz: string,
  now: Date,
): Promise<EmotionalState> {
  const signals = await gatherSignals(userId, tz, now);
  const { stressScore, flowScore, label, explanation } = computeScores(signals);

  // ── Baseline learning: compute rolling averages then append this snapshot ────
  // Baseline is computed BEFORE appending so the current reading is not
  // included in its own adjustment (avoids self-reference).
  const baseline = await computeBaseline(userId, now, tz);
  await appendToHistory(userId, stressScore, flowScore, label, now, tz);

  // Load existing state for consecutive-cycle tracking
  let prevState: typeof schema.userEmotionalState.$inferSelect | null = null;
  try {
    const rows = await db
      .select()
      .from(schema.userEmotionalState)
      .where(eq(schema.userEmotionalState.userId, userId))
      .limit(1);
    prevState = rows[0] ?? null;
  } catch {
    // first run
  }

  const isHighStress = stressScore >= HIGH_STRESS_THRESHOLD;
  let consecutiveHighStressCycles = prevState?.consecutiveHighStressCycles ?? 0;
  let lastStressCheckinAt = prevState?.lastStressCheckinAt ?? null;

  if (isHighStress) {
    consecutiveHighStressCycles += 1;
  } else {
    consecutiveHighStressCycles = 0;
  }

  // ── Baseline-relative score adjustment ──────────────────────────────────────
  // Blend the raw signal-based score with the user's personal deviation so that
  // a raw stress of 5 "feels" different for someone whose typical stress is 2
  // vs someone whose typical stress is 7.
  // Formula: adjusted = raw + (raw − baseline) × 0.3, clamped to [1, 10].
  // Only applied when we have enough historical samples.
  let effectiveStress = stressScore;
  let effectiveFlow = flowScore;
  let effectiveLabel = label;

  if (baseline.avgStress !== null && baseline.avgFlow !== null) {
    effectiveStress = clamp(
      Math.round(stressScore + (stressScore - baseline.avgStress) * 0.3),
      1,
      10,
    );
    effectiveFlow = clamp(
      Math.round(flowScore + (flowScore - baseline.avgFlow) * 0.3),
      1,
      10,
    );
    effectiveLabel = deriveLabel(effectiveStress, effectiveFlow);
  }

  // Respect manual override for up to 3 hours (wins over baseline adjustment)
  if (prevState?.manualOverride && prevState.manualOverrideAt) {
    const overrideAge = now.getTime() - new Date(prevState.manualOverrideAt).getTime();
    if (overrideAge < 3 * 60 * 60 * 1000) {
      effectiveLabel = prevState.manualOverride;
      // Map override label to adjusted scores
      if (prevState.manualOverride === "overwhelmed") { effectiveStress = 8; effectiveFlow = 2; }
      else if (prevState.manualOverride === "stressed") { effectiveStress = 6; effectiveFlow = 3; }
      else if (prevState.manualOverride === "calm") { effectiveStress = 2; effectiveFlow = 5; }
      else if (prevState.manualOverride === "focused") { effectiveStress = 3; effectiveFlow = 7; }
      else if (prevState.manualOverride === "in flow") { effectiveStress = 2; effectiveFlow = 9; }
    }
  }

  // Upsert
  try {
    await db
      .insert(schema.userEmotionalState)
      .values({
        userId,
        stressScore: effectiveStress,
        flowScore: effectiveFlow,
        label: effectiveLabel,
        explanation,
        signalSources: signals.sources,
        consecutiveHighStressCycles,
        lastStressCheckinAt,
        computedAt: now,
        updatedAt: now,
        baselineStress: baseline.avgStress,
        baselineFlow: baseline.avgFlow,
        patternNote: baseline.patternNote,
      })
      .onConflictDoUpdate({
        target: schema.userEmotionalState.userId,
        set: {
          stressScore: effectiveStress,
          flowScore: effectiveFlow,
          label: effectiveLabel,
          explanation,
          signalSources: signals.sources,
          consecutiveHighStressCycles,
          computedAt: now,
          updatedAt: now,
          baselineStress: baseline.avgStress,
          baselineFlow: baseline.avgFlow,
          patternNote: baseline.patternNote,
        },
      });
  } catch (err) {
    console.error("[EmotionalState] upsert failed:", err);
  }

  // ── Sustained stress check-in (max once per 24h) ───────────────────────────
  if (consecutiveHighStressCycles >= SUSTAINED_STRESS_CYCLES) {
    const lastCheckin = lastStressCheckinAt ? new Date(lastStressCheckinAt).getTime() : 0;
    if (now.getTime() - lastCheckin >= CHECKIN_COOLDOWN_MS) {
      try {
        const msg = `Hey — I've noticed you seem to be under a lot of pressure lately. ${explanation} Is there anything I can do to help lighten the load? You can tell me to reschedule tasks, simplify your plan, or just vent if you need to.`;
        await notifyUser(userId, "stress_checkin", msg);
        logInteraction(userId, "notification", "outbound", msg, "stress_checkin").catch(() => {});
        // Record last checkin time
        await db
          .update(schema.userEmotionalState)
          .set({ lastStressCheckinAt: now, updatedAt: now })
          .where(eq(schema.userEmotionalState.userId, userId));
        console.log(`[EmotionalState] stress check-in sent to ${userId}`);
      } catch (err) {
        console.error("[EmotionalState] stress check-in send failed:", err);
      }
    }
  }

  return {
    stressScore: effectiveStress,
    flowScore: effectiveFlow,
    label: effectiveLabel,
    explanation,
    signalSources: signals.sources,
  };
}

export async function getEmotionalState(userId: string): Promise<typeof schema.userEmotionalState.$inferSelect | null> {
  try {
    const rows = await db
      .select()
      .from(schema.userEmotionalState)
      .where(eq(schema.userEmotionalState.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Map an override label to representative stress/flow scores so the AI prompt
// guidance adapts immediately without waiting for the next heartbeat.
function overrideScores(label: string): { stressScore: number; flowScore: number } {
  switch (label) {
    case "overwhelmed": return { stressScore: 9, flowScore: 1 };
    case "stressed":    return { stressScore: 7, flowScore: 3 };
    case "focused":     return { stressScore: 3, flowScore: 7 };
    case "in flow":     return { stressScore: 2, flowScore: 9 };
    case "calm":
    default:            return { stressScore: 2, flowScore: 5 };
  }
}

export async function setManualStateOverride(
  userId: string,
  override: string,
  now: Date,
): Promise<void> {
  const { stressScore, flowScore } = overrideScores(override);
  const explanation = `User self-reported as "${override}". Jarvis will adapt its tone accordingly for the next 3 hours.`;
  const signalSources = ["manual override"];

  await db
    .insert(schema.userEmotionalState)
    .values({
      userId,
      stressScore,
      flowScore,
      label: override,
      explanation,
      signalSources,
      manualOverride: override,
      manualOverrideAt: now,
      consecutiveHighStressCycles: 0,
      computedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.userEmotionalState.userId,
      set: {
        stressScore,
        flowScore,
        label: override,
        explanation,
        signalSources,
        manualOverride: override,
        manualOverrideAt: now,
        consecutiveHighStressCycles: 0,
        computedAt: now,
        updatedAt: now,
      },
    });
}

/**
 * Build a brief prompt block describing the current emotional state.
 * Used by promptContext.ts to inject state-aware coaching instructions.
 */
export function buildEmotionalStatePromptBlock(state: typeof schema.userEmotionalState.$inferSelect): string {
  const { stressScore, flowScore, label, explanation, baselineStress, baselineFlow, patternNote } = state;

  let guidance = "";
  if (stressScore >= 7) {
    guidance = "The user is in HIGH STRESS. Keep your responses SHORT and SIMPLE. Prioritize reducing cognitive load — fewer options, more reassurance, protective tone. Avoid adding tasks or complexity. Focus on what can be removed or deferred.";
  } else if (stressScore >= 5) {
    guidance = "The user is under moderate stress. Keep responses concise and supportive. Gently prioritize and avoid overwhelming them with too much at once.";
  } else if (flowScore >= 7) {
    guidance = "The user is IN FLOW — high focus, high output. Minimise interruptions and proactive nudges. Match their momentum. Be terse and efficient in replies.";
  } else if (flowScore >= 5) {
    guidance = "The user is focused and doing well. Normal coaching style applies.";
  } else {
    guidance = "The user is in a calm, baseline state. Normal coaching style applies.";
  }

  // ── Baseline / personalisation context ──────────────────────────────────────
  let baselineContext = "";
  if (baselineStress !== null && baselineStress !== undefined &&
      baselineFlow !== null && baselineFlow !== undefined) {
    const stressDiff = stressScore - baselineStress;
    const flowDiff = flowScore - baselineFlow;

    const stressCtx = Math.abs(stressDiff) >= 2
      ? ` (${stressDiff > 0 ? "↑" : "↓"} ${Math.abs(stressDiff).toFixed(1)} vs your usual ${baselineStress.toFixed(1)})`
      : ` (near your typical ${baselineStress.toFixed(1)})`;
    const flowCtx = Math.abs(flowDiff) >= 2
      ? ` (${flowDiff > 0 ? "↑" : "↓"} ${Math.abs(flowDiff).toFixed(1)} vs your usual ${baselineFlow.toFixed(1)})`
      : ` (near your typical ${baselineFlow.toFixed(1)})`;

    baselineContext = `\nPersonal baseline: stress ${stressScore}/10${stressCtx}, flow ${flowScore}/10${flowCtx}.`;
    if (patternNote) baselineContext += ` Pattern: ${patternNote}.`;
  }

  return `\n\n## Jarvis Perceived Emotional State\nCurrent state: **${label}** (stress ${stressScore}/10, flow ${flowScore}/10)\n${explanation}${baselineContext}\n\nCoaching instruction: ${guidance}\n`;
}
