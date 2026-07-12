import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  STARTER_RETRIEVAL_REGRESSION_CASES,
  type RetrievalEvaluationCase,
} from "../server/memory/evals/retrievalRegressionCases";
import { summarizeRetrievalEvaluations } from "../server/memory/retrievalEvaluation";

function loadCases(filePath: string | undefined): RetrievalEvaluationCase[] {
  if (!filePath) return STARTER_RETRIEVAL_REGRESSION_CASES;

  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), filePath), "utf8")) as unknown;
  const cases = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { cases?: unknown }).cases)
      ? (parsed as { cases: unknown[] }).cases
      : null;
  if (!cases) {
    throw new Error("Retrieval evaluation input must be an array or an object with a cases array.");
  }
  return cases as RetrievalEvaluationCase[];
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
