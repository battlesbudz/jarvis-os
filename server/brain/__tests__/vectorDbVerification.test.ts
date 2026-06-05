import assert from "node:assert/strict";
import {
  REQUIRED_BRAIN_VECTOR_DB_CHECKS,
  buildBrainVectorVerificationReport,
  formatBrainVectorVerificationReport,
  redactDatabaseUrl,
} from "../vectorDbVerification";

const requiredIds = REQUIRED_BRAIN_VECTOR_DB_CHECKS.map((check) => check.id);

assert.deepEqual(
  requiredIds,
  [
    "migration_applied",
    "pgvector_extension_available",
    "embedding_vector_schema",
    "refresh_index_writes_embedding_vector",
    "vector_query_feature_flag",
    "fallback_when_pgvector_unavailable",
  ],
  "required verifier checks must match the G-Brain Live DB Verification plan",
);

const passingReport = buildBrainVectorVerificationReport({
  checkedAt: "2026-06-05T12:00:00.000Z",
  databaseUrl: "postgresql://jarvis:secret@example.com:5432/jarvis?sslmode=require",
  liveDbOptIn: true,
  checks: REQUIRED_BRAIN_VECTOR_DB_CHECKS.map((check) => ({
    id: check.id,
    status: "pass",
    detail: `${check.label} passed`,
  })),
});

assert.equal(passingReport.allPassed, true, "all required pass checks should complete the prerequisite");
assert.equal(
  redactDatabaseUrl("postgresql://jarvis:secret@example.com:5432/jarvis?sslmode=require"),
  "postgresql://jarvis:***@example.com:5432/jarvis",
  "database URLs should be redacted before reporting",
);

const passingOutput = formatBrainVectorVerificationReport(passingReport);
assert.match(passingOutput, /Brain vector live DB verification: PASS/);
assert.match(passingOutput, /migration_applied/);
assert.match(passingOutput, /postgresql:\/\/jarvis:\*\*\*@example\.com:5432\/jarvis/);
assert.doesNotMatch(passingOutput, /secret/);

const blockedReport = buildBrainVectorVerificationReport({
  checkedAt: "2026-06-05T12:00:00.000Z",
  databaseUrl: "postgresql://jarvis:secret@example.com:5432/jarvis?sslmode=require",
  liveDbOptIn: true,
  checks: [
    ...REQUIRED_BRAIN_VECTOR_DB_CHECKS.slice(0, -1).map((check) => ({
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

assert.equal(blockedReport.allPassed, false, "one failed required check should block the prerequisite");
assert.match(formatBrainVectorVerificationReport(blockedReport), /Brain vector live DB verification: BLOCKED/);

console.log("OK: brain vector DB verifier contract matches the roadmap prerequisite");
