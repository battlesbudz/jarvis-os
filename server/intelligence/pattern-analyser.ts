/**
 * Pattern Analyser — Jarvis Prediction Engine
 *
 * Analyses 30-90 days of historical data to extract temporal patterns:
 * - Energy levels by hour-of-day and day-of-week (from energy_checkins)
 * - Task completion rates by type and time-of-day (from plans)
 * - Brain dump activity patterns (from brain_dump_inbox + interaction_log)
 * - Email response latency by sender (from interaction_log + inbox_items)
 * - Project stall risk (from goal_trees + completion_history)
 */

import { db } from "../db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface EnergyPattern {
  hourOfDay: number;
  dayOfWeek: number;
  avgEnergyLevel: number;
  observationCount: number;
}

export interface TaskCompletionPattern {
  category: string;
  hourOfDay: number;
  completionRate: number;
  observationCount: number;
}

export interface EmailResponsePattern {
  senderDomain: string;
  senderName: string;
  avgResponseHours: number;
  observationCount: number;
  lastResponseAt: Date | null;
}

export interface ProjectStallPattern {
  goalTreeId: string;
  goalTitle: string;
  daysSinceProgress: number;
  stallRiskScore: number;
  similarPastStalls: number;
}

export interface PatternAnalysis {
  userId: string;
  analysedAt: Date;
  observationWindowDays: number;
  energyPatterns: EnergyPattern[];
  peakEnergyHour: number;
  dipEnergyHour: number;
  peakDayOfWeek: number;
  taskCompletionPatterns: TaskCompletionPattern[];
  emailResponsePatterns: EmailResponsePattern[];
  projectStallPatterns: ProjectStallPattern[];
  overallCompletionRate: number;
  averageDailyCompletions: number;
  brainDumpActivityPattern: {
    mostActiveHour: number;
    mostActiveDayOfWeek: number;
    avgItemsPerDay: number;
  };
}

type EnergyCheckinData = {
  level?: number;
  mood?: number;
  energy?: number;
  score?: number;
  [key: string]: unknown;
};

type PlanData = {
  tasks?: PlanTask[];
  [key: string]: unknown;
};

type PlanTask = {
  title?: string;
  category?: string;
  completed?: boolean;
  completedAt?: string | number;
  time?: string;
  createdAt?: string | number;
  [key: string]: unknown;
};

export async function analysePatterns(userId: string, windowDays = 60): Promise<PatternAnalysis> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const analysedAt = new Date();

  const [energyRows, planRows, goalTreeRows, inboxItemRows] = await Promise.all([
    db
      .select()
      .from(schema.energyCheckins)
      .where(and(
        eq(schema.energyCheckins.userId, userId),
        gte(schema.energyCheckins.date, cutoff.toISOString().slice(0, 10)),
      ))
      .orderBy(desc(schema.energyCheckins.date))
      .limit(200),

    db
      .select()
      .from(schema.plans)
      .where(and(
        eq(schema.plans.userId, userId),
        gte(schema.plans.date, cutoff.toISOString().slice(0, 10)),
      ))
      .orderBy(desc(schema.plans.date))
      .limit(120),

    db
      .select()
      .from(schema.goalTrees)
      .where(and(
        eq(schema.goalTrees.userId, userId),
        eq(schema.goalTrees.status, "active"),
      ))
      .limit(20),

    db
      .select()
      .from(schema.inboxItems)
      .where(and(
        eq(schema.inboxItems.userId, userId),
        eq(schema.inboxItems.sourceType, "email"),
        gte(schema.inboxItems.surfacedAt, cutoff),
      ))
      .orderBy(desc(schema.inboxItems.surfacedAt))
      .limit(200),
  ]);

  // ── Energy patterns ────────────────────────────────────────────────────────
  const energyPatterns = buildEnergyPatterns(energyRows);
  const { peakHour, dipHour, peakDay } = findEnergyPeakAndDip(energyPatterns);

  // ── Task completion patterns ───────────────────────────────────────────────
  const { taskCompletionPatterns, overallCompletionRate, averageDailyCompletions } =
    buildTaskCompletionPatterns(planRows, windowDays);

  // ── Email response patterns ────────────────────────────────────────────────
  const emailResponsePatterns = buildEmailResponsePatterns(inboxItemRows);

  // ── Project stall patterns ─────────────────────────────────────────────────
  const projectStallPatterns = buildProjectStallPatterns(goalTreeRows, planRows);

  // ── Brain dump activity (approximated from interaction log / plan history) ─
  const brainDumpActivityPattern = buildBrainDumpPattern(planRows);

  return {
    userId,
    analysedAt,
    observationWindowDays: windowDays,
    energyPatterns,
    peakEnergyHour: peakHour,
    dipEnergyHour: dipHour,
    peakDayOfWeek: peakDay,
    taskCompletionPatterns,
    emailResponsePatterns,
    projectStallPatterns,
    overallCompletionRate,
    averageDailyCompletions,
    brainDumpActivityPattern,
  };
}

