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
