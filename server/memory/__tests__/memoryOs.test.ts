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
  const { retrieveMemoryContext, memoryContextItemsToRetrievedMemories } = await import("../memoryOs");

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

  console.log("OK: Memory OS facade normalizes memories, provenance, and fallback uncertainty");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
