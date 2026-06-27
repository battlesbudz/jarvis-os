/**
 * Jarvis Dream Cycle — Nightly Deep Synthesis Engine
 *
 * Runs once per night (~3am local user time) per user. Pulls 30–90 days of
 * memories, weekly insights, task completions, and energy check-ins,
 * then runs a deep LLM synthesis pass to find non-obvious cross-category
 * connections. Insights are stored in dream_insights and queued for the
 * user's morning briefing.
 *
 * Sleep consolidation passes (Phase 6):
 *  1. Consolidation       — promotes/discards short_term memories older than 6 hours
 *  2. Semantic extraction — extracts durable facts from clusters of episodic memories
 *  3. Relevance decay     — reduces relevance_score for rarely-accessed long_term memories
 *  4. Access reinforcement — boosts memories whose access_count rose > 3 since last cycle
 */
import { db } from "../db";
import { eq, desc, and, gte, gt, lt, sql, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { extractAndStore } from "./extractor";
import { markSoulStale } from "./soul";
import { containsRawRestrictedContent } from "./restrictedContent";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { createRoutedOpenAIChatShim } from "../agent/routedChatCompletion";
import {
  DREAM_CAPABILITY_REVIEW_DEEP_LINK,
  DREAM_MEMORY_REVIEW_DEEP_LINK,
  buildDreamMemoryProvenance,
  normalizeDreamInsight,
  shouldAutoPromoteDreamMemory,
  type DreamReviewPayload,
  type NormalizedDreamInsight,
} from "./dreamPolicy";
import { keepPendingMemoryWrites, writeMemoryThroughPipeline } from "./writePipeline";

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

const openai = createRoutedOpenAIChatShim("[DreamCycle]", "balanced");

const MINIMUM_MEMORY_AGE_DAYS = 14;
const CONSOLIDATION_BATCH_SIZE = 20;
const RESTRICTED_MEMORY_SOURCE_SQL_PATTERN = "%(plaid|bank|banking|financial|transaction|credit_card|credit card|debit_card|debit card|tax_document|tax document|payroll|brokerage|account_balance|account balance|restricted_source|restricted summary|restricted_summary)%";

function approvedNonRestrictedMemoryClauses(userId: string) {
  return [
    eq(schema.userMemories.userId, userId),
    eq(schema.userMemories.pendingReview, false),
    sql`${schema.userMemories.reviewStatus} IN ('active', 'kept', 'edited')`,
    sql`COALESCE(${schema.userMemories.sensitivity}, 'normal') = 'normal'`,
    sql`LOWER(COALESCE(${schema.userMemories.sourceType}, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}`,
    sql`LOWER(COALESCE(${schema.userMemories.sourceRef}, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}`,
  ];
}

function filterRawRestrictedMemoryRows<T extends { content?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => !containsRawRestrictedContent(row.content ?? ""));
}

type DreamInsightRaw = NormalizedDreamInsight;

interface CorpusResult {
  text: string;
  memoryIds: string[];
}

interface TaskCompletionDay {
  date: string;
  completed: number;
  total: number;
}

