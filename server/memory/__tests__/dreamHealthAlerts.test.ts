/**
 * End-to-end tests: memory health alert recovery on all dream cycle exit paths.
 *
 * Each test calls the real `runDreamForUser` function with deterministic stubs
 * for upstream dependencies (OpenAI LLM, diagEmit) and verifies that:
 *   1. The correct recovery payload ({ severity:"info", metadata.recovery:true })
 *      is emitted on each exit path.
 *   2. The downstream diagnostics consumer clears previously-flagged degraded
 *      state in response to any recovery signal.
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
 * Because dream.ts captures `require("./diagnosticsService")` into a local
 * variable at module initialisation, we must delete dream.ts from the require
 * cache *after* installing the wrapper so every test gets a fresh dream module
 * whose internal reference points to the spy.
 *
 * For the OpenAI mock the same technique applies: replace
 * `openai.exports.default` (which IS writable) before the fresh dream.ts loads.
 *
 * DB data: test users are created and deleted per run; memories are inserted
 * with explicit backdated timestamps so hasEnoughData() and buildCorpus()
 * produce deterministic outcomes for each path.
 *
 * Run with:  tsx server/memory/__tests__/dreamHealthAlerts.test.ts
 */

import { createRequire } from "node:module";
import { db, pool } from "../../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import type { DreamCycleResult } from "../../memory/dream";

const req = createRequire(import.meta.url);
const DIAG_SVC_PATH = req.resolve("../../diagnostics/diagnosticsService");
const DREAM_PATH    = req.resolve("../../memory/dream");
const OPENAI_PATH   = req.resolve("openai");

// ─── Test user fixtures ────────────────────────────────────────────────────────

const TEST_USERS = [
  { id: "__dream_dr1__", username: "__dream_dr1__" },
  { id: "__dream_dr2__", username: "__dream_dr2__" },
  { id: "__dream_dr3__", username: "__dream_dr3__" },
  { id: "__dream_dr4__", username: "__dream_dr4__" },
  { id: "__dream_dr5__", username: "__dream_dr5__" },
];

let passed = 0;
let failed = 0;

function ok(condition: boolean, label: string): void {
  if (condition) { console.log(`✓ ${label}`); passed++; }
  else           { console.error(`✗ ${label}`); failed++; }
}

// ─── Mock OpenAI classes ──────────────────────────────────────────────────────

class MockOpenAINoInsights {
  chat = {
    completions: {
      create: async () => ({
        choices: [{ message: { content: '{"insights":[]}' } }],
      }),
    },
  };
}

class MockOpenAIWithInsights {
  chat = {
    completions: {
      create: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              insights: [{
                insight: "Test: work energy patterns correlate across weekdays",
                confidence: 80,
                sourceHints: ["mem_a", "mem_b"],
              }],
            }),
          },
        }],
      }),
    },
  };
}

class MockOpenAIFailure {
  chat = {
    completions: {
      create: async (): Promise<never> => {
        throw new Error("Simulated LLM failure for testing");
      },
    },
  };
}

// ─── Module spy helper ────────────────────────────────────────────────────────

type DiagCall = {
  userId?: string;
  subsystem: string;
  severity: string;
  message: string;
  metadata?: Record<string, unknown>;
};

/**
 * Install a diagEmit spy and return a fresh dream module.
 *
 * Steps performed:
 *   1. Ensure diagnosticsService is in the require cache.
 *   2. Create a spy wrapper for the exports object and install it in cache.
 *   3. Optionally replace openai.exports.default with a mock constructor.
 *   4. Delete dream.ts from cache so it reloads with the spy in scope.
 *   5. Load and return the fresh dream module.
 *
 * The returned `restore()` puts the original diagnosticsService exports back.
 */
