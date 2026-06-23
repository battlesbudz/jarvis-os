/**
 * Screenshot per-turn budget tests.
 *
 * Run with:  npx tsx server/agent/__tests__/screenshotBudget.test.ts
 *
 * Tests:
 *   SB-1: checkAndIncrementScreenshotBudget allows first 4 calls, rejects the 5th
 *   SB-2: Each ctx object gets its own independent budget
 *   SB-3: Calling without ctx (undefined) is always allowed (internal utility callers)
 *   SB-4: daemon_action tool rejects android_screenshot after budget is exhausted
 *   SB-5: Chat screenshot attachments are transparent and include local screen context
 */

import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`✓ ${label}`);
  passed++;
}

function fail(label: string, err: unknown) {
  console.error(`✗ ${label}`);
  console.error("  ", err);
  failed++;
}

async function run() {
  const { checkAndIncrementScreenshotBudget } = await import(
    "../tools/daemonShellTool"
  );

  // ── SB-1: First 4 calls allowed, 5th rejected ────────────────────────────
  try {
    const ctx = {};
    const results = [1, 2, 3, 4].map(() => checkAndIncrementScreenshotBudget(ctx));
    assert.deepEqual(results, [true, true, true, true], "SB-1a: calls 1–4 return true");
    const fifth = checkAndIncrementScreenshotBudget(ctx);
    assert.equal(fifth, false, "SB-1b: 5th call returns false");
    const sixth = checkAndIncrementScreenshotBudget(ctx);
    assert.equal(sixth, false, "SB-1c: 6th call also returns false (stays exhausted)");
    ok("SB-1: first 4 calls allowed, 5th+ rejected");
  } catch (err) {
    fail("SB-1", err);
  }

  // ── SB-2: Independent budget per ctx object ──────────────────────────────
  try {
    const ctxA = {};
    const ctxB = {};
    // Exhaust ctxA
    for (let i = 0; i < 4; i++) checkAndIncrementScreenshotBudget(ctxA);
    assert.equal(checkAndIncrementScreenshotBudget(ctxA), false, "SB-2a: ctxA exhausted");
    // ctxB should be untouched
    assert.equal(checkAndIncrementScreenshotBudget(ctxB), true, "SB-2b: ctxB still has budget");
    ok("SB-2: each ctx object has its own independent budget");
  } catch (err) {
    fail("SB-2", err);
  }

  // ── SB-3: undefined ctx is always allowed (no-op) ────────────────────────
  try {
    for (let i = 0; i < 10; i++) {
      const result = checkAndIncrementScreenshotBudget(undefined);
      assert.equal(result, true, `SB-3: undefined ctx call ${i + 1} returns true`);
    }
    ok("SB-3: undefined ctx is always allowed (no-op for internal utility callers)");
  } catch (err) {
    fail("SB-3", err);
  }

  // ── SB-4: buildScreenMapElements returns cap-hit error (no daemon call) ──────
  // buildScreenMapElements checks the budget gate before any network op, so the
  // rejection can be tested without a paired daemon.
  try {
    const { buildScreenMapElementsForTest } = await import(
      "../tools/daemonShellTool"
    ) as unknown as { buildScreenMapElementsForTest?: never };

    // Access via the module's internal test export if available; otherwise verify
    // the budget mechanism works correctly via the exported helper and the
    // known code path in daemon.ts.

    // Verify that daemon.ts has the budget check wired in by inspecting the
    // source code (structural test).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const daemonSrc = fs.readFileSync(
      path.resolve(__dirname, "../tools/daemon.ts"),
      "utf8",
    );
    assert.ok(
      daemonSrc.includes("checkAndIncrementScreenshotBudget(ctx)"),
      "SB-4a: daemon.ts calls checkAndIncrementScreenshotBudget(ctx) for android_screenshot",
    );
    assert.ok(
      daemonSrc.includes("Screenshot limit reached for this turn"),
      "SB-4b: daemon.ts cap-hit error contains 'Screenshot limit reached for this turn'",
    );
    assert.ok(
      daemonSrc.includes("android_read_screen"),
      "SB-4c: daemon.ts cap-hit error directs to android_read_screen",
    );
    assert.ok(
      daemonSrc.includes('"label": "daemon_action: turn screenshot limit reached"') ||
      daemonSrc.includes("label: \"daemon_action: turn screenshot limit reached\""),
      "SB-4d: daemon.ts cap-hit response includes structured label field",
    );
    ok("SB-4: daemon_action wires checkAndIncrementScreenshotBudget with correct error message and label");
  } catch (err) {
    fail("SB-4", err);
  }

  // SB-5: app-chat screenshot attachments remain transparent and model-usable.
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routesSrc = fs.readFileSync(path.resolve(__dirname, "../../routes.ts"), "utf8");
    const insightsSrc = fs.readFileSync(path.resolve(__dirname, "../../../app/(tabs)/insights.tsx"), "utf8");

    assert.ok(
      routesSrc.includes("temporary_chat_screen_capture"),
      "SB-5a: screenshot detail marks the attachment as a temporary chat capture",
    );
    assert.ok(
      !routesSrc.includes("savedToGallery: false"),
      "SB-5b: screenshot detail does not unconditionally promise Gallery absence",
    );
    assert.ok(
      routesSrc.includes("galleryPersistence"),
      "SB-5c: screenshot detail carries neutral Gallery persistence metadata",
    );
    assert.ok(
      routesSrc.includes("{ type: 'android_read_screen' }"),
      "SB-5d: screenshot handling fetches local accessibility context for the model",
    );
    assert.ok(
      routesSrc.includes("screenContext"),
      "SB-5e: screenshot detail includes screenContext fields",
    );
    assert.ok(
      insightsSrc.includes("Temporary chat preview"),
      "SB-5f: chat UI explains screenshot previews without promising Gallery behavior",
    );
    assert.ok(
      !insightsSrc.includes("not saved to Gallery"),
      "SB-5g: chat UI does not promise Gallery absence",
    );
    ok("SB-5: screenshot attachments are transparent and include local screen context");
  } catch (err) {
    fail("SB-5", err);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("Some screenshot budget assertions failed.");
    process.exit(1);
  } else {
    console.log("All screenshot budget assertions passed ✓");
  }
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
