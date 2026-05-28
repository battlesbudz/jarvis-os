export type MemoryTrustStatus = "pending" | "active" | "edited" | "rejected";

export interface MemoryTrustRecordInput {
  id?: string;
  content?: string;
  category?: string | null;
  memoryType?: string | null;
  memory_type?: string | null;
  tier?: string | null;
  confidence?: number | null;
  relevanceScore?: number | null;
  relevance_score?: number | null;
  sourceType?: string | null;
  source_type?: string | null;
  sourceRef?: string | null;
  source_ref?: string | null;
  pendingReview?: boolean | null;
  pending_review?: boolean | null;
  reviewStatus?: string | null;
  review_status?: string | null;
  extractedAt?: Date | string | null;
  extracted_at?: Date | string | null;
  lastReferencedAt?: Date | string | null;
  last_referenced_at?: Date | string | null;
}

export interface MemoryTrustRecord {
  id: string;
  content: string;
  status: MemoryTrustStatus;
  category: string;
  tier: string;
  memoryType: string;
  confidence: number;
  relevance: number;
  source: {
    type: string;
    ref: string | null;
    extractedAt: string | null;
    lastReferencedAt: string | null;
  };
  whyJarvisLearnedIt: string;
}

export interface MemoryTrustSummary {
  memories: MemoryTrustRecord[];
  counts: Record<MemoryTrustStatus, number>;
  buckets: Record<MemoryTrustStatus, MemoryTrustRecord[]>;
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function determineStatus(row: MemoryTrustRecordInput): MemoryTrustStatus {
  const reviewStatus = String(row.reviewStatus ?? row.review_status ?? "").toLowerCase();
  const pendingReview = row.pendingReview ?? row.pending_review ?? false;
  if (reviewStatus === "discarded" || reviewStatus === "rejected") return "rejected";
  if (reviewStatus === "edited") return "edited";
  if (reviewStatus === "pending" || pendingReview) return "pending";
  return "active";
}

function explainSource(sourceType: string, sourceRef: string | null, confidence: number): string {
  const sourceLabel = sourceType.replace(/_/g, " ") || "unknown source";
  const ref = sourceRef ? ` (${sourceRef})` : "";
  if (sourceType === "manual") {
    return `Jarvis learned this from a manual memory entry${ref} with ${confidence}% confidence.`;
  }
  if (sourceType.includes("email")) {
    return `Jarvis learned this from email context${ref} with ${confidence}% confidence.`;
  }
  if (sourceType.includes("calendar")) {
    return `Jarvis learned this from calendar context${ref} with ${confidence}% confidence.`;
  }
  if (sourceType.includes("dream") || sourceType.includes("pattern")) {
    return `Jarvis learned this from pattern synthesis${ref} with ${confidence}% confidence.`;
  }
  if (sourceType.includes("chat") || sourceType.includes("conversation")) {
    return `Jarvis learned this from conversation context${ref} with ${confidence}% confidence.`;
  }
  return `Jarvis learned this from ${sourceLabel}${ref} with ${confidence}% confidence.`;
}

export function normalizeMemoryTrustRecord(row: MemoryTrustRecordInput): MemoryTrustRecord {
  const confidence = coerceNumber(row.confidence, 70);
  const sourceType = String(row.sourceType ?? row.source_type ?? "manual");
  const sourceRef = (row.sourceRef ?? row.source_ref ?? null) || null;
  return {
    id: String(row.id ?? ""),
    content: String(row.content ?? ""),
    status: determineStatus(row),
    category: String(row.category ?? "fact"),
    tier: String(row.tier ?? "long_term"),
    memoryType: String(row.memoryType ?? row.memory_type ?? "semantic"),
    confidence,
    relevance: coerceNumber(row.relevanceScore ?? row.relevance_score, 50),
    source: {
      type: sourceType,
      ref: sourceRef,
      extractedAt: toIso(row.extractedAt ?? row.extracted_at),
      lastReferencedAt: toIso(row.lastReferencedAt ?? row.last_referenced_at),
    },
    whyJarvisLearnedIt: explainSource(sourceType, sourceRef, confidence),
  };
}

export function buildMemoryTrustSummary(rows: MemoryTrustRecordInput[]): MemoryTrustSummary {
  const memories = rows.map(normalizeMemoryTrustRecord);
  const buckets: Record<MemoryTrustStatus, MemoryTrustRecord[]> = {
    pending: [],
    active: [],
    edited: [],
    rejected: [],
  };
  for (const memory of memories) {
    buckets[memory.status].push(memory);
  }
  return {
    memories,
    counts: {
      pending: buckets.pending.length,
      active: buckets.active.length,
      edited: buckets.edited.length,
      rejected: buckets.rejected.length,
    },
    buckets,
  };
}
