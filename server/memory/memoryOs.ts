import { createHmac } from "node:crypto";

import type { RetrievedMemory } from "./retrieve";
import { containsRawRestrictedContent } from "./restrictedContent";

export type MemoryOsCaller =
  | "memory_search"
  | "memory_get"
  | "coach_context"
  | "daily_command"
  | "agent_sdk_context"
  | "gbrain_retrieval"
  | "runtime_memory_inspection"
  | "other";

export type MemoryProvenanceRef = {
  kind: "user_memory" | "brain_chunk" | "hot_state" | "runtime_event";
  id: string;
  source: "canonical" | "gbrain" | "hot_state" | "runtime";
  label?: string;
};

export type MemoryCorrectionOperation = "correct_existing_memory" | "propose_new_memory";
export type MemoryCorrectionStatus = "review_required" | "invalid";
export type MemoryModelTarget = "runtime" | "local" | "cloud";

export type MemoryCorrectionInput = {
  userId: string;
  operation: MemoryCorrectionOperation;
  proposedContent: string;
  reason?: string | null;
  confidence?: number | null;
  currentMemoryId?: string | null;
  currentMemoryContent?: string | null;
  source: {
    kind: "runtime_memory_calibration";
    eventId: string;
    eventSource: string;
    channel?: string | null;
    previewId?: string;
    createdAt?: string;
  };
  provenance?: MemoryProvenanceRef[];
};

export type MemoryCorrectionReview = {
  recorded: false;
  reviewOnly: true;
  status: MemoryCorrectionStatus;
  operation: MemoryCorrectionOperation;
  userId: string;
  currentMemoryId: string | null;
  proposedContent: string;
  reason: string;
  correctionReason: string | null;
  confidence: number | null;
  source: MemoryCorrectionInput["source"] | null;
  provenance: MemoryProvenanceRef[];
  uncertainty: string[];
};

export type MemoryContextItem = {
  memory: RetrievedMemory;
  provenance: MemoryProvenanceRef[];
};

export type MemoryRetrievalTraceDisposition =
  | "candidate"
  | "selected"
  | "sanitized"
  | "withheld"
  | "duplicate"
  | "limit";

export type MemoryRetrievalTraceCandidate = {
  id?: string;
  source: "canonical" | "gbrain";
  rank: number;
  score: number;
  disposition: MemoryRetrievalTraceDisposition;
};

export type MemoryRetrievalTraceStage = {
  stage: "primary_retrieval" | "privacy_boundary" | "canonical_fallback" | "context_selection";
  requestedLimit: number;
  receivedCount: number;
  candidates: MemoryRetrievalTraceCandidate[];
};

export type MemoryRetrievalTrace = {
  schemaVersion: 1;
  contentFree: true;
  identifiersOmitted: boolean;
  input: {
    queryFingerprint?: string;
    queryLength: number;
    caller: MemoryOsCaller | string;
    limit: number;
    canonicalOnly: boolean;
    modelTarget: MemoryModelTarget;
    allowRestrictedMemory: boolean;
  };
  outcome: "ok" | "empty" | "invalid_input" | "error";
  fallbackUsed: boolean;
  stages: MemoryRetrievalTraceStage[];
  selectedIds: string[];
  errorName?: string;
};

export type MemoryContext = {
  userId: string;
  query: string;
  caller: MemoryOsCaller | string;
  items: MemoryContextItem[];
  sources: {
    memories: string[];
    brainChunks: string[];
    hotState: string[];
  };
  provenance: MemoryProvenanceRef[];
  uncertainty: string[];
  trace?: MemoryRetrievalTrace;
};

export type RetrieveMemoryContextInput = {
  userId: string;
  query: string;
  limit?: number;
  caller: MemoryOsCaller | string;
  skipAccessUpdate?: boolean;
  canonicalOnly?: boolean;
  modelTarget?: MemoryModelTarget;
  allowRestrictedMemory?: boolean;
};

export type MemoryRetrievalOptions = {
  canonicalOnly?: boolean;
  includeRestricted?: boolean;
};

