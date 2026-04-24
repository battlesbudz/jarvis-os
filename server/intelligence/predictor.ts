/**
 * Predictor — Jarvis Prediction Engine
 *
 * Uses PatternAnalysis output to generate daily predictions with confidence scores.
 * Runs an LLM pass to translate raw patterns into human-readable, actionable predictions.
 *
 * Prediction types:
 *   energy_dip          — predicted low-energy window today/this week
 *   procrastination_risk — task categories with historically low completion
 *   email_overdue       — important sender whose reply is likely overdue
 *   project_stall       — goal whose trajectory looks like past stall patterns
 */

import { db } from "../db";
import { eq, and, desc, gte, isNull, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { PatternAnalysis } from "./pattern-analyser";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const CONFIDENCE_THRESHOLD = 55;

export type PredictionType =
  | "energy_dip"
  | "procrastination_risk"
  | "email_overdue"
  | "project_stall";

interface RawPrediction {
  type: PredictionType;
  targetDatetime: Date;
  confidenceScore: number;
  basisSummary: string;
  observationCount: number;
  extraContext?: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatHour(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "noon";
  return `${hour - 12}pm`;
}

/**
 * Generate raw predictions from pattern analysis without LLM translation.
 */
function buildRawPredictions(analysis: PatternAnalysis, targetDate: string): RawPrediction[] {
  const predictions: RawPrediction[] = [];
  const today = new Date(targetDate + "T00:00:00");

  // ── 1. Energy dip ──────────────────────────────────────────────────────────
  if (analysis.energyPatterns.length >= 3) {
    const dipHour = analysis.dipEnergyHour;
    const dipPatterns = analysis.energyPatterns.filter(
      (p) => Math.abs(p.hourOfDay - dipHour) <= 1
    );
    const obsCount = dipPatterns.reduce((s, p) => s + p.observationCount, 0);

    if (obsCount >= 3) {
      const dipTime = new Date(today);
      dipTime.setHours(dipHour, 0, 0, 0);
      const avgDipLevel = dipPatterns.reduce((s, p) => s + p.avgEnergyLevel * p.observationCount, 0) /
        Math.max(1, obsCount);

      // Energy scale is 1–5. Dip = avg level below midpoint (2.5).
      const confidence = Math.min(90, 40 + obsCount * 4 + (avgDipLevel < 2.5 ? 10 : 0));

      predictions.push({
        type: "energy_dip",
        targetDatetime: dipTime,
        confidenceScore: Math.round(confidence),
        basisSummary: `Energy dip pattern at ${formatHour(dipHour)} observed across ${obsCount} check-ins (avg level ${avgDipLevel.toFixed(1)}/5)`,
        observationCount: obsCount,
        extraContext: `Peak energy is typically at ${formatHour(analysis.peakEnergyHour)}`,
      });
    }
  }

  // ── 2. Procrastination risk ────────────────────────────────────────────────
  // Only emit one per day (matches the DB unique index on type+date).
  // Pick the single highest-risk (lowest completion rate) category.
  const lowCompletionCats = analysis.taskCompletionPatterns
    .filter((p) => p.completionRate < 0.45 && p.observationCount >= 4)
    .sort((a, b) => a.completionRate - b.completionRate)
    .slice(0, 1);

  for (const cat of lowCompletionCats) {
    const confidence = Math.min(85, 30 + cat.observationCount * 3 + (1 - cat.completionRate) * 20);
    const procrastTime = new Date(today);
    procrastTime.setHours(10, 0, 0, 0);

    predictions.push({
      type: "procrastination_risk",
      targetDatetime: procrastTime,
      confidenceScore: Math.round(confidence),
      basisSummary: `"${cat.category}" tasks completed only ${Math.round(cat.completionRate * 100)}% of the time across ${cat.observationCount} observations`,
      observationCount: cat.observationCount,
      extraContext: `Category: ${cat.category}`,
    });
  }

  // ── 3. Email overdue ───────────────────────────────────────────────────────
  const now = new Date();
  for (const ep of analysis.emailResponsePatterns) {
    if (!ep.lastResponseAt) continue;
    const hoursSinceLast = (now.getTime() - ep.lastResponseAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLast > ep.avgResponseHours * 1.8 && hoursSinceLast > 24) {
      const confidence = Math.min(80, 40 + Math.min(30, (hoursSinceLast - ep.avgResponseHours) / ep.avgResponseHours * 20));
      const overdueTime = new Date(today);
      overdueTime.setHours(9, 0, 0, 0);

      predictions.push({
        type: "email_overdue",
        targetDatetime: overdueTime,
        confidenceScore: Math.round(confidence),
        basisSummary: `${ep.senderName} usually gets a reply within ${Math.round(ep.avgResponseHours)}h — last interaction was ${Math.round(hoursSinceLast)}h ago`,
        observationCount: ep.observationCount,
        extraContext: `Sender domain: ${ep.senderDomain}`,
      });

      break;
    }
  }

  // ── 4. Project stall ──────────────────────────────────────────────────────
  const highStallRisk = analysis.projectStallPatterns.filter((p) => p.stallRiskScore >= 70).slice(0, 1);
  for (const stall of highStallRisk) {
    const stallTime = new Date(today);
    stallTime.setHours(11, 0, 0, 0);

    predictions.push({
      type: "project_stall",
      targetDatetime: stallTime,
      confidenceScore: Math.round(stall.stallRiskScore),
      basisSummary: `"${stall.goalTitle}" has had no progress in ${stall.daysSinceProgress} days`,
      observationCount: stall.daysSinceProgress,
      extraContext: `Goal tree ID: ${stall.goalTreeId}`,
    });
  }

  return predictions.filter((p) => p.confidenceScore >= CONFIDENCE_THRESHOLD);
}

/**
 * Translate raw predictions into human-readable, actionable text via LLM.
 */
async function translatePredictions(
  rawPredictions: RawPrediction[],
  analysis: PatternAnalysis
): Promise<{ type: PredictionType; humanReadable: string; actionSuggestion: string }[]> {
  if (rawPredictions.length === 0) return [];

  const predictionsDesc = rawPredictions
    .map((p, i) => {
      const time = `${p.targetDatetime.getHours()}:00 on ${DAY_NAMES[p.targetDatetime.getDay()]}`;
      return `${i + 1}. Type: ${p.type} | Time: ${time} | Confidence: ${p.confidenceScore}% | Basis: ${p.basisSummary}${p.extraContext ? ` | Context: ${p.extraContext}` : ""}`;
    })
    .join("\n");

  const prompt = `You are Jarvis, a highly personal AI assistant. Based on pattern analysis of this user's historical data, generate human-readable predictions and concrete action suggestions.

Peak energy hour: ${formatHour(analysis.peakEnergyHour)}
Low energy hour: ${formatHour(analysis.dipEnergyHour)}
Overall task completion rate: ${Math.round(analysis.overallCompletionRate * 100)}%

Predictions to translate:
${predictionsDesc}

Return a JSON array where each item has:
- "type": the prediction type (same as input)
- "human_readable": a conversational 1-sentence prediction (mention the time/day, be specific, no hedging)
- "action_suggestion": a concrete 1-sentence recommendation Jarvis should act on (e.g. "Move your deep work block to 10am", "Chase the reply from X", "Schedule 20 min on Y today")

Be direct, personal, and specific. Use "you" not "the user". Plain text, no markdown.

JSON array only, no preamble.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
    });
    const raw = resp.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as { predictions?: { type: string; human_readable: string; action_suggestion: string }[] } | { type: string; human_readable: string; action_suggestion: string }[];

    const items: { type: string; human_readable: string; action_suggestion: string }[] =
      Array.isArray(parsed) ? parsed : ((parsed as { predictions?: { type: string; human_readable: string; action_suggestion: string }[] }).predictions ?? []);

    return items.map((item) => ({
      type: item.type as PredictionType,
      humanReadable: item.human_readable || "",
      actionSuggestion: item.action_suggestion || "",
    }));
  } catch (err) {
    console.error("[Predictor] LLM translation failed:", err);
    return rawPredictions.map((p) => ({
      type: p.type,
      humanReadable: p.basisSummary,
      actionSuggestion: "",
    }));
  }
}

/**
 * Generate and persist predictions for a user for the target date.
 * Idempotent — will not re-insert if a prediction for that type+date already exists.
 * Returns the number of new predictions written.
 */
export async function generateAndStorePredictions(
  userId: string,
  targetDate: string,
  analysis: PatternAnalysis
): Promise<number> {
  const rawPredictions = buildRawPredictions(analysis, targetDate);
  if (rawPredictions.length === 0) return 0;

  // Skip LLM translation for types that already exist in the DB for this date.
  let newPredictions = rawPredictions;
  try {
    const existing = await db
      .select({ predictionType: schema.jarvisPredictions.predictionType })
      .from(schema.jarvisPredictions)
      .where(
        and(
          eq(schema.jarvisPredictions.userId, userId),
          eq(schema.jarvisPredictions.targetDate, targetDate),
        )
      );
    if (existing.length > 0) {
      const existingTypes = new Set(existing.map((r) => r.predictionType));
      newPredictions = rawPredictions.filter((p) => !existingTypes.has(p.type));
    }
  } catch { /* proceed with all predictions on error */ }

  if (newPredictions.length === 0) return 0;

  const translations = await translatePredictions(newPredictions, analysis);
  const translationMap = new Map(translations.map((t) => [t.type, t]));

  let inserted = 0;
  for (const raw of newPredictions) {
    const translation = translationMap.get(raw.type);
    const humanReadable = translation?.humanReadable || raw.basisSummary;
    const actionSuggestion = translation?.actionSuggestion || null;

    try {
      const result = await db
        .insert(schema.jarvisPredictions)
        .values({
          userId,
          predictionType: raw.type,
          targetDatetime: raw.targetDatetime,
          targetDate,
          confidenceScore: raw.confidenceScore,
          basisSummary: raw.basisSummary,
          humanReadable,
          actionSuggestion,
          observationCount: raw.observationCount,
        })
        .onConflictDoNothing()
        .returning({ id: schema.jarvisPredictions.id });
      if (result.length > 0) inserted++;
    } catch (err: unknown) {
      console.error("[Predictor] insert failed:", err);
    }
  }

  console.log(`[Predictor] ${inserted} prediction(s) stored for user ${userId} (${targetDate})`);
  return inserted;
}

/**
 * Get today's predictions for a user above the confidence threshold.
 */
export async function getTodayPredictions(
  userId: string,
  targetDate: string,
  minConfidence = CONFIDENCE_THRESHOLD
): Promise<schema.JarvisPrediction[]> {
  try {
    const rows = await db
      .select()
      .from(schema.jarvisPredictions)
      .where(
        and(
          eq(schema.jarvisPredictions.userId, userId),
          eq(schema.jarvisPredictions.targetDate, targetDate),
          gte(schema.jarvisPredictions.confidenceScore, minConfidence),
        )
      )
      .orderBy(desc(schema.jarvisPredictions.confidenceScore))
      .limit(10);
    return rows;
  } catch (err) {
    console.error("[Predictor] getTodayPredictions failed:", err);
    return [];
  }
}

/**
 * Get predictions for the upcoming week (today + 6 days) for a user.
 */
export async function getWeekPredictions(
  userId: string,
  startDate: string,
  minConfidence = CONFIDENCE_THRESHOLD
): Promise<schema.JarvisPrediction[]> {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endDate = end.toISOString().slice(0, 10);

  try {
    const rows = await db
      .select()
      .from(schema.jarvisPredictions)
      .where(
        and(
          eq(schema.jarvisPredictions.userId, userId),
          gte(schema.jarvisPredictions.targetDate, startDate),
          sql`${schema.jarvisPredictions.targetDate} <= ${endDate}`,
          minConfidence > 0
            ? gte(schema.jarvisPredictions.confidenceScore, minConfidence)
            : undefined,
        )
      )
      .orderBy(schema.jarvisPredictions.targetDate, desc(schema.jarvisPredictions.confidenceScore))
      .limit(30);
    return rows;
  } catch (err) {
    console.error("[Predictor] getWeekPredictions failed:", err);
    return [];
  }
}

/**
 * Format top predictions as a brief text block for the morning briefing.
 * Returns empty string if there are no high-confidence predictions.
 */
export function formatPredictionsForBriefing(
  predictions: schema.JarvisPrediction[]
): string {
  const top = predictions
    .filter((p) => p.confidenceScore >= 65)
    .slice(0, 2);

  if (top.length === 0) return "";

  const lines = top.map((p) => {
    const icon =
      p.predictionType === "energy_dip" ? "⚡" :
      p.predictionType === "procrastination_risk" ? "⚠️" :
      p.predictionType === "email_overdue" ? "📬" :
      "📊";
    return `${icon} ${p.humanReadable}${p.actionSuggestion ? ` → ${p.actionSuggestion}` : ""}`;
  });

  return `\n🔮 Jarvis Foresight:\n${lines.join("\n")}`;
}

/**
 * Get accuracy stats for a user — validated predictions grouped by type.
 */
export async function getPredictionAccuracy(userId: string): Promise<{
  total: number;
  validated: number;
  accurate: number;
  accuracyRate: number;
  autoSkipped: number;
  byType: Record<string, { total: number; accurate: number }>;
}> {
  try {
    // Fetch all predictions that have been evaluated (validated is not null).
    // Both confirmed (true) and not_confirmed (false) are included in the denominator.
    const rows = await db
      .select()
      .from(schema.jarvisPredictions)
      .where(
        and(
          eq(schema.jarvisPredictions.userId, userId),
          sql`${schema.jarvisPredictions.validated} IS NOT NULL`,
        )
      )
      .limit(200);

    // Count auto-skipped separately (validated=null, note starts with "auto_skipped").
    const skippedRows = await db
      .select({ id: schema.jarvisPredictions.id })
      .from(schema.jarvisPredictions)
      .where(
        and(
          eq(schema.jarvisPredictions.userId, userId),
          isNull(schema.jarvisPredictions.validated),
          sql`${schema.jarvisPredictions.validationNote} LIKE 'auto_skipped%'`,
        )
      )
      .limit(200);

    const byType: Record<string, { total: number; accurate: number }> = {};
    let totalValidated = 0;
    let totalAccurate = 0;

    for (const row of rows) {
      if (!byType[row.predictionType]) byType[row.predictionType] = { total: 0, accurate: 0 };
      byType[row.predictionType].total++;
      totalValidated++;
      if (row.validated === true && row.validationNote?.startsWith("confirmed")) {
        byType[row.predictionType].accurate++;
        totalAccurate++;
      }
    }

    return {
      total: rows.length,
      validated: totalValidated,
      accurate: totalAccurate,
      accuracyRate: totalValidated > 0 ? totalAccurate / totalValidated : 0,
      autoSkipped: skippedRows.length,
      byType,
    };
  } catch (err) {
    console.error("[Predictor] getPredictionAccuracy failed:", err);
    return { total: 0, validated: 0, accurate: 0, accuracyRate: 0, autoSkipped: 0, byType: {} };
  }
}

/**
 * Validate past predictions by comparing against what actually happened.
 * Called from the heartbeat — runs after predicted windows have passed.
 */
export async function validateExpiredPredictions(userId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const expired = await db
      .select()
      .from(schema.jarvisPredictions)
      .where(
        and(
          eq(schema.jarvisPredictions.userId, userId),
          isNull(schema.jarvisPredictions.validated),
          isNull(schema.jarvisPredictions.validationNote),
          gte(schema.jarvisPredictions.targetDate, oneWeekAgo),
        )
      )
      .orderBy(schema.jarvisPredictions.targetDatetime)
      .limit(20);

    for (const pred of expired) {
      if (pred.targetDatetime > cutoff) continue;

      let validated: boolean | null = null;
      let validationNote: string | null = null;

      if (pred.predictionType === "energy_dip") {
        const dateKey = pred.targetDate;
        try {
          const checkinRows = await db
            .select()
            .from(schema.energyCheckins)
            .where(and(eq(schema.energyCheckins.userId, userId), eq(schema.energyCheckins.date, dateKey)))
            .limit(1);

          if (checkinRows.length > 0) {
            const data = checkinRows[0].data as { level?: number; energy?: number };
            const level = data.level ?? data.energy ?? null;
            if (level !== null) {
              const predictedHour = pred.targetDatetime.getHours();
              const checkInHour = new Date(checkinRows[0].updatedAt || Date.now()).getHours();
              const hourDiff = Math.abs(checkInHour - predictedHour);

              if (hourDiff <= 2) {
                // Energy scale is 1–5. Dip = low/dead (1 or 2 out of 5).
                validated = level <= 2;
                validationNote = validated
                  ? `confirmed: energy was ${level}/5 at predicted dip time`
                  : `not_confirmed: energy was ${level}/5 (expected dip, level was not low)`;
              }
            }
          }
        } catch {}
      } else if (pred.predictionType === "procrastination_risk") {
        const dateKey = pred.targetDate;
        try {
          const planRows = await db
            .select()
            .from(schema.plans)
            .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, dateKey)))
            .limit(1);

          if (planRows.length > 0) {
            const data = planRows[0].data as { tasks?: { category?: string; completed?: boolean }[] };
            const tasks = data.tasks || [];
            const basisLine = pred.basisSummary;
            const catMatch = basisLine.match(/"([^"]+)"/);
            const cat = catMatch?.[1];
            if (cat) {
              const catTasks = tasks.filter((t) => t.category === cat);
              const catCompleted = catTasks.filter((t) => t.completed).length;
              const rate = catTasks.length > 0 ? catCompleted / catTasks.length : null;
              if (rate !== null) {
                validated = rate < 0.5;
                validationNote = validated
                  ? `confirmed: completed ${catCompleted}/${catTasks.length} ${cat} tasks`
                  : `not_confirmed: completed ${catCompleted}/${catTasks.length} ${cat} tasks`;
              }
            }
          }
        } catch {}
      } else {
        // Leave validated=null — this prediction type cannot be auto-validated.
        // Set validationNote so the heartbeat does not re-process it next tick.
        validationNote = "auto_skipped: manual validation required for this type";
      }

      // Only persist when the outcome is determined (validated set) or the row
      // is being permanently marked as auto_skipped. Leave truly unresolved rows
      // untouched so they will be retried on the next heartbeat tick.
      if (validated !== null || validationNote !== null) {
        try {
          await db
            .update(schema.jarvisPredictions)
            .set({ validated, validationNote, validatedAt: validated !== null ? now : null })
            .where(eq(schema.jarvisPredictions.id, pred.id));
        } catch (err) {
          console.error("[Predictor] validation update failed:", err);
        }
      }
    }
  } catch (err) {
    console.error("[Predictor] validateExpiredPredictions failed:", err);
  }
}
