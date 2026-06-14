import { JarvisEventSchema, redactRuntimeValue, type JarvisEvent, type RuntimeRiskTier } from "../protocol";
import {
  buildMemoryCorrectionReview,
  type MemoryCorrectionReview,
  type MemoryProvenanceRef,
} from "../../memory/memoryOs";

export type RuntimeMemoryCalibrationStatus = "review_required" | "invalid";
export type RuntimeMemoryCalibrationOperation = "correct_existing_memory" | "propose_new_memory";
export type RuntimeMemoryConfidenceScale = "ratio" | "percent" | "unknown";

export interface RuntimeMemoryCalibrationMemory {
  id?: string | null;
  content?: string | null;
  category?: string | null;
  memoryType?: string | null;
  confidence?: number | null;
  confidenceScale?: RuntimeMemoryConfidenceScale;
  sourceRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RuntimeMemoryCalibrationCorrection {
  content: string;
  reason?: string | null;
  confidence?: number | null;
  confidenceScale?: RuntimeMemoryConfidenceScale;
  source?: "user" | "system" | "runtime_preview";
  metadata?: Record<string, unknown>;
}

export interface RuntimeMemoryCalibrationInput {
  event: unknown;
  currentMemory?: RuntimeMemoryCalibrationMemory | null;
  correction: RuntimeMemoryCalibrationCorrection;
  createdAt?: string;
}

export interface RuntimeMemoryConfidence {
  raw: number;
  scale: RuntimeMemoryConfidenceScale;
  normalized: number;
}

export interface RuntimeMemoryCalibrationPreview {
  previewId: string;
  eventId: string;
  userId: string;
  operation: RuntimeMemoryCalibrationOperation;
  status: RuntimeMemoryCalibrationStatus;
  riskTier: RuntimeRiskTier;
  approvalRequired: true;
  writeAllowed: false;
  currentMemory: {
    id: string | null;
    content: string | null;
    category: string | null;
    memoryType: string | null;
    confidence: RuntimeMemoryConfidence | null;
    sourceRef: string | null;
    metadata: Record<string, unknown>;
  } | null;
  proposedMemory: {
    content: string;
    reason: string | null;
    confidence: RuntimeMemoryConfidence | null;
    source: RuntimeMemoryCalibrationCorrection["source"];
    metadata: Record<string, unknown>;
  };
  memoryOsCorrection: MemoryCorrectionReview;
  reviewReasons: string[];
  errors: string[];
  createdAt: string;
}

export interface PersistRuntimeMemoryCalibrationDeps {
  writePreview?: (preview: RuntimeMemoryCalibrationPreview) => Promise<void> | void;
}

export interface PersistRuntimeMemoryCalibrationResult {
  persisted: boolean;
  preview: RuntimeMemoryCalibrationPreview;
  reason: string;
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeConfidence(value: number | null | undefined, scale?: RuntimeMemoryConfidenceScale): RuntimeMemoryConfidence | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;

  const inferredScale = scale && scale !== "unknown" ? scale : value > 1 ? "percent" : "ratio";
  const normalized = inferredScale === "percent" ? clamp(value / 100) : clamp(value);

  return {
    raw: value,
    scale: inferredScale,
    normalized,
  };
}

function redactedRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return redactRuntimeValue(value ?? {}) as Record<string, unknown>;
}

function buildCurrentMemory(memory: RuntimeMemoryCalibrationMemory | null | undefined): RuntimeMemoryCalibrationPreview["currentMemory"] {
  if (!memory) return null;

  return {
    id: memory.id ?? null,
    content: memory.content ?? null,
    category: memory.category ?? null,
    memoryType: memory.memoryType ?? null,
    confidence: normalizeConfidence(memory.confidence, memory.confidenceScale),
    sourceRef: memory.sourceRef ?? null,
    metadata: redactedRecord(memory.metadata),
  };
}

