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

function emptyContext(input: RetrieveMemoryContextInput, uncertainty: string[] = []): MemoryContext {
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
  const normalized = cleanSingleLine(value).toLowerCase().replace(/[\s-]+/g, "_");
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
  if (memory.source === "gbrain") {
    const refs: MemoryProvenanceRef[] = [
      {
        kind: "brain_chunk",
        id: memory.sourceId ?? memory.id,
        source: "gbrain",
        label: memory.category,
      },
    ];

    const canonicalCitation = memory.sourceRefs?.find((citation) => citation.kind === "user_memory");
    if (canonicalCitation) {
      refs.push({
        kind: "user_memory",
        id: canonicalCitation.id,
        source: "canonical",
        label: memory.category,
      });
    }

    return uniqueRefs(refs);
  }

  return [
    {
      kind: "user_memory",
      id: memory.id,
      source: "canonical",
      label: memory.category,
    },
  ];
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
    return emptyContext(input, ["No user id was provided for memory retrieval."]);
  }

  if (!query) {
    return emptyContext(input, ["No memory query was provided."]);
  }

  try {
    const target = input.modelTarget ?? "cloud";
    const rawLimit = target === "runtime" || (target === "cloud" && input.allowRestrictedMemory === true)
      ? limit
      : Math.min(50, Math.max(limit, limit * 4));
    const rawMemories = await deps.retrieveMemories(input.userId, query, rawLimit, true, {
      canonicalOnly: input.canonicalOnly ?? false,
      includeRestricted: true,
    });
    const { memories: preparedMemories, uncertainty: boundaryUncertainty } = prepareMemoriesForModelTarget(
      rawMemories,
      target,
      input.allowRestrictedMemory ?? false,
    );
    const memories = preparedMemories.slice(0, limit);
    if (!skipAccessUpdate) {
      deps.incrementAccessCount?.(uniqueMemoryIds(memories));
    }
    const items = memories.map((memory) => ({
      memory,
      provenance: provenanceForMemory(memory),
    }));
    const provenance = items.flatMap((item) => item.provenance);

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
        ...boundaryUncertainty,
        ...(memories.length === 0 ? ["No relevant memories were found."] : []),
      ],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return emptyContext(input, [`Memory retrieval failed: ${detail}`]);
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