export interface DreamCycleResult {
  insightsStored: number;
  consolidation: { promoted: number; discarded: number };
  semanticExtraction: { factsExtracted: number };
  decay: { decayed: number; hardDeleted: number };
  reinforcement: { boosted: number };
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
        ...approvedNonRestrictedMemoryClauses(userId),
        sql`${schema.userMemories.extractedAt} < ${cutoff}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Pull the raw data corpus for the synthesis.
 * Returns the corpus text and the IDs of all memories included.
 */
async function buildCorpus(userId: string): Promise<CorpusResult> {
  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since30Key = since30.toISOString().slice(0, 10);

  const [rawMemoryRows, workingContextRows, insightRows, energyRows, planRows] = await Promise.all([
    db
      .select({
        id: schema.userMemories.id,
        content: schema.userMemories.content,
        category: schema.userMemories.category,
        confidence: schema.userMemories.confidence,
        tier: schema.userMemories.tier,
        memoryType: schema.userMemories.memoryType,
        sourceType: schema.userMemories.sourceType,
        extractedAt: schema.userMemories.extractedAt,
      })
      .from(schema.userMemories)
      .where(
        and(
          ...approvedNonRestrictedMemoryClauses(userId),
          gte(schema.userMemories.extractedAt, since90),
        ),
      )
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(200),

    db
      .select({
        id: schema.memoryWorkingContext.id,
        scopeType: schema.memoryWorkingContext.scopeType,
        scopeId: schema.memoryWorkingContext.scopeId,
        activeGoal: schema.memoryWorkingContext.activeGoal,
        currentStep: schema.memoryWorkingContext.currentStep,
        content: schema.memoryWorkingContext.content,
        updatedAt: schema.memoryWorkingContext.updatedAt,
      })
      .from(schema.memoryWorkingContext)
      .where(
        and(
          eq(schema.memoryWorkingContext.userId, userId),
          eq(schema.memoryWorkingContext.state, "active"),
          gt(schema.memoryWorkingContext.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.memoryWorkingContext.updatedAt))
      .limit(40),

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

  const memoriesRows = filterRawRestrictedMemoryRows(rawMemoryRows);
  const memoryIds: string[] = memoriesRows.map((m) => m.id);
  const sections: string[] = [];

  if (memoriesRows.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const m of memoriesRows) {
      const arr = grouped.get(m.category) || [];
      arr.push(`[${m.tier}/${m.memoryType} c=${m.confidence} source=${m.sourceType || "memory"}] ${m.content}`);
      grouped.set(m.category, arr);
    }
    sections.push("## Memories by category (last 90 days)");
    for (const [cat, items] of grouped) {
      sections.push(`### ${cat}`);
      items.slice(0, 20).forEach((i) => sections.push(`- ${i}`));
    }
  }

  const safeWorkingContextRows = filterRawRestrictedMemoryRows(workingContextRows);
  if (safeWorkingContextRows.length > 0) {
    sections.push("\n## Active working context (temporary, not durable memory)");
    for (const row of safeWorkingContextRows) {
      const bits = [
        `${row.scopeType}:${row.scopeId}`,
        row.activeGoal ? `goal=${row.activeGoal}` : "",
        row.currentStep ? `step=${row.currentStep}` : "",
      ].filter(Boolean).join(" ");
      sections.push(`- [${bits}] ${row.content}`);
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
        return obj.insights.flatMap((item) => {
          const insight = normalizeDreamInsight(item);
          return insight ? [insight] : [];
        });
      }
    }
  } catch {
    // fall through
  }
  return [];
}

// ---------------------------------------------------------------------------
// Pass 1: Consolidation — classify ALL short_term memories older than 6 hours
// ---------------------------------------------------------------------------

interface ConsolidationClassification {
  id: string;
  action: "promote" | "keep" | "discard";
}

function parseConsolidationResponse(raw: string): ConsolidationClassification[] {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.classifications)) {
      return (parsed.classifications as ConsolidationClassification[]).filter(
        (c) =>
          typeof c.id === "string" &&
          (c.action === "promote" || c.action === "keep" || c.action === "discard"),
      );
    }
  } catch {
    // fall through
  }
  return [];
}

