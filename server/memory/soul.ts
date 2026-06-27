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
import { containsRawRestrictedContent } from "./restrictedContent";
import { approvedDreamInsightContextFilter } from "./dreamContext";

const SOUL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Number of new short_term/episodic memories that trigger early re-generation */
export const SOUL_NOVELTY_THRESHOLD = 5;

/** Maximum character length before the compact formatting pass kicks in */
const SOUL_COMPACT_THRESHOLD = 4000;
const RESTRICTED_SOURCE_SQL_PATTERN = "%(plaid|bank|banking|financial|transaction|credit_card|credit card|debit_card|debit card|tax_document|tax document|payroll|brokerage|account_balance|account balance|restricted_source|restricted summary|restricted_summary)%";

function approvedMemoryLifecycleFilter() {
  return and(
    eq(schema.userMemories.pendingReview, false),
    sql`${schema.userMemories.reviewStatus} IN ('active', 'kept', 'edited')`,
    sql`COALESCE(${schema.userMemories.sensitivity}, 'normal') = 'normal'`,
    sql`LOWER(COALESCE(${schema.userMemories.sourceType}, '')) NOT SIMILAR TO ${RESTRICTED_SOURCE_SQL_PATTERN}`,
    sql`LOWER(COALESCE(${schema.userMemories.sourceRef}, '')) NOT SIMILAR TO ${RESTRICTED_SOURCE_SQL_PATTERN}`,
  );
}

function shouldIncludeNonRestrictedMemoryInSoul(memory: { content?: string | null; sourceType?: string | null }): boolean {
  return shouldIncludeMemoryInSoul(memory) && !containsRawRestrictedContent(memory.content ?? "");
}

interface SoulRecord {
  content: string;
  manualOverride: string | null;
  generatedAt: Date | null;
  updatedAt: Date;
}

export type SoulEditTarget = "content" | "manual_override";
export type SoulEditStatus = "pending" | "approved" | "rejected";

export interface SoulEditHistoryRecord {
  id: string;
  userId: string;
  target: SoulEditTarget;
  status: SoulEditStatus;
  oldValue: string | null;
  newValue: string;
  source: string;
  sourceRef: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  reason: string | null;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
}

interface SoulEditAuditOptions {
  source?: string;
  sourceRef?: string | null;
  requestedBy?: string | null;
  approvedBy?: string | null;
  reason?: string | null;
}

interface SoulEditProposalInput extends SoulEditAuditOptions {
  userId: string;
  target: SoulEditTarget | string;
  newValue: string;
}

function normalizeSoulEditTarget(value: unknown): SoulEditTarget | null {
  if (value === "content" || value === "manual_override") return value;
  return null;
}

function normalizeSoulEditValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function editValuesMatch(oldValue: string | null, newValue: string | null): boolean {
  return (oldValue ?? "") === (newValue ?? "");
}

function mapSoulEditRow(row: Record<string, unknown>): SoulEditHistoryRecord {
  const createdAt = row.created_at instanceof Date || typeof row.created_at === "string"
    ? row.created_at
    : row.createdAt instanceof Date || typeof row.createdAt === "string"
      ? row.createdAt
      : new Date(0);
  const resolvedAt = row.resolved_at instanceof Date || typeof row.resolved_at === "string"
    ? row.resolved_at
    : row.resolvedAt instanceof Date || typeof row.resolvedAt === "string"
      ? row.resolvedAt
      : null;

  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? row.userId ?? ""),
    target: normalizeSoulEditTarget(row.target) ?? "content",
    status: row.status === "approved" || row.status === "rejected" ? row.status : "pending",
    oldValue: typeof row.old_value === "string" ? row.old_value : typeof row.oldValue === "string" ? row.oldValue : null,
    newValue: String(row.new_value ?? row.newValue ?? ""),
    source: String(row.source ?? "chat"),
    sourceRef: typeof row.source_ref === "string" ? row.source_ref : typeof row.sourceRef === "string" ? row.sourceRef : null,
    requestedBy: typeof row.requested_by === "string" ? row.requested_by : typeof row.requestedBy === "string" ? row.requestedBy : null,
    approvedBy: typeof row.approved_by === "string" ? row.approved_by : typeof row.approvedBy === "string" ? row.approvedBy : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    createdAt,
    resolvedAt,
  };
}

