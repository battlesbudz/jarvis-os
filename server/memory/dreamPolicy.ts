import { containsRawRestrictedContent } from "./restrictedContent";
import type { MemoryProvenanceMetadata } from "./writePipeline";

export const DREAM_MEMORY_REVIEW_DEEP_LINK = "jarvis://profile?focus=memory_review";
export const DREAM_CAPABILITY_REVIEW_DEEP_LINK = "jarvis://inbox?focus=deliverables";

export type DreamInsightKind = "insight" | "memory_candidate" | "capability_proposal";

export interface NormalizedDreamInsight {
  insight: string;
  confidence: number;
  sourceHints: string[];
  kind: DreamInsightKind;
  category?: string;
  memoryType?: "semantic" | "procedural" | "episodic" | "contextual";
}

export interface DreamMemoryPromotionInput {
  insight: string;
  confidence: number;
  sourceHints: string[];
  kind: DreamInsightKind;
}

export interface DreamReviewPayload {
  memoryReview?: {
    status: "pending" | "auto_kept" | "excluded" | "failed";
    memoryId?: string | null;
    deepLink: string;
    reason?: string;
  };
  capabilityReview?: {
    status: "pending_approval" | "failed";
    deliverableId?: string | null;
    deepLink: string;
    reason?: string;
  };
  sourceHints?: string[];
}

const SENSITIVE_OR_PRIVATE_PATTERNS = [
  /\b(password|passcode|api[\s_-]*key|secret|token|credential|private key|seed phrase|oauth)\b/i,
  /\b(ssn|social security|credit card|debit card|routing number|bank account|tax return|irs)\b/i,
  /\b(diagnosis|diagnosed|prescription|medication|therapy|therapist|medical|symptom)\b/i,
  /\b(lawsuit|sue|attorney|lawyer|contract|nda|legal|compliance)\b/i,
  /\b(husband|wife|girlfriend|boyfriend|partner|dating|married|divorced|pregnant)\b/i,
];

const CONTRADICTION_PATTERNS = [
  /\bcontradict(s|ed|ion)?\b/i,
  /\bconflict(s|ed|ing)?\b/i,
  /\bsupersed(es|ed|ing)?\b/i,
  /\bchanged (their|his|her|my) mind\b/i,
  /\bno longer\b/i,
  /\bnot generally\b/i,
  /\bcorrection\b/i,
];

const ABSTRACT_PATTERNS = [
  /\bmaybe\b/i,
  /\bmight\b/i,
  /\bcould\b/i,
  /\bperhaps\b/i,
  /\bseems?\b/i,
  /\bmay indicate\b/i,
  /\bunclear\b/i,
];

const CAPABILITY_PATTERNS = [
  /\bcapability gap\b/i,
  /\bmissing (tool|capability|integration)\b/i,
  /\bneeds? (a )?(new )?(tool|capability|integration)\b/i,
  /\bshould (build|add|create) (a )?(tool|capability|integration)\b/i,
  /\bjarvis (could not|couldn't|cannot|can't) (handle|access|open|connect|complete)\b/i,
];

function cleanString(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanHints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((hint) => cleanString(hint))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 70;
  return Math.max(50, Math.min(100, Math.round(numeric)));
}

export function inferDreamInsightKind(input: { kind?: unknown; insight: string }): DreamInsightKind {
  const rawKind = cleanString(input.kind).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (rawKind === "capability_proposal" || rawKind === "capability_gap") return "capability_proposal";
  if (rawKind === "memory_candidate" || rawKind === "memory") return "memory_candidate";
  if (rawKind === "insight") return "insight";
  return CAPABILITY_PATTERNS.some((pattern) => pattern.test(input.insight))
    ? "capability_proposal"
    : "memory_candidate";
}