async function runConsolidationPass(
  userId: string,
  model: string,
): Promise<{ promoted: number; discarded: number }> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  // Fetch all eligible IDs upfront so we avoid offset-on-mutable-set issues:
  // once we promote a record (tier → long_term) or mark it for discard
  // (expires_at → now) its position in the result set shifts. Collecting all
  // IDs first and then fetching content by ID prevents rows from being skipped
  // or double-processed mid-pagination.
  // We exclude already-expired rows (previously discarded memories that haven't
  // been swept yet) so they are not reclassified and potentially re-promoted.
  const allEligible = await db
    .select({ id: schema.userMemories.id })
    .from(schema.userMemories)
    .where(
      and(
        ...approvedNonRestrictedMemoryClauses(userId),
        eq(schema.userMemories.tier, "short_term"),
        lt(schema.userMemories.extractedAt, sixHoursAgo),
        sql`(${schema.userMemories.expiresAt} IS NULL OR ${schema.userMemories.expiresAt} > NOW())`,
      ),
    )
    .orderBy(schema.userMemories.extractedAt);

  if (allEligible.length === 0) {
    console.log(`[Dream] Consolidation pass — no candidates for ${userId}`);
    return { promoted: 0, discarded: 0 };
  }

  const allIds = allEligible.map((r) => r.id);
  let promoted = 0;
  let discarded = 0;

  for (let i = 0; i < allIds.length; i += CONSOLIDATION_BATCH_SIZE) {
    const batchIds = allIds.slice(i, i + CONSOLIDATION_BATCH_SIZE);
    const batch = await db
      .select({
        id: schema.userMemories.id,
        content: schema.userMemories.content,
        category: schema.userMemories.category,
        confidence: schema.userMemories.confidence,
      })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          inArray(schema.userMemories.id, batchIds),
        ),
      );

    if (batch.length === 0) continue;

    const visibleBatch = filterRawRestrictedMemoryRows(batch);
    if (visibleBatch.length === 0) continue;

    const batchIdSet = new Set(visibleBatch.map((memory) => memory.id));
    const memoryList = visibleBatch
      .map(
        (m) =>
          `{"id":${JSON.stringify(m.id)},"content":${JSON.stringify(m.content)},"category":${JSON.stringify(m.category)},"confidence":${m.confidence}}`,
      )
      .join("\n");

    const prompt = `You are Jarvis's memory consolidation engine. Classify each short-term memory for long-term storage.

For each memory decide:
- "promote": this is a durable, stable fact or pattern worth keeping forever
- "keep": still relevant as short-term context, do not change yet
- "discard": no longer useful, transient or superseded information

Memories to classify (JSON, one per line):
${memoryList}

Output JSON:
{
  "classifications": [
    { "id": "<memory_id>", "action": "promote" | "keep" | "discard" }
  ]
}`;

    try {
      const resp = await openai.chat.completions.create({
        model,
        user: userId,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 800,
      });
      const raw = resp.choices[0]?.message?.content || '{"classifications":[]}';
      const classifications = parseConsolidationResponse(raw);

      // Only trust IDs that were in this specific batch (guards against LLM
      // hallucinating IDs from other users or inventing new ones).
      const promotedIds: string[] = [];
      const discardedIds: string[] = [];
      for (const c of classifications) {
        if (!batchIdSet.has(c.id)) continue;
        if (c.action === "promote") promotedIds.push(c.id);
        else if (c.action === "discard") discardedIds.push(c.id);
      }

      if (promotedIds.length > 0) {
        await db
          .update(schema.userMemories)
          .set({ tier: "long_term", expiresAt: null })
          .where(
            and(
              eq(schema.userMemories.userId, userId),
              inArray(schema.userMemories.id, promotedIds),
            ),
          );
        // Apply review gate: semantic/procedural long_term promotions need approval.
        const reviewEnabled = await isMemoryReviewEnabledForUser(userId);
        if (reviewEnabled) {
          await db.execute(sql`
            UPDATE user_memories
            SET pending_review = TRUE, review_status = 'pending'
            WHERE user_id = ${userId}
              AND id = ANY(${promotedIds}::varchar[])
              AND memory_type IN ('semantic','procedural')
              AND (pending_review = FALSE OR pending_review IS NULL)
          `).catch(() => {});
        }
        promoted += promotedIds.length;
      }

      if (discardedIds.length > 0) {
        await db
          .update(schema.userMemories)
          .set({ expiresAt: new Date() })
          .where(
            and(
              eq(schema.userMemories.userId, userId),
              inArray(schema.userMemories.id, discardedIds),
            ),
          );
        discarded += discardedIds.length;
      }
    } catch (err) {
      console.error(`[Dream] consolidation batch ${i}–${i + CONSOLIDATION_BATCH_SIZE} failed for ${userId}:`, err);
      diagEmit({
        userId,
        subsystem: "memory",
        severity: "error",
        message: `Dream consolidation batch failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
        metadata: { operation: "runConsolidationPass", batchStart: i },
      }).catch(() => {});
    }
  }

  console.log(`[Dream] Consolidation pass — promoted=${promoted} discarded=${discarded} for ${userId}`);
  return { promoted, discarded };
}

// ---------------------------------------------------------------------------
// Pass 2: Semantic extraction — distil episodic clusters into durable facts
// ---------------------------------------------------------------------------

async function runSemanticExtractionPass(
  userId: string,
  model: string,
): Promise<{ factsExtracted: number }> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rawEpisodic = await db
    .select({
      id: schema.userMemories.id,
      content: schema.userMemories.content,
      category: schema.userMemories.category,
    })
    .from(schema.userMemories)
    .where(
      and(
        ...approvedNonRestrictedMemoryClauses(userId),
        eq(schema.userMemories.memoryType, "episodic"),
        gte(schema.userMemories.extractedAt, since7d),
      ),
    )
    .orderBy(desc(schema.userMemories.extractedAt))
    .limit(120);
  const episodic = filterRawRestrictedMemoryRows(rawEpisodic);

  if (episodic.length === 0) return { factsExtracted: 0 };

  const grouped = new Map<string, string[]>();
  for (const m of episodic) {
    const arr = grouped.get(m.category) || [];
    arr.push(m.content);
    grouped.set(m.category, arr);
  }

  let factsExtracted = 0;

  for (const [category, items] of grouped) {
    if (items.length < 3) continue;

    const itemList = items.slice(0, 20).map((c, i) => `${i + 1}. ${c}`).join("\n");

    const prompt = `You are Jarvis's semantic memory extractor. Given these recent episodic memories in the "${category}" category, extract any stable facts, preferences, habits, or repeating patterns that should be remembered long-term.

Recent episodic memories (last 7 days):
${itemList}

Output JSON:
{
  "facts": [
    {
      "content": "<durable fact about the user in plain English, 1 sentence>",
      "memory_type": "semantic" | "procedural"
    }
  ]
}

Rules:
- Only extract facts that appear repeatedly or represent a stable pattern
- "semantic" = stable preferences or general facts
- "procedural" = repeated behavioral habits or workflows
- Return at most 3 facts
- Return { "facts": [] } if no durable pattern can be extracted`;

    try {
      const resp = await openai.chat.completions.create({
        model,
        user: userId,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 400,
      });
      const rawContent = resp.choices[0]?.message?.content || '{"facts":[]}';

      interface RawFact { content: unknown; memory_type: unknown }
      let facts: RawFact[] = [];
      try {
        const parsed = JSON.parse(rawContent) as Record<string, unknown>;
        if (Array.isArray(parsed.facts)) facts = (parsed.facts as RawFact[]).slice(0, 3);
      } catch {
        // fall through
      }

      interface ValidFact { content: string; memType: "semantic" | "procedural" }
      const validFacts: ValidFact[] = facts
        .filter((f) => typeof f.content === "string" && (f.content as string).trim().length > 0)
        .map((f) => ({
          content: (f.content as string).trim(),
          memType: f.memory_type === "procedural" ? "procedural" : "semantic",
        }));

      if (validFacts.length === 0) continue;

      // Route through extractAndStore for deduplication and embedding generation.
      // We include the intended memory_type in each line so the extractor's LLM
      // has explicit signal and is more likely to preserve the correct type/tier.
      // The context hint further biases the extractor toward long_term.
      const sourceText = validFacts
        .map((f) => `[${f.memType}] ${f.content}`)
        .join("\n");
      const stored = await extractAndStore({
        userId,
        source: sourceText,
        sourceType: "dream_cycle",
        sourceRef: new Date().toISOString().slice(0, 10),
        contextHint:
          `These are durable facts and behavioral patterns (each prefixed with [semantic] or [procedural]) extracted from recurring ${category} episodic events. They are stable, long-term observations that hold across time. Classify each as long_term tier with the matching memory_type prefix.`,
        maxNew: validFacts.length,
      });
      factsExtracted += stored.length;
    } catch (err) {
      console.error(`[Dream] semantic extraction failed for category ${category}, user ${userId}:`, err);
      diagEmit({
        userId,
        subsystem: "memory",
        severity: "error",
        message: `Dream semantic extraction failed for category "${category}": ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
        metadata: { operation: "runSemanticExtractionPass", category },
      }).catch(() => {});
    }
  }

  console.log(`[Dream] Semantic extraction pass — factsExtracted=${factsExtracted} for ${userId}`);
  return { factsExtracted };
}