async function readSoulEditValue(userId: string, target: SoulEditTarget): Promise<string | null> {
  const [existing] = await db
    .select({
      content: schema.jarvisSouls.content,
      manualOverride: schema.jarvisSouls.manualOverride,
    })
    .from(schema.jarvisSouls)
    .where(eq(schema.jarvisSouls.userId, userId))
    .limit(1);
  if (target === "content") return existing?.content ?? "";
  return existing?.manualOverride ?? null;
}

async function writeSoulEditValue(userId: string, target: SoulEditTarget, newValue: string | null, now: Date): Promise<void> {
  if (target === "content") {
    await db
      .insert(schema.jarvisSouls)
      .values({ userId, content: newValue ?? "", manualOverride: null, generatedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.jarvisSouls.userId,
        set: { content: newValue ?? "", manualOverride: null, generatedAt: now, updatedAt: now },
      });
    return;
  }

  await db
    .insert(schema.jarvisSouls)
    .values({ userId, content: "", manualOverride: newValue, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.jarvisSouls.userId,
      set: { manualOverride: newValue, updatedAt: now },
    });
}

async function insertSoulEditEvent(input: {
  userId: string;
  target: SoulEditTarget;
  status: SoulEditStatus;
  oldValue: string | null;
  newValue: string;
  source: string;
  sourceRef?: string | null;
  requestedBy?: string | null;
  approvedBy?: string | null;
  reason?: string | null;
  resolvedAt?: Date | null;
}): Promise<SoulEditHistoryRecord> {
  const result = await db.execute(sql`
    INSERT INTO soul_edit_events (
      user_id, target, status, old_value, new_value, source, source_ref,
      requested_by, approved_by, reason, resolved_at
    )
    VALUES (
      ${input.userId}, ${input.target}, ${input.status}, ${input.oldValue}, ${input.newValue}, ${input.source},
      ${input.sourceRef ?? null}, ${input.requestedBy ?? null}, ${input.approvedBy ?? null},
      ${input.reason ?? null}, ${input.resolvedAt ?? null}
    )
    RETURNING id, user_id, target, status, old_value, new_value, source, source_ref,
      requested_by, approved_by, reason, created_at, resolved_at
  `);
  return mapSoulEditRow((result.rows ?? [])[0] as Record<string, unknown>);
}

export async function recordSoulEditAudit(input: {
  userId: string;
  target: SoulEditTarget;
  oldValue: string | null;
  newValue: string | null;
  options?: SoulEditAuditOptions;
}): Promise<SoulEditHistoryRecord | null> {
  const oldValue = normalizeSoulEditValue(input.oldValue);
  const newValue = normalizeSoulEditValue(input.newValue);
  if (editValuesMatch(oldValue, newValue)) return null;
  return insertSoulEditEvent({
    userId: input.userId,
    target: input.target,
    status: "approved",
    oldValue,
    newValue: newValue ?? "",
    source: input.options?.source ?? "soul_editor",
    sourceRef: input.options?.sourceRef ?? null,
    requestedBy: input.options?.requestedBy ?? input.userId,
    approvedBy: input.options?.approvedBy ?? input.userId,
    reason: input.options?.reason ?? null,
    resolvedAt: new Date(),
  });
}

export async function proposeSoulEdit(input: SoulEditProposalInput): Promise<SoulEditHistoryRecord> {
  const target = normalizeSoulEditTarget(input.target);
  if (!target) throw new Error("Invalid Soul edit target");
  const newValue = normalizeSoulEditValue(input.newValue);
  if (!newValue) throw new Error("Soul edit proposal requires newValue");
  const oldValue = await readSoulEditValue(input.userId, target);
  return insertSoulEditEvent({
    userId: input.userId,
    target,
    status: "pending",
    oldValue: normalizeSoulEditValue(oldValue),
    newValue,
    source: input.source ?? "chat",
    sourceRef: input.sourceRef ?? null,
    requestedBy: input.requestedBy ?? input.userId,
    reason: input.reason ?? null,
  });
}

