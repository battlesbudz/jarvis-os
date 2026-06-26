import assert from "node:assert/strict";
import type { QueryBrainResult } from "../../brain/types";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_retrieval_fallback_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";
process.env.JARVIS_BRAIN_RETRIEVAL = "0";

async function main(): Promise<void> {
  const {
    applyAccessUpdateForRetrievedMemories,
    filterRestrictedRetrievedMemories,
    mapBrainChunksToRetrievedMemories,
  } = await import("../retrieve");
  const retrieveSource = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../retrieve.ts", import.meta.url), "utf8")
  );
  assert.match(
    retrieveSource,
    /brainRetrievalLimit[\s\S]*Math\.min\(50, Math\.max\(limit, limit \* 4\)\)[\s\S]*topK: brainRetrievalLimit/,
    "derived G-Brain retrieval should over-fetch before restricted filtering",
  );

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
    {
      pageSlug: "restricted-page",
      content: "Restricted projected spending summary.",
      score: 75,
      citations: [
        {
          kind: "user_memory",
          id: "restricted-memory-1",
          sourceType: "restricted_summary",
          sourceRef: "plaid-rollup-1",
        },
      ],
    },
  ];

  const mapped = mapBrainChunksToRetrievedMemories(chunks);

  assert.equal(
    mapped[0]?.id,
    "memory-canonical-1",
    "derived user_memory citations should preserve the canonical memory id",
  );
  assert.equal(mapped[1]?.id, "synthetic-page:1", "derived chunks without user_memory citations should use fallback ids");
  assert.equal(mapped[2]?.id, "restricted-memory-1", "restricted derived chunks should preserve canonical memory id");
  assert.equal(mapped[2]?.sensitivity, "restricted_summary", "restricted derived chunks should keep restricted sensitivity");
  assert.equal(mapped[2]?.sourceType, "restricted_summary", "restricted derived chunks should keep citation source type");
  assert.deepEqual(
    filterRestrictedRetrievedMemories(mapped).map((item) => item.id),
    ["memory-canonical-1", "synthetic-page:1"],
    "raw retrieval helper callers should not receive restricted derived chunks by default",
  );
  assert.deepEqual(
    filterRestrictedRetrievedMemories(mapped, { includeRestricted: true }).map((item) => item.id),
    ["memory-canonical-1", "synthetic-page:1", "restricted-memory-1"],
    "MemoryOS can opt into restricted candidates before applying model-target policy",
  );

  const incrementCalls: string[][] = [];
  applyAccessUpdateForRetrievedMemories(mapped, false, (ids) => {
    incrementCalls.push(ids);
  });
  assert.deepEqual(
    incrementCalls,
    [["memory-canonical-1", "synthetic-page:1", "restricted-memory-1"]],
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