// ---------------------------------------------------------------------------
// Pass 3: Relevance decay — age out rarely-accessed long-term memories
// ---------------------------------------------------------------------------

async function runRelevanceDecayPass(
  userId: string,
): Promise<{ decayed: number; hardDeleted: number }> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Use COALESCE(last_referenced_at, extracted_at) so that memories which have
  // never been accessed are measured from when they were first stored, not from
  // epoch zero. This prevents newly-created long-term memories from being
  // immediately decay-eligible due to a null last_referenced_at.
  try {
    const decayResult = await db.execute(sql`
      UPDATE user_memories
      SET relevance_score = GREATEST(10, relevance_score - 2)
      WHERE user_id = ${userId}
        AND tier = 'long_term'
        AND COALESCE(last_referenced_at, extracted_at) < ${thirtyDaysAgo}
      RETURNING id
    `);
    const decayed = (decayResult.rows ?? []).length;

    const deleteResult = await db.execute(sql`
      DELETE FROM user_memories
      WHERE user_id = ${userId}
        AND tier = 'long_term'
        AND relevance_score <= 10
        AND COALESCE(last_referenced_at, extracted_at) < ${ninetyDaysAgo}
      RETURNING id
    `);
    const softDeleted = (deleteResult.rows ?? []).length;

    console.log(`[Dream] Relevance decay pass — decayed=${decayed} hardDeleted=${softDeleted} for ${userId}`);
    return { decayed, hardDeleted: softDeleted };
  } catch (err) {
    console.error(`[Dream] relevance decay pass failed for ${userId}:`, err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Dream relevance decay pass failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "runRelevanceDecayPass" },
    }).catch(() => {});
    return { decayed: 0, hardDeleted: 0 };
  }
}

