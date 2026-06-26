import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import {
  MEMORY_CATEGORIES,
  MEMORY_TIERS,
  MEMORY_TYPES,
  memoryWorkingContext,
  userMemories,
  type MemoryCategory,
  type MemoryLifecycleState,
  type MemoryTier,
  type MemoryType,
} from "@shared/schema";

export const WORKING_CONTEXT_TTL_MS = 72 * 60 * 60 * 1000;
export const RECENT_CONTEXT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type MemoryWriteTrigger =
  | "working_context"
  | "explicit_remember"
  | "inferred"
  | "dream"
  | "diagnostic";

export type MemoryWriteDecisionStatus =
  | "auto_write_working_context"
  | "auto_write_memory"
  | "review_required"
  | "excluded"
  | "invalid";

export type MemorySensitivity = "normal" | "restricted_summary";

export interface MemoryProvenanceMetadata {
  sourceType: string;
  sourceRef?: string | null;
  sensitivity?: string;
  label?: string;
  restricted?: boolean;
}

export interface WorkingContextScope {
  scopeType: string;
  scopeId: string;
}

export interface WorkingContextRecordInput extends WorkingContextScope {
  userId: string;
  activeGoal?: string | null;
  currentStep?: string | null;
  lastEventId: string;
  content: string;
  now?: Date;
  ttlMs?: number;
}

export interface WorkingContextRecord extends WorkingContextScope {
  userId: string;
  activeGoal: string | null;
  currentStep: string | null;
  lastEventId: string;
  content: string;
  state: Extract<MemoryLifecycleState, "active" | "stale">;
  updatedAt: string;
  expiresAt: string;
}

export interface MemoryWriteInput {
  userId: string;
  content: string;
  trigger: MemoryWriteTrigger;
  category?: unknown;
  tier?: unknown;
  memoryType?: unknown;
  confidence?: unknown;
  sourceType?: unknown;
  sourceRef?: unknown;
  now?: Date;
  expiresAt?: Date | null;
  supersedesMemoryId?: string | null;
  reviewEnabled?: boolean;
  sensitivity?: unknown;
  provenance?: unknown;
  restrictedSummaryApproved?: boolean;
}

export interface PlannedMemoryRecord {
  userId: string;
  content: string;
  category: MemoryCategory;
  tier: MemoryTier;
  memoryType: MemoryType;
  confidence: number;
  sourceType: string;
  sourceRef: string | null;
  pendingReview: boolean;
  reviewStatus: MemoryLifecycleState;
  expiresAt: Date | null;
  supersedesMemoryId: string | null;
  sensitivity: MemorySensitivity;
  provenance: MemoryProvenanceMetadata[];
}

export interface MemoryWritePlan {
  status: MemoryWriteDecisionStatus;
  reason: string;
  userId: string;
  record: PlannedMemoryRecord | null;
  supersedeMemoryIds: string[];
  oneTimeReviewTip: boolean;
}

export interface MemoryWriteResult {
  status: MemoryWriteDecisionStatus;
  reason: string;
  insertedMemoryId: string | null;
  supersededMemoryIds: string[];
  oneTimeReviewTip: boolean;
}

export interface MemoryApprovalResolution {
  approvedMemoryId: string;
  supersedeMemoryIds: string[];
  correctedByMemoryId: string | null;
}

export interface ApprovedPendingMemoryWriteRow {
  id: string;
  supersedes_memory_id: string | null;
}

export interface ApprovedPendingMemoryWritesResult {
  approved: number;
  memoryIds: string[];
  supersededMemoryIds: string[];
}

export interface ExpiredWorkingContextRow extends WorkingContextScope {
  id: string;
  userId: string;
  activeGoal: string | null;
  currentStep: string | null;
  lastEventId: string;
  content: string;
  updatedAt: Date | string;
  claimUpdatedAt: Date | string;
  expiresAt: Date | string;
}

export interface CompactedWorkingContextResult {
  scanned: number;
  compacted: number;
  memoryIds: string[];
}

export interface MemoryWritePipelineDeps {
  insertUserMemory(record: PlannedMemoryRecord): Promise<{ id: string }>;
  markMemoriesSuperseded(userId: string, memoryIds: string[], correctedByMemoryId: string): Promise<number>;
}

