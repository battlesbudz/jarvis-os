/**
 * circuitBreaker.assert.ts — unit assertions for the integration circuit-breaker.
 *
 * Run with:  npx tsx server/intelligence/__tests__/circuitBreaker.assert.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 *
 * Covers the four requirements from task #688:
 *   A. Single failed ping → writes "degraded", does NOT fire a notification.
 *   B. Two consecutive failed pings → writes "broken", DOES fire a notification.
 *   C. Failure then success → resets streak, writes the healthy status.
 *   D. checkSystemCredential does NOT cache failed pings — a second call
 *      re-runs the ping function instead of returning a frozen "false".
 */

// DATABASE_URL must be set because integrationValidator.ts imports db.ts,
// which creates a pg.Pool at import time.  The pool is never actually used
// during these tests (all DB calls are stubbed via injectable deps), but the
// Pool constructor requires a valid connection string.
if (!process.env.DATABASE_URL) {
  console.error(
    "circuitBreaker.assert.ts: DATABASE_URL not set — please run in the Replit environment.",
  );
  process.exit(1);
}

import assert from "node:assert/strict";
import type { _CircuitBreakerDeps } from "../integrationValidator";
import {
  _resetConsecutiveFailuresForTest,
  _resetSystemPingCacheForTest,
  _applyCircuitBreakerForTest,
  _checkSystemCredentialForTest,
} from "../integrationValidator";

// ── Stub factory ──────────────────────────────────────────────────────────────
// Builds a fresh set of recording stubs for each test so call counts don't
// leak between test cases.

interface StubRecord {
  writeStatusCalls: Array<{ userId: string; integration: string; status: string }>;
  notifyUserCalls: Array<{ userId: string; type: string; message: string }>;
  diagEmitCalls: number;
  logSystemErrorCalls: number;
  triggerAutoDebugCalls: number;
}

function makeStubs(): { deps: _CircuitBreakerDeps; record: StubRecord } {
  const record: StubRecord = {
    writeStatusCalls: [],
    notifyUserCalls: [],
    diagEmitCalls: 0,
    logSystemErrorCalls: 0,
    triggerAutoDebugCalls: 0,
  };

  const deps: _CircuitBreakerDeps = {
    writeStatus: async (userId, integration, result) => {
      record.writeStatusCalls.push({ userId, integration, status: result.status });
    },
    notifyUser: async (userId, type, message) => {
      record.notifyUserCalls.push({ userId, type, message });
    },
    diagEmit: async () => {
      record.diagEmitCalls += 1;
    },
    logSystemError: async () => {
      record.logSystemErrorCalls += 1;
      return "stub-error-log-id";
    },
    triggerAutoDebugSession: async () => {
      record.triggerAutoDebugCalls += 1;
    },
  };

  return { deps, record };
}

// Use "token expired" in error messages so buildDirectNotification() returns a
// human-readable string and notifyUser is called (rather than the auto-debug
// path), making it easy to assert the notification fires.
const BROKEN_RESULT_NOTIFY = {
  status: "broken" as const,
  errorMessage: "OAuth token expired — please reconnect",
};

const BROKEN_RESULT_UNKNOWN = {
  status: "broken" as const,
  errorMessage: "Unexpected upstream error (non-classified)",
};

const HEALTHY_RESULT = { status: "healthy" as const };

const TEST_USER = "test-user-circuit-breaker";
const TEST_INTEGRATION = "google" as const;

