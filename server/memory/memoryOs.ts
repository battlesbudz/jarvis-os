import type { RetrievedMemory } from "./retrieve";

export type MemoryOsCaller =
  | "memory_search"
  | "memory_get"
  | "coach_context"
  | "daily_command"
  | "agent_sdk_context"
  | "gbrain_retrieval"
  | "other";

export type MemoryProvenanceRef = {
  kind: "user_memory" | "brain_chunk" | "hot_state" | "runtime_event";
  id: string;
  source: "canonical" | "gbrain" | "hot_state" | "runtime";
  label?: string;
};

export type MemoryCorrectionOperation = "correct_existing_memory" | "propose_new_memory";
export type MemoryCorrectionStatus = "review_required" | "invalid";

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
};

export type MemoryOsDeps = {
  retrieveMemories: (
    userId: string,
    query: string,
    limit: number,
    skipAccessUpdate: boolean,
  ) => Promise<RetrievedMemory[]>;
};

const defaultDeps: MemoryOsDeps = {
  retrieveMemories: async (userId, query, limit, skipAccessUpdate) => {
    const { retrieveRelevantMemories } = await import("./retrieve");
    return retrieveRelevantMemories(userId, query, limit, skipAccessUpdate);
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
    const memories = await deps.retrieveMemories(input.userId, query, limit, skipAccessUpdate);
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
      uncertainty: memories.length === 0 ? ["No relevant memories were found."] : [],
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
