export const LOCAL_VOICE_SILENCE_THRESHOLD_DB = -40;
export const LOCAL_VOICE_TURN_END_SILENCE_MS = 5_000;
export const LOCAL_VOICE_IDLE_PAUSE_MS = 60_000;
export const LOCAL_VOICE_SILENCE_POLL_MS = 250;

export interface LocalVoiceSilenceState {
  speechDetected: boolean;
  silenceMs: number;
  idleMs: number;
  shouldSubmit: boolean;
  shouldPause: boolean;
}

export function createLocalVoiceSilenceState(): LocalVoiceSilenceState {
  return {
    speechDetected: false,
    silenceMs: 0,
    idleMs: 0,
    shouldSubmit: false,
    shouldPause: false,
  };
}

export function updateLocalVoiceSilenceState(
  previous: LocalVoiceSilenceState,
  input: {
    decibels: number;
    pollMs?: number;
    thresholdDb?: number;
    turnEndSilenceMs?: number;
    idlePauseMs?: number;
  },
): LocalVoiceSilenceState {
  const pollMs = input.pollMs ?? LOCAL_VOICE_SILENCE_POLL_MS;
  const thresholdDb = input.thresholdDb ?? LOCAL_VOICE_SILENCE_THRESHOLD_DB;
  const turnEndSilenceMs = input.turnEndSilenceMs ?? LOCAL_VOICE_TURN_END_SILENCE_MS;
  const idlePauseMs = input.idlePauseMs ?? LOCAL_VOICE_IDLE_PAUSE_MS;
  const heardSpeech = Number.isFinite(input.decibels) && input.decibels >= thresholdDb;

  if (heardSpeech) {
    return {
      speechDetected: true,
      silenceMs: 0,
      idleMs: 0,
      shouldSubmit: false,
      shouldPause: false,
    };
  }

  const speechDetected = previous.speechDetected;
  const silenceMs = speechDetected ? previous.silenceMs + pollMs : 0;
  const idleMs = speechDetected ? 0 : previous.idleMs + pollMs;

  return {
    speechDetected,
    silenceMs,
    idleMs,
    shouldSubmit: speechDetected && silenceMs >= turnEndSilenceMs,
    shouldPause: !speechDetected && idleMs >= idlePauseMs,
  };
}
