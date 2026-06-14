import assert from "node:assert/strict";
import { compareRetrievalRuns, summarizeBenchmarkSuite } from "../benchmarks";

function main(): void {
  const fixture = {
    id: "identity-preference",
    query: "What coffee shop did Justin mention for Watertown outreach?",
    relevantIds: ["memory-jeans-beans"],
    runs: {
      legacy: [
        { id: "memory-generic-outreach", score: 0.8 },
        { id: "memory-jeans-beans", score: 0.6 },
      ],
      derivedFts: [{ id: "memory-jeans-beans", score: 0.9 }],
      derivedVector: [
        { id: "memory-jeans-beans", score: 0.95 },
        { id: "memory-full-circle", score: 0.4 },
      ],
    },
  };

  const result = compareRetrievalRuns(fixture, 2);

  assert.equal(result.fixtureId, "identity-preference");
  assert.equal(result.metrics.legacy.recallAtK, 1);
  assert.equal(result.metrics.legacy.mrr, 0.5);
  assert.equal(result.metrics.derivedFts.recallAtK, 1);
  assert.equal(result.metrics.derivedFts.mrr, 1);
  assert.equal(result.metrics.derivedVector.recallAtK, 1);
  assert.equal(result.metrics.derivedVector.mrr, 1);
  assert.equal(result.winner, "derivedFts");

  const summary = summarizeBenchmarkSuite([fixture], 2);
  assert.equal(summary.fixtures, 1);
  assert.equal(summary.averages.legacy.mrr, 0.5);
  assert.equal(summary.averages.derivedVector.mrr, 1);

  console.log("OK: brain retrieval benchmark fixtures");
}

main();
