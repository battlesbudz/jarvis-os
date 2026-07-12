export type RetrievalEvaluationItem = string | {
  id: string;
  score?: number;
  source?: string;
};

export type RetrievalEvaluationFixture = {
  id: string;
  query: string;
  expectedIds: string[];
  forbiddenIds?: string[];
  expectedAssemblyIds?: string[];
  topK?: number;
  thresholds?: {
    minRecallAtK?: number;
    minPrecisionAtK?: number;
    minReciprocalRank?: number;
  };
};

export type RetrievalEvaluationRun = {
  retrieved: RetrievalEvaluationItem[];
  assembledIds?: string[];
};

export type RetrievalEvaluationCase = {
  fixture: RetrievalEvaluationFixture;
  run: RetrievalEvaluationRun;
};

export type RetrievalEvaluationMetrics = {
  recallAtK: number;
  precisionAtK: number;
  reciprocalRank: number;
  retrievedCount: number;
  assembledCount: number | null;
};

export type RetrievalEvaluationFailureCode =
  | "recall_below_threshold"
  | "precision_below_threshold"
  | "reciprocal_rank_below_threshold"
  | "forbidden_retrieval_hit"
  | "forbidden_assembly_hit"
  | "missing_from_assembly";

export type RetrievalEvaluationResult = {
  fixtureId: string;
  query: string;
  topK: number;
  passed: boolean;
  failureCodes: RetrievalEvaluationFailureCode[];
  metrics: RetrievalEvaluationMetrics;
  expectedIds: string[];
  retrievedIds: string[];
  assembledIds: string[] | null;
  missingAtRetrievalIds: string[];
  missingAtAssemblyIds: string[];
  droppedDuringAssemblyIds: string[];
  forbiddenAtRetrievalIds: string[];
  forbiddenAtAssemblyIds: string[];
};

export type RetrievalEvaluationSummary = {
  fixtures: number;
  passed: number;
  failed: number;
  averages: Pick<RetrievalEvaluationMetrics, "recallAtK" | "precisionAtK" | "reciprocalRank">;
  results: RetrievalEvaluationResult[];
};

export function requireRetrievalEvaluationCases(value: unknown): RetrievalEvaluationCase[] {
  const cases = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { cases?: unknown }).cases)
      ? (value as { cases: unknown[] }).cases
      : null;
  if (!cases) {
    throw new Error("Retrieval evaluation input must be an array or an object with a cases array.");
  }
  if (cases.length === 0) {
    throw new Error("Retrieval evaluation input must contain at least one case.");
  }
  return cases as RetrievalEvaluationCase[];
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function evaluationItemId(item: RetrievalEvaluationItem): string {
  return typeof item === "string" ? item.trim() : item.id.trim();
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

export function evaluateRetrievalRun(
  fixture: RetrievalEvaluationFixture,
  run: RetrievalEvaluationRun,
): RetrievalEvaluationResult {
  const topK = Math.max(1, fixture.topK ?? 5);
  const expectedIds = uniqueIds(fixture.expectedIds);
  const expectedSet = new Set(expectedIds);
  const forbiddenSet = new Set(uniqueIds(fixture.forbiddenIds ?? []));
  const retrievedIds = run.retrieved
    .slice(0, topK)
    .map(evaluationItemId)
    .filter(Boolean);
  const retrievedSet = new Set(retrievedIds);
  const assembledIds = run.assembledIds === undefined ? null : uniqueIds(run.assembledIds);
  const assembledSet = new Set(assembledIds ?? []);
  const expectedAssemblyIds = uniqueIds(fixture.expectedAssemblyIds ?? expectedIds);

  const retrievalHits = uniqueIds(retrievedIds.filter((id) => expectedSet.has(id)));
  const firstRelevantIndex = retrievedIds.findIndex((id) => expectedSet.has(id));
  const recallAtK = ratio(retrievalHits.length, expectedIds.length, 1);
  const precisionAtK = expectedIds.length === 0 && retrievedIds.length === 0
    ? 1
    : retrievalHits.length / topK;
  const reciprocalRank = expectedIds.length === 0
    ? 1
    : firstRelevantIndex === -1
      ? 0
      : 1 / (firstRelevantIndex + 1);

  const missingAtRetrievalIds = expectedIds.filter((id) => !retrievedSet.has(id));
  const missingAtAssemblyIds = assembledIds === null
    ? []
    : expectedAssemblyIds.filter((id) => !assembledSet.has(id));
  const droppedDuringAssemblyIds = assembledIds === null
    ? []
    : expectedAssemblyIds.filter((id) => retrievedSet.has(id) && !assembledSet.has(id));
  const forbiddenAtRetrievalIds = uniqueIds(retrievedIds.filter((id) => forbiddenSet.has(id)));
  const forbiddenAtAssemblyIds = assembledIds === null
    ? []
    : assembledIds.filter((id) => forbiddenSet.has(id));

  const minRecallAtK = fixture.thresholds?.minRecallAtK ?? 1;
  const minPrecisionAtK = fixture.thresholds?.minPrecisionAtK;
  const minReciprocalRank = fixture.thresholds?.minReciprocalRank ?? (expectedIds.length > 0 ? 1 / topK : 1);
  const failureCodes: RetrievalEvaluationFailureCode[] = [];
  if (recallAtK < minRecallAtK) failureCodes.push("recall_below_threshold");
  if (minPrecisionAtK !== undefined && precisionAtK < minPrecisionAtK) {
    failureCodes.push("precision_below_threshold");
  }
  if (reciprocalRank < minReciprocalRank) failureCodes.push("reciprocal_rank_below_threshold");
  if (forbiddenAtRetrievalIds.length > 0) failureCodes.push("forbidden_retrieval_hit");
  if (forbiddenAtAssemblyIds.length > 0) failureCodes.push("forbidden_assembly_hit");
  if (missingAtAssemblyIds.length > 0) failureCodes.push("missing_from_assembly");

  return {
    fixtureId: fixture.id,
    query: fixture.query,
    topK,
    passed: failureCodes.length === 0,
    failureCodes,
    metrics: {
      recallAtK,
      precisionAtK,
      reciprocalRank,
      retrievedCount: retrievedIds.length,
      assembledCount: assembledIds?.length ?? null,
    },
    expectedIds,
    retrievedIds,
    assembledIds,
    missingAtRetrievalIds,
    missingAtAssemblyIds,
    droppedDuringAssemblyIds,
    forbiddenAtRetrievalIds,
    forbiddenAtAssemblyIds,
  };
}

export function summarizeRetrievalEvaluations(
  cases: RetrievalEvaluationCase[],
): RetrievalEvaluationSummary {
  const results = cases.map(({ fixture, run }) => evaluateRetrievalRun(fixture, run));
  const divisor = Math.max(1, results.length);
  const totals = results.reduce(
    (sum, result) => ({
      recallAtK: sum.recallAtK + result.metrics.recallAtK,
      precisionAtK: sum.precisionAtK + result.metrics.precisionAtK,
      reciprocalRank: sum.reciprocalRank + result.metrics.reciprocalRank,
    }),
    { recallAtK: 0, precisionAtK: 0, reciprocalRank: 0 },
  );

  return {
    fixtures: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    averages: {
      recallAtK: totals.recallAtK / divisor,
      precisionAtK: totals.precisionAtK / divisor,
      reciprocalRank: totals.reciprocalRank / divisor,
    },
    results,
  };
}
