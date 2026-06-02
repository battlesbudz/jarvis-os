import assert from "node:assert/strict";
import { cosineSimilarity, rankBrainChunkCandidates } from "../vector";

function main(): void {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);

  const ranked = rankBrainChunkCandidates(
    [
      {
        pageSlug: "memory/exact-words",
        pageTitle: "Exact words",
        content: "keyword keyword keyword",
        pageProvenance: [{ kind: "user_memory", id: "exact" }],
        chunkProvenance: [{ kind: "user_memory", id: "exact" }],
        ftsScore: 0.9,
        embedding: [0, 1],
      },
      {
        pageSlug: "memory/semantic-match",
        pageTitle: "Semantic match",
        content: "meaningfully related memory",
        pageProvenance: [{ kind: "user_memory", id: "semantic" }],
        chunkProvenance: [{ kind: "user_memory", id: "semantic" }],
        ftsScore: 0.1,
        embedding: [1, 0],
      },
    ],
    [1, 0],
    2,
  );

  assert.equal(ranked.chunks[0]?.pageSlug, "memory/semantic-match");
  assert.equal(ranked.pages[0]?.slug, "memory/semantic-match");
  assert.ok(ranked.chunks[0]?.score > ranked.chunks[1]?.score);

  console.log("OK: brain vector ranking");
}

main();
