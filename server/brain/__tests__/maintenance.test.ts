import assert from "node:assert/strict";
import { runBrainMaintenanceForAllUsers } from "../maintenance";

async function main(): Promise<void> {
  const logs: string[] = [];
  const errors: string[] = [];

  const result = await runBrainMaintenanceForAllUsers(
    new Date("2026-06-02T10:00:00.000Z"),
    {
      async listUserIds() {
        return ["user-a", "user-b", "user-c"];
      },
      async claimRun(userId) {
        return userId !== "user-b";
      },
      async projectPeople(userId) {
        if (userId === "user-c") throw new Error("boom");
        return { projected: 2 };
      },
      async projectMemories() {
        return { projected: 3 };
      },
      async refreshUserIndex() {
        return { embedded: 4 };
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
    peopleProjected: 2,
    memoriesProjected: 3,
    chunksEmbedded: 4,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /user-c/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /processed=1/);
  assert.match(logs[0], /skipped=1/);
  assert.match(logs[0], /failed=1/);

  console.log("OK: brain maintenance claims daily work and aggregates results");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
