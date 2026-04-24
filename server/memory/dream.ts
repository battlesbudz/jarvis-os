/**
 * Jarvis Dream Cycle — Nightly Deep Synthesis Engine
 *
 * Runs once per night (~3am local user time) per user. Pulls 30–90 days of
 * memories, weekly insights, task completions, and energy check-ins,
 * then runs a deep LLM synthesis pass to find non-obvious cross-category
 * connections. Insights are stored in dream_insights and queued for the
 * user's morning briefing.
 */
import { db } from "../db";
import { eq, desc, and, gte, sql, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import OpenAI from "openai";
import { extractAndStore } from "./extractor";
import { markSoulStale } from "./soul";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MINIMUM_MEMORY_AGE_DAYS = 14;

interface DreamInsightRaw {
  insight: string;
  confidence: number;
  sourceHints: string[];
}

interface CorpusResult {
  text: string;
  memoryIds: string[];
}

interface TaskCompletionDay {
  date: string;
  completed: number;
  total: number;
}

/**
 * Returns true if the user has at least 2 weeks of memory history,
 * which is the minimum required to run a meaningful synthesis.
 */
async function hasEnoughData(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - MINIMUM_MEMORY_AGE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.userMemories.id })
    .from(schema.userMemories)
    .where(
      and(
        eq(schema.userMemories.userId, userId),
        sql`${schema.userMemories.extractedAt} < ${cutoff}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Pull the raw data corpus for the synthesis:
 * - Last 90 days of memories (all categories)
 * - Last 4 weeks of weekly insights / patterns
 * - Last 30 days of energy check-ins
 * - Task completion counts by day for the last 30 days (from plans)
 *
 * Returns the corpus text and the IDs of all memories included.
 */
async function buildCorpus(userId: string): Promise<CorpusResult> {
  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since30Key = since30.toISOString().slice(0, 10);

  const [memoriesRows, insightRows, energyRows, planRows] = await Promise.all([
    db
      .select({
        id: schema.userMemories.id,
        content: schema.userMemories.content,
        category: schema.userMemories.category,
        confidence: schema.userMemories.confidence,
        extractedAt: schema.userMemories.extractedAt,
      })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          gte(schema.userMemories.extractedAt, since90),
        ),
      )
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(200),

    db
      .select()
      .from(schema.weeklyInsights)
      .where(eq(schema.weeklyInsights.userId, userId))
      .orderBy(desc(schema.weeklyInsights.createdAt))
      .limit(4),

    db
      .select()
      .from(schema.energyCheckins)
      .where(
        and(
          eq(schema.energyCheckins.userId, userId),
          sql`${schema.energyCheckins.date} >= ${since30Key}`,
        ),
      )
      .orderBy(desc(schema.energyCheckins.date))
      .limit(30),

    db
      .select({ date: schema.plans.date, data: schema.plans.data })
      .from(schema.plans)
      .where(
        and(
          eq(schema.plans.userId, userId),
          sql`${schema.plans.date} >= ${since30Key}`,
        ),
      )
      .orderBy(desc(schema.plans.date))
      .limit(30),
  ]);

  const memoryIds: string[] = memoriesRows.map((m) => m.id);
  const sections: string[] = [];

  if (memoriesRows.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const m of memoriesRows) {
      const arr = grouped.get(m.category) || [];
      arr.push(`[c=${m.confidence}] ${m.content}`);
      grouped.set(m.category, arr);
    }
    sections.push("## Memories by category (last 90 days)");
    for (const [cat, items] of grouped) {
      sections.push(`### ${cat}`);
      items.slice(0, 20).forEach((i) => sections.push(`- ${i}`));
    }
  }

  if (insightRows.length > 0) {
    sections.push("\n## Weekly pattern observations (last 4 weeks)");
    for (const row of insightRows) {
      const patterns = Array.isArray(row.patterns) ? row.patterns : [];
      sections.push(`### Week of ${row.weekOf}`);
      if (row.summary) sections.push(`Summary: ${row.summary}`);
      for (const p of patterns as schema.WeeklyPattern[]) {
        sections.push(`- [${p.category} c=${p.confidence}] ${p.observation}`);
      }
    }
  }

  if (energyRows.length > 0) {
    sections.push("\n## Energy check-ins (last 30 days)");
    for (const row of energyRows) {
      const data = row.data as Record<string, unknown>;
      const level = data.level ?? data.energy ?? "?";
      const mood = typeof data.mood === "string" ? data.mood
        : typeof data.moodNote === "string" ? data.moodNote
        : "";
      sections.push(`- ${row.date}: energy=${level}${mood ? ` — "${mood}"` : ""}`);
    }
  }

  if (planRows.length > 0) {
    const completionDays: TaskCompletionDay[] = [];
    for (const row of planRows) {
      const planData = row.data as { tasks?: { completed?: boolean }[] };
      const tasks = Array.isArray(planData.tasks) ? planData.tasks : [];
      const total = tasks.length;
      const completed = tasks.filter((t) => t.completed).length;
      if (total > 0) {
        completionDays.push({ date: row.date, completed, total });
      }
    }
    if (completionDays.length > 0) {
      sections.push("\n## Task completion history (last 30 days)");
      for (const day of completionDays) {
        const pct = Math.round((day.completed / day.total) * 100);
        sections.push(`- ${day.date}: ${day.completed}/${day.total} tasks completed (${pct}%)`);
      }
    }
  }

  return { text: sections.join("\n"), memoryIds };
}

