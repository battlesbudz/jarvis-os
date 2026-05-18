import { db } from "../db";
import { eq, desc, and, inArray, gte, gt, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { normalizeCategory } from "./categories";
import type { MemoryCategory } from "@shared/schema";
import {
  compactSoulText,
  shouldIncludeMemoryInSoul,
  SOUL_FIELD_MAX_CHARS,
} from "./soulCuration";

const SOUL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Number of new short_term/episodic memories that trigger early re-generation */
export const SOUL_NOVELTY_THRESHOLD = 5;

/** Maximum character length before the compact formatting pass kicks in */
const SOUL_COMPACT_THRESHOLD = 4000;

interface SoulRecord {
  content: string;
  manualOverride: string | null;
  generatedAt: Date | null;
  updatedAt: Date;
}

interface LifeContextData {
  priorityGoal?: string;
  upcomingDeadline?: string;
  improvementArea?: string;
  currentBlocker?: string;
  freeText?: string;
}

function readLifeContextData(value: unknown): LifeContextData | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const out: LifeContextData = {};
  for (const k of ["priorityGoal", "upcomingDeadline", "improvementArea", "currentBlocker", "freeText"] as const) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function countNewMemoriesSince(userId: string, since: Date): Promise<number> {
  try {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          gte(schema.userMemories.extractedAt, since),
          sql`(${schema.userMemories.tier} = 'short_term' OR ${schema.userMemories.memoryType} = 'episodic')`,
        ),
      );
    return Number(result[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function isStale(userId: string, generatedAt: Date | null): Promise<boolean> {
  if (!generatedAt) return true;
  if (Date.now() - generatedAt.getTime() > SOUL_TTL_MS) return true;
  const novelCount = await countNewMemoriesSince(userId, generatedAt);
  return novelCount > SOUL_NOVELTY_THRESHOLD;
}

async function buildSoulMarkdown(userId: string): Promise<string> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    identityCoreRows,
    currentStateRows,
    episodicRows,
    longTermPatternRows,
    aspirationRows,
    dreamRows,
    lifeRows,
    peopleRows,
    emotionalStateRows,
    morningNoteRows,
  ] = await Promise.all([
    // 1. Identity Core — long_term semantic + procedural (values, communication_style, preferences)
    db
      .select({
        id: schema.userMemories.id,
        content: schema.userMemories.content,
        category: schema.userMemories.category,
        sourceType: schema.userMemories.sourceType,
      })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.tier, "long_term"),
          sql`${schema.userMemories.memoryType} IN ('semantic','procedural')`,
          sql`${schema.userMemories.category} IN ('values','communication_style','preferences','fact')`,
          eq(schema.userMemories.pendingReview, false),
        ),
      )
      .orderBy(desc(schema.userMemories.relevanceScore), desc(schema.userMemories.confidence))
      .limit(16),

    // 2. Current State — short_term contextual
    db
      .select({ content: schema.userMemories.content, sourceType: schema.userMemories.sourceType })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.tier, "short_term"),
          eq(schema.userMemories.memoryType, "contextual"),
          eq(schema.userMemories.pendingReview, false),
        ),
      )
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(12),

    // 3. Episodic Highlights — episodic memories in last 7 days
    db
      .select({
        content: schema.userMemories.content,
        extractedAt: schema.userMemories.extractedAt,
        sourceType: schema.userMemories.sourceType,
      })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.memoryType, "episodic"),
          gte(schema.userMemories.extractedAt, sevenDaysAgo),
          eq(schema.userMemories.pendingReview, false),
        ),
      )
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(8),

    // 4. Long-Term Patterns — high-relevance long_term in work/energy/accomplishments
    db
      .select({
        content: schema.userMemories.content,
        category: schema.userMemories.category,
        sourceType: schema.userMemories.sourceType,
      })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.tier, "long_term"),
          sql`${schema.userMemories.category} IN ('work_patterns','energy_rhythms','accomplishments','blockers')`,
          gt(schema.userMemories.relevanceScore, 55),
          eq(schema.userMemories.pendingReview, false),
        ),
      )
      .orderBy(desc(schema.userMemories.relevanceScore), desc(schema.userMemories.extractedAt))
      .limit(24),

    // 7. Aspirations — goals_history category memories
    db
      .select({ content: schema.userMemories.content, sourceType: schema.userMemories.sourceType })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.category, "goals_history"),
          eq(schema.userMemories.pendingReview, false),
        ),
      )
      .orderBy(desc(schema.userMemories.relevanceScore), desc(schema.userMemories.extractedAt))
      .limit(8),

    // 5. Dream Insights — top 3 by confidence
    db
      .select({
        insightText: schema.dreamInsights.insightText,
        confidenceScore: schema.dreamInsights.confidenceScore,
        dreamDate: schema.dreamInsights.dreamDate,
      })
      .from(schema.dreamInsights)
      .where(eq(schema.dreamInsights.userId, userId))
      .orderBy(desc(schema.dreamInsights.confidenceScore), desc(schema.dreamInsights.createdAt))
      .limit(3),

    // Life context for Current State + Aspirations
    db.select().from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)).limit(1),

    // 6. Relationships — people table
    db
      .select()
      .from(schema.people)
      .where(eq(schema.people.userId, userId))
      .orderBy(desc(schema.people.lastInteractionAt))
      .limit(15),

    // 2b. Emotional state — current inferred state
    db
      .select({
        label: schema.userEmotionalState.label,
        stressScore: schema.userEmotionalState.stressScore,
        flowScore: schema.userEmotionalState.flowScore,
        explanation: schema.userEmotionalState.explanation,
        manualOverride: schema.userEmotionalState.manualOverride,
      })
      .from(schema.userEmotionalState)
      .where(eq(schema.userEmotionalState.userId, userId))
      .limit(1),

    // 2c. Most recent morning note mood signal + intention
    db
      .select({
        moodSignal: schema.morningVoiceNotes.moodSignal,
        intention: schema.morningVoiceNotes.intention,
        recordedAt: schema.morningVoiceNotes.recordedAt,
      })
      .from(schema.morningVoiceNotes)
      .where(eq(schema.morningVoiceNotes.userId, userId))
      .orderBy(desc(schema.morningVoiceNotes.recordedAt))
      .limit(1),
  ]);

  const lc = lifeRows[0] ? readLifeContextData((lifeRows[0] as { data: unknown }).data) : null;

  const sections: string[] = [];
  sections.push("# JARVIS SOUL");
  sections.push(
    "_Structured self-model — regenerated from memories, life context, and nightly synthesis. Sections reflect distinct cognitive layers._",
  );

  // ── Section 1: Identity Core ──────────────────────────────────────────────
  const identityByCat = new Map<MemoryCategory, string[]>();
  for (const m of identityCoreRows.filter(shouldIncludeMemoryInSoul)) {
    const cat = normalizeCategory(m.category);
    const arr = identityByCat.get(cat) || [];
    arr.push(compactSoulText(m.content));
    identityByCat.set(cat, arr);
  }
  const identityCatOrder: MemoryCategory[] = ["values", "communication_style", "preferences", "fact"];
  const identityLines: string[] = [];
  for (const cat of identityCatOrder) {
    const items = identityByCat.get(cat);
    if (!items || items.length === 0) continue;
    const labelMap: Record<string, string> = {
      values: "Values",
      communication_style: "Communication Style",
      preferences: "Preferences",
      fact: "Core Facts",
    };
    identityLines.push(`_${labelMap[cat] || cat}_`);
    for (const item of items) identityLines.push(`- ${item}`);
  }
  if (identityLines.length > 0) {
    sections.push("## 1. Identity Core");
    sections.push(...identityLines);
  }

  // ── Section 2: Current State ──────────────────────────────────────────────
  const currentStateLines: string[] = [];
  if (lc) {
    if (lc.priorityGoal) currentStateLines.push(`- **Top priority:** ${compactSoulText(lc.priorityGoal, SOUL_FIELD_MAX_CHARS)}`);
    if (lc.upcomingDeadline) currentStateLines.push(`- **Timing:** ${compactSoulText(lc.upcomingDeadline, SOUL_FIELD_MAX_CHARS)}`);
    if (lc.improvementArea) currentStateLines.push(`- **Improvement area:** ${compactSoulText(lc.improvementArea, SOUL_FIELD_MAX_CHARS)}`);
    if (lc.currentBlocker) currentStateLines.push(`- **Current blocker:** ${compactSoulText(lc.currentBlocker, SOUL_FIELD_MAX_CHARS)}`);
    if (lc.freeText) currentStateLines.push(`- ${compactSoulText(lc.freeText, SOUL_FIELD_MAX_CHARS)}`);
  }
  const es = emotionalStateRows[0];
  if (es) {
    const effectiveLabel = es.manualOverride || es.label;
    const stressNote = es.stressScore > 6 ? " (elevated stress)" : es.stressScore < 3 ? " (low stress)" : "";
    const flowNote = es.flowScore > 6 ? ", high flow" : es.flowScore < 3 ? ", low flow" : "";
    currentStateLines.push(`- **Emotional state:** ${effectiveLabel}${stressNote}${flowNote}`);
    if (es.explanation) currentStateLines.push(`- _${compactSoulText(es.explanation, SOUL_FIELD_MAX_CHARS)}_`);
  }
  const mn = morningNoteRows[0];
  if (mn) {
    if (mn.moodSignal)
      currentStateLines.push(`- **Morning mood:** ${compactSoulText(mn.moodSignal)}${mn.recordedAt ? ` (${mn.recordedAt})` : ""}`);
    if (mn.intention) currentStateLines.push(`- **Today's intention:** ${compactSoulText(mn.intention)}`);
  }
  for (const m of currentStateRows.filter(shouldIncludeMemoryInSoul)) {
    currentStateLines.push(`- ${compactSoulText(m.content)}`);
  }
  if (currentStateLines.length > 0) {
    sections.push("## 2. Current State");
    sections.push(...currentStateLines);
  }

  // ── Section 3: Episodic Highlights ───────────────────────────────────────
  const includedEpisodicRows = episodicRows.filter(shouldIncludeMemoryInSoul);
  if (includedEpisodicRows.length > 0) {
    sections.push("## 3. Episodic Highlights _(last 7 days)_");
    for (const m of includedEpisodicRows) {
      sections.push(`- ${compactSoulText(m.content)}`);
    }
  }

  // ── Section 4: Long-Term Patterns ────────────────────────────────────────
  const patternByCat = new Map<MemoryCategory, string[]>();
  for (const m of longTermPatternRows.filter(shouldIncludeMemoryInSoul)) {
    const cat = normalizeCategory(m.category);
    const arr = patternByCat.get(cat) || [];
    arr.push(compactSoulText(m.content));
    patternByCat.set(cat, arr);
  }
  const patternCatOrder: MemoryCategory[] = ["work_patterns", "energy_rhythms", "accomplishments", "blockers"];
  const patternLabelMap: Record<string, string> = {
    work_patterns: "Work Patterns",
    energy_rhythms: "Energy & Rhythms",
    accomplishments: "Wins & Accomplishments",
    blockers: "Blockers & Frictions",
  };
  const patternLines: string[] = [];
  for (const cat of patternCatOrder) {
    const items = patternByCat.get(cat);
    if (!items || items.length === 0) continue;
    patternLines.push(`_${patternLabelMap[cat] || cat}_`);
    for (const item of items) patternLines.push(`- ${item}`);
  }
  if (patternLines.length > 0) {
    sections.push("## 4. Long-Term Patterns");
    sections.push(...patternLines);
  }

  // ── Section 5: Dream Insights ─────────────────────────────────────────────
  if (dreamRows.length > 0) {
    sections.push("## 5. Dream Insights");
    for (const d of dreamRows) {
      const conf = typeof d.confidenceScore === "number" ? ` _(confidence: ${d.confidenceScore})_` : "";
      sections.push(`- ${d.insightText}${conf}`);
    }
  }

  // ── Section 6: Relationships ──────────────────────────────────────────────
  const relationshipRows = peopleRows.filter((p) => p.relationship !== "email correspondent").slice(0, 8);
  if (relationshipRows.length > 0) {
    sections.push("## 6. Relationships");
    for (const p of relationshipRows) {
      const role = p.relationship ? ` — ${p.relationship}` : "";
      const note = p.notes ? ` (${compactSoulText(p.notes, 120)})` : "";
      const lastSeen = p.lastInteractionAt
        ? ` [last: ${new Date(p.lastInteractionAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}]`
        : "";
      sections.push(`- **${p.name}**${role}${note}${lastSeen}`);
    }
  }

  // ── Section 7: Aspirations ────────────────────────────────────────────────
  const aspirationLines: string[] = [];
  if (lc?.priorityGoal) aspirationLines.push(`- **Priority goal:** ${compactSoulText(lc.priorityGoal, SOUL_FIELD_MAX_CHARS)}`);
  if (lc?.improvementArea) aspirationLines.push(`- **Improving:** ${compactSoulText(lc.improvementArea, SOUL_FIELD_MAX_CHARS)}`);
  for (const m of aspirationRows.filter(shouldIncludeMemoryInSoul)) {
    aspirationLines.push(`- ${compactSoulText(m.content)}`);
  }
  if (aspirationLines.length > 0) {
    sections.push("## 7. Aspirations");
    sections.push(...aspirationLines);
  }

  return sections.join("\n");
}