function buildEnergyPatterns(
  energyRows: (typeof schema.energyCheckins.$inferSelect)[]
): EnergyPattern[] {
  const buckets: Record<string, { total: number; count: number }> = {};

  for (const row of energyRows) {
    const data = row.data as EnergyCheckinData;
    const level = typeof data.level === "number" ? data.level
      : typeof data.energy === "number" ? data.energy
      : typeof data.mood === "number" ? data.mood
      : typeof data.score === "number" ? data.score
      : null;

    if (level === null) continue;

    const d = new Date(row.date);
    const dow = d.getDay();

    const updatedAt = row.updatedAt ? new Date(row.updatedAt) : d;
    const hour = updatedAt.getHours();
    const key = `${dow}_${hour}`;

    if (!buckets[key]) buckets[key] = { total: 0, count: 0 };
    buckets[key].total += level;
    buckets[key].count += 1;
  }

  return Object.entries(buckets).map(([key, val]) => {
    const [dow, hour] = key.split("_").map(Number);
    return {
      hourOfDay: hour,
      dayOfWeek: dow,
      avgEnergyLevel: val.total / val.count,
      observationCount: val.count,
    };
  });
}

function findEnergyPeakAndDip(patterns: EnergyPattern[]): {
  peakHour: number;
  dipHour: number;
  peakDay: number;
} {
  if (patterns.length === 0) return { peakHour: 9, dipHour: 15, peakDay: 1 };

  const hourBuckets: Record<number, { total: number; count: number }> = {};
  const dayBuckets: Record<number, { total: number; count: number }> = {};

  for (const p of patterns) {
    if (!hourBuckets[p.hourOfDay]) hourBuckets[p.hourOfDay] = { total: 0, count: 0 };
    hourBuckets[p.hourOfDay].total += p.avgEnergyLevel * p.observationCount;
    hourBuckets[p.hourOfDay].count += p.observationCount;

    if (!dayBuckets[p.dayOfWeek]) dayBuckets[p.dayOfWeek] = { total: 0, count: 0 };
    dayBuckets[p.dayOfWeek].total += p.avgEnergyLevel * p.observationCount;
    dayBuckets[p.dayOfWeek].count += p.observationCount;
  }

  const hourAvgs = Object.entries(hourBuckets)
    .filter(([, v]) => v.count >= 1)
    .map(([h, v]) => ({ hour: Number(h), avg: v.total / v.count }));

  const dayAvgs = Object.entries(dayBuckets)
    .filter(([, v]) => v.count >= 1)
    .map(([d, v]) => ({ day: Number(d), avg: v.total / v.count }));

  hourAvgs.sort((a, b) => b.avg - a.avg);
  dayAvgs.sort((a, b) => b.avg - a.avg);

  const peakHour = hourAvgs[0]?.hour ?? 9;
  const dipHour = hourAvgs[hourAvgs.length - 1]?.hour ?? 15;
  const peakDay = dayAvgs[0]?.day ?? 1;

  return { peakHour, dipHour, peakDay };
}

