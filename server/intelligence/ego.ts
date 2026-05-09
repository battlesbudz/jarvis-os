/**
 * Jarvis Ego — Self-Awareness and Performance Tracking
 *
 * Weekly analyser that:
 *   1. Aggregates the action log to compute key metrics
 *   2. Detects under-performing action types and writes self-correction prefs
 *   3. Generates a candid natural-language report via LLM
 *   4. Delivers the report via channel registry + queues it for in-app display
 *   5. Writes durable self-knowledge findings to user_memories + marks Soul stale
 */
import { db } from "../db";
import { eq, and, gte, lt, sql, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { jarvisActionLog, egoWeeklyReports } from "@shared/schema";
import { notifyUser } from "../channels/registry";
import { logInteraction } from "../interactionLog";
import { markSoulStale } from "../memory/soul";
import { recordSkillSignal } from "./skillWriter";
import OpenAI from "openai";
import { getOpenAIClientConfig } from "../agent/providers/env";

const openai = new OpenAI(getOpenAIClientConfig());

const SELF_CORRECTION_THRESHOLD = 0.25;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns the Monday-start ISO week anchor (YYYY-MM-DD) for the given date.
 * All ego reports are keyed by this value to ensure consistent longitudinal buckets
 * regardless of which day of the week the report is triggered.
 */
export function getISOWeekMonday(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay(): 0=Sun, 1=Mon, ..., 6=Sat → shift so Monday=0
  const dayOfWeek = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayOfWeek);
  return d.toISOString().slice(0, 10);
}

export interface EgoAnalysis {
  weekOf: string;
  totalActions: number;
  completionRate: number;
  engagementRate: number;
  predictionAccuracy: number;
  actionBreakdown: Record<string, { total: number; actedOn: number; pending: number; ignored: number }>;
  twoWeekBreakdown: Record<string, { total: number; actedOn: number }>;
  mostEffective: string[];
  leastEffective: string[];
  relationshipHealth: "improving" | "stable" | "declining";
  avgResponseLatencyMs: number;
  messageFrequency: number;
  selfCorrectionSignals: string[];
}

/**
 * Compute ego analysis for a user over the last 7 days (current week)
 * plus 2-week windows for self-correction accuracy.
 */
