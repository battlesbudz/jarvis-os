import assert from "node:assert/strict";
import { getExplicitCoachRequestedModel } from "../../services/coachModelSelection";

async function main() {
  const calls: string[] = [];
  const missing = await getExplicitCoachRequestedModel("user-without-selection", async (userId) => {
    calls.push(userId);
    return null;
  });
  assert.equal(missing, undefined);
  assert.deepEqual(calls, ["user-without-selection"]);

  const gemini = await getExplicitCoachRequestedModel("user-gemini", async () => "google/gemini-2.5-flash");
  assert.equal(gemini, "google/gemini-2.5-flash");

  const codex = await getExplicitCoachRequestedModel("user-codex", async () => "chatgpt-codex-oauth/auto");
  assert.equal(codex, "chatgpt-codex-oauth/auto");

  const noUser = await getExplicitCoachRequestedModel(null, async () => {
    throw new Error("resolver should not be called without a user");
  });
  assert.equal(noUser, undefined);

  console.log("OK: coach chat only pins an explicitly selected model");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
