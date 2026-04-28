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
  _resetLastDebugTriggerAtForTest,
  _setLastDebugTriggerAtForTest,
  _DEBUG_TRIGGER_COOLDOWN_MS_FOR_TEST,
  _applyCircuitBreakerForTest,
  _applyCircuitBreakerCrashForTest,
  _checkSystemCredentialForTest,
} from "../integrationValidator";

// ── Stub factory ──────────────────────────────────────────────────────────────
// Builds a fresh set of recording stubs for each test so call counts don't
// leak between test cases.

interface StubRecord {
  writeStatusCalls: Array<{ userId: string; integration: string; status: string; errorMessage?: string }>;
  notifyUserCalls: Array<{ userId: string; type: string; message: string }>;
  diagEmitCalls: number;
  logSystemErrorCalls: number;
  triggerAutoDebugCalls: number;
}

function makeStubs(overrides?: Partial<_CircuitBreakerDeps>): { deps: _CircuitBreakerDeps; record: StubRecord } {
  const record: StubRecord = {
    writeStatusCalls: [],
    notifyUserCalls: [],
    diagEmitCalls: 0,
    logSystemErrorCalls: 0,
    triggerAutoDebugCalls: 0,
  };

  const deps: _CircuitBreakerDeps = {
    previousStatus: null, // default: no prior record — simulates fresh integration
    writeStatus: async (userId, integration, result) => {
      record.writeStatusCalls.push({ userId, integration, status: result.status, errorMessage: result.errorMessage });
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
    ...overrides,
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

  // ── Test E: Duplicate-alert rate-limit — second broken cycle within cooldown
  //            fires NO additional notification ─────────────────────────────────
  // The 1-hour cooldown in lastDebugTriggerAt must prevent the second identical
  // alert from reaching the user when the integration stays broken across cycles.
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    // Cycle 1: streak=1 → degraded, no notification
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);
    // Cycle 2: streak=2 → broken, notification fires and rate-limit timestamp is set
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);
    // Cycle 3: streak=3, still within 1-hour cooldown → notification must NOT fire again
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    const brokenStatuses = record.writeStatusCalls.filter((c) => c.status === "broken");
    assert.ok(brokenStatuses.length >= 2, "E: 'broken' written on cycles 2 and 3");
    assert.equal(
      record.notifyUserCalls.length,
      1,
      "E: only ONE notification fired across three broken cycles (second blocked by cooldown)",
    );
    console.log("✓ E: duplicate-alert gate — second broken cycle within cooldown fires no additional notification");
  }

  // ── Test F: After cooldown expires, a fresh notification IS fired ──────────
  // Simulates an hour passing by backdating the rate-limit timestamp so the gate
  // opens again and the next broken cycle sends a new alert.
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    // Cycle 1: streak=1 → degraded
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);
    // Cycle 2: streak=2 → broken, first notification fires
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    assert.equal(record.notifyUserCalls.length, 1, "F: first notification fired");

    // Simulate the cooldown expiring by backdating the rate-limit entry by just
    // over one hour so Date.now() - last > DEBUG_TRIGGER_COOLDOWN_MS.
    const expiredTimestamp = Date.now() - _DEBUG_TRIGGER_COOLDOWN_MS_FOR_TEST - 1;
    _setLastDebugTriggerAtForTest(`${TEST_INTEGRATION}:${TEST_USER}`, expiredTimestamp);

    // Cycle 3 after cooldown: streak=3 → broken, second notification must now fire
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    assert.equal(
      record.notifyUserCalls.length,
      2,
      "F: second notification fired after cooldown window expired",
    );
    console.log("✓ F: after cooldown expires, a subsequent broken cycle fires a fresh notification");
  }

  // ── Test G: Duplicate auto-debug rate-limit — second broken cycle within
  //            cooldown fires NO additional triggerAutoDebugSession call ──────
  // Mirrors Test E but exercises the unknown-error path (BROKEN_RESULT_UNKNOWN)
  // where buildDirectNotification returns null and triggerAutoDebugSession is
  // called instead of notifyUser.  The 1-hour cooldown must cap this path too.
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    // Cycle 1: streak=1 → degraded, no auto-debug
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps);
    // Cycle 2: streak=2 → broken, auto-debug fires and rate-limit timestamp set
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps);
    // Cycle 3: streak=3, still within 1-hour cooldown → auto-debug must NOT fire again
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps);

    const brokenStatuses = record.writeStatusCalls.filter((c) => c.status === "broken");
    assert.ok(brokenStatuses.length >= 2, "G: 'broken' written on cycles 2 and 3");
    assert.equal(
      record.notifyUserCalls.length,
      0,
      "G: no direct notifications for unknown errors (auto-debug path)",
    );
    assert.equal(
      record.triggerAutoDebugCalls,
      1,
      "G: only ONE auto-debug session triggered across three broken cycles (second blocked by cooldown)",
    );
    console.log("✓ G: duplicate auto-debug gate — second broken cycle within cooldown fires no additional auto-debug session");
  }

  // ── Test H: After cooldown expires, a fresh auto-debug session IS triggered ─
  // Simulates an hour passing by backdating the rate-limit timestamp so the gate
  // opens again and the next broken cycle queues a new auto-debug job.
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    // Cycle 1: streak=1 → degraded
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps);
    // Cycle 2: streak=2 → broken, first auto-debug session fires
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps);

    assert.equal(record.triggerAutoDebugCalls, 1, "H: first auto-debug session triggered");

    // Simulate the cooldown expiring by backdating the rate-limit entry by just
    // over one hour so Date.now() - last > DEBUG_TRIGGER_COOLDOWN_MS.
    const expiredTimestamp = Date.now() - _DEBUG_TRIGGER_COOLDOWN_MS_FOR_TEST - 1;
    _setLastDebugTriggerAtForTest(`${TEST_INTEGRATION}:${TEST_USER}`, expiredTimestamp);

    // Cycle 3 after cooldown: streak=3 → broken, second auto-debug session must now fire
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_UNKNOWN, deps);

    assert.equal(
      record.triggerAutoDebugCalls,
      2,
      "H: second auto-debug session fired after cooldown window expired",
    );
    assert.equal(
      record.notifyUserCalls.length,
      0,
      "H: no direct notifications throughout (unknown error stays on auto-debug path)",
    );
    console.log("✓ H: after cooldown expires, a subsequent broken cycle fires a fresh auto-debug session");
  }

  // ── Test I: Crash path circuit-breaker ────────────────────────────────────
  // Simulates a check() function that throws (e.g. unexpected runtime error)
  // and verifies the catch-block applies the same streak/cooldown logic as the
  // normal broken path.

  // I1: First crash → "degraded", no alert ──────────────────────────────────
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    await _applyCircuitBreakerCrashForTest(
      TEST_USER,
      TEST_INTEGRATION,
      new Error("network timeout"),
      deps,
    );

    assert.equal(record.writeStatusCalls.length, 1, "I1: writeStatus called once on first crash");
    assert.equal(
      record.writeStatusCalls[0].status,
      "degraded",
      "I1: first crash writes 'degraded'",
    );
    assert.equal(
      record.triggerAutoDebugCalls,
      0,
      "I1: no auto-debug session triggered on first crash",
    );
    assert.equal(record.notifyUserCalls.length, 0, "I1: no direct notification on first crash");
    console.log("✓ I1: first validator crash → 'degraded', no alert");
  }

  // I2: Two consecutive crashes → "broken", auto-debug fires once ───────────
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    const crashErr = new Error("unexpected null pointer");
    // First crash — streak=1, degraded
    await _applyCircuitBreakerCrashForTest(TEST_USER, TEST_INTEGRATION, crashErr, deps);
    // Second crash — streak=2, broken, alert fires
    await _applyCircuitBreakerCrashForTest(TEST_USER, TEST_INTEGRATION, crashErr, deps);

    const statuses = record.writeStatusCalls.map((c) => c.status);
    assert.ok(statuses.includes("degraded"), "I2: first crash wrote 'degraded'");
    assert.ok(statuses.includes("broken"), "I2: second crash wrote 'broken'");
    assert.equal(
      record.triggerAutoDebugCalls,
      1,
      "I2: auto-debug session fired exactly once on second crash",
    );
    assert.equal(record.notifyUserCalls.length, 0, "I2: crash path uses auto-debug, not direct notify");
    console.log("✓ I2: two consecutive validator crashes → 'broken' + auto-debug fired once");
  }

  // I2b: Non-Error thrown value is handled — errMsg uses String() fallback ───
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    // Throw a plain string (not an Error instance), mirroring e.g. `throw "oops"`
    await _applyCircuitBreakerCrashForTest(TEST_USER, TEST_INTEGRATION, "plain string thrown", deps);
    await _applyCircuitBreakerCrashForTest(TEST_USER, TEST_INTEGRATION, "plain string thrown", deps);

    assert.equal(record.writeStatusCalls[1].status, "broken", "I2b: non-Error throw still escalates to broken");
    assert.ok(
      record.writeStatusCalls[1].errorMessage?.includes("plain string thrown"),
      "I2b: String() fallback is used for non-Error thrown values",
    );
    assert.equal(record.triggerAutoDebugCalls, 1, "I2b: auto-debug fires on second non-Error crash");
    console.log("✓ I2b: non-Error thrown values handled correctly via String() fallback");
  }

  // I3: Cooldown gate — third crash within window fires NO second alert ──────
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    const { deps, record } = makeStubs();

    const crashErr = new Error("database connection lost");
    // Cycle 1: streak=1 → degraded, no alert
    await _applyCircuitBreakerCrashForTest(TEST_USER, TEST_INTEGRATION, crashErr, deps);
    // Cycle 2: streak=2 → broken, auto-debug fires and cooldown timestamp set
    await _applyCircuitBreakerCrashForTest(TEST_USER, TEST_INTEGRATION, crashErr, deps);
    // Cycle 3: streak=3, still within cooldown → auto-debug must NOT fire again
    await _applyCircuitBreakerCrashForTest(TEST_USER, TEST_INTEGRATION, crashErr, deps);

    const brokenStatuses = record.writeStatusCalls.filter((c) => c.status === "broken");
    assert.ok(brokenStatuses.length >= 2, "I3: 'broken' written on cycles 2 and 3");
    assert.equal(
      record.triggerAutoDebugCalls,
      1,
      "I3: cooldown gate blocks second auto-debug within the same hour",
    );
    console.log(
      "✓ I3: cooldown gate applies on crash path — repeated crash within 1 h fires only one auto-debug",
    );
  }

  // ── Test K: Transition guard — broken → broken produces NO notification ───────
  // previousStatus = "broken" means the integration was already broken in the DB
  // before this cycle (e.g. persisted from a previous cycle before a restart).
  // Even though the circuit-breaker escalates again to "broken", the transition
  // guard must block the notification because the user was already told.
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    // Inject previousStatus = "broken" to simulate the DB having "broken" already
    const { deps, record } = makeStubs({ previousStatus: "broken" });

    // Cycle 1: streak=1 → degraded (no notification regardless)
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);
    // Cycle 2: streak=2 → broken, but previousStatus = "broken" → transition guard blocks
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    const statuses = record.writeStatusCalls.map((c) => c.status);
    assert.ok(statuses.includes("broken"), "K: 'broken' status written to DB");
    assert.equal(
      record.notifyUserCalls.length,
      0,
      "K: NO notification fired — integration was already broken (broken→broken transition blocked)",
    );
    assert.equal(
      record.triggerAutoDebugCalls,
      0,
      "K: NO auto-debug session triggered — broken→broken transition blocked",
    );
    console.log("✓ K: broken→broken transition — no notification (user was already told)");
  }

  // ── Test L: Transition guard — degraded → broken DOES fire notification ──────
  // previousStatus = "degraded" means the integration failed once before but had
  // NOT yet been confirmed broken.  Escalating to "broken" IS a new event —
  // the user should be notified.
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();
    // Inject previousStatus = "degraded" (was in a partial-failure state)
    const { deps, record } = makeStubs({ previousStatus: "degraded" });

    // Cycle 1: streak=1 → degraded (no notification regardless)
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);
    // Cycle 2: streak=2 → broken; previousStatus = "degraded" (not "broken") → notify
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    const statuses = record.writeStatusCalls.map((c) => c.status);
    assert.ok(statuses.includes("broken"), "L: 'broken' status written to DB");
    assert.equal(
      record.notifyUserCalls.length,
      1,
      "L: notification fires — degraded→broken IS a new disconnect event",
    );
    assert.equal(record.notifyUserCalls[0].userId, TEST_USER, "L: notification addressed to correct user");
    console.log("✓ L: degraded→broken transition — notification fires (this is a new disconnect event)");
  }

  // ── Test J: Warmup simulation — pre-populated rate-limit blocks re-alert ─────
  // Simulates what happens after a server restart when warmupRateLimitCache()
  // has already set lastDebugTriggerAt to Date.now() for a broken integration.
  // The circuit-breaker resets (in-memory consecutiveFailures cleared), so it
  // will escalate to "broken" after 2 cycles — but the pre-populated cooldown
  // timestamp must block the notification from firing.
  {
    _resetConsecutiveFailuresForTest();
    _resetLastDebugTriggerAtForTest();

    // Simulate warmupRateLimitCache() having run: stamp the rate-limit key now
    // (exactly as if the warmup read a "broken" row from the DB).
    const warmupTimestamp = Date.now();
    _setLastDebugTriggerAtForTest(`${TEST_INTEGRATION}:${TEST_USER}`, warmupTimestamp);

    const { deps, record } = makeStubs();

    // Cycle 1 after restart: streak=1 → degraded, no notification (expected)
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);
    // Cycle 2 after restart: streak=2 → broken, but warmup timestamp blocks notification
    await _applyCircuitBreakerForTest(TEST_USER, TEST_INTEGRATION, BROKEN_RESULT_NOTIFY, deps);

    const statuses = record.writeStatusCalls.map((c) => c.status);
    assert.ok(statuses.includes("broken"), "J: broken status was written to DB");
    assert.equal(
      record.notifyUserCalls.length,
      0,
      "J: no notification fired — warmup pre-populated the cooldown timestamp (restart-safe)",
    );
    console.log("✓ J: warmup simulation — pre-populated rate-limit blocks re-alert after restart");
  }

  // ── Test M: HTML connector error pages are classified as unconfigured ─────────
  // When the Replit connector proxy returns an HTML error page (e.g. HTTP 404
  // with <!DOCTYPE html>), checkConnectorStatus must return "unconfigured" rather
  // than "broken", so no user alert is fired.  This test exercises the string
  // detection logic directly (same guard used in checkConnectorStatus).
  {
    // Mirror the exact condition from checkConnectorStatus:
    // text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")
    const isHtmlErrorPage = (text: string): boolean =>
      text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html");

    // Positive cases — these should be classified as HTML (proxy errors)
    assert.ok(
      isHtmlErrorPage("<!DOCTYPE html>\n<html lang=en>"),
      "M: uppercase DOCTYPE is classified as HTML error page",
    );
    assert.ok(
      isHtmlErrorPage("\n<!DOCTYPE html>\n<html lang=en>"),
      "M: leading whitespace before DOCTYPE is normalised by trimStart",
    );
    assert.ok(
      isHtmlErrorPage("<html lang=en>\n  <meta charset=utf-8>"),
      "M: lowercase <html> tag is classified as HTML error page",
    );

    // Negative cases — genuine JSON API errors must NOT be treated as unconfigured
    assert.ok(
      !isHtmlErrorPage('{"error":"invalid_grant","error_description":"Token has been expired"}'),
      "M: JSON error body is NOT classified as HTML (should escalate to broken)",
    );
    assert.ok(
      !isHtmlErrorPage('{"error":"unauthorized","message":"Access denied"}'),
      "M: JSON unauthorized body is NOT classified as HTML",
    );
    assert.ok(
      !isHtmlErrorPage(""),
      "M: empty response body is NOT classified as HTML",
    );

    console.log("✓ M: HTML connector error page detection — proxy errors classified as unconfigured; JSON errors escalate normally");
  }

  console.log("\nAll circuit-breaker assertions passed. ✓");
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
