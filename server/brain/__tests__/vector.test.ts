import assert from "node:assert/strict";
import { cosineSimilarity, rankBrainChunkCandidates } from "../vector";

assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
assert.equal(cosineSimilarity(null, [0, 1]), 0);

const ranked = rankBrainChunkCandidates(
  [
    {
      pageSlug: "memory/a",
      pageTitle: "A",
      content: "first",
      pageProvenance: [],
      chunkProvenance: [],
      ftsScore: 0.1,
      embedding: [1, 0],
    },
    {
      pageSlug: "memory/b",
      pageTitle: "B",
      content: "second",
      pageProvenance: [],
      chunkProvenance: [],
      ftsScore: 0.8,
      embedding: [0, 1],
    },
  ],
  [1, 0],
  1,
);

assert.equal(ranked.chunks.length, 1);
assert.equal(ranked.chunks[0]?.pageSlug, "memory/a");

console.log("OK: brain vector ranking blends semantic and FTS signals");