/** Apply a compact formatting pass when the document exceeds the character budget. */
function compactSoulMarkdown(md: string): string {
  if (md.length <= SOUL_COMPACT_THRESHOLD) return md;

  const lines = md.split("\n");
  const output: string[] = [];
  let inSection: string | null = null;
  let sectionItemCount = 0;
  const EPISODIC_COMPACT_LIMIT = 5;
  const PATTERN_COMPACT_LIMIT_PER_CAT = 6;
  let patternSubCount = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      inSection = line;
      sectionItemCount = 0;
      patternSubCount = 0;
      output.push(line);
      continue;
    }
    if (inSection?.includes("3. Episodic")) {
      if (line.startsWith("- ")) {
        sectionItemCount++;
        if (sectionItemCount <= EPISODIC_COMPACT_LIMIT) output.push(line);
      } else {
        output.push(line);
      }
    } else if (inSection?.includes("4. Long-Term")) {
      if (line.startsWith("_") && line.endsWith("_")) {
        patternSubCount = 0;
        output.push(line);
      } else if (line.startsWith("- ")) {
        patternSubCount++;
        if (patternSubCount <= PATTERN_COMPACT_LIMIT_PER_CAT) output.push(line);
      } else {
        output.push(line);
      }
    } else {
      output.push(line);
    }
  }
  return output.join("\n");
}