function buildTaskCompletionPatterns(
  planRows: (typeof schema.plans.$inferSelect)[],
  windowDays: number
): {
  taskCompletionPatterns: TaskCompletionPattern[];
  overallCompletionRate: number;
  averageDailyCompletions: number;
} {
  let totalTasks = 0;
  let totalCompleted = 0;
  let totalDaysWithTasks = 0;
  const catBuckets: Record<string, { completed: number; total: number }> = {};

  for (const row of planRows) {
    const data = row.data as PlanData;
    const tasks: PlanTask[] = Array.isArray(data.tasks) ? data.tasks : [];
    if (tasks.length === 0) continue;

    totalDaysWithTasks++;
    totalTasks += tasks.length;
    const dayCompleted = tasks.filter((t) => t.completed).length;
    totalCompleted += dayCompleted;

    for (const task of tasks) {
      const cat = (task.category as string) || "general";
      if (!catBuckets[cat]) catBuckets[cat] = { completed: 0, total: 0 };
      catBuckets[cat].total++;
      if (task.completed) catBuckets[cat].completed++;
    }
  }

  const taskCompletionPatterns: TaskCompletionPattern[] = Object.entries(catBuckets)
    .filter(([, v]) => v.total >= 3)
    .map(([cat, v]) => ({
      category: cat,
      hourOfDay: 9,
      completionRate: v.total > 0 ? v.completed / v.total : 0,
      observationCount: v.total,
    }));

  const overallCompletionRate = totalTasks > 0 ? totalCompleted / totalTasks : 0;
  const averageDailyCompletions = totalDaysWithTasks > 0
    ? totalCompleted / totalDaysWithTasks
    : 0;

  return { taskCompletionPatterns, overallCompletionRate, averageDailyCompletions };
}

function buildEmailResponsePatterns(
  inboxItemRows: (typeof schema.inboxItems.$inferSelect)[]
): EmailResponsePattern[] {
  const domainBuckets: Record<
    string,
    { name: string; responseTimes: number[]; lastResponseAt: Date | null }
  > = {};

  for (const item of inboxItemRows) {
    if (!item.sender) continue;
    const emailMatch = item.sender.match(/<([^>]+)>/) || item.sender.match(/([^\s]+@[^\s]+)/);
    if (!emailMatch) continue;
    const email = emailMatch[1];
    const parts = email.split("@");
    if (parts.length < 2) continue;
    const domain = parts[1].toLowerCase();

    const displayName = item.sender.replace(/<[^>]+>/, "").trim() || email;

    if (!domainBuckets[domain]) {
      domainBuckets[domain] = { name: displayName, responseTimes: [], lastResponseAt: null };
    }

    if (item.actedAt && item.surfacedAt) {
      const hours =
        (item.actedAt.getTime() - item.surfacedAt.getTime()) / (1000 * 60 * 60);
      if (hours > 0 && hours < 168) {
        domainBuckets[domain].responseTimes.push(hours);
      }
    }

    if (
      item.surfacedAt &&
      (!domainBuckets[domain].lastResponseAt ||
        item.surfacedAt > domainBuckets[domain].lastResponseAt!)
    ) {
      domainBuckets[domain].lastResponseAt = item.surfacedAt;
    }
  }

  return Object.entries(domainBuckets)
    .filter(([, v]) => v.responseTimes.length >= 2)
    .map(([domain, v]) => ({
      senderDomain: domain,
      senderName: v.name,
      avgResponseHours:
        v.responseTimes.reduce((a, b) => a + b, 0) / v.responseTimes.length,
      observationCount: v.responseTimes.length,
      lastResponseAt: v.lastResponseAt,
    }));
}

function buildProjectStallPatterns(
  goalTreeRows: (typeof schema.goalTrees.$inferSelect)[],
  planRows: (typeof schema.plans.$inferSelect)[]
): ProjectStallPattern[] {
  const result: ProjectStallPattern[] = [];

  const completedGoalTaskIds = new Set<string>();
  for (const row of planRows) {
    const data = row.data as PlanData;
    const tasks: PlanTask[] = Array.isArray(data.tasks) ? data.tasks : [];
    for (const t of tasks) {
      if (t.completed && t['goalTaskId']) {
        completedGoalTaskIds.add(String(t['goalTaskId']));
      }
    }
  }

  for (const tree of goalTreeRows) {
    const treeData = tree.tree as { phases?: { milestones?: { tasks?: { id: string; completedAt?: string; status?: string }[] }[] }[] };
    if (!treeData?.phases) continue;

    let lastProgressAt: Date | null = null;
    let totalTasks = 0;
    let completedTasks = 0;

    for (const phase of treeData.phases) {
      for (const milestone of (phase.milestones || [])) {
        for (const task of (milestone.tasks || [])) {
          totalTasks++;
          if (task.status === "complete" || task.completedAt || completedGoalTaskIds.has(task.id)) {
            completedTasks++;
            const completedDate = task.completedAt ? new Date(task.completedAt) : null;
            if (completedDate && (!lastProgressAt || completedDate > lastProgressAt)) {
              lastProgressAt = completedDate;
            }
          }
        }
      }
    }

    if (totalTasks === 0) continue;

    const completionRate = completedTasks / totalTasks;
    if (completionRate >= 1) continue;

    const daysSinceProgress = lastProgressAt
      ? Math.floor((Date.now() - lastProgressAt.getTime()) / (1000 * 60 * 60 * 24))
      : 30;

    let stallRiskScore = 0;
    if (daysSinceProgress > 14) stallRiskScore = 90;
    else if (daysSinceProgress > 7) stallRiskScore = 70;
    else if (daysSinceProgress > 4) stallRiskScore = 50;
    else if (daysSinceProgress > 2) stallRiskScore = 30;

    if (stallRiskScore >= 50) {
      result.push({
        goalTreeId: tree.id,
        goalTitle: tree.title,
        daysSinceProgress,
        stallRiskScore,
        similarPastStalls: 0,
      });
    }
  }

  return result.sort((a, b) => b.stallRiskScore - a.stallRiskScore);
}

