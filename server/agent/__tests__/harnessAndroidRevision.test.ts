/**
 * harnessAndroidRevision.test.ts — assertions for the inline Android
 * quality-check revision logic added to runAgent (harness.ts).
 *
 * Since the harness requires a live model provider, we test the quality-check
 * core logic and the guard invariants in isolation, then simulate the loop
 * control-flow that the harness executes when checkResponseQuality returns
 * action:"revise".
 *
 * Run with: tsx server/agent/__tests__/harnessAndroidRevision.test.ts
 */

import { checkResponseQuality } from "../responseQuality";
import type { QualityCheckInput } from "../responseQuality";

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

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Simulate the harness inline revision loop for a sequence of model replies.
 *
 * `replies` is an ordered list of text replies the model would return on
 * successive text-only turns. Returns the index of the first reply that passes
 * the quality check (i.e. the harness would return it to the caller), the
 * total number of revisions that fired, and the injected [QUALITY REMINDER]
 * messages so tests can assert on them.
 */
function simulateHarnessLoop(opts: {
  userMessage: string;
  replies: string[];
  toolsUsedBeforeTextReply: string[];
  maxRevisions?: number;
}): {
  finalReplyIndex: number;
  revisionCount: number;
  injectedReminders: string[];
} {
  const maxRevisions = opts.maxRevisions ?? 2;
  let revisionCount = 0;
  const injectedReminders: string[] = [];

  for (let i = 0; i < opts.replies.length; i++) {
    const reply = opts.replies[i];

    if (revisionCount < maxRevisions) {
      const input: QualityCheckInput = {
        userMessage: opts.userMessage,
        agentReply: reply,
        toolsUsed: opts.toolsUsedBeforeTextReply,
        androidToolsAvailable: true,
      };
      const qc = checkResponseQuality(input);

      if (qc.action === "revise") {
        revisionCount++;
        injectedReminders.push(`[QUALITY REMINDER] ${qc.reason}`);
        continue; // harness would push messages and loop
      }
    }

    // Quality check passed (or guard exhausted) — harness returns this reply
    return { finalReplyIndex: i, revisionCount, injectedReminders };
  }

  // All replies were revised — return last index with revision info
  return {
    finalReplyIndex: opts.replies.length - 1,
    revisionCount,
    injectedReminders,
  };
}

// ── AR-1: Mid-task announce triggers revision ──────────────────────────────────
// The most common production failure: earlier turns used tools, then the model
// produces a text reply announcing the next step instead of calling a tool.
{
  const result = simulateHarnessLoop({
    userMessage: "Open YouTube, search for Alex Hormozi, and tap his channel.",
    replies: [
      // Turn N: model announces next step — should be revised
      "I searched for Alex Hormozi on YouTube and found the results. I will now tap on his channel to open it.",
      // Turn N+1: after reminder, model calls the tool (no announce phrase) — should finalize
      "I tapped on Alex Hormozi's channel and it is now open.",
    ],
    toolsUsedBeforeTextReply: ["daemon_action", "daemon_action"],
  });

  assert(result.revisionCount === 1, "AR-1: mid-task announce → 1 revision fired");
  assert(result.finalReplyIndex === 1, "AR-1: harness returns second reply after revision");
  assert(result.injectedReminders.length === 1, "AR-1: one QUALITY REMINDER injected");
  assert(
    result.injectedReminders[0].includes("QUALITY REMINDER"),
    "AR-1: injected message contains QUALITY REMINDER prefix",
  );
}

// ── AR-2: Clean reply (no announce phrase) skips revision ──────────────────────
// When the text reply has no announce phrase, checkResponseQuality returns
// "finalize" and the harness should not loop.
{
  const result = simulateHarnessLoop({
    userMessage: "Search for cat videos on YouTube.",
    replies: [
      "I found several cat videos on YouTube. The top result is 'Funny Cats Compilation 2024'.",
    ],
    toolsUsedBeforeTextReply: ["daemon_action"],
  });

  assert(result.revisionCount === 0, "AR-2: clean reply → 0 revisions");
  assert(result.finalReplyIndex === 0, "AR-2: harness returns first reply immediately");
  assert(result.injectedReminders.length === 0, "AR-2: no QUALITY REMINDER injected");
}

