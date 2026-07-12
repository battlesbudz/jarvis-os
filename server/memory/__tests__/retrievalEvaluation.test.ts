import assert from "node:assert/strict";

import { STARTER_RETRIEVAL_REGRESSION_CASES } from "../evals/retrievalRegressionCases";
import {
  evaluateRetrievalRun,
  requireRetrievalEvaluationCases,
  summarizeRetrievalEvaluations,
} from "../retrievalEvaluation";

function testStarterCasesPass(): void {
  const summary = summarizeRetrievalEvaluations(STARTER_RETRIEVAL_REGRESSION_CASES);

  assert.equal(summary.fixtures, 6);
  assert.equal(summary.passed, 6);
  assert.equal(summary.failed, 0);
  assert.equal(summary.averages.recallAtK, 1);
  assert.ok(summary.averages.reciprocalRank > 0.8);
}

function testFailureAttributionSeparatesRetrievalFromAssembly(): void {
  const result = evaluateRetrievalRun({
    id: "failed-grounding-run",
    query: "What do you know about my current project?",
    expectedIds: ["memory-project-priority", "memory-project-decision"],
    forbiddenIds: ["notification-spam-risk"],
    topK: 3,
    thresholds: {
      minPrecisionAtK: 0.75,
      minReciprocalRank: 1,
    },
  }, {
    retrieved: [
      { id: "memory-project-priority", score: 0.91, source: "canonical" },
      { id: "notification-spam-risk", score: 0.88, source: "canonical" },
    ],
    assembledIds: [],
  });

  assert.equal(result.passed, false);
  assert.equal(result.metrics.recallAtK, 0.5);
  assert.equal(result.metrics.precisionAtK, 1 / 3);
  assert.equal(result.metrics.reciprocalRank, 1);
  assert.deepEqual(result.missingAtRetrievalIds, ["memory-project-decision"]);
  assert.deepEqual(result.missingAtAssemblyIds, ["memory-project-priority", "memory-project-decision"]);
  assert.deepEqual(result.droppedDuringAssemblyIds, ["memory-project-priority"]);
  assert.deepEqual(result.forbiddenAtRetrievalIds, ["notification-spam-risk"]);
  assert.deepEqual(result.forbiddenAtAssemblyIds, []);
  assert.deepEqual(result.failureCodes, [
    "recall_below_threshold",
    "precision_below_threshold",
    "forbidden_retrieval_hit",
    "missing_from_assembly",
  ]);
}

function testForbiddenAssemblyHitFailsEvenWithoutExpectedFacts(): void {
  const result = evaluateRetrievalRun({
    id: "restricted-cloud-boundary",
    query: "Show raw restricted details",
    expectedIds: [],
    forbiddenIds: ["memory-restricted"],
  }, {
    retrieved: [],
    assembledIds: ["memory-restricted"],
  });

  assert.equal(result.metrics.recallAtK, 1);
  assert.equal(result.metrics.reciprocalRank, 1);
  assert.deepEqual(result.forbiddenAtAssemblyIds, ["memory-restricted"]);
  assert.deepEqual(result.failureCodes, ["forbidden_assembly_hit"]);
}

function testTopKBoundaryIsAppliedBeforeDedupe(): void {
  const result = evaluateRetrievalRun({
    id: "duplicate-rank-boundary",
    query: "Find the expected memory",
    expectedIds: ["memory-expected"],
    topK: 2,
  }, {
    retrieved: ["memory-noise", "memory-noise", "memory-expected"],
  });

  assert.deepEqual(result.retrievedIds, ["memory-noise", "memory-noise"]);
  assert.deepEqual(result.missingAtRetrievalIds, ["memory-expected"]);
  assert.equal(result.metrics.recallAtK, 0);
  assert.equal(result.metrics.retrievedCount, 2);
}

function testDuplicateSlotsDoNotImproveRankOrPrecision(): void {
  const result = evaluateRetrievalRun({
    id: "duplicate-slot-scoring",
    query: "Find the expected memory",
    expectedIds: ["memory-expected"],
    topK: 3,
  }, {
    retrieved: ["memory-noise", "memory-noise", "memory-expected"],
  });

  assert.deepEqual(result.retrievedIds, ["memory-noise", "memory-noise", "memory-expected"]);
  assert.equal(result.metrics.recallAtK, 1);
  assert.equal(result.metrics.precisionAtK, 1 / 3);
  assert.equal(result.metrics.reciprocalRank, 1 / 3);
  assert.equal(result.metrics.retrievedCount, 3);
}

function testUnderfilledRunsUseTopKPrecisionDenominator(): void {
  const result = evaluateRetrievalRun({
    id: "underfilled-top-k",
    query: "Find the expected memory",
    expectedIds: ["memory-expected"],
    topK: 5,
    thresholds: { minPrecisionAtK: 0.5 },
  }, {
    retrieved: ["memory-expected"],
  });

  assert.equal(result.metrics.precisionAtK, 0.2);
  assert.deepEqual(result.failureCodes, ["precision_below_threshold"]);
}

function testEmptyEvaluationArtifactsAreRejected(): void {
  assert.throws(
    () => requireRetrievalEvaluationCases([]),
    /must contain at least one case/,
  );
  assert.throws(
    () => requireRetrievalEvaluationCases({ cases: [] }),
    /must contain at least one case/,
  );
}

function main(): void {
  testStarterCasesPass();
  testFailureAttributionSeparatesRetrievalFromAssembly();
  testForbiddenAssemblyHitFailsEvenWithoutExpectedFacts();
  testTopKBoundaryIsAppliedBeforeDedupe();
  testDuplicateSlotsDoNotImproveRankOrPrecision();
  testUnderfilledRunsUseTopKPrecisionDenominator();
  testEmptyEvaluationArtifactsAreRejected();
  console.log("OK: retrieval evaluation attributes ranking, filtering, and context assembly failures");
}

main();
