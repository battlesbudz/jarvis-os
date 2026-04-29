/**
 * End-to-end tests: memory health alert recovery for extractAndStore exit paths.
 *
 * Each test either calls the real `extractAndStore` function or exercises the
 * real `diagnosticsService.emit()` directly and verifies that:
 *
 *   1. (EX-1) extractAndStore emits the exact recovery payload on success.
 *   2. (EX-2) extractAndStore does NOT emit a recovery signal when the LLM fails.
 *   3. (EX-3) Calling diagnosticsService.emit() with the exact extractor recovery
 *             payload clears a pre-inserted degraded-memory state in the DB.
 *
 * Module mocking strategy (CJS-compatible)
 * ─────────────────────────────────────────
 * tsx/esbuild compiles TypeScript named exports as non-configurable getter
 * properties on the module's exports object, so direct assignment or
 * Object.defineProperty on those properties both fail.  The workaround is to
 * replace the *entire* exports object stored in the require cache with a thin
 * wrapper that inherits everything from the real exports via Object.create but
 * overrides `emit` as a plain writable own property.
 *
 * Because extractor.ts captures `require("./diagnosticsService")` and
 * `require("openai")` into local variables at module initialisation, we must
 * delete extractor.ts from the require cache *after* installing the wrappers
 * so every test gets a fresh extractor module whose internal references point
 * to the spies.
 *
 * EX-3 uses the REAL diagnosticsService.emit() (no spy) to exercise the full
 * clearDegradation path and confirm the DB is actually updated.
 *
 * Run with:  tsx server/memory/__tests__/extractorHealthAlerts.test.ts
 */

import { createRequire } from "node:module";
import { db, pool } from "../../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { ExtractInput } from "../../memory/extractor";
import { emit as realDiagEmit } from "../../diagnostics/diagnosticsService";

const req = createRequire(import.meta.url);
const DIAG_SVC_PATH  = req.resolve("../../diagnostics/diagnosticsService");
const EXTRACTOR_PATH = req.resolve("../../memory/extractor");
const OPENAI_PATH    = req.resolve("openai");

// ─── Test user fixtures ────────────────────────────────────────────────────────

const TEST_USERS = [
  { id: "__extractor_ex1__", username: "__extractor_ex1__" },
  { id: "__extractor_ex2__", username: "__extractor_ex2__" },
  { id: "__extractor_ex3__", username: "__extractor_ex3__" },
];

let passed = 0;
let failed = 0;

function ok(condition: boolean, label: string): void {
  if (condition) { console.log(`✓ ${label}`); passed++; }
  else           { console.error(`✗ ${label}`); failed++; }
}

// ─── Mock OpenAI classes ──────────────────────────────────────────────────────

/** Returns one valid memory from chat completions (no embedding support needed). */
class MockOpenAIWithMemory {
  chat = {
    completions: {
      create: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              memories: [{
                content: "User prefers asynchronous communication over meetings",
                category: "communication_style",
                confidence: 85,
                tier: "long_term",
                memory_type: "semantic",
              }],
            }),
          },
        }],
      }),
    },
  };
}

