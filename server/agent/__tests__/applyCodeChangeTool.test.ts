/**
 * applyCodeChangeTool.test.ts — unit tests for recordVerificationResult().
 *
 * Run with:  npx tsx server/agent/__tests__/applyCodeChangeTool.test.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 *
 * The three side-effects under test — owner lookup, inbox insert, and
 * notifyUser — are intercepted via test-only hooks exported from
 * applyCodeChangeTool.ts, so assertions are deterministic and isolated.
 * Note: fire-and-forget audit-log DB updates still run but are non-fatal
 * and do not affect any assertion in these tests.
 *
 * Covers:
 *   E1. failed result + no userId → getIntegrationOwnerId called once, inbox item
 *       created for that owner, notifyUser called with owner id.
 *   E2. failed result + explicit userId → that userId used directly; owner lookup
 *       NOT called, inbox item created, notifyUser called with explicit userId.
 *   E3. passed result + no userId → owner lookup NOT called, no inbox item, no
 *       notifyUser call.
 *   E4. error result + no userId → same behaviour as failed: owner lookup called
 *       once, inbox item created, notifyUser called.
 *   E5. filePaths with no corresponding audit timestamp → early return before any
 *       side-effects, regardless of result or userId.
 */

import assert from "node:assert/strict";

import {
  recordVerificationResult,
  _setAuditTimestampForTest,
  _clearAuditTimestampsForTest,
  _interceptInboxInsertForTest,
  _interceptNotifyUserForTest,
  _interceptOwnerLookupForTest,
} from "../tools/applyCodeChangeTool";

// ── Constants ─────────────────────────────────────────────────────────────────

const OWNER_ID     = "test-owner-uid-verify";
const EXPLICIT_UID = "test-explicit-uid-verify";
const TEST_FILE    = "server/agent/tools/__verifyTest.ts";
const TEST_TS      = "2024-01-01T00:00:00.000Z";

// ── Capture fixture ───────────────────────────────────────────────────────────

/** Side-effects captured from a single recordVerificationResult() call. */
interface Capture {
  ownerLookupCalls: number;
  inboxInserts: Array<Record<string, unknown>>;
  notifications: Array<{ userId: string; channel: string; text: string }>;
}

/**
 * Set up interceptors for one test, await fn(), then tear everything down.
 * ownerReturnValue controls what the stubbed owner lookup returns.
 */
