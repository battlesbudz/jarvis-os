/**
 * Unit tests for classifyBuildIntent and classifyBuildFollowUp.
 *
 * Pure functions with no external deps — no mocking required.
 *
 * Run with: tsx server/agent/__tests__/queryClassifier.test.ts
 */

import {
  classifyBuildIntent,
  classifyBuildFollowUp,
  BUILD_ACK_MARKER,
} from "../queryClassifier";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

// ── Helper to build a chat history with a build-ack from the assistant ────────

function historyWithAck(
  extraMessages: Array<{ role: string; content: string }> = [],
): Array<{ role: string; content: string }> {
  return [
    // newest-first convention used by coachAgent
    { role: "assistant", content: `I've ${BUILD_ACK_MARKER} for you.` },
    ...extraMessages,
  ];
}

function historyWithoutAck(): Array<{ role: string; content: string }> {
  return [
    { role: "assistant", content: "Sure, here is your summary." },
    { role: "user", content: "Summarise my emails." },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyBuildIntent — positives
// ─────────────────────────────────────────────────────────────────────────────

assert(
  classifyBuildIntent("build a weather lookup tool"),
  "BI-1: 'build a weather lookup tool' → true",
);
assert(
  classifyBuildIntent("create a new integration with Notion"),
  "BI-2: 'create a new integration with Notion' → true",
);
assert(
  classifyBuildIntent("make a Discord bot for me"),
  "BI-3: 'make a Discord bot for me' → true",
);
assert(
  classifyBuildIntent("implement a capability to track stocks"),
  "BI-4: 'implement a capability to track stocks' → true",
);
assert(
  classifyBuildIntent("add a Slack integration for notifications"),
  "BI-5: 'add a Slack integration for notifications' → true",
);
assert(
  classifyBuildIntent("code a webhook handler"),
  "BI-6: 'code a webhook handler' → true",
);
assert(
  classifyBuildIntent("write a script that fetches prices"),
  "BI-7: 'write a script that fetches prices' → true",
);
assert(
  classifyBuildIntent("write a function that parses JSON"),
  "BI-8: 'write a function that parses JSON' → true",
);
assert(
  classifyBuildIntent("write the code for a retry mechanism"),
  "BI-9: 'write the code for a retry mechanism' → true",
);
assert(
  classifyBuildIntent("add support for OAuth"),
  "BI-10: 'add support for OAuth' → true",
);
assert(
  classifyBuildIntent("add an integration for GitHub"),
  "BI-11: 'add an integration for GitHub' → true",
);
assert(
  classifyBuildIntent("extend yourself with a new tool"),
  "BI-12: 'extend yourself with a new tool' → true",
);
assert(
  classifyBuildIntent("give Jarvis a new capability to summarise PDFs"),
  "BI-13: 'give Jarvis a new capability to summarise PDFs' → true",
);
assert(
  classifyBuildIntent("Build me a connector for Salesforce"),
  "BI-14: uppercase Build matches (case-insensitive) → true",
);

// ─────────────────────────────────────────────────────────────────────────────
// classifyBuildIntent — negatives (must NOT fire)
// ─────────────────────────────────────────────────────────────────────────────

assert(
  !classifyBuildIntent("build a plan for next week"),
  "BI-N1: 'build a plan for next week' → false (no tool noun)",
);
assert(
  !classifyBuildIntent("build a schedule for me"),
  "BI-N2: 'build a schedule for me' → false (no tool noun)",
);
assert(
  !classifyBuildIntent("write a memo about our product feature"),
  "BI-N3: 'write a memo about our product feature' → false (memo is not a tool noun)",
);
assert(
  !classifyBuildIntent("write a report on last month's sales"),
  "BI-N4: 'write a report on last month's sales' → false (report is not a tool noun)",
);
assert(
  !classifyBuildIntent("can you summarise my emails today"),
  "BI-N5: plain task request → false",
);
assert(
  !classifyBuildIntent("what is on my calendar tomorrow"),
  "BI-N6: calendar query → false",
);
assert(
  !classifyBuildIntent(""),
  "BI-N7: empty string → false",
);
assert(
  !classifyBuildIntent("   "),
  "BI-N8: whitespace-only string → false",
);
assert(
  !classifyBuildIntent("remind me to call John at 3pm"),
  "BI-N9: reminder request → false",
);
assert(
  !classifyBuildIntent("search for the latest AI news"),
  "BI-N10: research request → false",
);

// ─────────────────────────────────────────────────────────────────────────────
// classifyBuildFollowUp — detects refinements after build ack
// ─────────────────────────────────────────────────────────────────────────────

assert(
  classifyBuildFollowUp("now add retry logic", historyWithAck()),
  "BF-1: 'now add retry logic' after ack → true",
);
assert(
  classifyBuildFollowUp("also add error handling", historyWithAck()),
  "BF-2: 'also add error handling' after ack → true",
);
assert(
  classifyBuildFollowUp("update it to support timeouts", historyWithAck()),
  "BF-3: 'update it to support timeouts' after ack → true",
);
assert(
  classifyBuildFollowUp("change it to use async/await", historyWithAck()),
  "BF-4: 'change it to use async/await' after ack → true",
);
assert(
  classifyBuildFollowUp("fix the bug in it", historyWithAck()),
  "BF-5: 'fix the bug in it' after ack → true",
);
assert(
  classifyBuildFollowUp("make it also log to console", historyWithAck()),
  "BF-6: 'make it also log to console' after ack → true",
);
assert(
  classifyBuildFollowUp("refactor it to be cleaner", historyWithAck()),
  "BF-7: 'refactor it to be cleaner' after ack → true",
);
assert(
  classifyBuildFollowUp("rename myVar to betterName", historyWithAck()),
  "BF-8: 'rename myVar to betterName' after ack → true",
);
// Full build-intent rephrase also counts as a follow-up when ack is present
assert(
  classifyBuildFollowUp("build a caching module for it", historyWithAck()),
  "BF-9: full build rephrasing after ack → true",
);
assert(
  classifyBuildFollowUp("add caching", historyWithAck()),
  "BF-10: 'add caching' after ack → true (refinement keyword)",
);
assert(
  classifyBuildFollowUp("make it handle pagination", historyWithAck()),
  "BF-11: 'make it handle pagination' after ack → true",
);
assert(
  classifyBuildFollowUp("fix it to throw on invalid input", historyWithAck()),
  "BF-12: 'fix it to throw on invalid input' after ack → true",
);

// ─────────────────────────────────────────────────────────────────────────────
// classifyBuildFollowUp — ignored when no prior ack exists
// ─────────────────────────────────────────────────────────────────────────────

assert(
  !classifyBuildFollowUp("now add retry logic", historyWithoutAck()),
  "BF-N1: refinement pattern but no ack in history → false",
);
assert(
  !classifyBuildFollowUp("also add error handling", historyWithoutAck()),
  "BF-N2: common refinement phrase, no ack → false",
);
assert(
  !classifyBuildFollowUp("update it to support timeouts", historyWithoutAck()),
  "BF-N3: update-it pattern, no ack → false",
);
assert(
  !classifyBuildFollowUp("make it handle pagination", historyWithoutAck()),
  "BF-N4: make-it pattern, no ack → false",
);
assert(
  !classifyBuildFollowUp("build a script to parse CSV", historyWithoutAck()),
  "BF-N5: full build intent but no ack → false (should go through classifyBuildIntent instead)",
);

// ─────────────────────────────────────────────────────────────────────────────
// classifyBuildFollowUp — edge cases: empty / minimal history
// ─────────────────────────────────────────────────────────────────────────────

assert(
  !classifyBuildFollowUp("now add retry logic", []),
  "BF-E1: refinement with empty history → false",
);
assert(
  !classifyBuildFollowUp("", historyWithAck()),
  "BF-E2: empty message with ack → false",
);
assert(
  !classifyBuildFollowUp("   ", historyWithAck()),
  "BF-E3: whitespace-only message with ack → false",
);
assert(
  !classifyBuildFollowUp("now add retry logic", [
    { role: "user", content: "hello" },
  ]),
  "BF-E4: history contains only user messages (no assistant) → false",
);
// Ack buried under a newer non-ack assistant message — ack must be in the MOST RECENT assistant turn
assert(
  !classifyBuildFollowUp("now add retry logic", [
    { role: "assistant", content: "Your calendar is clear tomorrow." },
    { role: "assistant", content: `I've ${BUILD_ACK_MARKER} for you.` },
  ]),
  "BF-E5: ack present but overridden by newer non-ack assistant message → false",
);

// ── Print summary ─────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("All queryClassifier assertions passed ✓");
} else {
  process.exit(1);
}
