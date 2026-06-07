import assert from "node:assert/strict";
import { assertRuntimeLiveExecutionDisabled, getRuntimeFeatureFlags } from "../index";

{
  const flags = getRuntimeFeatureFlags({});

  assert.equal(flags.previewEnabled, false);
  assert.equal(flags.dryRunEnabled, false);
  assert.equal(flags.liveExecutionEnabled, false);
  assert.doesNotThrow(() => assertRuntimeLiveExecutionDisabled(flags));
  console.log("OK: Runtime feature flags default to disabled");
}

{
  const flags = getRuntimeFeatureFlags({
    JARVIS_RUNTIME_PREVIEW: "1",
    JARVIS_RUNTIME_DRY_RUN: "true",
  });

  assert.equal(flags.previewEnabled, true);
  assert.equal(flags.dryRunEnabled, true);
  assert.equal(flags.liveExecutionEnabled, false);
  console.log("OK: Runtime feature flags parse preview and dry-run flags");
}

{
  const flags = getRuntimeFeatureFlags({
    JARVIS_RUNTIME_LIVE_EXECUTION: "1",
  });

  assert.equal(flags.liveExecutionEnabled, true);
  assert.throws(() => assertRuntimeLiveExecutionDisabled(flags), /not supported/);
  console.log("OK: Runtime feature flags fail closed on live execution");
}

console.log("\nAll Runtime Feature Flag assertions passed.");
