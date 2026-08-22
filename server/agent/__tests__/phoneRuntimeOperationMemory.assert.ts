import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { PhoneRuntimeOperation } from "@shared/schema";
import {
  isConcretePhoneRuntimeCommand,
  isPhoneRuntimeOperationReference,
  selectReferencedPhoneRuntimeOperation,
} from "../phoneRuntimeOperationMemory";

const now = new Date("2026-08-22T15:00:00.000Z");
function operation(input: Partial<PhoneRuntimeOperation> & Pick<PhoneRuntimeOperation, "id" | "goal">): PhoneRuntimeOperation {
  return {
    userId: "user-a",
    sessionId: null,
    originChannel: "appchat",
    status: "active",
    state: {},
    createdAt: new Date("2026-08-21T15:00:00.000Z"),
    updatedAt: new Date("2026-08-21T15:00:00.000Z"),
    completedAt: null,
    ...input,
  };
}

const facebookGoal = operation({
  id: "facebook",
  goal: "Open Facebook and search Marketplace for used cars near me",
  status: "blocked",
  state: { appTarget: "Facebook", blocker: "Android blocked the background launch", nextStep: "Retry while unlocked" },
});
const instagramGoal = operation({
  id: "instagram",
  goal: "Open Instagram and search for local restaurants",
  updatedAt: new Date("2026-08-22T14:00:00.000Z"),
});

assert.equal(isPhoneRuntimeOperationReference("Please carry on from where we left off"), true);
assert.equal(isPhoneRuntimeOperationReference("What is Facebook Marketplace?"), false);
assert.equal(isConcretePhoneRuntimeCommand("Search Instagram for dogs again"), true);
assert.equal(isConcretePhoneRuntimeCommand("That Facebook thing from yesterday—try again"), false);
assert.equal(
  selectReferencedPhoneRuntimeOperation(
    "Hey, yesterday, that Facebook thing—can you try again?",
    [instagramGoal, facebookGoal],
    now,
  )?.id,
  "facebook",
  "a natural temporal/entity reference should recover the durable goal rather than depend on chat-window wording",
);
assert.equal(
  selectReferencedPhoneRuntimeOperation("Retry the last operation", [instagramGoal, facebookGoal], now)?.id,
  "instagram",
  "a bare retry should resume the most recently updated unfinished operation",
);
assert.equal(
  selectReferencedPhoneRuntimeOperation("Continue that Facebook task", [
    facebookGoal,
    operation({ id: "facebook-profile", goal: "Open Facebook and inspect Dakota Bull's profile" }),
  ], now),
  null,
  "equally matching unfinished operations should remain ambiguous instead of guessing",
);
assert.equal(
  selectReferencedPhoneRuntimeOperation("Try that Facebook task again", [
    { ...facebookGoal, status: "completed", completedAt: new Date("2026-08-21T16:00:00.000Z") },
  ], now),
  null,
  "completed operations must not be resumed",
);
assert.equal(
  selectReferencedPhoneRuntimeOperation("Continue that Snapchat task", [facebookGoal], now),
  null,
  "an entity mismatch must not revive an unrelated operation",
);

const root = process.cwd();
const appRoute = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
const channelRoute = fs.readFileSync(path.join(root, "server/channels/coachAgent.ts"), "utf8");
assert.match(appRoute, /findReferencedPhoneRuntimeOperation[\s\S]*activePhoneRuntimeOperation\?\.goal/);
assert.match(appRoute, /recordPhoneRuntimeToolResult\([\s\S]*activePhoneRuntimeOperation\.id/);
assert.match(channelRoute, /findReferencedPhoneRuntimeOperation[\s\S]*wrapPhoneRuntimeOperationTools/);

console.log("phoneRuntimeOperationMemory assertions passed");
