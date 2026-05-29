import assert from "node:assert/strict";
import { resolveTemporalExpression } from "../temporalContext";

const now = new Date("2026-05-29T16:00:00.000Z"); // Friday, noon in America/New_York
const timezone = "America/New_York";

const inHour = resolveTemporalExpression({ text: "remind me in an hour to call the company", now, timezone });
assert.equal(inHour.kind, "relative_point");
assert.equal(inHour.targetAt, "2026-05-29T17:00:00.000Z");
assert.equal(inHour.ambiguous, false);

const later = resolveTemporalExpression({ text: "remind me later to call the company", now, timezone });
assert.equal(later.kind, "relative_point");
assert.equal(later.label, "later");
assert.equal(later.targetAt, "2026-05-29T18:00:00.000Z");
assert.equal(later.ambiguous, true);

const nextWeek = resolveTemporalExpression({ text: "remind me next week to follow up with John", now, timezone });
assert.equal(nextWeek.kind, "future_window");
assert.equal(nextWeek.label, "next week");
assert.equal(nextWeek.start, "2026-06-01T04:00:00.000Z");
assert.equal(nextWeek.end, "2026-06-08T03:59:59.999Z");

const lastMonth = resolveTemporalExpression({ text: "what did John say last month?", now, timezone });
assert.equal(lastMonth.kind, "past_window");
assert.equal(lastMonth.label, "last month");
assert.equal(lastMonth.start, "2026-04-01T04:00:00.000Z");
assert.equal(lastMonth.end, "2026-05-01T03:59:59.999Z");

const tomorrowAtNine = resolveTemporalExpression({ text: "remind me tomorrow at 9am to follow up", now, timezone });
assert.equal(tomorrowAtNine.kind, "future_point");
assert.equal(tomorrowAtNine.targetAt, "2026-05-30T13:00:00.000Z");
assert.equal(tomorrowAtNine.ambiguous, false);

const monday = resolveTemporalExpression({ text: "remind me Monday to check in", now, timezone });
assert.equal(monday.kind, "future_point");
assert.equal(monday.targetAt, "2026-06-01T13:00:00.000Z");
assert.equal(monday.ambiguous, true);

const none = resolveTemporalExpression({ text: "what should I do?", now, timezone });
assert.equal(none.kind, "none");

console.log("temporalContext assertions passed");