function memoryOsProvenance(input: {
  event: JarvisEvent;
  currentMemory: RuntimeMemoryCalibrationPreview["currentMemory"];
}): MemoryProvenanceRef[] {
  const refs: MemoryProvenanceRef[] = [
    {
      kind: "runtime_event",
      id: input.event.eventId,
      source: "runtime",
      label: input.event.channel ?? input.event.source,
    },
  ];

  if (input.currentMemory?.id) {
    refs.push({
      kind: "user_memory",
      id: input.currentMemory.id,
      source: "canonical",
      label: input.currentMemory.category ?? input.currentMemory.memoryType ?? "runtime_memory_calibration",
    });
  }

  return refs;
}

function reviewReasons(input: {
  event: JarvisEvent;
  currentMemory: RuntimeMemoryCalibrationPreview["currentMemory"];
  proposedContent: string;
}): string[] {
  const reasons = [
    "Memory correction changes durable user context and must pass existing memory review/write controls.",
    "Core Runtime v0.2 preview is storage-neutral and cannot write canonical memory directly.",
  ];

  if (!input.currentMemory) {
    reasons.push("No existing memory id was supplied, so this is a proposed new memory rather than an in-place correction.");
  }
  if (input.proposedContent !== input.proposedContent.trim()) {
    reasons.push("Proposed memory content includes surrounding whitespace and should be normalized by the existing memory owner.");
  }
  if (input.event.source !== "app" && input.event.source !== "system") {
    reasons.push(`Correction came from ${input.event.source} and should preserve channel provenance.`);
  }

  return reasons;
}

export function buildRuntimeMemoryCalibrationPreview(input: RuntimeMemoryCalibrationInput): RuntimeMemoryCalibrationPreview {
  const event = JarvisEventSchema.parse(input.event);
  const currentMemory = buildCurrentMemory(input.currentMemory);
  const content = input.correction.content;
  const trimmedContent = content.trim();
  const errors = trimmedContent ? [] : ["Memory correction content is required."];
  const createdAt = input.createdAt ?? event.createdAt;
  const previewId = `runtime-memory-calibration-${event.eventId}`;
  const operation: RuntimeMemoryCalibrationOperation = currentMemory?.id ? "correct_existing_memory" : "propose_new_memory";
  const proposedConfidence = normalizeConfidence(input.correction.confidence, input.correction.confidenceScale);
  const memoryOsCorrection = buildMemoryCorrectionReview({
    userId: event.userId,
    operation,
    proposedContent: trimmedContent,
    reason: input.correction.reason ?? null,
    confidence: proposedConfidence?.normalized ?? null,
    currentMemoryId: currentMemory?.id ?? null,
    currentMemoryContent: currentMemory?.content ?? null,
    source: {
      kind: "runtime_memory_calibration",
      eventId: event.eventId,
      eventSource: event.source,
      channel: event.channel ?? null,
      previewId,
      createdAt,
    },
    provenance: memoryOsProvenance({ event, currentMemory }),
  });

  return {
    previewId,
    eventId: event.eventId,
    userId: event.userId,
    operation,
    status: errors.length > 0 ? "invalid" : "review_required",
    riskTier: "T2",
    approvalRequired: true,
    writeAllowed: false,
    currentMemory,
    proposedMemory: {
      content: trimmedContent,
      reason: input.correction.reason ?? null,
      confidence: proposedConfidence,
      source: input.correction.source ?? "user",
      metadata: redactedRecord(input.correction.metadata),
    },
    memoryOsCorrection,
    reviewReasons: reviewReasons({ event, currentMemory, proposedContent: content }),
    errors,
    createdAt,
  };
}

export async function persistRuntimeMemoryCalibrationPreview(
  preview: RuntimeMemoryCalibrationPreview,
  deps: PersistRuntimeMemoryCalibrationDeps = {},
): Promise<PersistRuntimeMemoryCalibrationResult> {
  if (!deps.writePreview) {
    return {
      persisted: false,
      preview,
      reason: "No runtime memory calibration writer configured.",
    };
  }

  await deps.writePreview(preview);
  return {
    persisted: true,
    preview,
    reason: "Runtime memory calibration writer accepted preview.",
  };
}
