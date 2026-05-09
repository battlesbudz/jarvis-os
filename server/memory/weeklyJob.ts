import { db } from "../db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import OpenAI from "openai";
import { getOpenAIClientConfig } from "../agent/providers/env";
import { normalizeCategory } from "./categories";
import type { WeeklyPattern, MemoryCategory } from "@shared/schema";
import { regenerateSoul } from "./soul";

async function isMemoryReviewEnabledForUser(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ data: schema.lifeContext.data })
      .from(schema.lifeContext)
      .where(eq(schema.lifeContext.userId, userId))
      .limit(1);
    const data = rows[0]?.data as Record<string, unknown> | undefined;
    if (data && typeof data.memoryReviewEnabled === "boolean") return data.memoryReviewEnabled;
    return true;
  } catch {
    return true;
  }
}

const openai = new OpenAI(getOpenAIClientConfig());

interface ChatMessage {
  role?: string;
  content?: string;
}

interface BrainDumpItem {
  text?: string;
  createdAt?: string;
}

interface CompletionItem {
  date?: string;
  completed?: number;
  title?: string;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function weekOfKey(now: Date): string {
  const start = new Date(now);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

interface RawPattern {
  category?: unknown;
  observation?: unknown;
  evidence?: unknown;
  confidence?: unknown;
}

function parsePatterns(raw: string): WeeklyPattern[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list: RawPattern[] = (() => {
    if (parsed && typeof parsed === "object" && "patterns" in parsed) {
      const p = (parsed as { patterns: unknown }).patterns;
      return Array.isArray(p) ? (p as RawPattern[]) : [];
    }
    return Array.isArray(parsed) ? (parsed as RawPattern[]) : [];
  })();

  const out: WeeklyPattern[] = [];
  for (const r of list.slice(0, 5)) {
    if (typeof r.observation !== "string" || !r.observation.trim()) continue;
    const evidence = Array.isArray(r.evidence)
      ? (r.evidence as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 5)
      : [];
    const confidenceNum = typeof r.confidence === "number" ? r.confidence : Number(r.confidence);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(100, Math.round(confidenceNum))) : 60;
    const category: MemoryCategory | "fact" =
      typeof r.category === "string" ? normalizeCategory(r.category) : "fact";
    out.push({ category, observation: r.observation.trim(), evidence, confidence });
  }
  return out;
}

interface WeeklyJobResult {
  weekOf: string;
  patternCount: number;
  promotedMemories: number;
  pendingReviewCount: number;
  pendingReviewPreviews: string[];
  summary: string;
  driveLink?: string | null;
}

export async function runWeeklyPatternJob(userId: string): Promise<WeeklyJobResult> {
  const now = new Date();
  // 30-day rolling window — durable patterns need at least a month of
  // signal before they're trustworthy enough to influence coaching.
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = windowStart; // legacy var name; window is 30 days
  const weekOf = weekOfKey(now);

  // Gather activity context.
  const [completionRow, brainRow, chatRow, telegramRows, energyRows] = await Promise.allSettled([
    db.select().from(schema.completionHistory).where(eq(schema.completionHistory.userId, userId)).limit(1),
    db.select().from(schema.brainDumpInbox).where(eq(schema.brainDumpInbox.userId, userId)).limit(1),
    db.select().from(schema.chatHistory).where(eq(schema.chatHistory.userId, userId)).limit(1),
    db
      .select()
      .from(schema.telegramGroupMessages)
      .where(and(eq(schema.telegramGroupMessages.userId, userId), gte(schema.telegramGroupMessages.messageDate, sevenDaysAgo)))
      .orderBy(desc(schema.telegramGroupMessages.messageDate))
      .limit(50),
    db
      .select()
      .from(schema.energyCheckins)
      .where(and(eq(schema.energyCheckins.userId, userId), gte(schema.energyCheckins.date, sevenDaysAgo.toISOString().slice(0, 10))))
      .orderBy(desc(schema.energyCheckins.date))
      .limit(60),
  ]);

  const completionData =
    completionRow.status === "fulfilled" ? asArray<CompletionItem>(completionRow.value[0]?.data) : [];
  const brainData =
    brainRow.status === "fulfilled" ? asArray<BrainDumpItem>(brainRow.value[0]?.data) : [];
  const chatData =
    chatRow.status === "fulfilled" ? asArray<ChatMessage>(chatRow.value[0]?.data).slice(0, 30) : [];
  const telegramData = telegramRows.status === "fulfilled" ? telegramRows.value : [];
  const energyData = energyRows.status === "fulfilled" ? energyRows.value : [];

  const recentCompletions = completionData.filter((c) => c.date && new Date(c.date) >= sevenDaysAgo);
  const completionsText = recentCompletions
    .slice(0, 50)
    .map((c) => `- ${c.date}: ${c.completed ?? 0} completions${c.title ? ` (${c.title})` : ""}`)
    .join("\n");

  // Explicit task-timing aggregates: weekday distribution + completion
  // intensity over the 30-day window. Surfaces "Mondays are dead, Thursdays
  // peak"-style patterns to the model without requiring it to count.
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const perDow = [0, 0, 0, 0, 0, 0, 0];
  const perDowDays = [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>()];
  let totalCompleted = 0;
  for (const c of recentCompletions) {
    if (!c.date) continue;
    const d = new Date(c.date);
    if (isNaN(d.getTime())) continue;
    const dow = d.getDay();
    const n = c.completed ?? 0;
    perDow[dow] += n;
    perDowDays[dow].add(c.date);
    totalCompleted += n;
  }
  const timingLines = perDow.map((total, i) => {
    const days = perDowDays[i].size || 1;
    const avg = (total / days).toFixed(1);
    return `- ${dayNames[i]}: ${total} total across ${perDowDays[i].size} day(s) (avg ${avg}/day)`;
  });
  const taskTimingText = `Total completions in window: ${totalCompleted}\nBy weekday:\n${timingLines.join("\n")}`;
  const brainText = brainData
    .slice(0, 25)
    .map((b) => `- ${b.text ?? ""}`)
    .filter((s) => s.length > 2)
    .join("\n");
  const chatText = chatData
    .map((m) => `${m.role ?? "?"}: ${(m.content ?? "").slice(0, 200)}`)
    .filter((s) => s.length > 5)
    .join("\n");
  const telegramText = telegramData
    .slice(0, 30)
    .map((t) => `- ${t.text.slice(0, 200)}`)
    .join("\n");
  const energyText = energyData
    .map((e) => {
      const d = e.data;
      if (!d || typeof d !== "object") return "";
      const obj = d as Record<string, unknown>;
      const energy = typeof obj.energy === "number" ? obj.energy : "?";
      const focus = typeof obj.focus === "number" ? obj.focus : "?";
      return `- ${e.date}: energy=${energy} focus=${focus}`;
    })
    .filter((s) => s.length > 0)
    .join("\n");

  const prompt = `You are reviewing the last 30 days of one user's activity to identify 3-5 durable behavioral patterns that should influence how a personal AI coach supports them long-term.

Output JSON: { "patterns": [{ "category": one-of-categories, "observation": "...", "evidence": ["...", "..."], "confidence": 0-100 }], "summary": "1-2 sentence summary of the week" }

Categories:
- work_patterns | communication_style | energy_rhythms | goals_history
- relationships | values | blockers | accomplishments | preferences | fact

Rules:
- Patterns must be DURABLE — recurring behaviors, not one-off events.
- Each evidence item must be a concrete data point from the input.
- Confidence: 90+ overwhelmingly clear; 70-89 strong; 60-69 plausible. Skip below 60.
- Return at most 5 patterns. Empty array if nothing notable.

## Completion history
${completionsText || "(none)"}

## Task timing (30-day aggregates)
${taskTimingText}

## Brain dump items
${brainText || "(none)"}

## Recent chat (most recent first)
${chatText || "(none)"}

## Group chat messages
${telegramText || "(none)"}

## Energy check-ins
${energyText || "(none)"}`;

  let patterns: WeeklyPattern[] = [];
  let summary = "";
  try {
    const { getModel } = await import("../lib/modelPrefs");
    const model = await getModel(userId, "memory");

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
    });
    const content = response.choices[0]?.message?.content || "{}";
    patterns = parsePatterns(content);
    try {
      const meta = JSON.parse(content) as { summary?: unknown };
      if (typeof meta.summary === "string") summary = meta.summary.trim().slice(0, 600);
    } catch {
      // already handled
    }
  } catch (err) {
    console.error("[WeeklyPattern] LLM call failed:", err);
  }

  // Min-data threshold: skip persistence when the 30-day window is too
  // sparse to draw durable patterns from. Avoids surfacing noise to the
  // user during their first weeks on the app.
  const signalCount = recentCompletions.length + brainData.length + chatData.length + telegramData.length + energyData.length;
  if (signalCount < 5) {
    console.log(`[WeeklyPattern] user=${userId} week=${weekOf} skipped — only ${signalCount} signal(s) in 30-day window`);
    return { weekOf, patternCount: 0, promotedMemories: 0, pendingReviewCount: 0, pendingReviewPreviews: [], summary: "" };
  }

  // DB-backed dedupe via unique (user_id, week_of); restart-safe.
  await db
    .insert(schema.weeklyInsights)
    .values({ userId, weekOf, patterns, summary: summary || null })
    .onConflictDoUpdate({
      target: [schema.weeklyInsights.userId, schema.weeklyInsights.weekOf],
      set: { patterns, summary: summary || null },
    });

  // Promote high-confidence patterns into user_memories so they show
  // up in the SOUL even after this week's row is rotated out of view.
  let promoted = 0;
  const promotedContents: string[] = [];
  const reviewEnabled = await isMemoryReviewEnabledForUser(userId);
  for (const p of patterns) {
    if (p.confidence < 80) continue;
    const cat = p.category === "fact" ? "fact" : p.category;
    // All weekly patterns are long_term semantic memories and are subject to the review gate.
    const pendingReview = reviewEnabled;
    const reviewStatus = reviewEnabled ? "pending" : "active";
    try {
      await db.insert(schema.userMemories).values({
        userId,
        content: p.observation,
        category: cat,
        confidence: p.confidence,
        relevanceScore: 70,
        sourceType: "weekly_pattern",
        sourceRef: weekOf,
        tier: "long_term",
        memoryType: "semantic",
        pendingReview,
        reviewStatus,
      });
      promoted += 1;
      if (reviewEnabled) promotedContents.push(p.observation);
    } catch (err) {
      console.error("[WeeklyPattern] promote failed:", err);
    }
  }

  // Rebuild SOUL so the new patterns / summary land in the coach prompt.
  try {
    await regenerateSoul(userId);
  } catch (err) {
    console.error("[WeeklyPattern] regenerateSoul failed:", err);
  }

  const finalSummary = summary || (patterns.length === 0 ? "No notable patterns this week." : `${patterns.length} pattern(s) identified.`);

  // Count pending-review memories so the weekly message can include a nudge.
  let pendingReviewCount = 0;
  try {
    const pendingResult = await db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM user_memories
      WHERE user_id = ${userId} AND pending_review = TRUE AND review_status = 'pending'
    `);
    pendingReviewCount = parseInt((pendingResult.rows ?? [])[0]?.cnt ?? "0", 10) || 0;
  } catch {
    // non-fatal
  }

  // Auto-save weekly review to Google Drive if enabled.
  let driveLink: string | null = null;
  try {
    const { getUserDriveSettings } = await import("../driveRoutes");
    const { createDriveTextFile } = await import("../integrations/googleDrive");
    const drive = await getUserDriveSettings(userId);
    if (drive.enabled && drive.autoSaveWeekly && drive.accessToken) {
      const reviewText = buildWeeklyReviewMarkdown(weekOf, patterns, finalSummary);
      const driveFile = await createDriveTextFile(
        drive.accessToken,
        `Weekly Review — ${weekOf}`,
        reviewText,
        { convertToDoc: true, folderId: drive.folderId || undefined }
      );
      driveLink = driveFile.webViewLink;
      console.log(`[WeeklyPattern] Drive auto-save for user=${userId}: ${driveLink}`);
    }
  } catch (driveErr) {
    console.error("[WeeklyPattern] Drive auto-save failed:", driveErr);
  }

  console.log(
    `[WeeklyPattern] user=${userId} week=${weekOf} patterns=${patterns.length} promoted=${promoted} pendingReview=${pendingReviewCount}`,
  );
  return {
    weekOf,
    patternCount: patterns.length,
    promotedMemories: promoted,
    pendingReviewCount,
    pendingReviewPreviews: promotedContents,
    summary: finalSummary,
    driveLink,
  };
}

function buildWeeklyReviewMarkdown(weekOf: string, patterns: WeeklyPattern[], summary: string): string {
  const lines: string[] = [`# Weekly Review — Week of ${weekOf}`, '', `> ${summary}`, ''];
  if (patterns.length > 0) {
    lines.push('## Patterns Identified', '');
    for (const p of patterns) {
      lines.push(`### ${p.observation} (confidence: ${p.confidence}%)`);
      lines.push(`*Category: ${p.category}*`);
      if (p.evidence.length > 0) {
        lines.push('');
        lines.push('**Evidence:**');
        for (const e of p.evidence) {
          lines.push(`- ${e}`);
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

/** Enqueue weekly pattern jobs for every user with recent activity. */
export async function enqueueWeeklyPatternJobs(): Promise<number> {
  const { submitAgentJob } = await import("../agent/jobQueue");
  // Active = anyone with chat history updated in the last 14 days OR a
  // login in the last 14 days. Cheap heuristic: just use chat_history.
  const rows = await db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT user_id FROM chat_history
    WHERE updated_at > NOW() - INTERVAL '14 days'
  `);
  let count = 0;
  for (const r of rows.rows ?? []) {
    if (!r.user_id) continue;
    try {
      await submitAgentJob({
        userId: r.user_id,
        agentType: "weekly_pattern",
        title: "Weekly pattern review",
        prompt: "Reflect on the last 30 days and identify durable patterns.",
      });
      count += 1;
    } catch (err) {
      console.error(`[WeeklyPattern] enqueue failed for ${r.user_id}:`, err);
    }
  }
  console.log(`[WeeklyPattern] enqueued ${count} job(s)`);
  return count;
}
