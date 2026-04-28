/**
 * Assertions for the DB-backed write-budget circuit breaker.
 *
 * Run with:  npx tsx server/agent/__tests__/writeBudget.assert.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 *
 * Tests:
 *   A. recordAutonomousWrite persists a row to write_budget_log
 *   B. checkCircuitBreaker reads count from DB, and the count survives a
 *      simulated server restart (fresh child process with empty module cache)
 *   B2. Circuit trips at exactly CIRCUIT_MAX_WRITES (10)
 *   C. Sliding window — rows outside the 60-min window are not counted
 *   D. resetCircuitBreaker clears all rows from the table
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";

/** Project root — two levels up from __tests__/ */
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

/**
 * Spawn a completely fresh Node/tsx process that imports safeWritePolicy from
 * scratch (no shared in-memory state with the current process) and calls
 * checkCircuitBreaker(). Returns the count reported by that fresh process.
 *
 * This simulates a server restart: each invocation starts with a cold module
 * cache, so any count it reads must come from the DB.
 */
function checkCircuitBreakerInFreshProcess(): number {
  const tmpScript = path.join(os.tmpdir(), `writeBudget_restart_check_${Date.now()}.ts`);
  const dbPath = path.join(PROJECT_ROOT, "server/db");
  const policyPath = path.join(PROJECT_ROOT, "server/agent/safeWritePolicy");

  fs.writeFileSync(
    tmpScript,
    `
import { ensureTablesExist } from ${JSON.stringify(dbPath)};
import { checkCircuitBreaker } from ${JSON.stringify(policyPath)};

(async () => {
  await ensureTablesExist().catch(() => {});
  const status = await checkCircuitBreaker();
  // Write a JSON sentinel line that is easy to extract from noisy stdout.
  process.stdout.write("RESULT:" + JSON.stringify({ count: status.count }) + "\\n");
  process.exit(0);
})().catch((err) => { process.stderr.write(String(err)); process.exit(1); });
`.trimStart(),
  );

  const tsxBin = path.join(PROJECT_ROOT, "node_modules/.bin/tsx");
  const result = spawnSync(tsxBin, [tmpScript], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 30_000,
  });

  fs.unlinkSync(tmpScript);

  if (result.status !== 0) {
    throw new Error(
      `Fresh-process check failed (exit ${result.status}):\n` +
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }

  // Extract the sentinel line "RESULT:{...}" from stdout (which may contain
  // other diagnostic output like "Database tables verified").
  const sentinelLine = result.stdout
    .split("\n")
    .find((line: string) => line.startsWith("RESULT:"));

  if (!sentinelLine) {
    throw new Error(
      `Fresh-process did not emit a RESULT: line.\nstdout: ${result.stdout}`,
    );
  }

  const parsed = JSON.parse(sentinelLine.slice("RESULT:".length)) as { count: number };
  return parsed.count;
}

