import fs from "node:fs";
import path from "node:path";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const TEST_USER_ID = "__brain_vector_db_verification__";
const TEST_PAGE_SLUG = "memory/brain-vector-db-verification";
const TEST_VECTOR = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 0.125 : 0.5));

export type BrainVectorVerificationCheckId =
  | "migration_applied"
  | "pgvector_extension_available"
  | "embedding_vector_schema"
  | "refresh_index_writes_embedding_vector"
  | "vector_query_feature_flag"
  | "fallback_when_pgvector_unavailable";

export type BrainVectorVerificationStatus = "pass" | "fail" | "skip";

export type BrainVectorVerificationCheck = {
  id: BrainVectorVerificationCheckId;
  status: BrainVectorVerificationStatus;
  detail: string;
};

export type BrainVectorVerificationReport = {
  checkedAt: string;
  databaseTarget: string;
  liveDbOptIn: boolean;
  checks: BrainVectorVerificationCheck[];
  allPassed: boolean;
};

export const REQUIRED_BRAIN_VECTOR_DB_CHECKS: Array<{
  id: BrainVectorVerificationCheckId;
  label: string;
}> = [
  {
    id: "migration_applied",
    label: "migration 0009 applies cleanly",
  },
  {
    id: "pgvector_extension_available",
    label: "pgvector extension is available",
  },
  {
    id: "embedding_vector_schema",
    label: "brain_content_chunks.embedding_vector schema is present",
  },
  {
    id: "refresh_index_writes_embedding_vector",
    label: "refreshIndex writes embedding_vector",
  },
  {
    id: "vector_query_feature_flag",
    label: "vector query activates under JARVIS_BRAIN_VECTOR_RETRIEVAL=1",
  },
  {
    id: "fallback_when_pgvector_unavailable",
    label: "query fallback works when pgvector path is unavailable",
  },
];

export function redactDatabaseUrl(value: string | undefined): string {
  if (!value) return "not set";
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = "***";
    return parsed.toString().replace(/\?.*$/, "");
  } catch {
    return value.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:***@").replace(/\?.*$/, "");
  }
}

export function buildBrainVectorVerificationReport(input: {
  checkedAt?: string;
  databaseUrl?: string;
  liveDbOptIn: boolean;
  checks: BrainVectorVerificationCheck[];
}): BrainVectorVerificationReport {
  const requiredIds = new Set(REQUIRED_BRAIN_VECTOR_DB_CHECKS.map((check) => check.id));
  const allPassed = [...requiredIds].every((id) =>
    input.checks.some((check) => check.id === id && check.status === "pass"),
  );

  return {
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    databaseTarget: redactDatabaseUrl(input.databaseUrl),
    liveDbOptIn: input.liveDbOptIn,
    checks: input.checks,
    allPassed,
  };
}

