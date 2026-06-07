import assert from "node:assert/strict";
import { getCoachAgentSessionAgentId } from "../../channels/coachAgentSession";
import { getCoachAppAgentId } from "../coreAgentIds";

const userId = "user-session-test";

assert.equal(
  getCoachAgentSessionAgentId(userId),
  getCoachAppAgentId(userId),
  "channel coach sessions must use the seeded per-user coach app agent id",
);
assert.notEqual(
  getCoachAgentSessionAgentId(userId),
  "coach",
  "channel coach sessions must not use the stale unseeded literal coach id",
);

console.log("OK: coach channel sessions use the seeded core coach agent id");