(async () => {
  // ── Test A: Single failure → "degraded", no notification ──────────────────
  {
    _resetConsecutiveFailuresForTest();
    const { deps, record } = makeStubs();

    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    assert.equal(record.writeStatusCalls.length, 1, "A: writeStatus called once");
    assert.equal(
      record.writeStatusCalls[0].status,
      "degraded",
      "A: first failure writes 'degraded', not 'broken'",
    );
    assert.equal(
      record.notifyUserCalls.length,
      0,
      "A: no notification fired on first failure",
    );
    assert.equal(
      record.triggerAutoDebugCalls,
      0,
      "A: no auto-debug session triggered on first failure",
    );
    console.log("✓ A: single failed ping → 'degraded', no notification");
  }

  // ── Test B: Two consecutive failures → "broken", notification fires ────────
  {
    _resetConsecutiveFailuresForTest();
    const { deps, record } = makeStubs();

    // First failure — sets streak to 1 (degraded, no alert)
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);
    // Second consecutive failure — streak reaches 2 (broken, alert required)
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    const statuses = record.writeStatusCalls.map((c) => c.status);
    assert.ok(statuses.includes("degraded"), "B: first failure wrote 'degraded'");
    assert.ok(statuses.includes("broken"), "B: second failure wrote 'broken'");
    assert.ok(
      record.notifyUserCalls.length > 0,
      "B: notification fired on second consecutive failure",
    );
    assert.ok(
      record.notifyUserCalls[0].userId === TEST_USER,
      "B: notification addressed to the correct user",
    );
    console.log("✓ B: two consecutive failures → 'broken' + notification fired");
  }

  // ── Test C: Failure then success → streak resets, healthy status written ───
  {
    _resetConsecutiveFailuresForTest();
    const { deps, record } = makeStubs();

    // One failure — streak = 1 (degraded)
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps);
    // Recovery — should clear streak and write healthy
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, HEALTHY_RESULT, deps);

    const statuses = record.writeStatusCalls.map((c) => c.status);
    assert.ok(statuses.includes("degraded"), "C: first failure wrote 'degraded'");
    assert.ok(statuses.includes("healthy"), "C: recovery wrote 'healthy'");
    // After recovery the streak is gone — a further failure should again start at
    // streak=1 (degraded), not immediately escalate to broken.
    const { deps: deps2, record: record2 } = makeStubs();
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps2);
    assert.equal(
      record2.writeStatusCalls[0].status,
      "degraded",
      "C: streak was reset — post-recovery failure writes 'degraded', not 'broken'",
    );
    assert.equal(record2.notifyUserCalls.length, 0, "C: no notification on first failure after reset");
    console.log("✓ C: failure → success resets streak; healthy status written; next failure starts fresh at 'degraded'");
  }

  // ── Test D: checkSystemCredential does not cache failed pings ─────────────
  // A failure must NOT be stored in systemPingCache.  The very next call must
  // invoke the ping function again rather than returning the frozen false result.
  {
    _resetSystemPingCacheForTest();

    let pingCallCount = 0;

    // First call — ping fails
    const failingPing = async (): Promise<boolean> => {
      pingCallCount += 1;
      return false;
    };

    const firstResult = await _checkSystemCredentialForTest("test-key-d", failingPing);
    assert.equal(firstResult, false, "D: failing ping returns false");
    assert.equal(pingCallCount, 1, "D: ping function called once on first invocation");

    // Second call with the same key — must re-run ping (failure not cached)
    const secondResult = await _checkSystemCredentialForTest("test-key-d", failingPing);
    assert.equal(secondResult, false, "D: second call still returns false");
    assert.equal(
      pingCallCount,
      2,
      "D: ping function called again — failure was not cached (second call re-ran the ping)",
    );

    // Bonus: a successful ping IS cached — third call with a success should NOT
    // invoke the ping function a fourth time.
    let successPingCount = 0;
    const successPing = async (): Promise<boolean> => {
      successPingCount += 1;
      return true;
    };
    _resetSystemPingCacheForTest();
    await _checkSystemCredentialForTest("test-key-d-ok", successPing);
    await _checkSystemCredentialForTest("test-key-d-ok", successPing);
    assert.equal(successPingCount, 1, "D(bonus): successful ping IS cached — second call skips re-ping");

    console.log("✓ D: failed pings not cached — re-runs ping on next call; success pings are cached");
  }

  console.log("\nAll circuit-breaker assertions passed. ✓");
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
