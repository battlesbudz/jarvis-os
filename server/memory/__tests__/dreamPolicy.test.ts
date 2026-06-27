import assert from "node:assert/strict";
import {
  DREAM_CAPABILITY_REVIEW_DEEP_LINK,
  DREAM_MEMORY_REVIEW_DEEP_LINK,
  buildDreamDeliveryMessage,
  buildDreamMemoryProvenance,
  inferDreamInsightKind,
  normalizeDreamInsight,
  shouldAutoPromoteDreamMemory,
} from "../dreamPolicy";

const repeatedHighConfidence = {
  insight: "The user does their best implementation work before switching into testing and review.",
  confidence: 94,
  sourceHints: ["three recent work sessions", "weekly pattern observed the same sequence"],
  kind: "memory_candidate" as const,
  memoryType: "semantic" as const,
};

assert.equal(shouldAutoPromoteDreamMemory(repeatedHighConfidence), true);
assert.equal(
  shouldAutoPromoteDreamMemory({ ...repeatedHighConfidence, memoryType: "procedural" }),
  true,
  "procedural dream memories can auto-keep when evidence is strong",
);
assert.equal(
  shouldAutoPromoteDreamMemory({ ...repeatedHighConfidence, memoryType: "episodic" }),
  false,
  "episodic dream memories stay in Memory Review",
);
assert.equal(
  shouldAutoPromoteDreamMemory({ ...repeatedHighConfidence, memoryType: "contextual" }),
  false,
  "contextual dream memories stay in Memory Review",
);
assert.equal(
  shouldAutoPromoteDreamMemory({ ...repeatedHighConfidence, memoryType: undefined }),
  false,
  "untyped dream memories stay in Memory Review",
);
assert.equal(
  shouldAutoPromoteDreamMemory({ ...repeatedHighConfidence, confidence: 89 }),
  false,
  "dream memories below 90% stay in Memory Review",
);
assert.equal(
  shouldAutoPromoteDreamMemory({ ...repeatedHighConfidence, sourceHints: ["single mention"] }),
  false,
  "single-evidence dream memories stay in Memory Review",
);
assert.equal(
  shouldAutoPromoteDreamMemory({
    ...repeatedHighConfidence,
    insight: "The user may prefer this workflow, but the evidence is unclear.",
  }),
  false,
  "abstract dream memories stay in Memory Review",
);
assert.equal(
  shouldAutoPromoteDreamMemory({
    ...repeatedHighConfidence,
    insight: "The user's bank account balance affects planning decisions.",
  }),
  false,
  "sensitive dream memories stay in Memory Review",
);
assert.equal(
  shouldAutoPromoteDreamMemory({
    ...repeatedHighConfidence,
    insight: "The user no longer treats Replit notifications as generally important.",
  }),
  false,
  "contradictory or corrective dream memories require user approval",
);

assert.equal(
  inferDreamInsightKind({
    insight: "Jarvis needs a new integration to summarize Discord incidents.",
  }),
  "capability_proposal",
);
assert.equal(
  normalizeDreamInsight({
    insight: "The user prefers morning implementation.",
    confidence: 91,
    sourceHints: ["morning work sessions", "weekly review"],
  })?.kind,
  "insight",
  "missing kind should stay as a digest insight instead of becoming memory",
);
assert.equal(
  normalizeDreamInsight({
    insight: "The user prefers morning implementation.",
    confidence: 91,
    sourceHints: ["morning work sessions", "weekly review"],
    kind: "memory_candidate",
  })?.kind,
  "memory_candidate",
);

const provenance = buildDreamMemoryProvenance({
  dreamDate: "2026-06-27",
  sourceHints: ["morning sessions", "review comments"],
  sourceMemoryIds: ["mem-a", "mem-b"],
});
assert.equal(provenance[0]?.sourceType, "dream_cycle");
assert.equal(provenance[1]?.sourceType, "dream_evidence");
assert.equal(provenance[3]?.sourceType, "user_memory");

const digest = buildDreamDeliveryMessage([
  {
    insightText: "The user gets stuck when validation results are hidden.",
    insightKind: "memory_candidate",
    reviewPayload: {
      memoryReview: { status: "pending", memoryId: "mem-1", deepLink: DREAM_MEMORY_REVIEW_DEEP_LINK },
    },
  },
  {
    insightText: "Jarvis needs a better YouTube runtime command.",
    insightKind: "capability_proposal",
    reviewPayload: {
      capabilityReview: { status: "pending_approval", deliverableId: "del-1", deepLink: DREAM_CAPABILITY_REVIEW_DEEP_LINK },
    },
  },
  {
    insightText: "The user repeats the same reliable implementation loop.",
    insightKind: "memory_candidate",
    reviewPayload: {
      memoryReview: { status: "auto_kept", memoryId: "mem-2", deepLink: DREAM_MEMORY_REVIEW_DEEP_LINK },
    },
  },
]);
assert.match(digest, /Memory Review/);
assert.match(digest, new RegExp(DREAM_MEMORY_REVIEW_DEEP_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(digest, /capability proposal/);
assert.match(digest, new RegExp(DREAM_CAPABILITY_REVIEW_DEEP_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(digest, /kept automatically/);

console.log("OK: dream policy gates memory promotion and separates digest queues");