/** Simulates an LLM hard failure on chat completions. */
class MockOpenAIFailure {
  chat = {
    completions: {
      create: async (): Promise<never> => {
        throw new Error("Simulated LLM failure for extractor testing");
      },
    },
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DiagCall = {
  userId?: string;
  subsystem: string;
  severity: string;
  message: string;
  metadata?: Record<string, unknown>;
};

// ─── Module spy helper ────────────────────────────────────────────────────────

/**
 * Install a diagEmit spy and return a fresh extractor module.
 *
 * Steps performed:
 *   1. Ensure diagnosticsService is in the require cache.
 *   2. Create a spy wrapper for the exports object and install it in cache.
 *   3. Replace openai.exports with a Proxy that returns the mock constructor
 *      for `.default` (the way extractor.ts imports it at module init time).
 *   4. Delete extractor.ts from cache so it reloads with both spies in scope.
 *   5. Load and return the fresh extractor module.
 *
 * The returned `restore()` puts the originals back and purges the fresh extractor.
 */
function setupExtractorWithSpy(MockOpenAI: new () => unknown): {
  extractor: { extractAndStore(input: ExtractInput): Promise<unknown> };
  calls: DiagCall[];
  restore(): void;
} {
  // Ensure diagnosticsService is loaded into the require cache.
  if (!req.cache![DIAG_SVC_PATH]) req(DIAG_SVC_PATH);
  const realDiagExports = req.cache![DIAG_SVC_PATH]!.exports as Record<string, unknown>;

  const calls: DiagCall[] = [];
  const emitSpy = async (opts: DiagCall): Promise<void> => { calls.push(opts); };

  // Create a wrapper whose prototype is the real exports, with `emit` overridden
  // as an own, writable property so it shadows the non-configurable getter.
  const diagWrapper = Object.create(realDiagExports) as Record<string, unknown>;
  Object.defineProperty(diagWrapper, "emit", {
    value: emitSpy,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  req.cache![DIAG_SVC_PATH]!.exports = diagWrapper;

  // Replace openai exports with a Proxy that intercepts `.default` (the
  // constructor) while preserving everything else from the real module.
  if (!req.cache![OPENAI_PATH]) req(OPENAI_PATH);
  const realOpenAIExports = req.cache![OPENAI_PATH]!.exports;
  const openaiProxy = new Proxy(realOpenAIExports as object, {
    get(_target, prop) {
      if (prop === "default") return MockOpenAI;
      return (realOpenAIExports as Record<string | symbol, unknown>)[prop as string];
    },
  });
  req.cache![OPENAI_PATH]!.exports = openaiProxy;

  // Delete extractor.ts so a fresh load picks up both spy wrappers.
  delete req.cache![EXTRACTOR_PATH];
  const extractor = req(EXTRACTOR_PATH) as {
    extractAndStore(input: ExtractInput): Promise<unknown>;
  };

  return {
    extractor,
    calls,
    restore: () => {
      req.cache![DIAG_SVC_PATH]!.exports = realDiagExports;
      req.cache![OPENAI_PATH]!.exports = realOpenAIExports;
      delete req.cache![EXTRACTOR_PATH];
    },
  };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function setupUsers(): Promise<void> {
  for (const u of TEST_USERS) {
    await db
      .insert(schema.users)
      .values({ id: u.id, username: u.username })
      .onConflictDoNothing();
  }
}

/**
 * Delete test users and all their dependent data.
 * Many child tables lack ON DELETE CASCADE, so we disable FK checks for this
 * session (SET session_replication_role = 'replica') to let the delete go
 * through, then restore the origin role immediately after.
 */
async function cleanup(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET session_replication_role = 'replica'");
    for (const u of TEST_USERS) {
      await client.query("DELETE FROM users WHERE id = $1", [u.id]);
    }
  } finally {
    await client.query("SET session_replication_role = 'origin'");
    client.release();
  }
}

/**
 * Insert a synthetic `pattern_detected` critical event into diagnostic_events
 * to simulate a degraded memory subsystem for a given user.
 * Returns the inserted row's id.
 */
async function insertDegradedEvent(userId: string): Promise<string> {
  const rows = await db
    .insert(schema.diagnosticEvents)
    .values({
      userId,
      subsystem: "memory",
      severity: "critical",
      message: `Subsystem degraded: Memory — 3 errors in 15 minutes`,
      metadata: { type: "pattern_detected", errorCount: 3 },
      resolved: false,
    })
    .returning({ id: schema.diagnosticEvents.id });
  return rows[0]!.id;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await cleanup();
  await setupUsers();

  // ── EX-1: successful extraction path — full payload shape ─────────────────
  // LLM returns one valid memory → extraction succeeds without errors.
  // Expected emit: {
  //   userId, subsystem:"memory", severity:"info",
  //   message:"Memory extraction completed successfully",
  //   metadata:{ recovery:true, operation:"extractAndStore", sourceType:"chat", stored:N }
  // }
  {
    const userId = TEST_USERS[0].id;
    const sourceType = "chat";
    const { extractor, calls, restore } = setupExtractorWithSpy(MockOpenAIWithMemory);
    try {
      await extractor.extractAndStore({
        userId,
        source: "I really prefer async communication — no meetings if possible, just leave me a message.",
        sourceType,
      });
    } finally {
      restore();
    }

    const rc = calls.filter(c => c.severity === "info" && c.metadata?.recovery === true);
    ok(rc.length >= 1,
      "EX-1: extractAndStore emits a recovery signal on successful completion");
    ok(rc.some(c => c.subsystem === "memory"),
      "EX-1: recovery signal targets the memory subsystem");
    ok(rc.some(c => c.severity === "info"),
      "EX-1: recovery signal has severity=info");
    ok(rc.some(c => c.message === "Memory extraction completed successfully"),
      'EX-1: recovery signal carries the exact message from extractor.ts');
    ok(rc.some(c => c.metadata?.operation === "extractAndStore"),
      'EX-1: recovery payload carries operation="extractAndStore"');
    ok(rc.some(c => c.metadata?.sourceType === sourceType),
      'EX-1: recovery payload carries matching sourceType');
    ok(rc.some(c => typeof c.metadata?.stored === "number"),
      "EX-1: recovery payload includes numeric stored field");
    ok(rc.some(c => c.userId === userId),
      "EX-1: recovery signal carries the correct userId");
  }

  // ── EX-2: LLM error path — no recovery signal (negative test) ─────────────
  // LLM throws → hadAnyError = true → extraction must NOT emit a recovery signal.
  // Verifies: a failed extraction must never falsely clear degraded state.
  {
    const userId = TEST_USERS[1].id;
    const { extractor, calls, restore } = setupExtractorWithSpy(MockOpenAIFailure);
    try {
      await extractor.extractAndStore({
        userId,
        source: "Some text that will never be processed due to the LLM failure.",
        sourceType: "chat",
      });
    } finally {
      restore();
    }

    const rc = calls.filter(c => c.severity === "info" && c.metadata?.recovery === true);
    ok(rc.length === 0,
      "EX-2: LLM failure path emits no recovery signal (negative test)");

    const errorCalls = calls.filter(c => c.severity === "error");
    ok(errorCalls.length >= 1,
      "EX-2: LLM failure path does emit an error diagnostic signal");
  }

  // ── EX-3: degraded state is actually cleared in the DB ───────────────────
  // This test exercises the full diagnosticsService.emit() → clearDegradation
  // flow end-to-end against real persisted DB state.
  //
  // Steps:
  //   1. Insert a `pattern_detected` critical event (resolved=false) to simulate
  //      a degraded memory subsystem.
  //   2. Confirm the row is present and unresolved.
  //   3. Call the real diagnosticsService.emit() with the exact payload that
  //      extractAndStore emits on success (!hadAnyError).
  //   4. Query the DB and confirm the pattern_detected row now has resolved=true.
  {
    const userId = TEST_USERS[2].id;
    const sourceType = "chat";

    // Step 1 – plant a degraded-state event for this user.
    const degradedId = await insertDegradedEvent(userId);

    // Step 2 – sanity-check: row is present and unresolved.
    const before = await db
      .select({ id: schema.diagnosticEvents.id, resolved: schema.diagnosticEvents.resolved })
      .from(schema.diagnosticEvents)
      .where(
        and(
          eq(schema.diagnosticEvents.id, degradedId),
          eq(schema.diagnosticEvents.resolved, false),
        ),
      );
    ok(before.length === 1,
      "EX-3: degraded pattern_detected event exists and is unresolved before recovery");

    // Step 3 – call the real emit() with the exact recovery payload from extractor.ts.
    await realDiagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Memory extraction completed successfully",
      metadata: { recovery: true, operation: "extractAndStore", sourceType, stored: 1 },
    });

    // Step 4 – verify the pattern_detected row is now resolved.
    const after = await db
      .select({ id: schema.diagnosticEvents.id, resolved: schema.diagnosticEvents.resolved })
      .from(schema.diagnosticEvents)
      .where(
        and(
          eq(schema.diagnosticEvents.id, degradedId),
          eq(schema.diagnosticEvents.resolved, true),
        ),
      );
    ok(after.length === 1,
      "EX-3: diagnosticsService clears degraded memory state after receiving the extractor recovery signal");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) { process.exit(1); }
}

run()
  .catch((err) => {
    console.error("Test suite crashed:", err);
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => {}).then(() => process.exit(0)));
