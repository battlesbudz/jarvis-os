import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  STARTER_RETRIEVAL_REGRESSION_CASES,
} from "../server/memory/evals/retrievalRegressionCases";
import {
  requireRetrievalEvaluationCases,
  summarizeRetrievalEvaluations,
  type RetrievalEvaluationCase,
} from "../server/memory/retrievalEvaluation";

function loadCases(filePath: string | undefined): RetrievalEvaluationCase[] {
  if (!filePath) return STARTER_RETRIEVAL_REGRESSION_CASES;

  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), filePath), "utf8")) as unknown;
  return requireRetrievalEvaluationCases(parsed);
}

function main(): void {
  const cases = loadCases(process.argv[2]?.trim());
  const summary = summarizeRetrievalEvaluations(cases);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