export async function approveSoulEdit(input: {
  userId: string;
  editId: string;
  approvedBy?: string | null;
  reason?: string | null;
}): Promise<SoulEditHistoryRecord | null> {
  return db.transaction(async (tx) => {
    const existing = await tx.execute(sql`
      SELECT id, user_id, target, status, old_value, new_value, source, source_ref,
        requested_by, approved_by, reason, created_at, resolved_at
      FROM soul_edit_events
      WHERE id = ${input.editId} AND user_id = ${input.userId} AND status = 'pending'
      LIMIT 1
      FOR UPDATE
    `);
    const row = (existing.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const target = normalizeSoulEditTarget(row.target);
    if (!target) return null;

    const current = await tx.execute(sql`
      SELECT content, manual_override
      FROM jarvis_souls
      WHERE user_id = ${input.userId}
      LIMIT 1
      FOR UPDATE
    `);
    const currentRow = (current.rows ?? [])[0] as Record<string, unknown> | undefined;
    const oldValue = target === "content"
      ? normalizeSoulEditValue(typeof currentRow?.content === "string" ? currentRow.content : "")
      : normalizeSoulEditValue(typeof currentRow?.manual_override === "string" ? currentRow.manual_override : null);
    const newValue = normalizeSoulEditValue(String(row.new_value ?? "")) ?? "";
    const now = new Date();

    if (target === "content") {
      await tx.execute(sql`
        INSERT INTO jarvis_souls (user_id, content, manual_override, generated_at, updated_at)
        VALUES (${input.userId}, ${newValue}, NULL, ${now}, ${now})
        ON CONFLICT (user_id) DO UPDATE
        SET content = EXCLUDED.content,
            manual_override = NULL,
            generated_at = EXCLUDED.generated_at,
            updated_at = EXCLUDED.updated_at
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO jarvis_souls (user_id, content, manual_override, updated_at)
        VALUES (${input.userId}, '', ${newValue}, ${now})
        ON CONFLICT (user_id) DO UPDATE
        SET manual_override = EXCLUDED.manual_override,
            updated_at = EXCLUDED.updated_at
      `);
    }

    const approvedBy = input.approvedBy ?? input.userId;
    const reason = input.reason ?? (typeof row.reason === "string" ? row.reason : null);
    const updated = await tx.execute(sql`
      UPDATE soul_edit_events
      SET status = 'approved',
          old_value = ${oldValue},
          approved_by = ${approvedBy},
          reason = ${reason},
          resolved_at = ${now}
      WHERE id = ${input.editId} AND user_id = ${input.userId} AND status = 'pending'
      RETURNING id, user_id, target, status, old_value, new_value, source, source_ref,
        requested_by, approved_by, reason, created_at, resolved_at
    `);
    const updatedRow = (updated.rows ?? [])[0] as Record<string, unknown> | undefined;
    return updatedRow ? mapSoulEditRow(updatedRow) : null;
  });
}

export async function rejectSoulEdit(input: {
  userId: string;
  editId: string;
  approvedBy?: string | null;
  reason?: string | null;
}): Promise<SoulEditHistoryRecord | null> {
  const reviewer = input.approvedBy ?? input.userId;
  const now = new Date();
  const updated = await db.execute(sql`
    UPDATE soul_edit_events
    SET status = 'rejected',
        approved_by = ${reviewer},
        reason = ${input.reason ?? null},
        resolved_at = ${now}
    WHERE id = ${input.editId} AND user_id = ${input.userId} AND status = 'pending'
    RETURNING id, user_id, target, status, old_value, new_value, source, source_ref,
      requested_by, approved_by, reason, created_at, resolved_at
  `);
  const row = (updated.rows ?? [])[0] as Record<string, unknown> | undefined;
  return row ? mapSoulEditRow(row) : null;
}

export async function listSoulEditHistory(userId: string, opts?: { limit?: number; status?: SoulEditStatus }): Promise<SoulEditHistoryRecord[]> {
  const limit = Math.max(1, Math.min(100, opts?.limit ?? 25));
  const result = opts?.status
    ? await db.execute(sql`
      SELECT id, user_id, target, status, old_value, new_value, source, source_ref,
        requested_by, approved_by, reason, created_at, resolved_at
      FROM soul_edit_events
      WHERE user_id = ${userId} AND status = ${opts.status}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)
    : await db.execute(sql`
      SELECT id, user_id, target, status, old_value, new_value, source, source_ref,
        requested_by, approved_by, reason, created_at, resolved_at
      FROM soul_edit_events
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  return (result.rows ?? []).map((row) => mapSoulEditRow(row as Record<string, unknown>));
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
          approvedMemoryLifecycleFilter(),
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
          approvedMemoryLifecycleFilter(),
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
          approvedMemoryLifecycleFilter(),
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
          approvedMemoryLifecycleFilter(),
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
          approvedMemoryLifecycleFilter(),
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
          approvedMemoryLifecycleFilter(),
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
      .where(approvedDreamInsightContextFilter(userId))
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
  for (const m of identityCoreRows.filter(shouldIncludeNonRestrictedMemoryInSoul)) {
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
  for (const m of currentStateRows.filter(shouldIncludeNonRestrictedMemoryInSoul)) {
    currentStateLines.push(`- ${compactSoulText(m.content)}`);
  }
  if (currentStateLines.length > 0) {
    sections.push("## 2. Current State");
    sections.push(...currentStateLines);
  }

  // ── Section 3: Episodic Highlights ───────────────────────────────────────
  const includedEpisodicRows = episodicRows.filter(shouldIncludeNonRestrictedMemoryInSoul);
  if (includedEpisodicRows.length > 0) {
    sections.push("## 3. Episodic Highlights _(last 7 days)_");
    for (const m of includedEpisodicRows) {
      sections.push(`- ${compactSoulText(m.content)}`);
    }
  }

  // ── Section 4: Long-Term Patterns ────────────────────────────────────────
  const patternByCat = new Map<MemoryCategory, string[]>();
  for (const m of longTermPatternRows.filter(shouldIncludeNonRestrictedMemoryInSoul)) {
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
  const nonRestrictedDreamRows = dreamRows.filter((row) => !containsRawRestrictedContent(row.insightText ?? ""));
  if (nonRestrictedDreamRows.length > 0) {
    sections.push("## 5. Dream Insights");
    for (const d of nonRestrictedDreamRows) {
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
  for (const m of aspirationRows.filter(shouldIncludeNonRestrictedMemoryInSoul)) {
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

export async function regenerateSoul(userId: string, auditOptions?: SoulEditAuditOptions): Promise<SoulRecord> {
  const oldValue = await readSoulEditValue(userId, "content");
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
  await recordSoulEditAudit({
    userId,
    target: "content",
    oldValue,
    newValue: row?.content ?? content,
    options: auditOptions ?? { source: "soul_regeneration" },
  });
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
export async function setSoulContent(userId: string, content: string, auditOptions?: SoulEditAuditOptions): Promise<void> {
  const trimmed = content.trim();
  const now = new Date();
  const oldValue = await readSoulEditValue(userId, "content");
  await writeSoulEditValue(userId, "content", trimmed, now);
  await recordSoulEditAudit({
    userId,
    target: "content",
    oldValue,
    newValue: trimmed,
    options: auditOptions ?? { source: "soul_editor", approvedBy: userId },
  });
}

export async function setManualOverride(userId: string, override: string | null, auditOptions?: SoulEditAuditOptions): Promise<void> {
  const trimmed = override?.trim() || null;
  const now = new Date();
  const oldValue = await readSoulEditValue(userId, "manual_override");
  await writeSoulEditValue(userId, "manual_override", trimmed, now);
  await recordSoulEditAudit({
    userId,
    target: "manual_override",
    oldValue,
    newValue: trimmed,
    options: auditOptions ?? { source: "soul_editor", approvedBy: userId },
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
