import assert from "node:assert/strict";
import {
  TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS,
  buildVisibleTurnProgressMessage,
  shouldEmitVisibleProgressUpdate,
} from "../turnProgress";

const startedAt = 1_000;

assert.equal(
  shouldEmitVisibleProgressUpdate({
    nowMs: startedAt + TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS - 1,
    lastVisibleUpdateAtMs: startedAt,
  }),
  false,
  "progress update should not fire before the visible interval elapses",
);

assert.equal(
  shouldEmitVisibleProgressUpdate({
    nowMs: startedAt + TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS,
    lastVisibleUpdateAtMs: startedAt,
  }),
  true,
  "progress update should fire once the visible interval elapses",
);

assert.match(
  buildVisibleTurnProgressMessage({
    startedAtMs: startedAt,
    nowMs: startedAt + 21_000,
    updateCount: 2,
  }),
  /Elapsed: 21s/,
  "progress message should include elapsed time",
);

assert.match(
  buildVisibleTurnProgressMessage({
    startedAtMs: startedAt,
    nowMs: startedAt + 21_000,
    updateCount: 1,
    latestPhase: "Searching memory",
  }),
  /Searching memory/,
  "explicit phase should be surfaced when available",
);

console.log("OK: visible turn progress messages provide timed user-facing status");