function buildBrainDumpPattern(planRows: (typeof schema.plans.$inferSelect)[]): {
  mostActiveHour: number;
  mostActiveDayOfWeek: number;
  avgItemsPerDay: number;
} {
  let totalItems = 0;
  const hourBuckets: Record<number, number> = {};
  const dayBuckets: Record<number, number> = {};

  for (const row of planRows) {
    const data = row.data as PlanData;
    const tasks: PlanTask[] = Array.isArray(data.tasks) ? data.tasks : [];
    const brainTasks = tasks.filter((t) => t.category === "capture" || t.category === "brain_dump");
    totalItems += brainTasks.length;

    const d = new Date(row.date + "T12:00:00");
    const dow = d.getDay();
    dayBuckets[dow] = (dayBuckets[dow] || 0) + brainTasks.length;

    // Populate hourBuckets from each brain-dump task's createdAt timestamp.
    for (const bt of brainTasks) {
      const ts = bt.createdAt;
      if (ts) {
        const hour = new Date(typeof ts === "number" ? ts : String(ts)).getHours();
        if (hour >= 0 && hour < 24) {
          hourBuckets[hour] = (hourBuckets[hour] || 0) + 1;
        }
      }
    }
  }

  const mostActiveDayOfWeek = Object.entries(dayBuckets).sort(([, a], [, b]) => b - a)[0]
    ? Number(Object.entries(dayBuckets).sort(([, a], [, b]) => b - a)[0][0])
    : 1;

  return {
    mostActiveHour: Object.entries(hourBuckets).sort(([, a], [, b]) => b - a)[0]
      ? Number(Object.entries(hourBuckets).sort(([, a], [, b]) => b - a)[0][0])
      : 9,
    mostActiveDayOfWeek,
    avgItemsPerDay: planRows.length > 0 ? totalItems / planRows.length : 0,
  };
}

// ── Behaviour signal detection ────────────────────────────────────────────────

export interface BehaviorSignal {
  patternId: string;
  type: "praise" | "correction" | "preference";
  example: string;
}

/**
 * Scan the most recent user message (and the preceding assistant message) for
 * praise, correction, or standing-preference signals.  Returns zero or more
 * BehaviorSignal objects that can be fed directly to `recordSkillSignal`.
 *
 * Pattern IDs use the convention:
 *   praise:<category>        — user explicitly praised this type of Jarvis behaviour
 *   correction:<category>    — user asked Jarvis to stop or change behaviour
 *   preference:<category>    — user stated a standing preference ("always", "never")
 *
 * Detection is intentionally keyword-based (no LLM call) so it runs on every
 * conversation turn with zero latency overhead.
 */
