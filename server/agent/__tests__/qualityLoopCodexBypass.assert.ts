import assert from "node:assert/strict";
import {
  postCheck,
  preThink,
  shouldBypassQualityLoopForModel,
} from "../qualityLoop";

const CODEX_MODEL = "chatgpt-codex-oauth/auto";

assert.equal(shouldBypassQualityLoopForModel(CODEX_MODEL), true);
assert.equal(shouldBypassQualityLoopForModel("codex-oauth/auto"), true);
assert.equal(shouldBypassQualityLoopForModel("gpt-4.1-mini"), false);

async function main(): Promise<void> {
  const preThinkStartedAt = Date.now();
  const guidance = await preThink(
    "Search the web for today's AI news.",
    "Telegram June 3, 2026",
    CODEX_MODEL,
    "test-user",
  );
  assert.equal(guidance, "");
  assert.ok(
    Date.now() - preThinkStartedAt < 1000,
    "Codex OAuth quality pre-think should bypass immediately instead of opening a daemon model turn",
  );

  const checkStartedAt = Date.now();
  const check = await postCheck(
    "Search the web for today's AI news.",
    "Here is a concise answer.",
    CODEX_MODEL,
    "test-user",
  );
  assert.deepEqual(check, { passed: true, feedback: "" });
  assert.ok(
    Date.now() - checkStartedAt < 1000,
    "Codex OAuth quality post-check should bypass immediately instead of opening a daemon model turn",
  );

  console.log("OK: Codex OAuth quality loop is bypassed for optional checks.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
