import assert from "node:assert/strict";
import {
  evaluateMemoryAutoReviewDecision,
  runMemoryAutoReviewForAllUsers,
} from "../autoReview";

const baseMemory = {
  id: "m1",
  userId: "user-a",
  content: "The user prefers deep work in the early morning before meetings start.",
  category: "work_patterns",
  confidence: 85,
  sourceType: "weekly_pattern",
  tier: "long_term",
  memoryType: "semantic",
  pendingReview: true,
  reviewStatus: "pending",
  supersedesMemoryId: null,
} as const;

const keepDecision = evaluateMemoryAutoReviewDecision(baseMemory);
assert.equal(keepDecision.action, "keep");

assert.equal(
  evaluateMemoryAutoReviewDecision({
    ...baseMemory,
    category: "relationships",
  }).action,
  "pending",
);

assert.equal(
  evaluateMemoryAutoReviewDecision({
    ...baseMemory,
    confidence: 75,
  }).action,
  "pending",
);

assert.equal(
  evaluateMemoryAutoReviewDecision({
    ...baseMemory,
    content: "The user's API key is stored in a local file.",
  }).action,
  "pending",
);

assert.equal(
  evaluateMemoryAutoReviewDecision({
    ...baseMemory,
    supersedesMemoryId: "older-memory",
  }).action,
  "pending",
);

assert.equal(
  evaluateMemoryAutoReviewDecision({
    ...baseMemory,
    sourceType: "explicit_remember",
  }).action,
  "pending",
);

async function main(): Promise<void> {
  const logs: string[] = [];
  const errors: string[] = [];
  const keptByUser = new Map<string, string[]>();
  const soulUsers: string[] = [];
  const projectedUsers: string[] = [];

  const result = await runMemoryAutoReviewForAllUsers(
    new Date("2026-06-05T10:00:00.000Z"),
    {
      async listUserIds() {
        return ["user-a", "user-b", "user-c"];
      },
      async claimRun(userId) {
        return userId !== "user-b";
      },
      async listPendingMemories(userId) {
        if (userId === "user-c") throw new Error("boom");
        return [
          baseMemory,
          {
            ...baseMemory,
            id: "m2",
            content: "The user is dating someone new right now.",
            category: "relationships",
          },
          {
            ...baseMemory,
            id: "m3",
            confidence: 75,
          },
          {
            ...baseMemory,
            id: "m4",
            supersedesMemoryId: "older-memory",
          },
        ].map((memory) => ({ ...memory, userId }));
      },
      async keepMemories(userId, memoryIds) {
        keptByUser.set(userId, memoryIds);
        return memoryIds.length;
      },
      async markSoulStale(userId) {
        soulUsers.push(userId);
      },
      async projectApprovedMemories(userId) {
        projectedUsers.push(userId);
      },
      log(message) {
        logs.push(message);
      },
      error(message, error) {
        errors.push(`${message} ${error instanceof Error ? error.message : String(error)}`);
      },
    },
  );

  assert.deepEqual(result, {
    users: 3,
    processed: 1,
    skipped: 1,
    failed: 1,
    scanned: 4,
    autoKept: 1,
  });
  assert.deepEqual(keptByUser.get("user-a"), ["m1"]);
  assert.deepEqual(soulUsers, ["user-a"]);
  assert.deepEqual(projectedUsers, ["user-a"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /user-c/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /autoKept=1/);

  console.log("OK: memory auto-review keeps only safe high-confidence pending memories");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