async function withCapture(
  ownerReturnValue: string | null,
  fn: (cap: Capture) => Promise<void>,
): Promise<Capture> {
  const cap: Capture = { ownerLookupCalls: 0, inboxInserts: [], notifications: [] };

  _interceptOwnerLookupForTest(async () => {
    cap.ownerLookupCalls++;
    return ownerReturnValue;
  });
  _interceptInboxInsertForTest((v) => cap.inboxInserts.push(v));
  _interceptNotifyUserForTest((uid, ch, txt) =>
    cap.notifications.push({ userId: uid, channel: ch, text: txt }),
  );

  try {
    await fn(cap);
  } finally {
    _interceptOwnerLookupForTest(null);
    _interceptInboxInsertForTest(null);
    _interceptNotifyUserForTest(null);
    _clearAuditTimestampsForTest();
  }
  return cap;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

  console.log("\n── Section E: recordVerificationResult ──────────────────────");

  // ── E1. failed + no userId → owner looked up, inbox item created ─────────────
  {
    _setAuditTimestampForTest(TEST_FILE, TEST_TS);

    const cap = await withCapture(OWNER_ID, async () => {
      await recordVerificationResult([TEST_FILE], "failed", "build error");
    });

    assert.equal(cap.ownerLookupCalls, 1,       "E1a: owner lookup called exactly once for failed+no-userId");
    assert.equal(cap.inboxInserts.length, 1,     "E1b: exactly one inbox insert");
    assert.equal(cap.inboxInserts[0].userId, OWNER_ID, "E1c: inbox insert targets the resolved owner");
    assert.ok(
      String(cap.inboxInserts[0].subject ?? "").includes("failed"),
      "E1d: inbox subject mentions 'failed'",
    );
    assert.ok(
      String(cap.inboxInserts[0].snippet ?? "").includes("build error"),
      "E1e: inbox snippet includes the summary",
    );
    assert.equal(cap.inboxInserts[0].status, "pending", "E1f: inbox item status is 'pending'");
    assert.ok(
      String(cap.inboxInserts[0].sourceId ?? "").startsWith("self-repair:failed:"),
      "E1g: sourceId is prefixed with self-repair:failed:",
    );
    assert.equal(cap.notifications.length, 1,    "E1h: exactly one notifyUser call");
    assert.equal(cap.notifications[0].userId, OWNER_ID, "E1i: notification targets the owner");
    assert.equal(cap.notifications[0].channel, "self_repair", "E1j: channel is self_repair");
    assert.ok(
      cap.notifications[0].text.includes("failed"),
      "E1k: notification text mentions the result",
    );
    console.log("✓ E1: failed+no-userId → owner looked up (×1), inbox item created, notifyUser called");
  }

  // ── E2. failed + explicit userId → explicit userId used, no owner lookup ──────
  {
    _setAuditTimestampForTest(TEST_FILE, TEST_TS);

    const cap = await withCapture(OWNER_ID, async () => {
      await recordVerificationResult([TEST_FILE], "failed", "type error", EXPLICIT_UID);
    });

    assert.equal(cap.ownerLookupCalls, 0,        "E2a: owner lookup NOT called when explicit userId provided");
    assert.equal(cap.inboxInserts.length, 1,     "E2b: exactly one inbox insert");
    assert.equal(cap.inboxInserts[0].userId, EXPLICIT_UID, "E2c: inbox insert targets the explicit userId");
    assert.equal(cap.notifications.length, 1,    "E2d: exactly one notifyUser call");
    assert.equal(cap.notifications[0].userId, EXPLICIT_UID, "E2e: notification targets the explicit userId, not the owner");
    console.log("✓ E2: failed+explicit-userId → owner lookup skipped, explicit userId used, inbox item created");
  }

  // ── E3. passed + no userId → NO owner lookup, NO inbox, NO notification ───────
  {
    _setAuditTimestampForTest(TEST_FILE, TEST_TS);

    const cap = await withCapture(OWNER_ID, async () => {
      await recordVerificationResult([TEST_FILE], "passed", "all green");
    });

    assert.equal(cap.ownerLookupCalls, 0, "E3a: owner lookup NOT called for passed+no-userId");
    assert.equal(cap.inboxInserts.length, 0, "E3b: no inbox insert for passed+no-userId");
    assert.equal(cap.notifications.length, 0, "E3c: no notifyUser call for passed+no-userId");
    console.log("✓ E3: passed+no-userId → owner lookup skipped, no inbox item, no notification");
  }

  // ── E4. error + no userId → same as failed: owner looked up, inbox, notification
  {
    _setAuditTimestampForTest(TEST_FILE, TEST_TS);

    const cap = await withCapture(OWNER_ID, async () => {
      await recordVerificationResult([TEST_FILE], "error", "runtime crash");
    });

    assert.equal(cap.ownerLookupCalls, 1,        "E4a: owner lookup called exactly once for error+no-userId");
    assert.equal(cap.inboxInserts.length, 1,     "E4b: exactly one inbox insert for error result");
    assert.equal(cap.inboxInserts[0].userId, OWNER_ID, "E4c: inbox insert targets the owner for error result");
    assert.ok(
      String(cap.inboxInserts[0].subject ?? "").includes("error"),
      "E4d: inbox subject mentions 'error'",
    );
    assert.equal(cap.notifications.length, 1,    "E4e: exactly one notifyUser call for error result");
    assert.equal(cap.notifications[0].userId, OWNER_ID, "E4f: notification targets the owner for error result");
    console.log("✓ E4: error+no-userId → owner looked up (×1), inbox item created, notifyUser called");
  }

  // ── E5. no audit timestamp → early return before any side-effects ─────────────
  {
    // Deliberately do NOT set a timestamp — map is empty after _clearAuditTimestampsForTest.

    const cap = await withCapture(OWNER_ID, async () => {
      await recordVerificationResult([TEST_FILE], "failed", "no timestamp");
    });

    assert.equal(cap.ownerLookupCalls, 0, "E5a: owner lookup NOT called when no audit timestamp");
    assert.equal(cap.inboxInserts.length, 0, "E5b: no inbox insert when no audit timestamp");
    assert.equal(cap.notifications.length, 0, "E5c: no notification when no audit timestamp");
    console.log("✓ E5: missing audit timestamp → early return, owner lookup skipped, nothing created");
  }

  console.log("\n✅ All Section E tests passed.\n");

})().catch((err) => {
  console.error("\n✗ Test failed:", err);
  process.exit(1);
});