// ---------------------------------------------------------------------------
// Pass 4: Access reinforcement — boost memories whose access_count rose > 3
// since the last dream cycle by comparing against a persisted snapshot.
// ---------------------------------------------------------------------------

async function runAccessReinforcementPass(
  userId: string,
): Promise<{ boosted: number }> {
  try {
    // Load the access-count snapshot saved at the end of the previous dream cycle.
    const prefsRows = await db
      .select({ data: schema.userPreferences.data })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    const prefsData = (prefsRows[0]?.data as Record<string, unknown>) || {};
    const prevSnapshot: Record<string, number> =
      (prefsData.dreamAccessSnapshot as Record<string, number>) || {};

    // Fetch current access counts for all memories belonging to this user.
    const memories = await db
      .select({ id: schema.userMemories.id, accessCount: schema.userMemories.accessCount })
      .from(schema.userMemories)
      .where(and(
        eq(schema.userMemories.userId, userId),
        eq(schema.userMemories.pendingReview, false),
        sql`${schema.userMemories.reviewStatus} IN ('active', 'kept', 'edited')`,
      ));

    // Compare against the snapshot to find memories with delta > 3.
    // On the very first run (empty snapshot), skip boosting entirely so we
    // don't incorrectly treat all high-access-count memories as "newly accessed".
    const hasPriorSnapshot = Object.keys(prevSnapshot).length > 0;
    const boostIds: string[] = [];
    const newSnapshot: Record<string, number> = {};
    for (const m of memories) {
      const prev = prevSnapshot[m.id] ?? 0;
      const delta = m.accessCount - prev;
      if (hasPriorSnapshot && delta > 3) boostIds.push(m.id);
      newSnapshot[m.id] = m.accessCount;
    }

    if (boostIds.length > 0) {
      await db
        .update(schema.userMemories)
        .set({ relevanceScore: sql`LEAST(95, relevance_score + 1)` })
        .where(
          and(
            eq(schema.userMemories.userId, userId),
            inArray(schema.userMemories.id, boostIds),
          ),
        );
    }

    // Persist the updated snapshot so the next dream cycle has a fresh baseline.
    const updatedPrefs = { ...prefsData, dreamAccessSnapshot: newSnapshot };
    await db
      .insert(schema.userPreferences)
      .values({ userId, data: updatedPrefs })
      .onConflictDoUpdate({
        target: [schema.userPreferences.userId],
        set: { data: updatedPrefs, updatedAt: new Date() },
      });

    console.log(`[Dream] Access reinforcement pass — boosted=${boostIds.length} for ${userId}`);
    return { boosted: boostIds.length };
  } catch (err) {
    console.error(`[Dream] access reinforcement pass failed for ${userId}:`, err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Dream access reinforcement pass failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "runAccessReinforcementPass" },
    }).catch(() => {});
    return { boosted: 0 };
  }
}