export function detectBehaviorSignals(
  messages: Array<{ role: string; content: string | unknown }>,
): BehaviorSignal[] {
  // Extract the last user message and, if present, the preceding assistant message.
  const reversed = [...messages].reverse();
  const lastUser = reversed.find((m) => m.role === "user");
  const lastAssistant = reversed.find((m) => m.role === "assistant");

  if (!lastUser) return [];

  const userText =
    typeof lastUser.content === "string" ? lastUser.content.toLowerCase() : "";
  const assistantText =
    typeof lastAssistant?.content === "string"
      ? lastAssistant.content.toLowerCase()
      : "";

  const signals: BehaviorSignal[] = [];

  // ── Praise detection ───────────────────────────────────────────────────────
  const praiseKeywords = [
    "perfect", "great job", "well done", "love this", "exactly right",
    "that's exactly", "brilliant", "spot on", "nailed it", "this is great",
    "this is perfect", "fantastic", "excellent", "amazing", "helpful",
    "thanks, that's", "thank you, that's", "this helps", "that helps",
    "you're right", "good call", "good suggestion", "appreciate that",
  ];
  const hasPraise = praiseKeywords.some((kw) => userText.includes(kw));
  if (hasPraise) {
    // Infer which category is being praised from the assistant's response.
    const category = inferCategory(assistantText, userText);
    signals.push({
      patternId: `praise:${category}`,
      type: "praise",
      example: `User praised Jarvis's ${category} response: "${truncate(userText, 80)}"`,
    });
  }

  // ── Correction detection ───────────────────────────────────────────────────
  const correctionKeywords = [
    "don't do that", "stop doing", "please don't", "never do", "don't say",
    "that's wrong", "that's not right", "incorrect", "you got that wrong",
    "actually no", "not what i meant", "that's not what", "please stop",
    "i didn't ask", "don't include", "don't add", "don't mention",
    "too long", "too short", "too formal", "too casual", "you're repeating",
  ];
  const hasCorrection = correctionKeywords.some((kw) => userText.includes(kw));
  if (hasCorrection) {
    const category = inferCorrectionCategory(userText);
    signals.push({
      patternId: `correction:${category}`,
      type: "correction",
      example: `User corrected Jarvis's ${category}: "${truncate(userText, 80)}"`,
    });

    // Append structured entry to workspace .learnings/CORRECTIONS.md
    // Fire-and-forget to keep detectBehaviorSignals synchronous.
    const rawText = typeof lastUser.content === "string" ? lastUser.content : "";
    const correctionEntry = `\n---\n**${new Date().toISOString()}** | category: ${category}\n> ${truncate(rawText, 200)}\n`;
    Promise.resolve().then(async () => {
      const { writeWorkspaceFile } = await import("../workspace/loader");
      await writeWorkspaceFile("corrections", correctionEntry, "append");
    }).catch(() => { /* Non-fatal */ });
  }

  // ── Standing preference detection ─────────────────────────────────────────
  const preferencePatterns: Array<[RegExp, string]> = [
    [/always\s+(give|send|use|start|begin|include|add|format|write|reply)/i, "response_format"],
    [/never\s+(give|send|use|start|begin|include|add|format|write|reply)/i, "response_format"],
    [/i (prefer|like|want|need) (you to|jarvis to)/i, "user_preference"],
    [/from now on/i, "standing_instruction"],
    [/going forward/i, "standing_instruction"],
    [/every time you/i, "standing_instruction"],
    [/whenever you/i, "standing_instruction"],
  ];
  for (const [pattern, category] of preferencePatterns) {
    if (pattern.test(userText)) {
      signals.push({
        patternId: `preference:${category}`,
        type: "preference",
        example: `User stated standing preference (${category}): "${truncate(userText, 80)}"`,
      });
      break; // one preference signal per message is enough
    }
  }

  return signals;
}

/** Infer the category of what Jarvis was doing from text context. */
function inferCategory(assistantText: string, userText: string): string {
  const combined = assistantText + " " + userText;
  if (combined.includes("task") || combined.includes("todo") || combined.includes("plan")) return "task_management";
  if (combined.includes("email") || combined.includes("draft")) return "email_drafting";
  if (combined.includes("calendar") || combined.includes("meeting") || combined.includes("schedule")) return "calendar_management";
  if (combined.includes("reminder") || combined.includes("alarm")) return "reminders";
  if (combined.includes("coach") || combined.includes("motivation") || combined.includes("advice")) return "coaching";
  if (combined.includes("summar") || combined.includes("recap")) return "summarisation";
  if (combined.includes("search") || combined.includes("find") || combined.includes("lookup")) return "information_retrieval";
  return "general_assistance";
}

/** Infer the correction category from the user's correction message. */
function inferCorrectionCategory(userText: string): string {
  if (userText.includes("long") || userText.includes("short") || userText.includes("brief") || userText.includes("concise")) return "response_length";
  if (userText.includes("formal") || userText.includes("casual") || userText.includes("tone")) return "tone";
  if (userText.includes("repeat") || userText.includes("again") || userText.includes("already")) return "repetition";
  if (userText.includes("format") || userText.includes("bullet") || userText.includes("list") || userText.includes("markdown")) return "formatting";
  if (userText.includes("task") || userText.includes("plan")) return "task_management";
  if (userText.includes("email")) return "email_drafting";
  return "general_behaviour";
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}