export interface WorkingContextDeps {
  upsertWorkingContext(record: WorkingContextRecord): Promise<WorkingContextRecord>;
  listExpiredWorkingContext(now: Date, limit: number): Promise<ExpiredWorkingContextRow[]>;
  insertRecentContextMemory(record: PlannedMemoryRecord): Promise<{ id: string }>;
  markWorkingContextStale(id: string, memoryId: string, claimUpdatedAt: Date | string): Promise<void>;
}

const DIAGNOSTIC_SOURCE_PATTERN = /\b(diagnostic|diagnostics|self[_ -]?model|phone[_ -]?gemma[_ -]?diagnostic|test[_ -]?run)\b/i;
const RESTRICTED_SOURCE_TOKENS = [
  "bank",
  "banking",
  "bank_statement",
  "financial",
  "financial_record",
  "financial_transaction",
  "transaction",
  "plaid",
  "credit_card",
  "debit_card",
  "tax_document",
  "payroll",
  "brokerage",
  "account_balance",
  "restricted_source",
  "restricted_summary",
];
const RAW_RESTRICTED_CONTENT_PATTERNS = [
  /\b(?:account|routing|card|debit|credit)\s*(?:number|no\.?|#|ending)?\s*[:#-]?\s*(?:\d[\s-]?){4,}\b/i,
  /\b(?:ssn|social security)\b[\s\S]{0,40}\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/i,
  /\b(?:available|current|ending)\s+balance\b[\s\S]{0,80}\$?\d[\d,]*(?:\.\d{2})?\b/i,
  /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+.{2,}\s+[-+]?\$?\d[\d,]*(?:\.\d{2})?\s*$/m,
];

function cleanSingleLine(value: unknown, fallback = ""): string {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

function cleanContent(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeCategory(value: unknown): MemoryCategory {
  const raw = cleanSingleLine(value).toLowerCase();
  return (MEMORY_CATEGORIES as readonly string[]).includes(raw) ? (raw as MemoryCategory) : "fact";
}

function normalizeTier(value: unknown, fallback: MemoryTier): MemoryTier {
  const raw = cleanSingleLine(value).toLowerCase();
  return (MEMORY_TIERS as readonly string[]).includes(raw) ? (raw as MemoryTier) : fallback;
}

function normalizeMemoryType(value: unknown, fallback: MemoryType): MemoryType {
  const raw = cleanSingleLine(value).toLowerCase();
  return (MEMORY_TYPES as readonly string[]).includes(raw) ? (raw as MemoryType) : fallback;
}

function normalizeSensitivity(value: unknown): MemorySensitivity {
  const raw = cleanSingleLine(value).toLowerCase();
  return raw === "restricted_summary" ? "restricted_summary" : "normal";
}

function normalizeProvenance(value: unknown): MemoryProvenanceMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const sourceType = cleanSingleLine(record.sourceType ?? record.source_type ?? record.kind);
    if (!sourceType) return [];
    const sourceRef = cleanSingleLine(record.sourceRef ?? record.source_ref ?? record.id);
    const sensitivity = cleanSingleLine(record.sensitivity);
    const label = cleanSingleLine(record.label);
    return [{
      sourceType,
      sourceRef: sourceRef || null,
      sensitivity: sensitivity || undefined,
      label: label || undefined,
      restricted: Boolean(record.restricted),
    }];
  });
}