async function markDreamMemoryDerivedContextFresh(userId: string): Promise<void> {
  await markSoulStale(userId);
  import("./vaultWriter").then(({ maybeRegenerateVault }) => {
    maybeRegenerateVault(userId).catch((err) => console.error("[Dream] maybeRegenerateVault:", err));
  }).catch((err) => console.error("[Dream] vaultWriter import failed:", err));
}

async function writeDreamMemoryCandidate(input: {
  userId: string;
  dreamDate: string;
  insight: DreamInsightRaw;
  sourceMemoryIds: string[];
}): Promise<DreamReviewPayload> {
  const result = await writeMemoryThroughPipeline({
    userId: input.userId,
    content: input.insight.insight,
    trigger: "dream",
    category: input.insight.category || "fact",
    tier: "long_term",
    memoryType: input.insight.memoryType || "semantic",
    confidence: input.insight.confidence,
    sourceType: "dream_cycle",
    sourceRef: input.dreamDate,
    reviewEnabled: true,
    provenance: buildDreamMemoryProvenance({
      dreamDate: input.dreamDate,
      sourceHints: input.insight.sourceHints,
      sourceMemoryIds: input.sourceMemoryIds,
    }),
  });

  if (!result.insertedMemoryId) {
    return {
      memoryReview: {
        status: result.status === "excluded" ? "excluded" : "failed",
        deepLink: DREAM_MEMORY_REVIEW_DEEP_LINK,
        reason: result.reason,
      },
      sourceHints: input.insight.sourceHints,
    };
  }

  if (shouldAutoPromoteDreamMemory(input.insight)) {
    const kept = await keepPendingMemoryWrites({
      userId: input.userId,
      memoryIds: [result.insertedMemoryId],
    });
    if (kept.approved > 0) {
      await markDreamMemoryDerivedContextFresh(input.userId);
      return {
        memoryReview: {
          status: "auto_kept",
          memoryId: result.insertedMemoryId,
          deepLink: DREAM_MEMORY_REVIEW_DEEP_LINK,
          reason: "High-confidence repeated dream memory was auto-kept with provenance.",
        },
        sourceHints: input.insight.sourceHints,
      };
    }
  }

  return {
    memoryReview: {
      status: "pending",
      memoryId: result.insertedMemoryId,
      deepLink: DREAM_MEMORY_REVIEW_DEEP_LINK,
      reason: result.reason,
    },
    sourceHints: input.insight.sourceHints,
  };
}

