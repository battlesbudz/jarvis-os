import { db } from "../db";
import { eq, desc, and, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { CATEGORY_LABELS, normalizeCategory } from "./categories";
import type { MemoryCategory, WeeklyPattern } from "@shared/schema";

const SOUL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SoulRecord {
  content: string;
  manualOverride: string | null;
  generatedAt: Date | null;
  updatedAt: Date;
}

function isStale(generatedAt: Date | null): boolean {
  if (!generatedAt) return true;
  return Date.now() - generatedAt.getTime() > SOUL_TTL_MS;
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

async function buildSoulMarkdown(userId: string): Promise<string> {
  const [memoriesRows, lifeRows, peopleRows, insightRows] = await Promise.all([
    db
      .select()
      .from(schema.userMemories)
      .where(eq(schema.userMemories.userId, userId))
      .orderBy(desc(schema.userMemories.relevanceScore), desc(schema.userMemories.confidence), desc(schema.userMemories.extractedAt))
      .limit(120),
    db.select().from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)).limit(1),
    db
      .select()
      .from(schema.people)
      .where(eq(schema.people.userId, userId))
      .orderBy(desc(schema.people.lastInteractionAt))
      .limit(15),
    db
      .select()
      .from(schema.weeklyInsights)
      .where(eq(schema.weeklyInsights.userId, userId))
      .orderBy(desc(schema.weeklyInsights.createdAt))
      .limit(1),
  ]);

  const grouped = new Map<MemoryCategory, string[]>();
  for (const m of memoriesRows) {
    const cat = normalizeCategory(m.category);
    const arr = grouped.get(cat) || [];
    if (arr.length < 8) arr.push(m.content);
    grouped.set(cat, arr);
  }

  const sections: string[] = [];
  sections.push("# JARVIS SOUL");
  sections.push("_Auto-generated profile of the user. Regenerated weekly from memories, life context, and observed patterns._");

  const lc = lifeRows[0] ? readLifeContextData((lifeRows[0] as { data: unknown }).data) : null;
  if (lc) {
    sections.push("## Current Life Context");
    if (lc.priorityGoal) sections.push(`- **Top priority:** ${lc.priorityGoal}`);
    if (lc.upcomingDeadline) sections.push(`- **Upcoming deadline:** ${lc.upcomingDeadline}`);
    if (lc.improvementArea) sections.push(`- **Improvement area:** ${lc.improvementArea}`);
    if (lc.currentBlocker) sections.push(`- **Current blocker:** ${lc.currentBlocker}`);
    if (lc.freeText) sections.push(`- ${lc.freeText}`);
  }

  const orderedCats: MemoryCategory[] = [
    "values",
    "communication_style",
    "work_patterns",
    "energy_rhythms",
    "goals_history",
    "blockers",
    "preferences",
    "accomplishments",
    "relationships",
    "fact",
  ];
  for (const cat of orderedCats) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    sections.push(`## ${CATEGORY_LABELS[cat]}`);
    for (const item of items) sections.push(`- ${item}`);
  }

  if (peopleRows.length > 0) {
    sections.push("## People in your life");
    for (const p of peopleRows) {
      const role = p.relationship ? ` — ${p.relationship}` : "";
      const note = p.notes ? ` (${p.notes})` : "";
      sections.push(`- **${p.name}**${role}${note}`);
    }
  }

  const latestInsight = insightRows[0];
  if (latestInsight) {
    const patterns: WeeklyPattern[] = Array.isArray(latestInsight.patterns) ? latestInsight.patterns : [];
    if (patterns.length > 0) {
      sections.push(`## Patterns observed (week of ${latestInsight.weekOf})`);
      for (const p of patterns) {
        const conf = typeof p.confidence === "number" ? ` _(c=${p.confidence})_` : "";
        sections.push(`- ${p.observation}${conf}`);
      }
      if (latestInsight.summary) {
        sections.push(`\n_${latestInsight.summary}_`);
      }
    }
  }

  return sections.join("\n");
}

export async function regenerateSoul(userId: string): Promise<SoulRecord> {
  const content = await buildSoulMarkdown(userId);
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

  if (!existing || opts?.forceFresh || isStale(existing.generatedAt) || !existing.content.trim()) {
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
      set: { content: trimmed, generatedAt: now, updatedAt: now },
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

/** Mark the SOUL as needing regeneration on next read. Cheap; just clears generatedAt. */
export async function markSoulStale(userId: string): Promise<void> {
  await db
    .update(schema.jarvisSouls)
    .set({ generatedAt: null })
    .where(eq(schema.jarvisSouls.userId, userId));
}

/**
 * Inline block for the coach system prompt. Combines auto SOUL +
 * manual override. Empty string when the user has no SOUL yet.
 */
export async function getSoulPromptBlock(userId: string): Promise<string> {
  try {
    const soul = await getSoul(userId);
    const parts: string[] = [];
    if (soul.content.trim()) parts.push(soul.content.trim());
    if (soul.manualOverride && soul.manualOverride.trim()) {
      parts.push(`\n## User-pinned context\n${soul.manualOverride.trim()}`);
    }
    return parts.length > 0 ? `\n${parts.join("\n")}\n` : "";
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