export async function analyseEgo(userId: string, weekOf: string): Promise<EgoAnalysis> {
  // Anchor windows to the ISO week boundaries (weekOf = Monday 00:00 UTC).
  const weekStart = new Date(`${weekOf}T00:00:00.000Z`);
  const weekEnd = new Date(weekStart.getTime() + ONE_WEEK_MS); // exclusive upper bound (next Monday)
  const prevWeekStart = new Date(weekStart.getTime() - ONE_WEEK_MS); // two-week window lower bound

  // This week's actions: [weekStart, weekEnd)
  const actions = await db
    .select()
    .from(jarvisActionLog)
    .where(
      and(
        eq(jarvisActionLog.userId, userId),
        gte(jarvisActionLog.createdAt, weekStart),
        lt(jarvisActionLog.createdAt, weekEnd),
      ),
    );

  // Two-week window: [prevWeekStart, weekEnd) — used for trend analysis
  const allTwoWeekActions = await db
    .select()
    .from(jarvisActionLog)
    .where(
      and(
        eq(jarvisActionLog.userId, userId),
        gte(jarvisActionLog.createdAt, prevWeekStart),
        lt(jarvisActionLog.createdAt, weekEnd),
      ),
    );

  const breakdown: EgoAnalysis["actionBreakdown"] = {};
  for (const a of actions) {
    const t = a.actionType;
    if (!breakdown[t]) breakdown[t] = { total: 0, actedOn: 0, pending: 0, ignored: 0 };
    breakdown[t].total++;
    if (a.outcome === "acted_on" || a.outcome === "completed") breakdown[t].actedOn++;
    else if (a.outcome === "pending") breakdown[t].pending++;
    else if (a.outcome === "ignored" || a.outcome === "dismissed") breakdown[t].ignored++;
  }

  const twoWeekBreakdown: EgoAnalysis["twoWeekBreakdown"] = {};
  for (const a of allTwoWeekActions) {
    const t = a.actionType;
    if (!twoWeekBreakdown[t]) twoWeekBreakdown[t] = { total: 0, actedOn: 0 };
    twoWeekBreakdown[t].total++;
    if (a.outcome === "acted_on" || a.outcome === "completed") twoWeekBreakdown[t].actedOn++;
  }

  const totalActions = actions.length;
  const decided = actions.filter((a) => a.outcome !== "pending");
  const actedOn = decided.filter((a) => a.outcome === "acted_on" || a.outcome === "completed").length;
  const completionRate = decided.length > 0 ? actedOn / decided.length : 0;
  const engagementRate = totalActions > 0 ? actedOn / totalActions : 0;

  const predictionActions = allTwoWeekActions.filter((a) => a.actionType === "prediction_made" && a.outcome !== "pending");
  const predictionHits = predictionActions.filter((a) => a.outcome === "completed" || a.outcome === "acted_on").length;
  const predictionAccuracy = predictionActions.length > 0 ? predictionHits / predictionActions.length : 0;

  const mostEffective = Object.entries(breakdown)
    .filter(([, v]) => v.total >= 2 && v.actedOn / v.total >= 0.6)
    .sort(([, a], [, b]) => b.actedOn / b.total - a.actedOn / a.total)
    .slice(0, 3)
    .map(([k]) => k);

  const leastEffective = Object.entries(twoWeekBreakdown)
    .filter(([, v]) => v.total >= 3 && v.actedOn / v.total < SELF_CORRECTION_THRESHOLD)
    .sort(([, a], [, b]) => a.actedOn / a.total - b.actedOn / b.total)
    .slice(0, 3)
    .map(([k]) => k);

  const recentInteractions = await db
    .select({ createdAt: schema.interactionLog.createdAt })
    .from(schema.interactionLog)
    .where(
      and(
        eq(schema.interactionLog.userId, userId),
        gte(schema.interactionLog.createdAt, weekStart),
        lt(schema.interactionLog.createdAt, weekEnd),
      ),
    );

  const prevWeekInteractions = await db
    .select({ createdAt: schema.interactionLog.createdAt })
    .from(schema.interactionLog)
    .where(
      and(
        eq(schema.interactionLog.userId, userId),
        gte(schema.interactionLog.createdAt, prevWeekStart),
        lt(schema.interactionLog.createdAt, weekStart),
      ),
    );

  const messageFrequency = recentInteractions.length;
  const prevMessageFrequency = prevWeekInteractions.length;

  const resolvedWithTimes = actions.filter(
    (a) => a.outcome !== "pending" && a.updatedAt && a.createdAt,
  );
  let avgResponseLatencyMs = 0;
  if (resolvedWithTimes.length > 0) {
    const totalLatency = resolvedWithTimes.reduce(
      (sum, a) => sum + (new Date(a.updatedAt!).getTime() - new Date(a.createdAt!).getTime()),
      0,
    );
    avgResponseLatencyMs = totalLatency / resolvedWithTimes.length;
  }

  const prevWeekActions = allTwoWeekActions.filter((a) => a.createdAt < weekStart);
  const prevDecided = prevWeekActions.filter((a) => a.outcome !== "pending");
  const prevActed = prevDecided.filter((a) => a.outcome === "acted_on" || a.outcome === "completed").length;
  const prevRate = prevDecided.length > 0 ? prevActed / prevDecided.length : 0;

  const prevResolved = prevWeekActions.filter(
    (a) => a.outcome !== "pending" && a.updatedAt && a.createdAt,
  );
  const prevAvgLatency = prevResolved.length > 0
    ? prevResolved.reduce((sum, a) => sum + (new Date(a.updatedAt!).getTime() - new Date(a.createdAt!).getTime()), 0) / prevResolved.length
    : 0;

  // Relationship health: multi-factor — completion rate, message frequency, response latency.
  // Count how many factors improved vs. declined. Requires ≥3 previous resolved actions to trust trend.
  let improvingFactors = 0;
  let decliningFactors = 0;
  if (prevDecided.length >= 3) {
    if (completionRate > prevRate + 0.08) improvingFactors++;
    else if (completionRate < prevRate - 0.08) decliningFactors++;
  }
  if (prevMessageFrequency > 0) {
    if (messageFrequency > prevMessageFrequency * 1.15) improvingFactors++;
    else if (messageFrequency < prevMessageFrequency * 0.85) decliningFactors++;
  }
  if (prevAvgLatency > 0 && avgResponseLatencyMs > 0) {
    if (avgResponseLatencyMs < prevAvgLatency * 0.85) improvingFactors++;
    else if (avgResponseLatencyMs > prevAvgLatency * 1.25) decliningFactors++;
  }

  let relationshipHealth: EgoAnalysis["relationshipHealth"] = "stable";
  if (improvingFactors >= 2) relationshipHealth = "improving";
  else if (decliningFactors >= 2) relationshipHealth = "declining";

  const selfCorrectionSignals: string[] = [];
  for (const actionType of leastEffective) {
    const tw = twoWeekBreakdown[actionType];
    const rate = tw ? tw.actedOn / tw.total : 0;
    selfCorrectionSignals.push(`${actionType}: ${Math.round(rate * 100)}% engagement over last 2 weeks`);
  }

  return {
    weekOf,
    totalActions,
    completionRate,
    engagementRate,
    predictionAccuracy,
    actionBreakdown: breakdown,
    twoWeekBreakdown,
    mostEffective,
    leastEffective,
    relationshipHealth,
    avgResponseLatencyMs,
    messageFrequency,
    selfCorrectionSignals,
  };
}