export async function regenerateSoul(userId: string): Promise<SoulRecord> {
  const raw = await buildSoulMarkdown(userId);
  const content = compactSoulMarkdown(raw);
  const now = new Date();
  const inserted = await db
    .insert(schema.jarvisSouls)
    .values({ userId, content, generatedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.jarvisSouls.userId,
      set: { content, generatedAt: now, updatedAt: now },
    })
    .returning();
  const row = inserted[0];
  console.log(`[Soul] regenerated for user ${userId} (${content.length} chars)`);
  return {
    content: row?.content ?? content,
    manualOverride: row?.manualOverride ?? null,
    generatedAt: row?.generatedAt ?? now,
    updatedAt: row?.updatedAt ?? now,
  };
}

export async function getSoul(userId: string, opts?: { forceFresh?: boolean }): Promise<SoulRecord> {
  const [existing] = await db
    .select()
    .from(schema.jarvisSouls)
    .where(eq(schema.jarvisSouls.userId, userId))
    .limit(1);

  const stale = await isStale(userId, existing?.generatedAt ?? null);

  if (!existing || opts?.forceFresh || stale || !existing.content.trim()) {
    const fresh = await regenerateSoul(userId);
    return {
      content: fresh.content,
      manualOverride: existing?.manualOverride ?? fresh.manualOverride,
      generatedAt: fresh.generatedAt,
      updatedAt: fresh.updatedAt,
    };
  }

  return {
    content: existing.content,
    manualOverride: existing.manualOverride,
    generatedAt: existing.generatedAt,
    updatedAt: existing.updatedAt,
  };
}