async function createDreamCapabilityProposal(input: {
  userId: string;
  dreamDate: string;
  insight: DreamInsightRaw;
  sourceMemoryIds: string[];
}): Promise<DreamReviewPayload> {
  try {
    const [row] = await db.insert(schema.deliverables).values({
      userId: input.userId,
      agentType: "planning",
      type: "plan",
      title: `Capability proposal: ${input.insight.insight.slice(0, 80)}`,
      summary: input.insight.insight.slice(0, 300),
      body: [
        `## Capability proposal from dream synthesis`,
        "",
        input.insight.insight,
        "",
        `Confidence: ${input.insight.confidence}%`,
        input.insight.sourceHints.length > 0 ? "" : "",
        input.insight.sourceHints.length > 0 ? "## Evidence" : "",
        ...input.insight.sourceHints.map((hint) => `- ${hint}`),
        "",
        "JARVIS has not built or run anything. Review this proposal before any implementation work starts.",
      ].filter((line) => line !== "").join("\n"),
      meta: {
        source: "dream_cycle_capability_proposal",
        dreamDate: input.dreamDate,
        confidence: input.insight.confidence,
        sourceHints: input.insight.sourceHints,
        sourceMemoryIds: input.sourceMemoryIds.slice(0, 20),
      },
      status: "pending_approval",
      triageStatus: "needs_attention",
    }).returning({ id: schema.deliverables.id });

    return {
      capabilityReview: {
        status: "pending_approval",
        deliverableId: row?.id ?? null,
        deepLink: DREAM_CAPABILITY_REVIEW_DEEP_LINK,
        reason: "Dream synthesis surfaced a capability proposal for review only.",
      },
      sourceHints: input.insight.sourceHints,
    };
  } catch (err) {
    return {
      capabilityReview: {
        status: "failed",
        deepLink: DREAM_CAPABILITY_REVIEW_DEEP_LINK,
        reason: err instanceof Error ? err.message : String(err),
      },
      sourceHints: input.insight.sourceHints,
    };
  }
}

async function buildDreamReviewPayload(input: {
  userId: string;
  dreamDate: string;
  insight: DreamInsightRaw;
  sourceMemoryIds: string[];
}): Promise<DreamReviewPayload> {
  if (input.insight.kind === "capability_proposal") {
    return createDreamCapabilityProposal(input);
  }
  if (input.insight.kind === "memory_candidate") {
    return writeDreamMemoryCandidate(input);
  }
  return { sourceHints: input.insight.sourceHints };
}

/**
 * Run the full dream cycle for a single user.
 * Returns a DreamCycleResult with insight count and consolidation metadata.
 *
 * The four sleep-consolidation passes (consolidation, semantic extraction,
 * decay, reinforcement) always run nightly regardless of memory history depth.
 * The cross-category synthesis pass (which generates dream insights) requires
 * at least 14 days of history and a non-empty corpus — it is skipped when
 * those conditions are not met, but consolidation still proceeds.
 */
export async function runDreamForUser(
  userId: string,
  dreamDate: string,
): Promise<DreamCycleResult> {
  const { getModel } = await import("../lib/modelPrefs");
  const model = await getModel(userId, "memory");

  // ── Sleep-consolidation passes — run unconditionally every night ───────────
  // Run sequentially: reinforcement pass reads/writes userPreferences so we
  // avoid concurrent writes racing with one another.
  const consolidation = await runConsolidationPass(userId, model);
  const semanticExtraction = await runSemanticExtractionPass(userId, model);
  const decay = await runRelevanceDecayPass(userId);
  const reinforcement = await runAccessReinforcementPass(userId);

  // ── Cross-category synthesis — requires sufficient history ─────────────────
  const enough = await hasEnoughData(userId);
  if (!enough) {
    console.log(
      `[Dream] user ${userId} has insufficient data for synthesis (<${MINIMUM_MEMORY_AGE_DAYS} days) — consolidation passes ran`,
    );
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Dream cycle completed successfully (skipped synthesis: insufficient history)",
      metadata: { recovery: true, operation: "runDreamForUser", reason: "insufficient_data" },
    }).catch(() => {});
    return { insightsStored: 0, consolidation, semanticExtraction, decay, reinforcement };
  }

  const corpus = await buildCorpus(userId);
  if (!corpus.text.trim()) {
    console.log(`[Dream] empty corpus for user ${userId} — consolidation passes ran`);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Dream cycle completed successfully (skipped synthesis: empty corpus)",
      metadata: { recovery: true, operation: "runDreamForUser", reason: "empty_corpus" },
    }).catch(() => {});
    return { insightsStored: 0, consolidation, semanticExtraction, decay, reinforcement };
  }

  // ── Original cross-category synthesis pass (unchanged logic) ─────────────
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
      "kind": "memory_candidate" | "capability_proposal" | "insight",
      "insight": "<specific, non-obvious observation - 1-3 sentences, plain English, no markdown>",
      "confidence": <50-100 integer — how strongly supported by the data>,
      "sourceHints": ["<short phrase describing evidence 1>", "<evidence 2>"],
      "category": "work_patterns" | "communication_style" | "energy_rhythms" | "goals_history" | "blockers" | "accomplishments" | "preferences" | "fact",
      "memory_type": "semantic" | "procedural" | "episodic"
    }
  ]
}

