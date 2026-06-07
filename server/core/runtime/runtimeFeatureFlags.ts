export interface RuntimeFeatureFlags {
  previewEnabled: boolean;
  dryRunEnabled: boolean;
  liveExecutionEnabled: boolean;
}

export type RuntimeFeatureFlagEnv = Record<string, string | undefined>;

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function getRuntimeFeatureFlags(env: RuntimeFeatureFlagEnv = process.env): RuntimeFeatureFlags {
  return {
    previewEnabled: envFlag(env.JARVIS_RUNTIME_PREVIEW),
    dryRunEnabled: envFlag(env.JARVIS_RUNTIME_DRY_RUN),
    liveExecutionEnabled: envFlag(env.JARVIS_RUNTIME_LIVE_EXECUTION),
  };
}

export function assertRuntimeLiveExecutionDisabled(flags: RuntimeFeatureFlags): void {
  if (flags.liveExecutionEnabled) {
    throw new Error("Runtime live execution is not supported by the current Core Runtime preview slices.");
  }
}