/**
 * Replace the canonical SOUL document content directly. This is what
 * powers the "edit JARVIS_SOUL.md" experience in Profile — the user is
 * editing the source of truth, not just a pinned override layered on top.
 * Calling this also resets generatedAt so the document is treated as
 * fresh (won't be auto-regenerated on next read).
 */
export async function setSoulContent(userId: string, content: string): Promise<void> {
  const trimmed = content.trim();
  const now = new Date();
  await db
    .insert(schema.jarvisSouls)
    .values({ userId, content: trimmed, manualOverride: null, generatedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.jarvisSouls.userId,
      set: { content: trimmed, manualOverride: null, generatedAt: now, updatedAt: now },
    });
}

export async function setManualOverride(userId: string, override: string | null): Promise<void> {
  const trimmed = override?.trim() || null;
  const now = new Date();
  await db
    .insert(schema.jarvisSouls)
    .values({ userId, content: "", manualOverride: trimmed, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.jarvisSouls.userId,
      set: { manualOverride: trimmed, updatedAt: now },
    });
}

/**
 * Mark the SOUL as needing regeneration on next read — but only if it has
 * genuinely become stale (TTL exceeded or novelty threshold crossed).
 * If the soul is already null-stamped (already stale) this is a no-op.
 * If neither condition is met, the soul stays fresh and is not touched.
 */