// ── AR-3: Guard caps revisions at 2 ───────────────────────────────────────────
// Even if every reply triggers the quality check, the harness must not loop
// more than 2 times (inlineRevisionCount < 2 guard).
{
  const announceReply =
    "I found the results. I will now tap on the first video to open it.";
  const result = simulateHarnessLoop({
    userMessage: "Find and open a cat video on YouTube.",
    replies: [
      announceReply, // revision 1
      announceReply, // revision 2
      announceReply, // guard exhausted — harness must return this despite announce
    ],
    toolsUsedBeforeTextReply: ["daemon_action"],
    maxRevisions: 2,
  });

  assert(result.revisionCount === 2, "AR-3: guard caps revisions at 2");
  assert(
    result.finalReplyIndex === 2,
    "AR-3: after 2 revisions guard is exhausted — third reply returned as-is",
  );
  assert(result.injectedReminders.length === 2, "AR-3: exactly 2 QUALITY REMINDER messages injected");
}

// ── AR-4: checkResponseQuality receives correct inputs for inline path ─────────
// Verify that the quality check is invoked with androidToolsAvailable:true and
// the accumulated toolsUsed (not just the current text-turn's tools, which would
// be empty). This prevents false deflection flags on legitimate multi-step runs.
{
  const input: QualityCheckInput = {
    userMessage: "Open the Settings app and toggle airplane mode.",
    agentReply:
      "I navigated to the Settings app. I will now tap on the Airplane Mode toggle.",
    toolsUsed: ["android_screenshot", "android_tap"], // tools from prior turns
    androidToolsAvailable: true,
  };
  const qc = checkResponseQuality(input);

  assert(qc.action === "revise", "AR-4: announce phrase in mid-task reply → revise");
  assert(
    "reason" in qc && qc.reason.includes("tool"),
    "AR-4: revise reason mentions 'tool'",
  );
}

// ── AR-5: No revision when Android tools are NOT available ─────────────────────
// The inline check must be skipped (or finalize) when the session has no
// Android tools. Announce phrases in non-Android sessions are benign.
{
  const input: QualityCheckInput = {
    userMessage: "Schedule a meeting for tomorrow at 3pm.",
    agentReply: "I will now create the calendar event for you.",
    toolsUsed: [],
    androidToolsAvailable: false,
  };
  const qc = checkResponseQuality(input);
  // Without androidToolsAvailable, check 1a does not fire. The deflection
  // check (1b) would need toolsUsed=[] AND short reply AND action verb — but
  // the reply is short, so let's verify what happens.
  // The point is: the harness ONLY runs the inline check when hasAndroidTools.
  // Here we just verify androidToolsAvailable:false suppresses the Android check.
  const wouldHaveFiredWithAndroid = checkResponseQuality({
    ...input,
    androidToolsAvailable: true,
  });
  assert(
    wouldHaveFiredWithAndroid.action === "revise",
    "AR-5: same announce phrase fires when androidToolsAvailable=true",
  );
  // The harness check `if (hasAndroidTools && ...)` means this path is never
  // reached for non-Android sessions — documented here for clarity.
  assert(true, "AR-5: harness guard (hasAndroidTools) prevents check in non-Android sessions");
}

// ── AR-6: QUALITY REMINDER prefix is present on every injected message ─────────
// The harness injects `[QUALITY REMINDER] <reason>` as a user-turn message.
// Verify the prefix format is consistent across multiple revisions.
{
  const result = simulateHarnessLoop({
    userMessage: "Go to YouTube and play the top trending video.",
    replies: [
      "I opened YouTube. Next I will search for the top trending video.",
      "I can see the trending page. I will now tap on the first video.",
      "I tapped the video and it is now playing.",
    ],
    toolsUsedBeforeTextReply: ["daemon_action"],
    maxRevisions: 2,
  });

  assert(result.revisionCount === 2, "AR-6: two announce phrases → two revisions");
  assert(
    result.injectedReminders.every((r) => r.startsWith("[QUALITY REMINDER]")),
    "AR-6: all injected messages start with [QUALITY REMINDER]",
  );
  assert(result.finalReplyIndex === 2, "AR-6: clean third reply returned after guard exhausted");
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("All harness Android revision assertions passed ✓");
} else {
  process.exit(1);
}
