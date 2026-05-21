import assert from "node:assert/strict";
import {
  TelegramRunAbortedError,
  TelegramRunTimeoutError,
  createTelegramRunGuard,
} from "../../telegramRunGuard";
import { activeCoachRuns } from "../../runRegistry";

async function main() {
  activeCoachRuns.clear();

  const first = createTelegramRunGuard("user-telegram");
  assert.equal(activeCoachRuns.size, 1);
  assert.equal(first.signal.aborted, false);

  const second = createTelegramRunGuard("user-telegram");
  assert.equal(first.signal.aborted, true, "a new Telegram turn should abort the previous stuck turn");
  assert.equal(activeCoachRuns.size, 1, "only the latest Telegram turn should remain active");

  await assert.rejects(
    () => first.race(Promise.resolve("late")),
    (error) => {
      assert.ok(error instanceof TelegramRunAbortedError);
      return true;
    },
  );
  console.log("OK: superseded Telegram turns abort cleanly");

  await assert.rejects(
    () => second.race(new Promise(() => {}), 5),
    (error) => {
      assert.ok(error instanceof TelegramRunTimeoutError);
      return true;
    },
  );
  assert.equal(second.signal.aborted, true, "timed-out Telegram turns should abort their outer guard");
  console.log("OK: hung Telegram turns time out instead of refreshing typing forever");

  second.finish();
  assert.equal(activeCoachRuns.size, 0);
  console.log("OK: Telegram run guard unregisters finished turns");

  console.log("\nAll Telegram run guard assertions passed.");
}

main().catch((error) => {
  activeCoachRuns.clear();
  console.error(error);
  process.exit(1);
});