export type MemoryOsDeps = {
  retrieveMemories: (
    userId: string,
    query: string,
    limit: number,
    skipAccessUpdate: boolean,
    options?: MemoryRetrievalOptions,
  ) => Promise<RetrievedMemory[]>;
  incrementAccessCount?: (ids: string[]) => void;
};

const defaultDeps: MemoryOsDeps = {
  retrieveMemories: async (userId, query, limit, skipAccessUpdate, options) => {
    if (options?.canonicalOnly) {
      const { retrieveCanonicalRelevantMemories } = await import("./retrieve");
      return retrieveCanonicalRelevantMemories(userId, query, limit, skipAccessUpdate, {
        includeRestricted: options.includeRestricted,
      });
    }

    const { retrieveRelevantMemories } = await import("./retrieve");
    return retrieveRelevantMemories(userId, query, limit, skipAccessUpdate, {
      includeRestricted: options?.includeRestricted,
    });
  },
  incrementAccessCount: (ids) => {
    void import("./retrieve")
      .then(({ batchIncrementAccessCount }) => batchIncrementAccessCount(ids))
      .catch((err) => console.error("[MemoryOS] access_count update failed:", err));
  },
};

function memoryTraceHmac(scope: string, userId: string, value: string): string | undefined {
  const key = process.env.JARVIS_TRACE_HMAC_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!key) return undefined;
  return createHmac("sha256", key)
    .update(`${scope}\0${userId.trim()}\0${value.trim()}`)
    .digest("hex")
    .slice(0, 24);
}

export function fingerprintMemoryQuery(query: string, userId: string): string | undefined {
  return memoryTraceHmac("memory-query", userId, query);
}

export function opaqueMemoryTraceIdentifier(id: string, userId: string): string | undefined {
  const digest = memoryTraceHmac("memory-id", userId, id);
  return digest ? `memory_${digest}` : undefined;
}

export function opaqueEvidenceTraceIdentifier(id: string, userId: string): string | undefined {
  const digest = memoryTraceHmac("evidence-id", userId, id);
  return digest ? `evidence_${digest}` : undefined;
}

function baseRetrievalTrace(
  input: RetrieveMemoryContextInput,
  limit: number,
  outcome: MemoryRetrievalTrace["outcome"],
): MemoryRetrievalTrace {
  const query = input.query.trim();
  const queryFingerprint = fingerprintMemoryQuery(query, input.userId);
  return {
    schemaVersion: 1,
    contentFree: true,
    identifiersOmitted: queryFingerprint === undefined,
    input: {
      queryFingerprint,
      queryLength: query.length,
      caller: input.caller,
      limit,
      canonicalOnly: input.canonicalOnly ?? false,
      modelTarget: input.modelTarget ?? "cloud",
      allowRestrictedMemory: input.allowRestrictedMemory ?? false,
    },
    outcome,
    fallbackUsed: false,
    stages: [],
    selectedIds: [],
  };
}

function traceCandidate(
  memory: RetrievedMemory,
  rank: number,
  disposition: MemoryRetrievalTraceDisposition,
  userId: string,
): MemoryRetrievalTraceCandidate {
  return {
    id: opaqueMemoryTraceIdentifier(memory.id, userId),
    source: memory.source === "gbrain" ? "gbrain" : "canonical",
    rank,
    score: Number.isFinite(memory.score) ? memory.score : 0,
    disposition,
  };
}

function emptyContext(
  input: RetrieveMemoryContextInput,
  uncertainty: string[] = [],
  outcome: MemoryRetrievalTrace["outcome"] = "empty",
  errorName?: string,
): MemoryContext {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const trace = baseRetrievalTrace(input, limit, outcome);
  if (errorName) trace.errorName = errorName;
  return {
    userId: input.userId,
    query: input.query.trim(),
    caller: input.caller,
    items: [],
    sources: {
      memories: [],
      brainChunks: [],
      hotState: [],
    },
    provenance: [],
    uncertainty,
    trace,
  };
}

