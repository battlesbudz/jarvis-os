import assert from "node:assert/strict";
import { assertRuntimeLiveExecutionDisabled, getRuntimeFeatureFlags } from "../index";

{
  const flags = getRuntimeFeatureFlags({});

  assert.equal(flags.previewEnabled, false);
  assert.equal(flags.dryRunEnabled, false);
  assert.equal(flags.liveExecutionEnabled, false);
  assert.equal(flags.defaultReadOnlyEnabled, false);
  assert.equal(flags.killSwitchEnabled, false);
  assert.deepEqual(flags.liveWorkflowIds, []);
  assert.doesNotThrow(() => assertRuntimeLiveExecutionDisabled(flags));
  console.log("OK: Runtime feature flags default to disabled");
}

{
  const flags = getRuntimeFeatureFlags({
    JARVIS_RUNTIME_PREVIEW: "1",
    JARVIS_RUNTIME_DRY_RUN: "true",
    JARVIS_RUNTIME_DEFAULT_READ_ONLY: "1",
    JARVIS_RUNTIME_KILL_SWITCH: "false",
    JARVIS_RUNTIME_LIVE_WORKFLOWS: "general-answer, memory-lookup",
  });

  assert.equal(flags.previewEnabled, true);
  assert.equal(flags.dryRunEnabled, true);
  assert.equal(flags.liveExecutionEnabled, false);
  assert.equal(flags.defaultReadOnlyEnabled, true);
  assert.equal(flags.killSwitchEnabled, false);
  assert.deepEqual(flags.liveWorkflowIds, ["general-answer", "memory-lookup"]);
  console.log("OK: Runtime feature flags parse preview, dry-run, default, kill switch, and workflow allowlist flags");
}

{
  const flags = getRuntimeFeatureFlags({
    JARVIS_RUNTIME_LIVE_EXECUTION: "1",
  });

  assert.equal(flags.liveExecutionEnabled, true);
  assert.throws(() => assertRuntimeLiveExecutionDisabled(flags), /not supported/);
  console.log("OK: Runtime feature flags fail closed on live execution");
}

{
  const flags = getRuntimeFeatureFlags({
    JARVIS_RUNTIME_KILL_SWITCH: "true",
  });

  assert.equal(flags.killSwitchEnabled, true);
  console.log("OK: Runtime feature flags parse kill switch");
}

console.log("\nAll Runtime Feature Flag assertions passed.");