Return { "insights": [] } if you cannot find anything genuinely non-obvious and cross-category.

Kind rules:
- "memory_candidate": a durable pattern or fact JARVIS may remember after MemoryOS policy review.
- "capability_proposal": JARVIS appears to be missing a tool, integration, deterministic workflow, or runtime capability. Surface the proposal only; never imply it was built or should auto-run.
- "insight": useful observation for the morning digest that should not be stored as memory.

Use active working context and recent context as evidence, but do not treat it as permanent unless it repeats across other evidence.

---

${corpus.text.slice(0, 12000)}`;

  let rawInsights: DreamInsightRaw[] = [];
  try {
    const resp = await openai.chat.completions.create({
      model,
      user: userId,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
    });
    const raw = resp.choices[0]?.message?.content || '{"insights":[]}';
    rawInsights = parseDreamResponse(raw).slice(0, 3);
  } catch (err) {
    console.error(`[Dream] LLM synthesis failed for ${userId}:`, err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Dream LLM synthesis failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "runDreamForUser_synthesis" },
    }).catch(() => {});
    return { insightsStored: 0, consolidation, semanticExtraction, decay, reinforcement };
  }

  if (rawInsights.length === 0) {
    console.log(`[Dream] no insights generated for ${userId} on ${dreamDate}`);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Dream cycle completed successfully (no new insights generated)",
      metadata: { recovery: true, operation: "runDreamForUser", reason: "no_insights" },
    }).catch(() => {});
    return { insightsStored: 0, consolidation, semanticExtraction, decay, reinforcement };
  }

  const sourceIds = corpus.memoryIds.slice(0, 50);

  let stored = 0;
  let hadInsertError = false;
  for (const raw of rawInsights) {
    const text = raw.insight.trim();
    if (!text) continue;
    const confidence = Math.max(50, Math.min(100, Math.round(raw.confidence || 70)));
    try {
      const reviewPayload = await buildDreamReviewPayload({
        userId,
        dreamDate,
        insight: { ...raw, confidence },
        sourceMemoryIds: sourceIds,
      });
      await db
        .insert(schema.dreamInsights)
        .values({
          userId,
          dreamDate,
          insightText: text,
          confidenceScore: confidence,
          sourceMemoryIds: sourceIds,
          insightKind: raw.kind,
          reviewPayload,
          shownToUser: false,
        });
      stored++;
      console.log(`[Dream] +insight [c=${confidence}] ${text.slice(0, 80)}`);
    } catch (err) {
      hadInsertError = true;
      console.error(`[Dream] insert failed:`, err);
      diagEmit({
        userId,
        subsystem: "memory",
        severity: "error",
        message: `Dream insight DB insert failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
        metadata: { operation: "runDreamForUser_insertInsight" },
      }).catch(() => {});
    }
  }

  const result: DreamCycleResult = {
    insightsStored: stored,
    consolidation,
    semanticExtraction,
    decay,
    reinforcement,
  };

  console.log(
    `[Dream] Cycle complete for ${userId} — insights=${stored} promoted=${consolidation.promoted} discarded=${consolidation.discarded} factsExtracted=${semanticExtraction.factsExtracted} decayed=${decay.decayed} deleted=${decay.hardDeleted} boosted=${reinforcement.boosted}`,
  );

  if (!hadInsertError) {
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Dream cycle completed successfully",
      metadata: { recovery: true, operation: "runDreamForUser", insightsStored: stored },
    }).catch(() => {});
  }

  return result;
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