(async () => {
  // Ensure DB tables exist before touching write_budget_log.
  const { db, pool, ensureTablesExist } = await import("../../db");
  await ensureTablesExist();

  const {
    checkCircuitBreaker,
    recordAutonomousWrite,
    resetCircuitBreaker,
  } = await import("../safeWritePolicy");

  // Helper: count all rows currently in write_budget_log.
  async function rowCount(): Promise<number> {
    const result = await db.execute(sql`SELECT COUNT(*)::int AS n FROM write_budget_log`);
    return Number((result.rows[0] as { n: number }).n);
  }

  // Helper: insert a row with a custom timestamp (bypasses recordAutonomousWrite
  // so we can plant rows outside the window for the sliding-window test).
  async function insertAt(ts: Date): Promise<void> {
    await db.execute(sql`INSERT INTO write_budget_log (written_at) VALUES (${ts})`);
  }

  // ── Baseline: clear table before all tests ──────────────────────────────────
  await resetCircuitBreaker();
  assert.equal(await rowCount(), 0, "Baseline: table starts empty");

  // ── A. recordAutonomousWrite persists to DB ─────────────────────────────────
  {
    await recordAutonomousWrite();
    const count = await rowCount();
    assert.equal(count, 1, "A: one row inserted after recordAutonomousWrite()");
    console.log("✓ A: recordAutonomousWrite() persists a row to write_budget_log");
  }

  // ── B. Budget count survives a simulated server restart ─────────────────────
  // Records writes in this process (which go to the DB), then spawns a fresh
  // child process with a completely empty module cache — simulating what happens
  // when the server restarts. The fresh process must read the same count from
  // the DB, proving the budget is DB-backed rather than held in memory.
  {
    await resetCircuitBreaker();

    const EXPECTED_WRITES = 4;
    for (let i = 0; i < EXPECTED_WRITES; i++) {
      await recordAutonomousWrite();
    }

    // Confirm count in the current process first.
    const statusHere = await checkCircuitBreaker();
    assert.equal(
      statusHere.count,
      EXPECTED_WRITES,
      `B: current process sees ${EXPECTED_WRITES} writes`,
    );

    // Spawn a fresh process — this simulates a server restart.
    const countAfterRestart = checkCircuitBreakerInFreshProcess();
    assert.equal(
      countAfterRestart,
      EXPECTED_WRITES,
      `B: fresh process (simulated restart) reports count == ${EXPECTED_WRITES}`,
    );
    console.log(
      `✓ B: write budget (${EXPECTED_WRITES} writes) survives server restart — ` +
      `fresh process with empty module cache reported count = ${countAfterRestart}`,
    );
  }

  // ── B2. checkCircuitBreaker trips at CIRCUIT_MAX_WRITES (10) ────────────────
  {
    await resetCircuitBreaker();

    for (let i = 0; i < 10; i++) {
      await recordAutonomousWrite();
    }

    const status = await checkCircuitBreaker();
    assert.equal(status.tripped, true, "B2: circuit tripped at 10 writes");
    assert.equal(status.count, 10, "B2: count reported as 10");
    assert.ok(status.resetAt instanceof Date, "B2: resetAt is a Date when tripped");
    console.log("✓ B2: checkCircuitBreaker() trips at 10 writes and returns resetAt");
  }

  // ── C. Sliding window — rows older than 60 min are excluded ─────────────────
  // Plant 5 rows that are 61 minutes in the past, then 2 fresh rows.
  // checkCircuitBreaker must count only the 2 fresh rows.
  {
    await resetCircuitBreaker();

    const sixtyOneMinutesAgo = new Date(Date.now() - 61 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      await insertAt(sixtyOneMinutesAgo);
    }

    assert.equal(await rowCount(), 5, "C setup: 5 old rows inserted");

    // Two fresh writes (recordAutonomousWrite also prunes expired rows).
    await recordAutonomousWrite();
    await recordAutonomousWrite();

    const status = await checkCircuitBreaker();
    assert.equal(status.tripped, false, "C: circuit not tripped — old rows excluded");
    assert.equal(status.count, 2, "C: only the 2 fresh rows are within the window");
    console.log("✓ C: sliding window excludes rows older than 60 minutes (count = 2)");
  }

  // ── D. resetCircuitBreaker clears the table ──────────────────────────────────
  {
    await recordAutonomousWrite();
    await recordAutonomousWrite();
    const before = await rowCount();
    assert.ok(before >= 2, "D setup: at least 2 rows exist before reset");

    await resetCircuitBreaker();

    const after = await rowCount();
    assert.equal(after, 0, "D: resetCircuitBreaker() clears all rows");

    const status = await checkCircuitBreaker();
    assert.equal(status.count, 0, "D: checkCircuitBreaker() returns 0 after reset");
    assert.equal(status.tripped, false, "D: circuit not tripped after reset");
    console.log("✓ D: resetCircuitBreaker() clears write_budget_log and resets count to 0");
  }

  console.log("\nAll write-budget assertions passed.");

  // Close the connection pool so the process can exit cleanly without
  // force-calling process.exit().
  await pool.end();
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
