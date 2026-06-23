import assert from "node:assert/strict";
import { verifyDatabaseTablesBeforeListen } from "../databaseBoot";

async function main() {
  let attempts = 0;
  await assert.rejects(
    () =>
      verifyDatabaseTablesBeforeListen({
        attempts: 2,
        delayMsForAttempt: () => 0,
        ensureTablesExist: async () => {
          attempts += 1;
          throw new Error("db unavailable");
        },
      }),
    /Database table verification failed before startup/,
  );
  assert.equal(attempts, 2);

  let flakyAttempts = 0;
  await verifyDatabaseTablesBeforeListen({
    attempts: 3,
    delayMsForAttempt: () => 0,
    ensureTablesExist: async () => {
      flakyAttempts += 1;
      if (flakyAttempts < 2) throw new Error("first attempt fails");
    },
  });
  assert.equal(flakyAttempts, 2);

  console.log("OK: database boot verification retries and fails closed before listen");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
