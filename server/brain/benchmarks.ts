export type RetrievalMethod = "legacy" | "derivedFts" | "derivedVector";

export type RetrievalBenchmarkItem = {
  id: string;
  score: number;
};

export type RetrievalBenchmarkFixture = {
  id: string;
  query: string;
  relevantIds: string[];
  runs: Record<RetrievalMethod, RetrievalBenchmarkItem[]>;
};

export type RetrievalBenchmarkMetrics = {
  recallAtK: number;
  mrr: number;
  topId?: string;
};

export type RetrievalBenchmarkResult = {
  fixtureId: string;
  query: string;
  metrics: Record<RetrievalMethod, RetrievalBenchmarkMetrics>;
  winner: RetrievalMethod;
};

const METHODS: RetrievalMethod[] = ["legacy", "derivedFts", "derivedVector"];

function metricsForRun(
  run: RetrievalBenchmarkItem[],
  relevantIds: Set<string>,
  topK: number,
): RetrievalBenchmarkMetrics {
  const limited = run.slice(0, Math.max(1, topK));
  const hits = limited.filter((item) => relevantIds.has(item.id));
  const firstHitIndex = limited.findIndex((item) => relevantIds.has(item.id));

  return {
    recallAtK: relevantIds.size === 0 ? 0 : hits.length / relevantIds.size,
    mrr: firstHitIndex === -1 ? 0 : 1 / (firstHitIndex + 1),
    topId: limited[0]?.id,
  };
}

export function compareRetrievalRuns(
  fixture: RetrievalBenchmarkFixture,
  topK = 5,
): RetrievalBenchmarkResult {
  const relevantIds = new Set(fixture.relevantIds);
  const metrics = Object.fromEntries(
    METHODS.map((method) => [method, metricsForRun(fixture.runs[method] ?? [], relevantIds, topK)]),
  ) as Record<RetrievalMethod, RetrievalBenchmarkMetrics>;

  const winner = METHODS.reduce((best, method) => {
    const current = metrics[method];
    const incumbent = metrics[best];
    if (current.recallAtK > incumbent.recallAtK) return method;
    if (current.recallAtK === incumbent.recallAtK && current.mrr > incumbent.mrr) return method;
    return best;
  }, METHODS[0]);

  return {
    fixtureId: fixture.id,
    query: fixture.query,
    metrics,
    winner,
  };
}

export function summarizeBenchmarkSuite(fixtures: RetrievalBenchmarkFixture[], topK = 5): {
  fixtures: number;
  averages: Record<RetrievalMethod, RetrievalBenchmarkMetrics>;
  results: RetrievalBenchmarkResult[];
} {
  const results = fixtures.map((fixture) => compareRetrievalRuns(fixture, topK));
  const averages = Object.fromEntries(
    METHODS.map((method) => {
      const total = results.reduce(
        (sum, result) => ({
          recallAtK: sum.recallAtK + result.metrics[method].recallAtK,
          mrr: sum.mrr + result.metrics[method].mrr,
        }),
        { recallAtK: 0, mrr: 0 },
      );
      const divisor = Math.max(1, results.length);
      return [
        method,
        {
          recallAtK: total.recallAtK / divisor,
          mrr: total.mrr / divisor,
        },
      ];
    }),
  ) as Record<RetrievalMethod, RetrievalBenchmarkMetrics>;

  return {
    fixtures: fixtures.length,
    averages,
    results,
  };
}