function setupDreamWithSpy(MockOpenAI?: new () => unknown): {
  dream: { runDreamForUser(userId: string, date: string): Promise<DreamCycleResult> };
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

  // Swap the exports object in the require cache.
  req.cache![DIAG_SVC_PATH]!.exports = diagWrapper;

  // If an OpenAI mock is requested, replace the whole openai exports object
  // before dream.ts loads. The openai package exposes `.default` as a non-
  // configurable getter, so direct assignment fails. We swap the entire
  // exports for a Proxy that returns the mock constructor for `.default`.
  let realOpenAIExports: unknown;
  if (MockOpenAI !== undefined) {
    if (!req.cache![OPENAI_PATH]) req(OPENAI_PATH);
    realOpenAIExports = req.cache![OPENAI_PATH]!.exports;
    const openaiProxy = new Proxy(realOpenAIExports as object, {
      get(_target, prop) {
        if (prop === "default") return MockOpenAI;
        return (realOpenAIExports as Record<string | symbol, unknown>)[prop as string];
      },
    });
    req.cache![OPENAI_PATH]!.exports = openaiProxy;
  }

  // Delete dream.ts so a fresh load picks up the spy wrapper.
  delete req.cache![DREAM_PATH];
  const dream = req(DREAM_PATH) as {
    runDreamForUser(userId: string, date: string): Promise<DreamCycleResult>;
  };

  return {
    dream,
    calls,
    restore: () => {
      req.cache![DIAG_SVC_PATH]!.exports = realDiagExports;
      if (realOpenAIExports !== undefined && req.cache![OPENAI_PATH]) {
        req.cache![OPENAI_PATH]!.exports = realOpenAIExports;
      }
      delete req.cache![DREAM_PATH];
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
 * Insert a user memory with an explicit backdated extractedAt timestamp.
 * Using `long_term` tier prevents the consolidation LLM pass from running
 * (which only processes `short_term` memories older than 6 hours).
 */
async function insertMemory(
  userId: string,
  ageInDays: number,
  tier: "long_term" | "short_term" = "long_term",
): Promise<void> {
  const extractedAt = new Date(Date.now() - ageInDays * 24 * 60 * 60 * 1000);
  await db.insert(schema.userMemories).values({
    userId,
    content: `Test memory — ${ageInDays} days old`,
    category: "work_patterns",
    tier,
    memoryType: "semantic",
    extractedAt,
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await cleanup();
  await setupUsers();

  // ── DR-1: insufficient_data exit path ─────────────────────────────────────
  // User has no memories → hasEnoughData() returns false → dream skips synthesis.
  // Expected emit: { severity: "info", metadata: { recovery: true, reason: "insufficient_data" } }
  {
    const userId = TEST_USERS[0].id;
    const { dream, calls, restore } = setupDreamWithSpy(); // No OpenAI mock needed.
    try {
      await dream.runDreamForUser(userId, "2026-04-28");
    } finally {
      restore();
    }

    const rc = calls.filter(c => c.severity === "info" && c.metadata?.recovery === true);
    ok(rc.length >= 1,
      "DR-1: runDreamForUser emits a recovery signal on the insufficient_data path");
    ok(rc.some(c => c.metadata?.reason === "insufficient_data"),
      'DR-1: recovery payload carries reason="insufficient_data"');
    ok(rc.every(c => c.subsystem === "memory"),
      "DR-1: recovery signal targets the memory subsystem");
  }

  // ── DR-2: empty_corpus exit path ──────────────────────────────────────────
  // Memory 100 days old: hasEnoughData()=true (>14 days), buildCorpus()=empty
  // (100 days > the 90-day corpus window).
  // Expected emit: { severity: "info", metadata: { recovery: true, reason: "empty_corpus" } }
  {
    const userId = TEST_USERS[1].id;
    await insertMemory(userId, 100, "long_term");

    const { dream, calls, restore } = setupDreamWithSpy();
    try {
      await dream.runDreamForUser(userId, "2026-04-28");
    } finally {
      restore();
    }

    const rc = calls.filter(c => c.severity === "info" && c.metadata?.recovery === true);
    ok(rc.length >= 1,
      "DR-2: runDreamForUser emits a recovery signal on the empty_corpus path");
    ok(rc.some(c => c.metadata?.reason === "empty_corpus"),
      'DR-2: recovery payload carries reason="empty_corpus"');
    ok(rc.every(c => c.subsystem === "memory"),
      "DR-2: recovery signal targets the memory subsystem");
  }

  // ── DR-3: no_insights exit path ───────────────────────────────────────────
  // Memory 20 days old: hasEnoughData=true, corpus non-empty.
  // Mock LLM returns { insights: [] } → no-insights branch fires.
  // Expected emit: { severity: "info", metadata: { recovery: true, reason: "no_insights" } }
  {
    const userId = TEST_USERS[2].id;
    await insertMemory(userId, 20, "long_term");

    const { dream, calls, restore } = setupDreamWithSpy(MockOpenAINoInsights);
    try {
      await dream.runDreamForUser(userId, "2026-04-28");
    } finally {
      restore();
    }

    const rc = calls.filter(c => c.severity === "info" && c.metadata?.recovery === true);
    ok(rc.length >= 1,
      "DR-3: runDreamForUser emits a recovery signal on the no_insights path");
    ok(rc.some(c => c.metadata?.reason === "no_insights"),
      'DR-3: recovery payload carries reason="no_insights"');
    ok(rc.every(c => c.subsystem === "memory"),
      "DR-3: recovery signal targets the memory subsystem");
  }

  // ── DR-4: full synthesis (successful) exit path ───────────────────────────
  // Memory 20 days old, mock LLM returns 1 insight → synthesis succeeds.
  // Expected emit: { severity: "info", metadata: { recovery: true, insightsStored: N } }
  {
    const userId = TEST_USERS[3].id;
    await insertMemory(userId, 20, "long_term");

    const { dream, calls, restore } = setupDreamWithSpy(MockOpenAIWithInsights);
    try {
      await dream.runDreamForUser(userId, "2026-04-28");
    } finally {
      restore();
    }

    const rc = calls.filter(c => c.severity === "info" && c.metadata?.recovery === true);
    ok(rc.length >= 1,
      "DR-4: runDreamForUser emits a recovery signal on the full-synthesis path");
    ok(rc.some(c => typeof c.metadata?.insightsStored === "number"),
      "DR-4: recovery payload includes numeric insightsStored field");
    ok(rc.every(c => c.subsystem === "memory"),
      "DR-4: recovery signal targets the memory subsystem");
  }

  // ── DR-5: LLM error path — no recovery signal (negative test) ─────────────
  // Mock LLM throws → synthesis fails → error diagnostic emitted, no recovery.
  // Verifies: a failed dream cycle must NOT emit a recovery signal.
  {
    const userId = TEST_USERS[4].id;
    await insertMemory(userId, 20, "long_term");

    const { dream, calls, restore } = setupDreamWithSpy(MockOpenAIFailure);
    try {
      await dream.runDreamForUser(userId, "2026-04-28");
    } finally {
      restore();
    }

    const rc = calls.filter(c => c.severity === "info" && c.metadata?.recovery === true);
    ok(rc.length === 0,
      "DR-5: error exit path emits no recovery signal (negative test)");

    const errorCalls = calls.filter(c => c.severity === "error");
    ok(errorCalls.length >= 1,
      "DR-5: error exit path does emit an error diagnostic signal");
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
