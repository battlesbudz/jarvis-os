import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

async function syncIsolatedTestSchema(): Promise<void> {
  const testDatabaseUrl = process.env.JARVIS_TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) {
    console.warn("JARVIS_TEST_DATABASE_URL is not set; skipping destructive test schema synchronization.");
    return;
  }

  const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (configuredDatabaseUrl && configuredDatabaseUrl !== testDatabaseUrl) {
    throw new Error("DATABASE_URL must match JARVIS_TEST_DATABASE_URL before synchronizing the test schema.");
  }
  process.env.DATABASE_URL = testDatabaseUrl;

  const extensionPool = new pg.Pool({ connectionString: testDatabaseUrl });
  try {
    await extensionPool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await extensionPool.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    await extensionPool.end();
  }

  const drizzleCli = path.resolve(process.cwd(), "node_modules", "drizzle-kit", "bin.cjs");
  const result = spawnSync(process.execPath, [drizzleCli, "push", "--force"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`drizzle-kit push failed with exit code ${result.status ?? "unknown"}.`);
  }
}

async function main(): Promise<void> {
  await syncIsolatedTestSchema();
  const { ensureTablesExist, pool } = await import("../server/db");
  try {
    await ensureTablesExist();
    console.log("Test database schema prepared.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
