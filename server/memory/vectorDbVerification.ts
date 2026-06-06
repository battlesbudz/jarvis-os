import fs from "node:fs";
import path from "node:path";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const TEST_USER_ID = "__memory_vector_db_verification__";
const TEST_MEMORY_ID = "memory-vector-db-verification";
const TEST_VECTOR = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 0.25 : 0.5));
const TEST_CONTENT =
  "Canonical memory vector verification lexical fallback token confirms packable autonomy memory recall.";

export type MemoryVectorVerificationCheckId =
  | "migration_applied"
  | "pgvector_extension_available"
  | "embedding_vector_schema"
  | "jsonb_backfill_writes_embedding_vector"
  | "vector_query_feature_flag"
  | "fallback_when_pgvector_unavailable";

export type MemoryVectorVerificationStatus = "pass" | "fail" | "skip";

export type MemoryVectorVerificationCheck = {
  id: MemoryVectorVerificationCheckId;
  status: MemoryVectorVerificationStatus;
  detail: string;
};

export type MemoryVectorVerificationReport = {
  checkedAt: string;
  databaseTarget: string;
  liveDbOptIn: boolean;
  checks: MemoryVectorVerificationCheck[];
  allPassed: boolean;
};

export const REQUIRED_MEMORY_VECTOR_DB_CHECKS: Array<{
  id: MemoryVectorVerificationCheckId;
  label: string;
}> = [
  {
    id: "migration_applied",
    label: "migration 0010 applies cleanly",
  },
  {
    id: "pgvector_extension_available",
    label: "pgvector extension is available",
  },
  {
    id: "embedding_vector_schema",
    label: "user_memories.embedding_vector schema is present",
  },
  {
    id: "jsonb_backfill_writes_embedding_vector",
    label: "JSONB embedding backfill writes embedding_vector",
  },
  {
    id: "vector_query_feature_flag",
    label: "vector query activates under JARVIS_MEMORY_VECTOR_RETRIEVAL=1",
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

export function buildMemoryVectorVerificationReport(input: {
  checkedAt?: string;
  databaseUrl?: string;
  liveDbOptIn: boolean;
  checks: MemoryVectorVerificationCheck[];
}): MemoryVectorVerificationReport {
  const requiredIds = new Set(REQUIRED_MEMORY_VECTOR_DB_CHECKS.map((check) => check.id));
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

export function formatMemoryVectorVerificationReport(report: MemoryVectorVerificationReport): string {
  const status = report.allPassed ? "PASS" : "BLOCKED";
  const lines = [
    `Memory vector live DB verification: ${status}`,
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
  checks: MemoryVectorVerificationCheck[],
  id: MemoryVectorVerificationCheckId,
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

function skippedChecks(detail: string): MemoryVectorVerificationCheck[] {
  return REQUIRED_MEMORY_VECTOR_DB_CHECKS.map((check) => ({
    id: check.id,
    status: "skip",
    detail,
  }));
}

export async function runMemoryVectorDbVerification(options: {
  projectRoot?: string;
  databaseUrl?: string;
  liveDbOptIn?: boolean;
  closePool?: boolean;
} = {}): Promise<MemoryVectorVerificationReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const liveDbOptIn =
    options.liveDbOptIn ??
    (Boolean(process.env.JARVIS_TEST_DATABASE_URL) || isTruthy(process.env.JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL));

  if (!databaseUrl) {
    return buildMemoryVectorVerificationReport({
      databaseUrl,
      liveDbOptIn,
      checks: skippedChecks("DATABASE_URL is not set"),
    });
  }

  if (!liveDbOptIn) {
    return buildMemoryVectorVerificationReport({
      databaseUrl,
      liveDbOptIn,
      checks: skippedChecks("set JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL=1 to verify the live database"),
    });
  }

  const { eq } = await import("drizzle-orm");
  const { db, pool } = await import("../db");
  const schema = await import("@shared/schema");
  const { retrieveCanonicalMemoriesWithQueryVector } = await import("./retrieve");
  const { searchMemoryVectors, syncExistingMemoryEmbeddingVectors } = await import("./vectorStore");
  const checks: MemoryVectorVerificationCheck[] = [];

  async function cleanup(): Promise<void> {
    await db.delete(schema.userMemories).where(eq(schema.userMemories.userId, TEST_USER_ID)).catch(() => undefined);
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER_ID)).catch(() => undefined);
  }

  async function seedJsonbOnlyMemory(): Promise<void> {
    await cleanup();
    await db.insert(schema.users).values({ id: TEST_USER_ID, username: TEST_USER_ID }).onConflictDoNothing();
    await db.insert(schema.userMemories).values({
      id: TEST_MEMORY_ID,
      userId: TEST_USER_ID,
      content: TEST_CONTENT,
      category: "fact",
      tier: "long_term",
      memoryType: "semantic",
      relevanceScore: 75,
      confidence: 90,
      pendingReview: false,
      reviewStatus: "active",
      embedding: TEST_VECTOR,
    });
  }

  try {
    await recordCheck(checks, "migration_applied", async () => {
      const migration = fs.readFileSync(path.join(projectRoot, "migrations", "0010_user_memory_vector_index.sql"), "utf8");
      await pool.query(migration);
      return "0010_user_memory_vector_index.sql executed successfully";
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
         WHERE table_name = 'user_memories'
           AND column_name = 'embedding_vector'`,
      );
      const index = await pool.query<{ indexname: string }>(
        `SELECT indexname
         FROM pg_indexes
         WHERE tablename = 'user_memories'
           AND indexname = 'user_memories_embedding_vector_idx'`,
      );
      if (!column.rows[0]) throw new Error("user_memories.embedding_vector column is missing");
      if (column.rows[0].udt_name !== "vector") {
        throw new Error(`embedding_vector uses unexpected type ${column.rows[0].udt_name}`);
      }
      if (!index.rows[0]) throw new Error("user_memories_embedding_vector_idx is missing");
      return "embedding_vector vector column and IVFFlat index are present";
    });

    await recordCheck(checks, "jsonb_backfill_writes_embedding_vector", async () => {
      await seedJsonbOnlyMemory();
      const sync = await syncExistingMemoryEmbeddingVectors(5);
      if (sync.unavailable) throw new Error("JSONB-to-pgvector sync reported pgvector unavailable");
      if (sync.updated < 1) throw new Error(`expected at least one vector backfill, got ${sync.updated}`);
      const vector = await pool.query<{ embedding_vector: string | null }>(
        "SELECT embedding_vector::text AS embedding_vector FROM user_memories WHERE id = $1 LIMIT 1",
        [TEST_MEMORY_ID],
      );
      if (!vector.rows[0]?.embedding_vector) throw new Error("embedding_vector was not written");
      return "existing JSONB embedding was mirrored into user_memories.embedding_vector";
    });

    await recordCheck(checks, "vector_query_feature_flag", async () => {
      const previousFlag = process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL;
      process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL = "1";
      try {
        const result = await searchMemoryVectors({
          userId: TEST_USER_ID,
          query: "no lexical overlap for vector verification",
          queryEmbedding: TEST_VECTOR,
          limit: 1,
        });
        if (result.status !== "ok") throw new Error(`vector query returned ${result.status}`);
        if (result.rows[0]?.id !== TEST_MEMORY_ID) {
          throw new Error("vector query did not return the seeded canonical memory");
        }
        return "vector query returned the seeded memory under JARVIS_MEMORY_VECTOR_RETRIEVAL=1";
      } finally {
        if (previousFlag === undefined) {
          delete process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL;
        } else {
          process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL = previousFlag;
        }
      }
    });

    await recordCheck(checks, "fallback_when_pgvector_unavailable", async () => {
      const previousFlag = process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL;
      process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL = "1";
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
        const result = await retrieveCanonicalMemoriesWithQueryVector(
          TEST_USER_ID,
          "canonical memory vector verification lexical fallback token",
          TEST_VECTOR,
          1,
          true,
        );
        if (!injectedFailure) throw new Error("simulated vector failure was not injected");
        if (result[0]?.id !== TEST_MEMORY_ID) {
          throw new Error("retrieveRelevantMemories fallback did not return the seeded canonical memory");
        }
        return "simulated pgvector failure fell back through canonical memory retrieval";
      } finally {
        mutableDb.execute = originalExecute;
        console.warn = originalWarn;
        if (previousFlag === undefined) {
          delete process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL;
        } else {
          process.env.JARVIS_MEMORY_VECTOR_RETRIEVAL = previousFlag;
        }
      }
    });
  } finally {
    await cleanup().catch(() => undefined);
    if (options.closePool) await pool.end().catch(() => undefined);
  }

  return buildMemoryVectorVerificationReport({
    databaseUrl,
    liveDbOptIn,
    checks,
  });
}