function parseDreamResponse(raw: string): DreamInsightRaw[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.insights)) {
        return (obj.insights as DreamInsightRaw[]).filter(
          (i) => typeof i.insight === "string" && i.insight.trim().length > 0,
        );
      }
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Run the full dream synthesis for a single user.
 * Returns the number of insights stored, or 0 if skipped.
 */
export async function runDreamForUser(userId: string, dreamDate: string): Promise<number> {
  const enough = await hasEnoughData(userId);
  if (!enough) {
    console.log(`[Dream] user ${userId} has insufficient data (<${MINIMUM_MEMORY_AGE_DAYS} days) — skipping`);
    return 0;
  }

  const corpus = await buildCorpus(userId);
  if (!corpus.text.trim()) {
    console.log(`[Dream] empty corpus for user ${userId} — skipping`);
    return 0;
  }

  const prompt = `You are Jarvis's deep synthesis engine running a nightly dream cycle.

Your job: analyse the user's memories, energy patterns, weekly observations, and task completion history from the past 3 months and surface 1–3 non-obvious, SPECIFIC insights that cross categories — insights the user would not have noticed themselves.

Good insights:
- Cross-category correlations: "Every time X happens, Y follows within 2–3 days"
- Hidden loops: "You mention blocker B every time goal G makes progress — they might be related"
- Energy–behaviour links: "Your low-energy days correlate with lower task completion rates the following day"
- Completion pattern surprises: "You complete 40%+ more tasks on days following a recorded energy level of 8+, compared to any other energy level"
- Surprising absences: "You have many work-pattern memories but almost none about rest/recovery — your system may be missing a recovery loop"

Bad insights (do NOT generate):
- Obvious rephrasing of individual memories
- Generic motivational statements
- Anything that could apply to anyone
- Predictions about future events (that is the Prediction Engine's job)

Output JSON:
{
  "insights": [
    {
      "insight": "<specific, non-obvious observation — 1–3 sentences, plain English, no markdown>",
      "confidence": <50-100 integer — how strongly supported by the data>,
      "sourceHints": ["<short phrase describing evidence 1>", "<evidence 2>"]
    }
  ]
}

Return { "insights": [] } if you cannot find anything genuinely non-obvious and cross-category.

---

${corpus.text.slice(0, 12000)}`;

  let rawInsights: DreamInsightRaw[] = [];
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
    });
    const raw = resp.choices[0]?.message?.content || '{"insights":[]}';
    rawInsights = parseDreamResponse(raw).slice(0, 3);
  } catch (err) {
    console.error(`[Dream] LLM synthesis failed for ${userId}:`, err);
    return 0;
  }

  if (rawInsights.length === 0) {
    console.log(`[Dream] no insights generated for ${userId} on ${dreamDate}`);
    return 0;
  }

  // Use the full set of memory IDs that contributed to the corpus as source provenance.
  // This lets the UI show which memories were synthesised.
  const sourceIds = corpus.memoryIds.slice(0, 50);

  let stored = 0;
  for (const raw of rawInsights) {
    const text = raw.insight.trim();
    if (!text) continue;
    const confidence = Math.max(50, Math.min(100, Math.round(raw.confidence || 70)));
    try {
      await db
        .insert(schema.dreamInsights)
        .values({
          userId,
          dreamDate,
          insightText: text,
          confidenceScore: confidence,
          sourceMemoryIds: sourceIds,
          shownToUser: false,
        });
      stored++;
      console.log(`[Dream] +insight [c=${confidence}] ${text.slice(0, 80)}`);
    } catch (err) {
      console.error(`[Dream] insert failed:`, err);
    }
  }

  if (stored > 0) {
    await seedSoulFromDream(userId, rawInsights);
  }

  return stored;
}

/**
 * Extract durable findings from the dream and write them back into
 * user_memories so the Soul compounds Jarvis's understanding over time.
 * Marks the Soul stale so it regenerates on the next read.
 */
async function seedSoulFromDream(userId: string, insights: DreamInsightRaw[]): Promise<void> {
  try {
    const combined = insights
      .filter((i) => (i.confidence || 0) >= 70)
      .map((i) => i.insight)
      .join("\n");

    if (!combined.trim()) return;

    await extractAndStore({
      userId,
      source: combined,
      sourceType: "dream_cycle",
      sourceRef: new Date().toISOString().slice(0, 10),
      contextHint: "Durable cross-category finding from nightly dream synthesis",
      maxNew: 3,
    });

    await markSoulStale(userId);
    console.log(`[Dream] soul seeded and marked stale for ${userId}`);
  } catch (err) {
    console.error(`[Dream] soul seeding failed:`, err);
  }
}

/**
 * Retrieve pending (undelivered) dream insights for a user.
 * Called by the morning delivery heartbeat job.
 */
export async function getPendingDreamInsights(
  userId: string,
): Promise<typeof schema.dreamInsights.$inferSelect[]> {
  return db
    .select()
    .from(schema.dreamInsights)
    .where(
      and(
        eq(schema.dreamInsights.userId, userId),
        eq(schema.dreamInsights.shownToUser, false),
      ),
    )
    .orderBy(desc(schema.dreamInsights.createdAt))
    .limit(3);
}

/**
 * Mark insights as delivered to the user.
 */
export async function markDreamInsightsDelivered(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(schema.dreamInsights)
    .set({ shownToUser: true, deliveredAt: new Date() })
    .where(inArray(schema.dreamInsights.id, ids));
}