export function formatBrainVectorVerificationReport(report: BrainVectorVerificationReport): string {
  const status = report.allPassed ? "PASS" : "BLOCKED";
  const lines = [
    `Brain vector live DB verification: ${status}`,
    `Checked at: ${report.checkedAt}`,
    `Database: ${report.databaseTarget}`,
    `Live DB opt-in: ${report.liveDbOptIn ? "yes" : "no"}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
  }

  return lines.join("\n");
}

function isTruthy(value: string | undefined): boolean {
  return TRUE_VALUES.has(String(value ?? "").toLowerCase());
}

async function recordCheck(
  checks: BrainVectorVerificationCheck[],
  id: BrainVectorVerificationCheckId,
  run: () => Promise<string>,
): Promise<void> {
  try {
    const detail = await run();
    checks.push({ id, status: "pass", detail });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push({ id, status: "fail", detail });
  }
}

function skippedChecks(detail: string): BrainVectorVerificationCheck[] {
  return REQUIRED_BRAIN_VECTOR_DB_CHECKS.map((check) => ({
    id: check.id,
    status: "skip",
    detail,
  }));
}

export async function runBrainVectorDbVerification(options: {
  projectRoot?: string;
  databaseUrl?: string;
  liveDbOptIn?: boolean;
  closePool?: boolean;
} = {}): Promise<BrainVectorVerificationReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const liveDbOptIn =
    options.liveDbOptIn ??
    (Boolean(process.env.JARVIS_TEST_DATABASE_URL) || isTruthy(process.env.JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL));

  if (!databaseUrl) {
    return buildBrainVectorVerificationReport({
      databaseUrl,
      liveDbOptIn,
      checks: skippedChecks("DATABASE_URL is not set"),
    });
  }

  if (!liveDbOptIn) {
    return buildBrainVectorVerificationReport({
      databaseUrl,
      liveDbOptIn,
      checks: skippedChecks("set JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL=1 to verify the live database"),
    });
  }

  const { eq, sql } = await import("drizzle-orm");
  const { db, pool } = await import("../db");
  const schema = await import("@shared/schema");
  const { jarvisBrainAdapter, queryBrainWithEmbedder, refreshIndexWithEmbedder } = await import("./adapter");
  const checks: BrainVectorVerificationCheck[] = [];

  async function cleanup(): Promise<void> {
    await db.delete(schema.brainPages).where(eq(schema.brainPages.userId, TEST_USER_ID)).catch(() => undefined);
    await db.delete(schema.brainIngestLog).where(eq(schema.brainIngestLog.userId, TEST_USER_ID)).catch(() => undefined);
    await db.delete(schema.brainConfig).where(eq(schema.brainConfig.userId, TEST_USER_ID)).catch(() => undefined);
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER_ID)).catch(() => undefined);
  }

  try {
    await recordCheck(checks, "migration_applied", async () => {
      for (const fileName of ["0008_brain_projection.sql", "0009_brain_vector_index.sql"]) {
        const migration = fs.readFileSync(path.join(projectRoot, "migrations", fileName), "utf8");
        await pool.query(migration);
      }
      return "0008_brain_projection.sql and 0009_brain_vector_index.sql executed successfully";
    });

    await recordCheck(checks, "pgvector_extension_available", async () => {
      const result = await pool.query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
      );
      const extversion = result.rows[0]?.extversion;
      if (!extversion) throw new Error("pgvector extension is not installed after migration");
      return `pgvector extension installed (version ${extversion})`;
    });

    await recordCheck(checks, "embedding_vector_schema", async () => {
      const column = await pool.query<{ udt_name: string; data_type: string }>(
        `SELECT udt_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'brain_content_chunks'
           AND column_name = 'embedding_vector'`,
      );
      const index = await pool.query<{ indexname: string }>(
        `SELECT indexname
         FROM pg_indexes
         WHERE tablename = 'brain_content_chunks'
           AND indexname = 'brain_chunks_embedding_vector_idx'`,
      );
      if (!column.rows[0]) throw new Error("brain_content_chunks.embedding_vector column is missing");
      if (column.rows[0].udt_name !== "vector") {
        throw new Error(`embedding_vector uses unexpected type ${column.rows[0].udt_name}`);
      }
      if (!index.rows[0]) throw new Error("brain_chunks_embedding_vector_idx is missing");
      return "embedding_vector vector column and IVFFlat index are present";
    });

    await recordCheck(checks, "refresh_index_writes_embedding_vector", async () => {
      await cleanup();
      await db.insert(schema.users).values({ id: TEST_USER_ID, username: TEST_USER_ID }).onConflictDoNothing();
      const page = await jarvisBrainAdapter.upsertEvidence({
        userId: TEST_USER_ID,
        actorId: "brain-vector-db-verification",
        pageType: "memory",
        slug: TEST_PAGE_SLUG,
        title: "Brain vector DB verification",
        compiledTruth:
          "Jarvis brain vector verification lexical fallback token confirms packable autonomy memory recall.",
        sourceKind: "test",
        sourceId: "brain-vector-db-verification",
        provenance: [{ kind: "user_memory", id: "brain-vector-db-verification" }],
      });

      const refresh = await refreshIndexWithEmbedder(
        { userId: TEST_USER_ID, actorId: "brain-vector-db-verification", staleOnly: false, limit: 5 },
        async () => TEST_VECTOR,
      );
      if (refresh.embedded < 1) throw new Error(`expected at least one embedded chunk, got ${refresh.embedded}`);

      const vector = await pool.query<{ embedding_vector: string | null }>(
        "SELECT embedding_vector::text AS embedding_vector FROM brain_content_chunks WHERE page_id = $1 LIMIT 1",
        [page.pageId],
      );
      if (!vector.rows[0]?.embedding_vector) throw new Error("embedding_vector was not written");
      return "refreshIndexWithEmbedder wrote embedding_vector for a derived brain chunk";
    });

    await recordCheck(checks, "vector_query_feature_flag", async () => {
      const previousFlag = process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL;
      process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL = "1";
      try {
        const result = await queryBrainWithEmbedder(
          {
            userId: TEST_USER_ID,
            actorId: "brain-vector-db-verification",
            query: "no lexical overlap for vector verification",
            topK: 1,
          },
          async () => TEST_VECTOR,
        );
        if (result.chunks[0]?.pageSlug !== TEST_PAGE_SLUG) {
          throw new Error("vector query did not return the seeded verification page");
        }
        return "vector query returned the seeded chunk under JARVIS_BRAIN_VECTOR_RETRIEVAL=1";
      } finally {
        if (previousFlag === undefined) {
          delete process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL;
        } else {
          process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL = previousFlag;
        }
      }
    });

    await recordCheck(checks, "fallback_when_pgvector_unavailable", async () => {
      const previousFlag = process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL;
      process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL = "1";
      const mutableDb = db as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
      const originalExecute = mutableDb.execute.bind(db);
      const originalWarn = console.warn;
      let injectedFailure = false;
      mutableDb.execute = async (...args: unknown[]) => {
        if (!injectedFailure) {
          injectedFailure = true;
          throw new Error("simulated pgvector unavailable");
        }
        return originalExecute(...args);
      };
      console.warn = (...args: unknown[]) => {
        const message = args.map((arg) => String(arg)).join(" ");
        if (message.includes("simulated pgvector unavailable")) return;
        originalWarn(...args);
      };

      try {
        const result = await queryBrainWithEmbedder(
          {
            userId: TEST_USER_ID,
            actorId: "brain-vector-db-verification",
            query: "brain vector verification lexical fallback token",
            topK: 1,
          },
          async () => TEST_VECTOR,
        );
        if (!injectedFailure) throw new Error("simulated vector failure was not injected");
        if (result.chunks[0]?.pageSlug !== TEST_PAGE_SLUG) {
          throw new Error("fallback query did not return the seeded verification page");
        }
        return "simulated pgvector failure fell back to FTS retrieval";
      } finally {
        mutableDb.execute = originalExecute;
        console.warn = originalWarn;
        if (previousFlag === undefined) {
          delete process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL;
        } else {
          process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL = previousFlag;
        }
      }
    });
  } finally {
    await cleanup().catch(() => undefined);
    if (options.closePool) await pool.end().catch(() => undefined);
  }

  return buildBrainVectorVerificationReport({
    databaseUrl,
    liveDbOptIn,
    checks,
  });
}