/**
 * Apply self-correction signals: write suppression prefs for under-performing
 * action types so the heartbeat and planner pull back on them.
 * Also recovers (un-suppresses) action types that have improved to above the
 * threshold in the current week, preventing permanent over-suppression.
 */
async function applySelfCorrections(
  userId: string,
  leastEffective: string[],
  actionBreakdown: EgoAnalysis["actionBreakdown"],
): Promise<void> {
  if (leastEffective.length === 0 && Object.keys(actionBreakdown).length === 0) return;

  try {
    const prefRows = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);

    const prefData = (prefRows[0]?.data as Record<string, unknown>) || {};
    let suppressedActions = (prefData.jarvisSuppressedActions as string[] | undefined) || [];

    // Suppress new under-performers
    for (const actionType of leastEffective) {
      if (!suppressedActions.includes(actionType)) {
        suppressedActions.push(actionType);
        console.log(`[Ego] self-correction: suppressing ${actionType} for user ${userId}`);
      }
    }

    // Recovery policy: un-suppress action types that have improved to above the
    // threshold this week (completion rate > SELF_CORRECTION_THRESHOLD with ≥3 actions).
    suppressedActions = suppressedActions.filter((actionType) => {
      const bd = actionBreakdown[actionType];
      if (!bd || bd.total < 3) return true; // too few data points — keep suppressed
      const rate = bd.actedOn / bd.total;
      if (rate > SELF_CORRECTION_THRESHOLD) {
        console.log(`[Ego] self-correction: recovering ${actionType} for user ${userId} (rate ${(rate * 100).toFixed(0)}%)`);
        return false; // remove from suppressed
      }
      return true;
    });

    await db
      .insert(schema.userPreferences)
      .values({ userId, data: { ...prefData, jarvisSuppressedActions: suppressedActions }, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.userPreferences.userId,
        set: { data: { ...prefData, jarvisSuppressedActions: suppressedActions }, updatedAt: new Date() },
      });

    // Always persist the current suppression state into the behaviour store so
    // the agent harness reflects the latest Ego decisions at next session start.
    // Writing even when suppressedActions is empty ensures that recovered action
    // types are cleared from user_skill_packs.instruction_overrides — decoupling
    // behaviour updates from code deploys (Task #282).
    try {
      const { writeEgoOverrides, getOrCreateSystemPackId } = await import("./behaviorStore");
      const systemPackId = await getOrCreateSystemPackId();
      const coachingNote = suppressedActions.length > 0
        ? `Ego self-correction (${new Date().toISOString().slice(0, 10)}): reduce frequency of low-engagement actions.`
        : undefined;
      await writeEgoOverrides(userId, systemPackId, {
        suppressActionTypes: suppressedActions,
        ...(coachingNote ? { coachingNote } : {}),
      });
    } catch (bsErr) {
      // Non-fatal — behaviour store write is best-effort
      console.warn("[Ego] behaviour store override write failed (non-fatal):", bsErr);
    }
  } catch (err) {
    console.error("[Ego] applySelfCorrections failed:", err);
  }
}

/**
 * Generate a natural-language self-report using the ego analysis.
 */
