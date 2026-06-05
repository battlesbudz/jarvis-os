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
    900_000,
    "a 10-second env override must not become Telegram's production inactivity timeout",
  );
  assert.equal(resolveTelegramReplyTimeoutMs("60000"), 900_000);
  assert.equal(resolveTelegramReplyTimeoutMs("900000"), 900_000);
  console.log("OK: Telegram production inactivity timeout has a 15-minute floor");

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
  console.log("OK: inactive Telegram turns time out instead of refreshing typing forever");

  second.finish();
  assert.equal(activeCoachRuns.size, 0);
  console.log("OK: Telegram run guard unregisters finished turns");

  const active = createTelegramRunGuard("user-telegram");
  const activeStartedAt = Date.now();
  const activeResult = active.race(
    new Promise<string>((resolve) => setTimeout(() => resolve("finished after meaningful work"), 28)),
    20,
  );
  setTimeout(() => active.touch("tool_call", "Reading memory"), 12);
  assert.equal(
    await activeResult,
    "finished after meaningful work",
    "meaningful activity inside the inactivity window should extend the Telegram turn",
  );
  assert.ok(Date.now() - activeStartedAt >= 24);
  active.finish();
  console.log("OK: meaningful Telegram activity extends the inactivity window");

  const filler = createTelegramRunGuard("user-telegram");
  setTimeout(() => filler.touch("auto_progress", "Still running"), 5);
  await assert.rejects(
    () => filler.race(new Promise(() => {}), 20),
    (error) => {
      assert.ok(error instanceof TelegramRunTimeoutError);
      return true;
    },
  );
  filler.finish();
  console.log("OK: automatic filler progress does not keep a Telegram turn alive forever");

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
