import assert from "node:assert/strict";
import {
  REQUIRED_MEMORY_VECTOR_DB_CHECKS,
  buildMemoryVectorVerificationReport,
  formatMemoryVectorVerificationReport,
  redactDatabaseUrl,
} from "../vectorDbVerification";

const requiredIds = REQUIRED_MEMORY_VECTOR_DB_CHECKS.map((check) => check.id);

assert.deepEqual(
  requiredIds,
  [
    "migration_applied",
    "pgvector_extension_available",
    "embedding_vector_schema",
    "jsonb_backfill_writes_embedding_vector",
    "vector_query_feature_flag",
    "fallback_when_pgvector_unavailable",
  ],
  "required verifier checks must match the Canonical Memory Vector Index plan",
);

const passingReport = buildMemoryVectorVerificationReport({
  checkedAt: "2026-06-05T12:00:00.000Z",
  databaseUrl: "postgresql://jarvis:secret@example.com:5432/jarvis?sslmode=require",
  liveDbOptIn: true,
  checks: REQUIRED_MEMORY_VECTOR_DB_CHECKS.map((check) => ({
    id: check.id,
    status: "pass",
    detail: `${check.label} passed`,
  })),
});

assert.equal(passingReport.allPassed, true, "all required pass checks should complete the canonical vector slice");
assert.equal(
  redactDatabaseUrl("postgresql://jarvis:secret@example.com:5432/jarvis?sslmode=require"),
  "postgresql://jarvis:***@example.com:5432/jarvis",
  "database URLs should be redacted before reporting",
);

const passingOutput = formatMemoryVectorVerificationReport(passingReport);
assert.match(passingOutput, /Memory vector live DB verification: PASS/);
assert.match(passingOutput, /jsonb_backfill_writes_embedding_vector/);
assert.match(passingOutput, /postgresql:\/\/jarvis:\*\*\*@example\.com:5432\/jarvis/);
assert.doesNotMatch(passingOutput, /secret/);

const blockedReport = buildMemoryVectorVerificationReport({
  checkedAt: "2026-06-05T12:00:00.000Z",
  databaseUrl: "postgresql://jarvis:secret@example.com:5432/jarvis?sslmode=require",
  liveDbOptIn: true,
  checks: [
    ...REQUIRED_MEMORY_VECTOR_DB_CHECKS.slice(0, -1).map((check) => ({
      id: check.id,
      status: "pass" as const,
      detail: `${check.label} passed`,
    })),
    {
      id: "fallback_when_pgvector_unavailable" as const,
      status: "fail" as const,
      detail: "simulated vector failure did not fall back",
    },
  ],
});

assert.equal(blockedReport.allPassed, false, "one failed required check should block the canonical vector slice");
assert.match(formatMemoryVectorVerificationReport(blockedReport), /Memory vector live DB verification: BLOCKED/);

console.log("OK: memory vector DB verifier contract matches the roadmap slice");
