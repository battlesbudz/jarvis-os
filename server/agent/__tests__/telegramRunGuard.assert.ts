import assert from "node:assert/strict";
import {
  TelegramRunAbortedError,
  TelegramRunTimeoutError,
  createTelegramRunGuard,
  resolveTelegramReplyTimeoutMs,
} from "../../telegramRunGuard";
import { activeCoachRuns } from "../../runRegistry";

async function main() {
  activeCoachRuns.clear();

  assert.equal(
    resolveTelegramReplyTimeoutMs("10000"),
    300_000,
    "a 10-second env override must not become Telegram's production turn abort timeout",
  );
  assert.equal(resolveTelegramReplyTimeoutMs("60000"), 300_000);
  assert.equal(resolveTelegramReplyTimeoutMs("900000"), 900_000);
  console.log("OK: Telegram production timeout has a floor well above the fast-reply target");

  const first = createTelegramRunGuard("user-telegram");
  assert.equal(activeCoachRuns.size, 1);
  assert.equal(first.signal.aborted, false);

  const second = createTelegramRunGuard("user-telegram");
  assert.equal(first.signal.aborted, false, "a new Telegram turn should not abort a previous turn");
  assert.equal(second.signal.aborted, false);
  assert.equal(activeCoachRuns.size, 2, "Telegram should allow multiple active turns from one user");

  const firstResult = await first.race(Promise.resolve("first reply"));
  assert.equal(firstResult, "first reply");
  first.finish();
  assert.equal(activeCoachRuns.size, 1, "finishing one Telegram turn should leave the other active");
  console.log("OK: overlapping Telegram turns stay independent");

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

  const stopped = createTelegramRunGuard("user-telegram");
  activeCoachRuns.get(stopped.runId)?.controller.abort(new TelegramRunAbortedError("Manual stop"));
  await assert.rejects(
    () => stopped.race(Promise.resolve("late")),
    (error) => {
      assert.ok(error instanceof TelegramRunAbortedError);
      return true;
    },
  );
  stopped.finish();
  assert.equal(activeCoachRuns.size, 0);
  console.log("OK: explicit Telegram stops still abort the targeted turn");

  console.log("\nAll Telegram run guard assertions passed.");
}

main().catch((error) => {
  activeCoachRuns.clear();
  console.error(error);
  process.exit(1);
});