function isRestrictedSourceType(value: unknown): boolean {
  const normalized = cleanSingleLine(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return false;
  return RESTRICTED_SOURCE_TOKENS.some((token) =>
    normalized === token ||
    normalized.startsWith(`${token}_`) ||
    normalized.endsWith(`_${token}`) ||
    normalized.includes(`_${token}_`)
  );
}

function containsRawRestrictedContent(content: string): boolean {
  return RAW_RESTRICTED_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

function provenanceHasRestrictedSource(provenance: MemoryProvenanceMetadata[]): boolean {
  return provenance.some((item) =>
    item.restricted === true ||
    normalizeSensitivity(item.sensitivity) === "restricted_summary" ||
    isRestrictedSourceType(item.sourceType) ||
    isRestrictedSourceType(item.sourceRef)
  );
}

function isApprovedRestrictedSummary(input: MemoryWriteInput, sourceType: string): boolean {
  return input.restrictedSummaryApproved === true || sourceType === "restricted_summary";
}

function buildRestrictedProvenance(
  sourceType: string,
  sourceRef: string | null,
  provenance: MemoryProvenanceMetadata[],
): MemoryProvenanceMetadata[] {
  const refs = provenance.length > 0 ? provenance : [{
    sourceType: sourceType || "restricted_source",
    sourceRef,
  }];
  return refs.map((item) => ({
    ...item,
    sensitivity: "restricted_summary",
    restricted: true,
  }));
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function isDiagnosticWrite(input: MemoryWriteInput): boolean {
  if (input.trigger === "diagnostic") return true;
  const sourceType = cleanSingleLine(input.sourceType);
  const sourceRef = cleanSingleLine(input.sourceRef);
  return DIAGNOSTIC_SOURCE_PATTERN.test(sourceType) || DIAGNOSTIC_SOURCE_PATTERN.test(sourceRef);
}

export function buildWorkingContextRecord(input: WorkingContextRecordInput): WorkingContextRecord {
  const now = input.now ?? new Date();
  const userId = cleanSingleLine(input.userId);
  const scopeType = cleanSingleLine(input.scopeType, "global");
  const scopeId = cleanSingleLine(input.scopeId, "default");
  const lastEventId = cleanSingleLine(input.lastEventId);
  const content = cleanContent(input.content);
  const ttlMs = Math.max(1, input.ttlMs ?? WORKING_CONTEXT_TTL_MS);

  if (!userId) throw new Error("Working context requires a user id.");
  if (!lastEventId) throw new Error("Working context requires a last event id.");
  if (!content) throw new Error("Working context requires content.");

  return {
    userId,
    scopeType,
    scopeId,
    activeGoal: cleanSingleLine(input.activeGoal) || null,
    currentStep: cleanSingleLine(input.currentStep) || null,
    lastEventId,
    content,
    state: "active",
    updatedAt: now.toISOString(),
    expiresAt: addMs(now, ttlMs).toISOString(),
  };
}

export function planMemoryWrite(input: MemoryWriteInput): MemoryWritePlan {
  const userId = cleanSingleLine(input.userId);
  const content = cleanContent(input.content);
  const now = input.now ?? new Date();
  const inputSourceType = cleanSingleLine(input.sourceType);
  const inputSourceRef = cleanSingleLine(input.sourceRef) || null;
  const provenance = normalizeProvenance(input.provenance);
  const requestedSensitivity = normalizeSensitivity(input.sensitivity);
  const restrictedSource = isRestrictedSourceType(inputSourceType) ||
    isRestrictedSourceType(inputSourceRef) ||
    provenanceHasRestrictedSource(provenance) ||
    requestedSensitivity === "restricted_summary";
  const rawRestrictedContent = containsRawRestrictedContent(content);
  const approvedRestrictedSummary = isApprovedRestrictedSummary(input, inputSourceType);

  if (!userId) {
    return {
      status: "invalid",
      reason: "Memory write requires an authenticated user.",
      userId,
      record: null,
      supersedeMemoryIds: [],
      oneTimeReviewTip: false,
    };
  }

  if (!content) {
    return {
      status: "invalid",
      reason: "Memory write requires non-empty content.",
      userId,
      record: null,
      supersedeMemoryIds: [],
      oneTimeReviewTip: false,
    };
  }

  if (isDiagnosticWrite(input)) {
    return {
      status: "excluded",
      reason: "Diagnostics and tests are recorded in self-model telemetry, not user MemoryOS.",
      userId,
      record: null,
      supersedeMemoryIds: [],
      oneTimeReviewTip: false,
    };
  }

  if ((restrictedSource || rawRestrictedContent) && !approvedRestrictedSummary) {
    return {
      status: "excluded",
      reason: "Raw restricted-source records are excluded from normal MemoryOS. Store an approved high-level restricted summary instead.",
      userId,
      record: null,
      supersedeMemoryIds: [],
      oneTimeReviewTip: false,
    };
  }

  if (approvedRestrictedSummary && rawRestrictedContent) {
    return {
      status: "excluded",
      reason: "Approved restricted summaries must not include raw account, card, routing, balance, or transaction details.",
      userId,
      record: null,
      supersedeMemoryIds: [],
      oneTimeReviewTip: false,
    };
  }

  if (input.trigger === "working_context") {
    const sensitivity: MemorySensitivity = approvedRestrictedSummary ? "restricted_summary" : "normal";
    return {
      status: "auto_write_working_context",
      reason: "Working context is short-lived and can update without manual review.",
      userId,
      record: {
        userId,
        content,
        category: normalizeCategory(input.category),
        tier: "working",
        memoryType: "contextual",
        confidence: clampInt(input.confidence, 0, 100, 80),
        sourceType: cleanSingleLine(input.sourceType, "working_context"),
        sourceRef: cleanSingleLine(input.sourceRef) || null,
        pendingReview: false,
        reviewStatus: "active",
        expiresAt: input.expiresAt === undefined ? addMs(now, WORKING_CONTEXT_TTL_MS) : input.expiresAt,
        supersedesMemoryId: null,
        sensitivity,
        provenance: sensitivity === "restricted_summary"
          ? buildRestrictedProvenance(inputSourceType || "restricted_summary", inputSourceRef, provenance)
          : provenance,
      },
      supersedeMemoryIds: [],
      oneTimeReviewTip: false,
    };
  }

  const supersedesMemoryId = cleanSingleLine(input.supersedesMemoryId) || null;
  const reviewEnabled = input.reviewEnabled ?? true;
  const reviewRequired = reviewEnabled;
  const sourceType = approvedRestrictedSummary
    ? "restricted_summary"
    : reviewRequired && input.trigger === "explicit_remember"
      ? "explicit_remember"
      : cleanSingleLine(input.sourceType, input.trigger === "dream" ? "dream_cycle" : "manual");
  const sensitivity: MemorySensitivity = approvedRestrictedSummary ? "restricted_summary" : "normal";
  const reason = reviewRequired
    ? input.trigger === "explicit_remember"
      ? "Explicit long-term memories are queued for user review before they become active."
      : "Inferred or synthesized memories require review before they become active."
    : "Memory Review is disabled, so this memory is stored as active immediately.";

  return {
    status: reviewRequired ? "review_required" : "auto_write_memory",
    reason,
    userId,
    record: {
      userId,
      content,
      category: normalizeCategory(input.category),
      tier: normalizeTier(input.tier, "long_term"),
      memoryType: normalizeMemoryType(input.memoryType, "semantic"),
      confidence: clampInt(input.confidence, 0, 100, input.trigger === "explicit_remember" ? 95 : 80),
      sourceType,
      sourceRef: cleanSingleLine(input.sourceRef) || null,
      pendingReview: reviewRequired,
      reviewStatus: reviewRequired ? "pending" : "active",
      expiresAt: input.expiresAt ?? null,
      supersedesMemoryId,
      sensitivity,
      provenance: sensitivity === "restricted_summary"
        ? buildRestrictedProvenance(inputSourceType || sourceType, inputSourceRef, provenance)
        : provenance,
    },
    supersedeMemoryIds: supersedesMemoryId ? [supersedesMemoryId] : [],
    oneTimeReviewTip: reviewRequired && input.trigger === "explicit_remember",
  };
}

export function buildRecentContextMemory(row: ExpiredWorkingContextRow, now = new Date()): PlannedMemoryRecord {
  const date = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  const updatedAt = Number.isFinite(date.getTime()) ? date.toISOString() : now.toISOString();
  const scope = `${row.scopeType}:${row.scopeId}`;
  const content = [
    `Recent ${row.scopeType} context from ${updatedAt}: ${row.content}`,
    row.activeGoal ? `Active goal: ${row.activeGoal}` : "",
    row.currentStep ? `Current step: ${row.currentStep}` : "",
  ].filter(Boolean).join("\n");

  return {
    userId: row.userId,
    content,
    category: "fact",
    tier: "short_term",
    memoryType: "contextual",
    confidence: 75,
    sourceType: "working_context",
    sourceRef: `${scope}:${row.lastEventId}`,
    pendingReview: false,
    reviewStatus: "active",
    expiresAt: addMs(now, RECENT_CONTEXT_TTL_MS),
    supersedesMemoryId: null,
    sensitivity: "normal",
    provenance: [{
      sourceType: "working_context",
      sourceRef: `${scope}:${row.lastEventId}`,
      label: row.scopeType,
    }],
  };
}

export function buildMemoryApprovalResolution(input: {
  approvedMemoryId: string;
  supersedesMemoryId?: string | null;
}): MemoryApprovalResolution {
  const approvedMemoryId = cleanSingleLine(input.approvedMemoryId);
  const supersedesMemoryId = cleanSingleLine(input.supersedesMemoryId);
  return {
    approvedMemoryId,
    supersedeMemoryIds: approvedMemoryId && supersedesMemoryId ? [supersedesMemoryId] : [],
    correctedByMemoryId: approvedMemoryId || null,
  };
}

export function buildApprovedMemorySupersessions(
  rows: ApprovedPendingMemoryWriteRow[],
): Array<{ approvedMemoryId: string; supersedesMemoryId: string }> {
  return rows.flatMap((row) => {
    const approvedMemoryId = cleanSingleLine(row.id);
    const supersedesMemoryId = cleanSingleLine(row.supersedes_memory_id);
    if (!approvedMemoryId || !supersedesMemoryId) return [];
    return [{ approvedMemoryId, supersedesMemoryId }];
  });
}

async function refreshApprovedMemoryEmbedding(
  userId: string,
  memoryId: string,
  content: string,
): Promise<void> {
  let refreshed = false;
  try {
    const { backfillEmbedding } = await import("./retrieve");
    refreshed = await backfillEmbedding(memoryId, content);
  } catch (error) {
    console.warn("[MemoryWritePipeline] approved memory embedding refresh failed:", error);
  }

  if (refreshed) return;

  await db.execute(sql`
    UPDATE user_memories
    SET embedding = NULL,
        embedding_vector = NULL
    WHERE id = ${memoryId}
      AND user_id = ${userId}
  `).catch((error) => {
    console.warn("[MemoryWritePipeline] stale embedding clear failed:", error);
  });
}

export async function applyMemoryWritePlan(
  plan: MemoryWritePlan,
  deps: MemoryWritePipelineDeps = defaultMemoryWriteDeps,
): Promise<MemoryWriteResult> {
  if (!plan.record) {
    return {
      status: plan.status,
      reason: plan.reason,
      insertedMemoryId: null,
      supersededMemoryIds: [],
      oneTimeReviewTip: plan.oneTimeReviewTip,
    };
  }

  const inserted = await deps.insertUserMemory(plan.record);
  const superseded = plan.status === "review_required"
    ? []
    : plan.supersedeMemoryIds;
  if (superseded.length > 0) {
    await deps.markMemoriesSuperseded(plan.userId, superseded, inserted.id);
  }

  return {
    status: plan.status,
    reason: plan.reason,
    insertedMemoryId: inserted.id,
    supersededMemoryIds: superseded,
    oneTimeReviewTip: plan.oneTimeReviewTip,
  };
}

export async function writeMemoryThroughPipeline(
  input: MemoryWriteInput,
  deps: MemoryWritePipelineDeps = defaultMemoryWriteDeps,
): Promise<MemoryWriteResult> {
  return applyMemoryWritePlan(planMemoryWrite(input), deps);
}

export async function upsertWorkingContext(
  input: WorkingContextRecordInput,
  deps: Pick<WorkingContextDeps, "upsertWorkingContext"> = defaultWorkingContextDeps,
): Promise<WorkingContextRecord> {
  const record = buildWorkingContextRecord(input);
  return deps.upsertWorkingContext(record);
}

export async function compactExpiredWorkingContext(
  input: { now?: Date; limit?: number } = {},
  deps: WorkingContextDeps = defaultWorkingContextDeps,
): Promise<CompactedWorkingContextResult> {
  const now = input.now ?? new Date();
  const rows = await deps.listExpiredWorkingContext(now, Math.max(1, Math.min(input.limit ?? 100, 500)));
  const memoryIds: string[] = [];

  for (const row of rows) {
    const recent = buildRecentContextMemory(row, now);
    const inserted = await deps.insertRecentContextMemory(recent);
    await deps.markWorkingContextStale(row.id, inserted.id, row.claimUpdatedAt);
    memoryIds.push(inserted.id);
  }

  return {
    scanned: rows.length,
    compacted: memoryIds.length,
    memoryIds,
  };
}

export async function approvePendingMemoryWrite(input: {
  userId: string;
  memoryId: string;
  status: Extract<MemoryLifecycleState, "kept" | "edited">;
  updatedContent?: string | null;
}): Promise<{ approved: boolean; supersededMemoryId: string | null }> {
  const content = cleanContent(input.updatedContent);
  const setContent = content ? sql`, content = ${content}` : sql``;
  const result = await db.execute<{ id: string; supersedes_memory_id: string | null }>(sql`
    UPDATE user_memories
    SET pending_review = FALSE,
        review_status = ${input.status}
        ${setContent}
    WHERE id = ${input.memoryId}
      AND user_id = ${input.userId}
      AND pending_review = TRUE
      AND review_status = 'pending'
    RETURNING id, supersedes_memory_id
  `);
  const row = (result.rows ?? [])[0];
  if (!row) return { approved: false, supersededMemoryId: null };

  if (content) {
    await refreshApprovedMemoryEmbedding(input.userId, row.id, content);
  }

  const [supersession] = buildApprovedMemorySupersessions([row]);
  if (supersession) {
    await defaultMemoryWriteDeps.markMemoriesSuperseded(
      input.userId,
      [supersession.supersedesMemoryId],
      supersession.approvedMemoryId,
    );
  }

  return { approved: true, supersededMemoryId: row.supersedes_memory_id ?? null };
}

export async function keepPendingMemoryWrites(input: {
  userId: string;
  memoryIds?: string[] | null;
}): Promise<ApprovedPendingMemoryWritesResult> {
  const userId = cleanSingleLine(input.userId);
  const memoryIds = input.memoryIds?.map((id) => cleanSingleLine(id)).filter(Boolean) ?? null;
  if (!userId || (memoryIds && memoryIds.length === 0)) {
    return { approved: 0, memoryIds: [], supersededMemoryIds: [] };
  }

  const result = memoryIds
    ? await db.execute<ApprovedPendingMemoryWriteRow>(sql`
      UPDATE user_memories
      SET pending_review = FALSE,
          review_status = 'kept'
      WHERE user_id = ${userId}
        AND id = ANY(${memoryIds}::varchar[])
        AND pending_review = TRUE
        AND review_status = 'pending'
      RETURNING id, supersedes_memory_id
    `)
    : await db.execute<ApprovedPendingMemoryWriteRow>(sql`
      UPDATE user_memories
      SET pending_review = FALSE,
          review_status = 'kept'
      WHERE user_id = ${userId}
        AND pending_review = TRUE
        AND review_status = 'pending'
      RETURNING id, supersedes_memory_id
    `);

  const rows = result.rows ?? [];
  const supersessions = buildApprovedMemorySupersessions(rows);
  for (const supersession of supersessions) {
    await defaultMemoryWriteDeps.markMemoriesSuperseded(
      userId,
      [supersession.supersedesMemoryId],
      supersession.approvedMemoryId,
    );
  }

  return {
    approved: rows.length,
    memoryIds: rows.map((row) => row.id),
    supersededMemoryIds: supersessions.map((item) => item.supersedesMemoryId),
  };
}

export const defaultMemoryWriteDeps: MemoryWritePipelineDeps = {
  async insertUserMemory(record) {
    const [inserted] = await db.insert(userMemories).values({
      userId: record.userId,
      content: record.content,
      category: record.category,
      confidence: record.confidence,
      relevanceScore: record.tier === "long_term" ? 75 : 55,
      sourceType: record.sourceType,
      sourceRef: record.sourceRef,
      tier: record.tier,
      memoryType: record.memoryType,
      expiresAt: record.expiresAt ?? undefined,
      pendingReview: record.pendingReview,
      reviewStatus: record.reviewStatus,
      supersedesMemoryId: record.supersedesMemoryId,
      sensitivity: record.sensitivity,
      provenance: record.provenance,
    }).returning({ id: userMemories.id });
    return { id: inserted.id };
  },
  async markMemoriesSuperseded(userId, memoryIds, correctedByMemoryId) {
    if (memoryIds.length === 0) return 0;
    const result = await db.execute(sql`
      UPDATE user_memories
      SET review_status = 'superseded',
          corrected_by_memory_id = ${correctedByMemoryId}
      WHERE user_id = ${userId}
        AND id = ANY(${memoryIds}::varchar[])
        AND review_status IN ('active', 'kept', 'edited')
      RETURNING id
    `);
    return (result.rows ?? []).length;
  },
};

export const defaultWorkingContextDeps: WorkingContextDeps = {
  async upsertWorkingContext(record) {
    const [row] = await db.insert(memoryWorkingContext).values({
      userId: record.userId,
      scopeType: record.scopeType,
      scopeId: record.scopeId,
      activeGoal: record.activeGoal,
      currentStep: record.currentStep,
      lastEventId: record.lastEventId,
      content: record.content,
      state: record.state,
      updatedAt: new Date(record.updatedAt),
      expiresAt: new Date(record.expiresAt),
    }).onConflictDoUpdate({
      target: [
        memoryWorkingContext.userId,
        memoryWorkingContext.scopeType,
        memoryWorkingContext.scopeId,
      ],
      set: {
        activeGoal: record.activeGoal,
        currentStep: record.currentStep,
        lastEventId: record.lastEventId,
        content: record.content,
        state: "active",
        compactedMemoryId: null,
        updatedAt: new Date(record.updatedAt),
        expiresAt: new Date(record.expiresAt),
      },
    }).returning({
      userId: memoryWorkingContext.userId,
      scopeType: memoryWorkingContext.scopeType,
      scopeId: memoryWorkingContext.scopeId,
      activeGoal: memoryWorkingContext.activeGoal,
      currentStep: memoryWorkingContext.currentStep,
      lastEventId: memoryWorkingContext.lastEventId,
      content: memoryWorkingContext.content,
      state: memoryWorkingContext.state,
      updatedAt: memoryWorkingContext.updatedAt,
      expiresAt: memoryWorkingContext.expiresAt,
    });

    return {
      userId: row.userId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      activeGoal: row.activeGoal,
      currentStep: row.currentStep,
      lastEventId: row.lastEventId,
      content: row.content,
      state: row.state === "stale" ? "stale" : "active",
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  },
  async listExpiredWorkingContext(now, limit) {
    const result = await db.execute<{
      id: string;
      user_id: string;
      scope_type: string;
      scope_id: string;
      active_goal: string | null;
      current_step: string | null;
      last_event_id: string;
      content: string;
      context_updated_at: Date | string;
      claim_updated_at: Date | string;
      expires_at: Date | string;
    }>(sql`
      WITH candidates AS (
        SELECT id, updated_at AS original_updated_at
        FROM memory_working_context
        WHERE expires_at <= ${now}
          AND (
            state = 'active'
            OR (state = 'compacting' AND updated_at < NOW() - INTERVAL '15 minutes')
          )
        ORDER BY expires_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE memory_working_context AS wc
      SET state = 'compacting',
          updated_at = ${now}
      FROM candidates
      WHERE wc.id = candidates.id
      RETURNING wc.id, wc.user_id, wc.scope_type, wc.scope_id, wc.active_goal,
                wc.current_step, wc.last_event_id, wc.content,
                candidates.original_updated_at AS context_updated_at,
                wc.updated_at AS claim_updated_at,
                wc.expires_at
    `);
    return (result.rows ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      activeGoal: row.active_goal,
      currentStep: row.current_step,
      lastEventId: row.last_event_id,
      content: row.content,
      updatedAt: row.context_updated_at,
      claimUpdatedAt: row.claim_updated_at,
      expiresAt: row.expires_at,
    }));
  },
  async insertRecentContextMemory(record) {
    const inserted = await defaultMemoryWriteDeps.insertUserMemory(record);
    try {
      const { backfillEmbedding } = await import("./retrieve");
      await backfillEmbedding(inserted.id, record.content);
    } catch (error) {
      console.warn("[MemoryWritePipeline] recent context embedding backfill failed:", error);
    }
    return inserted;
  },
  async markWorkingContextStale(id, memoryId, claimUpdatedAt) {
    const claimUpdatedAtDate = claimUpdatedAt instanceof Date ? claimUpdatedAt : new Date(claimUpdatedAt);
    await db.update(memoryWorkingContext)
      .set({
        state: "stale",
        compactedMemoryId: memoryId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(memoryWorkingContext.id, id),
        eq(memoryWorkingContext.state, "compacting"),
        eq(memoryWorkingContext.updatedAt, claimUpdatedAtDate),
      ));
  },
};
