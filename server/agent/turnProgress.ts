export const TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS = 8_000;

const DEFAULT_PHASES = [
  "Loading conversation context",
  "Checking available tools and route",
  "Working through the request",
  "Waiting on model or tool results",
  "Still running the turn",
];

export function shouldEmitVisibleProgressUpdate(input: {
  nowMs: number;
  lastVisibleUpdateAtMs: number;
  intervalMs?: number;
}): boolean {
  const intervalMs = input.intervalMs ?? TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS;
  return input.nowMs - input.lastVisibleUpdateAtMs >= intervalMs;
}

export function buildVisibleTurnProgressMessage(input: {
  startedAtMs: number;
  nowMs: number;
  updateCount: number;
  latestPhase?: string;
}): string {
  const elapsedSeconds = Math.max(0, Math.round((input.nowMs - input.startedAtMs) / 1000));
  const phase = input.latestPhase?.trim()
    || DEFAULT_PHASES[input.updateCount % DEFAULT_PHASES.length];
  return `Working - ${phase}\nElapsed: ${elapsedSeconds}s`;
}

export type TurnProgressEvent = {
  type: "progress";
  source: string;
  stage: string;
  message: string;
  detail?: string;
  elapsedSeconds: number;
  updateCount: number;
  meaningful: boolean;
};

export function buildTurnProgressEvent(input: {
  startedAtMs: number;
  nowMs: number;
  updateCount: number;
  source?: string;
  stage?: string;
  message: string;
  detail?: string;
  meaningful?: boolean;
}): TurnProgressEvent {
  return {
    type: "progress",
    source: input.source?.trim() || "server",
    stage: input.stage?.trim() || "working",
    message: input.message,
    ...(input.detail ? { detail: input.detail } : {}),
    elapsedSeconds: Math.max(0, Math.round((input.nowMs - input.startedAtMs) / 1000)),
    updateCount: input.updateCount,
    meaningful: input.meaningful ?? false,
  };
}
