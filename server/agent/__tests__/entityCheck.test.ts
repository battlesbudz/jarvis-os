/**
 * Unit tests for the protected-entity near-match check.
 *
 * Tests cover:
 *  - editDistance correctness
 *  - findEntityNearMatch: near-match triggers
 *  - findEntityNearMatch: exact match does NOT trigger
 *  - findEntityNearMatch: unrelated query does NOT trigger
 *  - findEntityNearMatch: skip_entity_check equivalent (empty entity list)
 *  - goal-title token extraction stop-word filtering
 */

import assert from "node:assert";
import { editDistance, findEntityNearMatch } from "../../memory/protectedEntities";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ EC-${String(++passed + failed).padStart(2, "0")}: ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ EC-${String(passed + ++failed).padStart(2, "0")}: ${name}`);
    console.error("  ", err instanceof Error ? err.message : err);
    failed++;
  }
}

// ── editDistance ──────────────────────────────────────────────────────────────

test("identical strings → 0", () => {
  assert.strictEqual(editDistance("HealthTrackr", "HealthTrackr"), 0);
});

test("case-insensitive identical → 0", () => {
  assert.strictEqual(editDistance("healthtrackr", "HealthTrackr"), 0);
});

test("one substitution → 1", () => {
  // HealthTrackr -> HealthTrackz (one char wrong)
  assert.strictEqual(editDistance("HealthTrackr", "HealthTrackz"), 1);
});

test("adjacent transposition → 1 (OSA counts swap as 1 edit)", () => {
  // HealthTrackr -> HealthTrakcr exercises the transposition branch.
  assert.strictEqual(editDistance("HealthTrackr", "HealthTrakcr"), 1);
});

test("completely different strings → > 2", () => {
  assert.ok(editDistance("HealthTrackr", "Stripe") > 2);
});

test("one deletion → 1", () => {
  assert.strictEqual(editDistance("HealthTrackr", "HealthTrack"), 1);
});

test("one insertion → 1", () => {
  assert.strictEqual(editDistance("HealthTrackr", "HealthTrackrr"), 1);
});

// ── findEntityNearMatch ───────────────────────────────────────────────────────

test("near-match triggers for a protected project typo", () => {
  const result = findEntityNearMatch("Research HealthTrakcr booking platform", ["HealthTrackr"]);
  assert.ok(result !== null, "Expected a near-match to be found");
  assert.strictEqual(result!.matchedEntity, "HealthTrackr");
  assert.strictEqual(result!.queryWord, "HealthTrakcr");
  assert.ok(result!.distance <= 2);
});

test("exact match does NOT trigger (distance=0)", () => {
  const result = findEntityNearMatch("Research HealthTrackr features", ["HealthTrackr"]);
  assert.strictEqual(result, null, "Exact match should not trigger confirmation");
});

test("unrelated query does NOT trigger", () => {
  const result = findEntityNearMatch("What is the weather in London today", ["HealthTrackr"]);
  assert.strictEqual(result, null, "Unrelated query should not trigger");
});

test("empty entity list → no match", () => {
  const result = findEntityNearMatch("Research HealthTrakcr", []);
  assert.strictEqual(result, null, "Empty entity list should never match");
});

test("short tokens (< 4 chars) are ignored to prevent false positives", () => {
  // 'App' is 3 chars — should not match 'API' (4 chars) ... but let's test
  // that short query words are ignored even against a similar entity
  const result = findEntityNearMatch("iOS app MVP", ["App"]);
  assert.strictEqual(result, null, "Tokens shorter than 4 chars should be skipped");
});

test("entity names shorter than 4 chars are skipped", () => {
  const result = findEntityNearMatch("MVP launch strategy", ["MVC"]);
  assert.strictEqual(result, null, "Entity names shorter than 4 chars should be ignored");
});

test("distance=3 does NOT trigger (max is 2)", () => {
  // "HealthAi" vs "HealthTrack" — more than 2 edits apart
  const result = findEntityNearMatch("HealthAi research", ["HealthTrack"]);
  assert.strictEqual(result, null, "Distance > 2 should not trigger");
});

test("multi-word query checks all words", () => {
  // The near-match word is not the first word
  const result = findEntityNearMatch("Do competitive research on TrakrAi platform", ["TrackrAi"]);
  assert.ok(result !== null, "Should find near-match in any word position");
  assert.strictEqual(result!.matchedEntity, "TrackrAi");
});

test("command verbs do NOT trigger: create should not match creative", () => {
  const result = findEntityNearMatch("Create a short reviewable deliverable", ["creative"]);
  assert.strictEqual(result, null, "Generic command verbs should not trigger entity confirmation");
});

test("confirmed 'no' path: skip_entity_check equivalent passes entity list as []", () => {
  // When skip_entity_check=true the caller passes an empty list, so no match
  const result = findEntityNearMatch("Research HealthTrakcr", []);
  assert.strictEqual(result, null);
});

// ── Results ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All entity check assertions passed ✓");
}
