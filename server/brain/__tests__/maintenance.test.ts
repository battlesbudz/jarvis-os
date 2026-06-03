import assert from "node:assert/strict";
import { runBrainMaintenanceForAllUsers } from "../maintenance";

type Call = {
  name: string;
  userId?: string;
  messageType?: string;
  sentDate?: string;
};

async function main(): Promise<void> {
  const calls: Call[] = [];
  const alreadyRun = new Set(["user-skipped|gbrain:refresh_index:2026-06-02|2026-06-02"]);
  const claimed = new Set<string>();

  const result = await runBrainMaintenanceForAllUsers(new Date("2026-06-02T10:00:00.000Z"), {
    async listUserIds() {
      calls.push({ name: "listUserIds" });
      return ["user-active", "user-skipped", "user-fails"];
    },
    async claimRun(userId, messageType, sentDate) {
      calls.push({ name: "claimRun", userId, messageType, sentDate });
      const key = `${userId}|${messageType}|${sentDate}`;
      if (alreadyRun.has(key)) return false;
      claimed.add(key);
      return true;
    },
    async projectPeople(userId) {
      calls.push({ name: "projectPeople", userId });
      if (userId === "user-fails") throw new Error("projection failed");
      return { projected: 2 };
    },
    async projectMemories(userId) {
      calls.push({ name: "projectMemories", userId });
      return { projected: 3 };
    },
    async refreshUserIndex(userId) {
      calls.push({ name: "refreshUserIndex", userId });
      return { embedded: 4 };
    },
    log(message) {
      calls.push({ name: "log", userId: message });
    },
    error(message) {
      calls.push({ name: "error", userId: message });
    },
  });

  assert.deepEqual(result, {
    users: 3,
    processed: 1,
    skipped: 1,
    failed: 1,
    peopleProjected: 2,
    memoriesProjected: 3,
    chunksEmbedded: 4,
  });

  assert.ok(claimed.has("user-active|gbrain:refresh_index:2026-06-02|2026-06-02"));
  assert.equal(claimed.has("user-skipped|gbrain:refresh_index:2026-06-02|2026-06-02"), false);
  assert.ok(claimed.has("user-fails|gbrain:refresh_index:2026-06-02|2026-06-02"));

  const activeOrder = calls
    .filter((call) => call.userId === "user-active")
    .map((call) => call.name);
  assert.deepEqual(activeOrder, ["claimRun", "projectPeople", "projectMemories", "refreshUserIndex"]);

  const skippedCalls = calls
    .filter((call) => call.userId === "user-skipped")
    .map((call) => call.name);
  assert.deepEqual(skippedCalls, ["claimRun"]);

  const failedCalls = calls
    .filter((call) => call.userId === "user-fails")
    .map((call) => call.name);
  assert.deepEqual(failedCalls, ["claimRun", "projectPeople"]);

  console.log("OK: brain maintenance is idempotent, ordered, and failure-isolated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