async function generateReportText(analysis: EgoAnalysis): Promise<string> {
  const breakdownLines = Object.entries(analysis.actionBreakdown)
    .map(([type, v]) => {
      const rate = v.total > 0 ? Math.round((v.actedOn / v.total) * 100) : 0;
      return `- ${type}: ${v.total} actions, ${rate}% engagement`;
    })
    .join("\n");

  const avgLatencyHours = analysis.avgResponseLatencyMs > 0
    ? (analysis.avgResponseLatencyMs / 3_600_000).toFixed(1) + "h"
    : "unknown";

  const prompt = `You are Jarvis, an AI assistant writing your own weekly self-evaluation report. Be candid, honest, and direct. Do not be falsely modest or excessively self-congratulatory. Refer to yourself as "I" or "Jarvis".

Weekly performance data:
- Total actions taken: ${analysis.totalActions}
- Completion rate (of resolved actions): ${Math.round(analysis.completionRate * 100)}%
- Engagement rate (of all actions): ${Math.round(analysis.engagementRate * 100)}%
- Prediction accuracy (2-week window): ${analysis.predictionAccuracy > 0 ? Math.round(analysis.predictionAccuracy * 100) + "%" : "insufficient data"}
- Avg time before user responds to my actions: ${avgLatencyHours}
- Relationship health trend: ${analysis.relationshipHealth}
- Messages exchanged this week: ${analysis.messageFrequency}

Action breakdown:
${breakdownLines || "No actions recorded this week."}

Most effective action types: ${analysis.mostEffective.join(", ") || "insufficient data"}
Least effective action types: ${analysis.leastEffective.join(", ") || "none identified"}

Write a concise weekly self-report with these sections:
1. **This week at a glance** — 2-3 sentences summarising what I did and the headline numbers
2. **What I did well** — 1-2 specific things with honest evidence
3. **Where I can do better** — 2-3 candid self-observations about where I fell short or over-reached. Be honest even if it's uncomfortable.
4. **What I'm adjusting** — 1-2 concrete changes I'm making next week based on this data

Tone: direct, self-aware, honest. Not corporate, not sycophantic. Under 250 words total. Plain text, no markdown headers.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 600,
    });
    return resp.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.error("[Ego] report generation failed:", err);
    return "";
  }
}

/**
 * Write durable self-knowledge memories and mark Soul stale.
 */
async function writeSelfKnowledgeMemories(
  userId: string,
  analysis: EgoAnalysis,
): Promise<void> {
  const findings: string[] = [];

  if (analysis.leastEffective.length > 0) {
    findings.push(
      `Jarvis has low engagement on ${analysis.leastEffective.join(", ")} — user rarely acts on these suggestions`,
    );
  }
  if (analysis.mostEffective.length > 0) {
    findings.push(
      `Jarvis is most effective with ${analysis.mostEffective.join(", ")} — user consistently acts on these`,
    );
  }
  if (analysis.relationshipHealth === "improving") {
    findings.push("User engagement with Jarvis is trending upward week-over-week");
  } else if (analysis.relationshipHealth === "declining") {
    findings.push("User engagement with Jarvis is declining — may need to reduce frequency or change approach");
  }

  for (const finding of findings) {
    try {
      await db.insert(schema.userMemories).values({
        userId,
        content: finding,
        category: "fact",
        confidence: 80,
        relevanceScore: 60,
        sourceType: "jarvis_self_knowledge",
        sourceRef: `ego_${analysis.weekOf}`,
      });
    } catch (err) {
      console.error("[Ego] self-knowledge memory insert failed:", err);
    }
  }

  if (findings.length > 0) {
    markSoulStale(userId).catch(() => {});
  }
}

/**
 * Record skill signals for effective action types detected by the ego analysis.
 * Each `mostEffective` action type emits one signal per ego run.
 * When the same pattern accumulates 3 signals, SkillWriter crystallises it
 * into a persistent instruction file for the agent harness.
 */
async function recordSkillSignals(userId: string, analysis: EgoAnalysis): Promise<void> {
  for (const actionType of analysis.mostEffective) {
    const bd = analysis.actionBreakdown[actionType];
    const rate = bd ? Math.round((bd.actedOn / bd.total) * 100) : 0;
    const example = `The action type "${actionType}" has a ${rate}% engagement rate — the user consistently acts on these suggestions`;
    await recordSkillSignal(userId, `ego_effective:${actionType}`, example).catch(() => {});
  }
  // Also record signals for confirmed high-engagement sequences from twoWeekBreakdown
  for (const [actionType, tw] of Object.entries(analysis.twoWeekBreakdown)) {
    if (tw.total >= 5 && tw.actedOn / tw.total >= 0.75) {
      const example = `Over two weeks, "${actionType}" had ${tw.actedOn}/${tw.total} accepted — strong sustained preference`;
      await recordSkillSignal(userId, `ego_sustained:${actionType}`, example).catch(() => {});
    }
  }
}

/**
 * Run the full ego cycle for one user.
 * Returns true if a report was generated and delivered.
 */
export async function runEgoForUser(userId: string, weekOf: string): Promise<boolean> {
  // If a report row already exists, skip regeneration.
  // Exception: if deliveredAt is null (channel delivery previously failed),
  // retry delivery using the stored report text.
  try {
    const existing = await db
      .select({ id: egoWeeklyReports.id, deliveredAt: egoWeeklyReports.deliveredAt, reportText: egoWeeklyReports.reportText })
      .from(egoWeeklyReports)
      .where(and(eq(egoWeeklyReports.userId, userId), eq(egoWeeklyReports.weekOf, weekOf)))
      .limit(1);
    if (existing.length > 0) {
      if (existing[0].deliveredAt) return false; // already delivered — skip
      // Retry delivery for previously undelivered report.
      // Only mark deliveredAt if at least one channel confirms ok.
      const storedText = existing[0].reportText;
      if (storedText) {
        const msg = `📊 Jarvis Weekly Self-Report (week of ${weekOf})\n\n${storedText}`;
        const retryResults = await notifyUser(userId, "ego_report", msg).catch(() => []);
        const anyDelivered = retryResults.some((r) => r.result.ok);
        if (anyDelivered) {
          await db
            .update(egoWeeklyReports)
            .set({ deliveredAt: new Date() })
            .where(eq(egoWeeklyReports.id, existing[0].id));
          logInteraction(userId, "notification", "outbound", msg, "ego_report").catch(() => {});
          console.log(`[Ego] retry delivery succeeded for user ${userId} (${weekOf})`);
        } else {
          console.log(`[Ego] retry delivery: no channel confirmed for user ${userId} (${weekOf}) — will retry next run`);
        }
        return anyDelivered;
      }
      return false; // row exists but no report text — nothing to retry
    }
  } catch {}

  const analysis = await analyseEgo(userId, weekOf);

  if (analysis.totalActions === 0) {
    console.log(`[Ego] no actions recorded for user ${userId} (${weekOf}), skipping report`);
    return false;
  }

  const reportText = await generateReportText(analysis);
  if (!reportText) return false;

  try {
    await db.insert(egoWeeklyReports).values({
      userId,
      weekOf,
      analysis: analysis as unknown as Record<string, unknown>,
      reportText,
    });
  } catch (err) {
    console.error("[Ego] report insert failed:", err);
    return false;
  }

  await applySelfCorrections(userId, analysis.leastEffective, analysis.actionBreakdown);
  await writeSelfKnowledgeMemories(userId, analysis);
  await recordSkillSignals(userId, analysis);

  const msg = `📊 Jarvis Weekly Self-Report (week of ${weekOf})\n\n${reportText}`;
  let delivered = false;
  try {
    const deliveryResults = await notifyUser(userId, "ego_report", msg);
    delivered = deliveryResults.some((r) => r.result.ok);
    if (delivered) {
      await db
        .update(egoWeeklyReports)
        .set({ deliveredAt: new Date() })
        .where(and(eq(egoWeeklyReports.userId, userId), eq(egoWeeklyReports.weekOf, weekOf)));
      logInteraction(userId, "notification", "outbound", msg, "ego_report").catch(() => {});
      console.log(`[Ego] report delivered for user ${userId} (${weekOf})`);
    } else {
      console.log(`[Ego] report generated but no channel delivered for user ${userId} (${weekOf}) — will retry next run`);
    }
  } catch (err) {
    console.error("[Ego] report delivery failed:", err);
  }

  return delivered;
}

/**
 * Run ego cycle for all users. Called from the scheduler on Sunday evenings.
 */
export async function runEgoForAllUsers(now: Date, weekOf: string): Promise<void> {
  const allUsers = await db.select({ id: schema.users.id }).from(schema.users).catch(() => []);
  let count = 0;
  for (const user of allUsers) {
    try {
      const delivered = await runEgoForUser(user.id, weekOf);
      if (delivered) count++;
    } catch (err) {
      console.error(`[Ego] failed for user ${user.id}:`, err);
    }
  }
  if (count > 0) console.log(`[Ego] Weekly ego reports delivered to ${count} user(s)`);
}
