export const LIVE_ACTION_FEATURE_FLAG_NAMES = [
  "JARVIS_PROJECT_CAPSULE",
  "JARVIS_LIVE_ACTIONS_PROJECTOR",
  "JARVIS_LIVE_ACTIONS_UI",
  "JARVIS_LIVE_ACTIONS_STREAM",
] as const;

export type LiveActionFeatureFlagName = typeof LIVE_ACTION_FEATURE_FLAG_NAMES[number];
export type LiveActionFeatureFlagEnv = Record<string, string | undefined>;

export interface LiveActionFeatureFlags {
  projectCapsule: boolean;
  projector: boolean;
  ui: boolean;
  stream: boolean;
}

function enabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function getLiveActionFeatureFlags(
  env: LiveActionFeatureFlagEnv = process.env,
): LiveActionFeatureFlags {
  return {
    projectCapsule: enabled(env.JARVIS_PROJECT_CAPSULE),
    projector: enabled(env.JARVIS_LIVE_ACTIONS_PROJECTOR),
    ui: enabled(env.JARVIS_LIVE_ACTIONS_UI),
    stream: enabled(env.JARVIS_LIVE_ACTIONS_STREAM),
  };
}
