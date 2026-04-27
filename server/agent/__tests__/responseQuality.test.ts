/**
 * Unit tests for the ResponseQualityChecker (before_agent_finalize hook).
 *
 * Each assertion is a separate console.assert so failures are clear.
 * Run with: tsx server/agent/__tests__/responseQuality.test.ts
 */

import { checkResponseQuality } from "../responseQuality";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

// ── Deflection detector ────────────────────────────────────────────────────────

const deflectionInput = {
  userMessage: "Please send an email to john@example.com saying I'll be late.",
  agentReply: "I'll get that done for you shortly!",
  toolsUsed: [],
};

const deflectionResult = checkResponseQuality(deflectionInput);
assert(deflectionResult.action === "revise", "RQ-1: deflection — short reply + action verb + no tools → revise");
assert(
  "reason" in deflectionResult && deflectionResult.reason.includes("action"),
  "RQ-1: deflection reason mentions 'action'",
);

// Agent used a tool — should not flag as deflection
const withToolsInput = {
  userMessage: "Please send an email to john@example.com saying I'll be late.",
  agentReply: "I'll get that done for you shortly!",
  toolsUsed: ["send_email"],
};
assert(
  checkResponseQuality(withToolsInput).action === "finalize",
  "RQ-2: deflection check skipped when tool was used",
);

// Action verb in message but reply is long and substantive — no deflection
// (reply is 42+ words so replyWords < 40 threshold is not met)
const longReplyDeflect = {
  userMessage: "Search for the latest news on AI.",
  agentReply:
    "I don't have direct web access to fetch live news, but I can point you to the best sources. " +
    "For AI news, check TechCrunch, The Verge, MIT Technology Review, and Hacker News. " +
    "Alternatively, follow researchers like Andrej Karpathy or Yann LeCun on Twitter. " +
    "Would you like me to help you set up a news digest instead?",
  toolsUsed: [],
};
assert(
  checkResponseQuality(longReplyDeflect).action === "finalize",
  "RQ-3: long explanatory reply (40+ words) not flagged as deflection",
);

// ── Terse response check ───────────────────────────────────────────────────────

const terseInput = {
  userMessage:
    "Can you help me plan my week? I have a big product launch on Thursday and multiple team meetings. " +
    "I'd love to prioritise my tasks and block some focus time.",
  agentReply: "Sure, I can help with that.",
  toolsUsed: [],
};
const terseResult = checkResponseQuality(terseInput);
assert(terseResult.action === "revise", "RQ-4: terse response on long question → revise");
assert(
  "reason" in terseResult && terseResult.reason.includes("brief"),
  "RQ-4: terse reason mentions 'brief'",
);

// Short user message → no terse flag
const shortQuestionShortAnswer = {
  userMessage: "What time is it?",
  agentReply: "I don't have access to your current time.",
  toolsUsed: [],
};
assert(
  checkResponseQuality(shortQuestionShortAnswer).action === "finalize",
  "RQ-5: short reply to short question not flagged",
);

// ── Apology-only check ─────────────────────────────────────────────────────────
// Use a message without action verbs so the deflection check doesn't fire first.

const apologyInput = {
  userMessage: "What is the capital of France?",
  agentReply: "I apologize, but I cannot answer that.",
  toolsUsed: [],
};
const apologyResult = checkResponseQuality(apologyInput);
assert(apologyResult.action === "revise", "RQ-6: apology-only short reply → revise");
assert(
  "reason" in apologyResult && apologyResult.reason.includes("apologise"),
  "RQ-6: apology reason text correct",
);

// Long apology with explanation should not be flagged
const longApologyWithContext = {
  userMessage: "Book me a table at the French Laundry.",
  agentReply:
    "I apologize, but I don't have the ability to make real-world restaurant reservations directly. " +
    "You can book via OpenTable at opentable.com or call the restaurant at +1 (707) 944-2380. " +
    "Would you like me to help you draft a reservation request email instead?",
  toolsUsed: [],
};
assert(
  checkResponseQuality(longApologyWithContext).action === "finalize",
  "RQ-7: substantive apology with alternative → no flag",
);

// ── Happy path — no revision needed ───────────────────────────────────────────

const goodReply = {
  userMessage: "What are some good habits for staying focused during deep work?",
  agentReply:
    "Great question! The most effective habits for deep work focus include: " +
    "time-blocking (schedule 90-120 min sessions), eliminating digital distractions, " +
    "using a shutdown ritual to end work sessions clearly, and protecting your best " +
    "cognitive hours for hard tasks. Would you like help building a focus schedule?",
  toolsUsed: [],
};
assert(checkResponseQuality(goodReply).action === "finalize", "RQ-8: quality reply → finalize (no revision)");

// ── Word-boundary matching (avoid false positives) ─────────────────────────────

// "sender" should not match "send"
const senderTest = {
  userMessage: "Who is the sender of this email?",
  agentReply: "The sender field is not visible in the context provided.",
  toolsUsed: [],
};
assert(
  checkResponseQuality(senderTest).action === "finalize",
  "RQ-9: 'sender' does not match 'send' verb — no deflection flag",
);

// ── Print summary ──────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("All response quality assertions passed ✓");
} else {
  process.exit(1);
}