function uniqueRefs(refs: MemoryProvenanceRef[]): MemoryProvenanceRef[] {
  const seen = new Set<string>();
  const out: MemoryProvenanceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.source}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function uniqueMemoryIds(memories: Pick<RetrievedMemory, "id">[]): string[] {
  return [...new Set(memories.map((memory) => memory.id).filter(Boolean))];
}

function cleanSingleLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

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

function isRestrictedSourceType(value: unknown): boolean {
  const normalized = cleanSingleLine(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return false;
  return RESTRICTED_SOURCE_TOKENS.some((token) =>
    normalized === token ||
    normalized.startsWith(`${token}_`) ||
    normalized.endsWith(`_${token}`) ||
    normalized.includes(`_${token}_`)
  );
}

function isRestrictedProvenanceRef(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const sourceType = cleanSingleLine(record.sourceType ?? record.source_type ?? record.kind);
  const sourceRef = cleanSingleLine(record.sourceRef ?? record.source_ref ?? record.id);
  const sensitivity = cleanSingleLine(record.sensitivity).toLowerCase();
  return Boolean(record.restricted) ||
    sensitivity === "restricted_summary" ||
    isRestrictedSourceType(sourceType) ||
    isRestrictedSourceType(sourceRef);
}

function isRestrictedRetrievedMemory(memory: RetrievedMemory): boolean {
  return cleanSingleLine(memory.sensitivity).toLowerCase() === "restricted_summary" ||
    isRestrictedSourceType(memory.sourceType) ||
    isRestrictedSourceType(memory.sourceRef) ||
    containsRawRestrictedContent(memory.content) ||
    (Array.isArray(memory.provenance) && memory.provenance.some(isRestrictedProvenanceRef)) ||
    (Array.isArray(memory.sourceRefs) && memory.sourceRefs.some(isRestrictedProvenanceRef));
}

function sanitizeRestrictedMemoryContent(content: string): string {
  const redacted = content
    .replace(/\b(?:account|routing|card|debit|credit)\s*(?:number|no\.?|#|ending(?:\s+in)?|last\s+four)?\s*[:#-]?\s*(?:\d[\s-]?){4,}\b/gi, "[redacted identifier]")
    .replace(/\blast\s+four\s*(?:digits?)?\s*[:#-]?\s*(?:\d[\s-]?){4}\b/gi, "[redacted identifier]")
    .replace(/\b(?:ssn|social security)\b[\s\S]{0,40}\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/gi, "[redacted identifier]")
    .replace(/\b(?:available|current|ending)\s+balance\b[\s\S]{0,80}\$?\d[\d,]*(?:\.\d{2})?\b/gi, "[redacted balance]")
    .replace(/\b(?:bank|checking|savings|account)\s+balance\b[\s\S]{0,80}\$?\d[\d,]*(?:\.\d{2})?\b/gi, "[redacted balance]")
    .replace(/\bbalance\b[\s\S]{0,40}\b(?:bank|checking|savings|account)\b[\s\S]{0,80}\$?\d[\d,]*(?:\.\d{2})?\b/gi, "[redacted balance]")
    .replace(/\b(?:bank|checking|savings|account)(?:\s+account)?\b[\s\S]{0,80}(?:\$\d[\d,]*(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b)/gi, "[redacted balance]")
    .replace(/(?:\$\d[\d,]*(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b)[\s\S]{0,80}\b(?:bank|checking|savings|account)(?:\s+account)?\b/gi, "[redacted balance]")
    .replace(/^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+.{2,}\s+[-+]?\$?\d[\d,]*(?:\.\d{2})?\s*$/gim, "[redacted transaction row]")
    .replace(/^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*,\s*[^,\n]{2,}\s*,\s*[-+]?\$?\d[\d,]*(?:\.\d{2})?\s*$/gim, "[redacted transaction row]")
    .trim();
  const compact = redacted.length > 260 ? `${redacted.slice(0, 257).trimEnd()}...` : redacted;
  return compact || "Restricted summary available; raw details withheld.";
}

function prepareMemoryForModelTarget(
  memory: RetrievedMemory,
  target: MemoryModelTarget,
  allowRestrictedMemory: boolean,
): RetrievedMemory | null {
  if (!isRestrictedRetrievedMemory(memory)) return memory;
  if (target === "runtime" || (target === "cloud" && allowRestrictedMemory)) return memory;
  if (target === "cloud") return null;
  return {
    ...memory,
    content: `Restricted summary: ${sanitizeRestrictedMemoryContent(memory.content)}`,
    sensitivity: "restricted_summary",
  };
}

function prepareMemoriesForModelTarget(
  memories: RetrievedMemory[],
  target: MemoryModelTarget,
  allowRestrictedMemory: boolean,
): { memories: RetrievedMemory[]; uncertainty: string[] } {
  const prepared: RetrievedMemory[] = [];
  let withheld = 0;
  let sanitized = 0;

  for (const memory of memories) {
    const restricted = isRestrictedRetrievedMemory(memory);
    const next = prepareMemoryForModelTarget(memory, target, allowRestrictedMemory);
    if (!next) {
      withheld += 1;
      continue;
    }
    if (restricted && target === "local") sanitized += 1;
    prepared.push(next);
  }

  const uncertainty: string[] = [];
  if (withheld > 0) {
    uncertainty.push(`${withheld} restricted MemoryOS item${withheld === 1 ? " was" : "s were"} withheld from cloud model context.`);
  }
  if (sanitized > 0) {
    uncertainty.push(`${sanitized} restricted MemoryOS summar${sanitized === 1 ? "y was" : "ies were"} sanitized for local model context.`);
  }
  return { memories: prepared, uncertainty };
}

function appendUniqueMemories(base: RetrievedMemory[], candidates: RetrievedMemory[], limit: number): RetrievedMemory[] {
  const seen = new Set(base.map((memory) => memory.id).filter(Boolean));
  const out = [...base];
  for (const candidate of candidates) {
    if (out.length >= limit) break;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
  }
  return out;
}

export function buildMemoryCorrectionReview(input?: MemoryCorrectionInput): MemoryCorrectionReview {
  if (!input) {
    return {
      recorded: false,
      reviewOnly: true,
      status: "invalid",
      operation: "propose_new_memory",
      userId: "",
      currentMemoryId: null,
      proposedContent: "",
      reason: "Memory correction flows are planned for a later slice.",
      correctionReason: null,
      confidence: null,
      source: null,
      provenance: [],
      uncertainty: ["No memory correction input was provided."],
    };
  }

  const proposedContent = input.proposedContent.trim();
  const provenance = uniqueRefs([
    {
      kind: "runtime_event",
      id: input.source.eventId,
      source: "runtime",
      label: input.source.channel ?? input.source.eventSource,
    },
    ...(input.currentMemoryId
      ? [{
          kind: "user_memory" as const,
          id: input.currentMemoryId,
          source: "canonical" as const,
          label: input.operation,
        }]
      : []),
    ...(input.provenance ?? []),
  ]);

  const uncertainty: string[] = [];
  if (!input.userId.trim()) uncertainty.push("No user id was provided for memory correction.");
  if (!proposedContent) uncertainty.push("No proposed memory correction content was provided.");
  if (input.operation === "correct_existing_memory" && !input.currentMemoryId) {
    uncertainty.push("Correction operation was requested without an existing memory id.");
  }

  return {
    recorded: false,
    reviewOnly: true,
    status: uncertainty.length > 0 ? "invalid" : "review_required",
    operation: input.operation,
    userId: input.userId,
    currentMemoryId: input.currentMemoryId ?? null,
    proposedContent,
    reason: "Memory OS correction provenance is captured for review only; durable correction writes are planned for a later slice.",
    correctionReason: input.reason ?? null,
    confidence: typeof input.confidence === "number" && Number.isFinite(input.confidence) ? input.confidence : null,
    source: input.source,
    provenance,
    uncertainty,
  };
}

function provenanceForMemory(memory: RetrievedMemory): MemoryProvenanceRef[] {
  const refs: MemoryProvenanceRef[] = [];
  const rankedBrainSources = memory.retrieval?.sources.filter((source) => source.source === "gbrain") ?? [];
  if (rankedBrainSources.length > 0) {
    refs.push(...rankedBrainSources.map((source) => ({
      kind: "brain_chunk" as const,
      id: source.sourceId,
      source: "gbrain" as const,
      label: memory.category,
    })));
  } else if (memory.source === "gbrain") {
    refs.push({
      kind: "brain_chunk",
      id: memory.sourceId ?? memory.id,
      source: "gbrain",
      label: memory.category,
    });
  }

  if (memory.source !== "gbrain") {
    refs.push({
      kind: "user_memory",
      id: memory.id,
      source: "canonical",
      label: memory.category,
    });
  }
  refs.push(...(memory.sourceRefs ?? [])
    .filter((citation) => citation.kind === "user_memory")
    .map((citation) => ({
      kind: "user_memory" as const,
      id: citation.id,
      source: "canonical" as const,
      label: memory.category,
    })));
  return uniqueRefs(refs);
}

export function memoryContextItemsToRetrievedMemories(items: MemoryContextItem[]): RetrievedMemory[] {
  return items.map((item) => item.memory);
}

export async function retrieveMemoryContext(
  input: RetrieveMemoryContextInput,
  deps: MemoryOsDeps = defaultDeps,
): Promise<MemoryContext> {
  const query = input.query.trim();
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const skipAccessUpdate = input.skipAccessUpdate ?? false;

  if (!input.userId.trim()) {
    return emptyContext(input, ["No user id was provided for memory retrieval."], "invalid_input");
  }

  if (!query) {
    return emptyContext(input, ["No memory query was provided."], "invalid_input");
  }

  const trace = baseRetrievalTrace(input, limit, "ok");
  try {
    const target = input.modelTarget ?? "cloud";
    const rawLimit = target === "runtime" || (target === "cloud" && input.allowRestrictedMemory === true)
      ? limit
      : Math.min(50, Math.max(limit, limit * 4));
    const rawMemories = await deps.retrieveMemories(input.userId, query, rawLimit, true, {
      canonicalOnly: input.canonicalOnly ?? false,
      includeRestricted: true,
    });
    trace.stages.push({
      stage: "primary_retrieval",
      requestedLimit: rawLimit,
      receivedCount: rawMemories.length,
      candidates: rawMemories.map((memory, index) => traceCandidate(
        memory,
        index + 1,
        "candidate",
        input.userId,
      )),
    });
    const { memories: preparedMemories, uncertainty: boundaryUncertainty } = prepareMemoriesForModelTarget(
      rawMemories,
      target,
      input.allowRestrictedMemory ?? false,
    );
    const degradedSources = [...new Set(rawMemories.flatMap(
      (memory) => memory.retrieval?.degradedSources ?? [],
    ))];
    const retrievalUncertainty = degradedSources.map((source) =>
      `${source === "gbrain" ? "G-Brain" : "Canonical memory"} retrieval was unavailable; results use the remaining source.`
    );
    const preparedIds = new Set(preparedMemories.map((memory) => memory.id));
    trace.stages.push({
      stage: "privacy_boundary",
      requestedLimit: limit,
      receivedCount: preparedMemories.length,
      candidates: rawMemories.map((memory, index) => {
        const restricted = isRestrictedRetrievedMemory(memory);
        const disposition: MemoryRetrievalTraceDisposition = !preparedIds.has(memory.id)
          ? "withheld"
          : restricted && target === "local"
            ? "sanitized"
            : "candidate";
        return traceCandidate(memory, index + 1, disposition, input.userId);
      }),
    });
    let selectionPool = [...preparedMemories];
    let memories = preparedMemories.slice(0, limit);
    let uncertainty = [...boundaryUncertainty, ...retrievalUncertainty];
    if (
      memories.length < limit &&
      !input.canonicalOnly &&
      rawMemories.length > 0 &&
      rawMemories.some(isRestrictedRetrievedMemory)
    ) {
      const fallbackLimit = Math.min(50, Math.max(limit, (limit - memories.length) * 4));
      const canonicalFallback = await deps.retrieveMemories(input.userId, query, fallbackLimit, true, {
        canonicalOnly: true,
        includeRestricted: true,
      });
      const fallbackPrepared = prepareMemoriesForModelTarget(
        canonicalFallback,
        target,
        input.allowRestrictedMemory ?? false,
      );
      const beforeFallbackIds = new Set(memories.map((memory) => memory.id));
      memories = appendUniqueMemories(memories, fallbackPrepared.memories, limit);
      selectionPool = appendUniqueMemories(selectionPool, fallbackPrepared.memories, 50);
      uncertainty = [...uncertainty, ...fallbackPrepared.uncertainty];
      const fallbackPreparedIds = new Set(fallbackPrepared.memories.map((memory) => memory.id));
      const selectedIds = new Set(memories.map((memory) => memory.id));
      trace.fallbackUsed = true;
      trace.stages.push({
        stage: "canonical_fallback",
        requestedLimit: fallbackLimit,
        receivedCount: canonicalFallback.length,
        candidates: canonicalFallback.map((memory, index) => {
          const restricted = isRestrictedRetrievedMemory(memory);
          let disposition: MemoryRetrievalTraceDisposition;
          if (!fallbackPreparedIds.has(memory.id)) disposition = "withheld";
          else if (beforeFallbackIds.has(memory.id)) disposition = "duplicate";
          else if (!selectedIds.has(memory.id)) disposition = "limit";
          else if (restricted && target === "local") disposition = "sanitized";
          else disposition = "selected";
          return traceCandidate(memory, index + 1, disposition, input.userId);
        }),
      });
    }
    if (!skipAccessUpdate) {
      deps.incrementAccessCount?.(uniqueMemoryIds(memories));
    }
    const items = memories.map((memory) => ({
      memory,
      provenance: provenanceForMemory(memory),
    }));
    const provenance = items.flatMap((item) => item.provenance);
    const selectedIds = new Set(memories.map((memory) => memory.id));
    trace.stages.push({
      stage: "context_selection",
      requestedLimit: limit,
      receivedCount: memories.length,
      candidates: selectionPool.map((memory, index) => traceCandidate(
        memory,
        index + 1,
        selectedIds.has(memory.id) ? "selected" : "limit",
        input.userId,
      )),
    });
    trace.selectedIds = memories.flatMap((memory) => {
      const id = opaqueMemoryTraceIdentifier(memory.id, input.userId);
      return id ? [id] : [];
    });
    trace.outcome = memories.length > 0 ? "ok" : "empty";

    return {
      userId: input.userId,
      query,
      caller: input.caller,
      items,
      sources: {
        memories: provenance.filter((ref) => ref.kind === "user_memory").map((ref) => ref.id),
        brainChunks: provenance.filter((ref) => ref.kind === "brain_chunk").map((ref) => ref.id),
        hotState: [],
      },
      provenance,
      uncertainty: [
        ...uncertainty,
        ...(memories.length === 0 ? ["No relevant memories were found."] : []),
      ],
      trace,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return emptyContext(
      input,
      [`Memory retrieval failed: ${detail}`],
      "error",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
}

export async function rememberEpisode(): Promise<{ recorded: false; reason: string }> {
  return { recorded: false, reason: "Memory OS episode writes are planned for a later slice." };
}

export async function explainMemoryAnswer(): Promise<{ available: false; reason: string }> {
  return { available: false, reason: "User-facing memory explanation is planned for a later slice." };
}

export async function recordMemoryCorrection(input?: MemoryCorrectionInput): Promise<MemoryCorrectionReview> {
  return buildMemoryCorrectionReview(input);
}