export function normalizeDreamInsight(raw: unknown): NormalizedDreamInsight | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const insight = cleanString(record.insight ?? record.content ?? record.text);
  if (!insight) return null;
  const kind = inferDreamInsightKind({ kind: record.kind, insight });
  const memoryTypeRaw = cleanString(record.memory_type ?? record.memoryType).toLowerCase();
  const memoryType = ["semantic", "procedural", "episodic", "contextual"].includes(memoryTypeRaw)
    ? memoryTypeRaw as NormalizedDreamInsight["memoryType"]
    : undefined;
  const category = cleanString(record.category).toLowerCase() || undefined;
  return {
    insight,
    confidence: normalizeConfidence(record.confidence),
    sourceHints: cleanHints(record.sourceHints ?? record.source_hints ?? record.evidence),
    kind,
    category,
    memoryType,
  };
}

export function shouldAutoPromoteDreamMemory(input: DreamMemoryPromotionInput): boolean {
  if (input.kind !== "memory_candidate") return false;
  if (input.confidence < 90) return false;
  if (input.sourceHints.length < 2) return false;
  if (containsRawRestrictedContent(input.insight)) return false;
  if (SENSITIVE_OR_PRIVATE_PATTERNS.some((pattern) => pattern.test(input.insight))) return false;
  if (CONTRADICTION_PATTERNS.some((pattern) => pattern.test(input.insight))) return false;
  if (ABSTRACT_PATTERNS.some((pattern) => pattern.test(input.insight))) return false;
  return true;
}

export function buildDreamMemoryProvenance(input: {
  dreamDate: string;
  sourceHints: string[];
  sourceMemoryIds: string[];
}): MemoryProvenanceMetadata[] {
  const refs: MemoryProvenanceMetadata[] = [{
    sourceType: "dream_cycle",
    sourceRef: input.dreamDate,
    label: "Nightly dream synthesis",
  }];
  for (const hint of input.sourceHints.slice(0, 5)) {
    refs.push({
      sourceType: "dream_evidence",
      sourceRef: hint.slice(0, 160),
      label: "Dream evidence",
    });
  }
  for (const id of input.sourceMemoryIds.slice(0, 10)) {
    refs.push({
      sourceType: "user_memory",
      sourceRef: id,
      label: "Source memory",
    });
  }
  return refs;
}

export function buildDreamDeliveryMessage(insights: Array<{
  insightText: string;
  insightKind?: string | null;
  reviewPayload?: unknown;
}>): string {
  const insightLines = insights
    .map((ins, i) => `${i + 1}. ${ins.insightText}`)
    .join("\n\n");

  let pendingMemoryReview = 0;
  let autoKeptMemory = 0;
  let capabilityProposals = 0;

  for (const ins of insights) {
    const payload = ins.reviewPayload && typeof ins.reviewPayload === "object"
      ? ins.reviewPayload as DreamReviewPayload
      : {};
    if (payload.memoryReview?.status === "pending") pendingMemoryReview += 1;
    if (payload.memoryReview?.status === "auto_kept") autoKeptMemory += 1;
    if (payload.capabilityReview?.status === "pending_approval") capabilityProposals += 1;
  }

  const sections = [
    "Jarvis dreamed about you",
    insightLines,
    "(Synthesised from MemoryOS, recent context, working context, diagnostics, and task history.)",
  ];

  if (autoKeptMemory > 0) {
    sections.push(`${autoKeptMemory} high-confidence memory ${autoKeptMemory === 1 ? "was" : "were"} kept automatically. You can edit or delete saved memories from MemoryOS.`);
  }
  if (pendingMemoryReview > 0) {
    sections.push(`${pendingMemoryReview} memory ${pendingMemoryReview === 1 ? "candidate is" : "candidates are"} waiting in Memory Review: ${DREAM_MEMORY_REVIEW_DEEP_LINK}`);
  }
  if (capabilityProposals > 0) {
    sections.push(`${capabilityProposals} capability ${capabilityProposals === 1 ? "proposal is" : "proposals are"} waiting for review: ${DREAM_CAPABILITY_REVIEW_DEEP_LINK}`);
  }

  return sections.filter(Boolean).join("\n\n");
}
