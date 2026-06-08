import assert from "node:assert/strict";
import {
  formatRuntimeShadowPreviewSummary,
  previewRuntimeShadowForMessage,
} from "../index";

async function main(): Promise<void> {
  const now = new Date("2026-06-08T13:00:00.000Z");

  const disabled = await previewRuntimeShadowForMessage({
    userId: "user-shadow",
    message: "What should I focus on today?",
    channel: "appchat",
    now,
    env: {},
  });
  assert.equal(disabled.enabled, false);
  assert.match(formatRuntimeShadowPreviewSummary(disabled), /disabled/);
  console.log("OK: runtime shadow preview stays disabled by default");

  const preview = await previewRuntimeShadowForMessage({
    userId: "user-shadow",
    message: "What memory do you have about morning planning?",
    channel: "appchat",
    now,
    env: { JARVIS_RUNTIME_PREVIEW: "1" },
  });
  assert.equal(preview.enabled, true);
  assert.equal("error" in preview, false);
  if (preview.enabled && !("error" in preview)) {
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.event.userId, "user-shadow");
    assert.equal(preview.event.source, "app");
    assert.equal(preview.summary.intent, "memory_query");
    assert.equal(preview.summary.approvalRequired, false);
    assert.match(preview.formatted, /runtime_shadow preview/);
  }
  console.log("OK: runtime shadow preview produces a read-only decision summary");

  const liveExecution = await previewRuntimeShadowForMessage({
    userId: "user-shadow",
    message: "Open my phone.",
    channel: "appchat",
    now,
    env: {
      JARVIS_RUNTIME_PREVIEW: "1",
      JARVIS_RUNTIME_LIVE_EXECUTION: "1",
    },
  });
  assert.equal(liveExecution.enabled, true);
  assert.equal("error" in liveExecution, true);
  assert.match(formatRuntimeShadowPreviewSummary(liveExecution), /not supported/);
  console.log("OK: runtime shadow preview fails closed when live execution is enabled");

  const missingUser = await previewRuntimeShadowForMessage({
    userId: null,
    message: "What can you do?",
    channel: "appchat",
    now,
    env: { JARVIS_RUNTIME_PREVIEW: "1" },
  });
  assert.equal(missingUser.enabled, false);
  assert.match(formatRuntimeShadowPreviewSummary(missingUser), /authenticated user/);
  console.log("OK: runtime shadow preview skips unauthenticated chat turns");

  console.log("\nAll runtime shadow preview assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
