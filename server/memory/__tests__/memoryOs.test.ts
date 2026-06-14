import assert from "node:assert/strict";
import type { RetrievedMemory } from "../retrieve";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_memory_os_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";

function memory(overrides: Partial<RetrievedMemory> = {}): RetrievedMemory {
  return {
    id: "memory-os-1",
    content: "The user prefers crisp morning plans.",
    category: "preferences",
    tier: "long_term",
    memoryType: "semantic",
    relevanceScore: 86,
    confidence: 92,
    accessCount: 2,
    score: 0.93,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const {
    retrieveMemoryContext,
    memoryContextItemsToRetrievedMemories,
    recordMemoryCorrection,
    buildMemoryCorrectionReview,
  } = await import("../memoryOs");

  const context = await retrieveMemoryContext(
    {
      userId: "memory-os-user",
      query: "morning planning",
      limit: 3,
      caller: "memory_search",
      skipAccessUpdate: true,
    },
    {
      retrieveMemories: async (userId, query, limit, skipAccessUpdate) => {
        assert.equal(userId, "memory-os-user");
        assert.equal(query, "morning planning");
        assert.equal(limit, 3);
        assert.equal(skipAccessUpdate, true);
        return [memory()];
      },
    },
  );

  assert.equal(context.query, "morning planning");
  assert.equal(context.caller, "memory_search");
  assert.equal(context.items.length, 1);
  assert.deepEqual(context.sources.memories, ["memory-os-1"]);
  assert.deepEqual(context.sources.brainChunks, []);
  assert.deepEqual(context.sources.hotState, []);
  assert.equal(context.provenance[0]?.kind, "user_memory");
  assert.equal(context.provenance[0]?.id, "memory-os-1");
  assert.equal(context.provenance[0]?.source, "canonical");
  assert.deepEqual(context.uncertainty, []);
  assert.equal(context.items[0]?.provenance[0]?.id, "memory-os-1");
  assert.equal(context.items[0]?.memory.category, "preferences");

  const roundTrip = memoryContextItemsToRetrievedMemories(context.items);
  assert.deepEqual(roundTrip, [memory()]);

  const gbrainContext = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "derived planning", caller: "gbrain_retrieval" },
    {
      retrieveMemories: async () => [
        memory({
          id: "memory-canonical-2",
          content: "A derived G-Brain chunk with canonical citation.",
          source: "gbrain",
          sourceId: "memory/derived-planning:0",
          sourceRefs: [{ kind: "user_memory", id: "memory-canonical-2" }],
        }),
      ],
    },
  );

  assert.deepEqual(gbrainContext.sources.brainChunks, ["memory/derived-planning:0"]);
  assert.deepEqual(gbrainContext.sources.memories, ["memory-canonical-2"]);
  assert.equal(gbrainContext.items[0]?.provenance[0]?.kind, "brain_chunk");
  assert.equal(gbrainContext.items[0]?.provenance[0]?.source, "gbrain");
  assert.equal(gbrainContext.items[0]?.provenance[1]?.kind, "user_memory");
  assert.equal(gbrainContext.items[0]?.provenance[1]?.source, "canonical");

  const empty = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "   ", caller: "coach_context" },
    {
      retrieveMemories: async () => {
        throw new Error("empty query should not hit retrieval");
      },
    },
  );
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.uncertainty, ["No memory query was provided."]);

  const failed = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "planning", caller: "daily_command" },
    {
      retrieveMemories: async () => {
        throw new Error("database unavailable");
      },
    },
  );
  assert.deepEqual(failed.items, []);
  assert.match(failed.uncertainty[0] ?? "", /database unavailable/);

  const correction = await recordMemoryCorrection({
    userId: "memory-os-user",
    operation: "correct_existing_memory",
    currentMemoryId: "memory-os-1",
    currentMemoryContent: "The user starts daily planning at 9:00.",
    proposedContent: " The user starts daily planning at 8:30. ",
    reason: "User corrected the previous schedule.",
    confidence: 0.94,
    source: {
      kind: "runtime_memory_calibration",
      eventId: "runtime-memory-event-1",
      eventSource: "app",
      channel: "settings-runtime-preview",
      previewId: "runtime-memory-calibration-runtime-memory-event-1",
      createdAt: "2026-06-08T21:00:00.000Z",
    },
    provenance: [
      {
        kind: "runtime_event",
        id: "runtime-memory-event-1",
        source: "runtime",
        label: "settings-runtime-preview",
      },
      {
        kind: "user_memory",
        id: "memory-os-1",
        source: "canonical",
        label: "preferences",
      },
    ],
  });

  assert.equal(correction.recorded, false);
  assert.equal(correction.reviewOnly, true);
  assert.equal(correction.status, "review_required");
  assert.equal(correction.operation, "correct_existing_memory");
  assert.equal(correction.currentMemoryId, "memory-os-1");
  assert.equal(correction.proposedContent, "The user starts daily planning at 8:30.");
  assert.equal(correction.source?.eventId, "runtime-memory-event-1");
  assert.deepEqual(
    correction.provenance.map((ref) => `${ref.kind}:${ref.source}:${ref.id}`),
    [
      "runtime_event:runtime:runtime-memory-event-1",
      "user_memory:canonical:memory-os-1",
    ],
  );

  const invalidCorrection = buildMemoryCorrectionReview({
    userId: "",
    operation: "correct_existing_memory",
    proposedContent: "   ",
    source: {
      kind: "runtime_memory_calibration",
      eventId: "runtime-memory-event-invalid",
      eventSource: "app",
    },
  });

  assert.equal(invalidCorrection.recorded, false);
  assert.equal(invalidCorrection.reviewOnly, true);
  assert.equal(invalidCorrection.status, "invalid");
  assert.match(invalidCorrection.uncertainty.join(" "), /No user id/);
  assert.match(invalidCorrection.uncertainty.join(" "), /No proposed memory correction content/);
  assert.match(invalidCorrection.uncertainty.join(" "), /without an existing memory id/);

  console.log("OK: Memory OS facade normalizes memories, provenance, and fallback uncertainty");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
