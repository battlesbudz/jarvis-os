export interface RuntimeFeatureFlags {
  previewEnabled: boolean;
  dryRunEnabled: boolean;
  liveExecutionEnabled: boolean;
  liveWorkflowIds: string[];
}

export type RuntimeFeatureFlagEnv = Record<string, string | undefined>;

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function envList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getRuntimeFeatureFlags(env: RuntimeFeatureFlagEnv = process.env): RuntimeFeatureFlags {
  return {
    previewEnabled: envFlag(env.JARVIS_RUNTIME_PREVIEW),
    dryRunEnabled: envFlag(env.JARVIS_RUNTIME_DRY_RUN),
    liveExecutionEnabled: envFlag(env.JARVIS_RUNTIME_LIVE_EXECUTION),
    liveWorkflowIds: envList(env.JARVIS_RUNTIME_LIVE_WORKFLOWS),
  };
}

export function assertRuntimeLiveExecutionDisabled(flags: RuntimeFeatureFlags): void {
  if (flags.liveExecutionEnabled) {
    throw new Error("Runtime live execution is not supported by the current Core Runtime preview slices.");
  }
}