export async function markSoulStale(userId: string): Promise<void> {
  const [existing] = await db
    .select({ generatedAt: schema.jarvisSouls.generatedAt })
    .from(schema.jarvisSouls)
    .where(eq(schema.jarvisSouls.userId, userId))
    .limit(1);

  if (!existing) return;
  if (existing.generatedAt === null) return;

  const shouldInvalidate = await isStale(userId, existing.generatedAt);
  if (!shouldInvalidate) return;

  await db
    .update(schema.jarvisSouls)
    .set({ generatedAt: null })
    .where(eq(schema.jarvisSouls.userId, userId));
}

/**
 * Inline block for the coach system prompt. Combines structured SOUL +
 * manual override as ## Personal Notes. Empty string when the user has no SOUL yet.
 * Applies compact formatting as a final guardrail if the assembled block exceeds
 * 4000 characters (e.g. manual soul edits or legacy long content).
 */
export async function getSoulPromptBlock(userId: string): Promise<string> {
  try {
    const soul = await getSoul(userId);
    const parts: string[] = [];
    if (soul.content.trim()) {
      parts.push(soul.content.trim());
    }
    if (soul.manualOverride && soul.manualOverride.trim()) {
      parts.push(`\n## Personal Notes\n${soul.manualOverride.trim()}`);
    }
    if (parts.length === 0) return "";
    const combined = parts.join("\n");
    const compacted = compactSoulMarkdown(combined);
    return `\n${compacted}\n`;
  } catch (err) {
    console.error("[Soul] getSoulPromptBlock failed:", err);
    return "";
  }
}

/** Touch lastReferencedAt on memories whose content appears in the prompt. */
export async function touchReferencedMemories(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db
      .update(schema.userMemories)
      .set({ lastReferencedAt: new Date() })
      .where(and(eq(schema.userMemories.userId, userId), inArray(schema.userMemories.id, ids)));
  } catch (err) {
    console.error("[Soul] touchReferencedMemories failed:", err);
  }
}
