import assert from "node:assert/strict";
import type { QueryBrainResult } from "../../brain/types";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_retrieval_fallback_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";
process.env.JARVIS_BRAIN_RETRIEVAL = "0";

async function main(): Promise<void> {
  const { applyAccessUpdateForRetrievedMemories, mapBrainChunksToRetrievedMemories } = await import("../retrieve");

  const chunks: QueryBrainResult["chunks"] = [
    {
      pageSlug: "memory-page",
      content: "Canonical memory projected into the derived brain.",
      score: 87,
      citations: [
        { kind: "chat", id: "chat-1" },
        { kind: "user_memory", id: "memory-canonical-1" },
      ],
    },
    {
      pageSlug: "synthetic-page",
      content: "Derived-only context without a canonical user memory.",
      score: 42,
      citations: [{ kind: "document", id: "doc-1" }],
    },
  ];

  const mapped = mapBrainChunksToRetrievedMemories(chunks);

  assert.equal(
    mapped[0]?.id,
    "memory-canonical-1",
    "derived user_memory citations should preserve the canonical memory id",
  );
  assert.equal(mapped[1]?.id, "synthetic-page:1", "derived chunks without user_memory citations should use fallback ids");

  const incrementCalls: string[][] = [];
  applyAccessUpdateForRetrievedMemories(mapped, false, (ids) => {
    incrementCalls.push(ids);
  });
  assert.deepEqual(
    incrementCalls,
    [["memory-canonical-1", "synthetic-page:1"]],
    "access updates should receive mapped canonical and synthetic ids",
  );

  applyAccessUpdateForRetrievedMemories(mapped, true, (ids) => {
    incrementCalls.push(ids);
  });
  assert.equal(incrementCalls.length, 1, "skipAccessUpdate=true should not call the increment function");

  assert.deepEqual(
    mapBrainChunksToRetrievedMemories([]),
    [],
    "empty derived chunks should map to no results so callers can fall back",
  );

  console.log("OK: memory retrieval maps derived chunks, preserves access updates, and leaves empty chunks fallback-safe");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
