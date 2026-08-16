export const LOCAL_VOICE_SILENCE_THRESHOLD_DB = -40;
export const LOCAL_VOICE_TURN_END_SILENCE_MS = 5_000;
export const LOCAL_VOICE_IDLE_PAUSE_MS = 60_000;
export const LOCAL_VOICE_SILENCE_POLL_MS = 250;
export const LOCAL_VOICE_COMPLETE_CONTINUATION_MS = 1_500;
export const LOCAL_VOICE_INCOMPLETE_CONTINUATION_MS = 2_500;
export const LOCAL_VOICE_MAX_TRANSCRIPT_SEGMENTS = 8;

const INCOMPLETE_TRANSCRIPT_ENDINGS = [
  /\b(?:and|and also|also|but|because|so|or|then|plus)$/i,
  /\b(?:not just|as well as|on top of that)$/i,
  /\b(?:want|wanted|trying|going|need|needed|supposed|able)\s+to$/i,
  /[,;:\-\u2014]$/,
];

export interface LocalVoiceContinuationState {
  transcript: string;
  segmentCount: number;
  likelyIncomplete: boolean;
  continuationWindowMs: number;
  shouldListenForContinuation: boolean;
}

export function isLikelyIncompleteVoiceTranscript(transcript: string): boolean {
  const normalized = transcript.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return INCOMPLETE_TRANSCRIPT_ENDINGS.some(pattern => pattern.test(normalized));
}

export function appendLocalVoiceTranscriptSegment(
  transcript: string,
  nextSegment: string,
): string {
  const previous = transcript.trim();
  const next = nextSegment.trim();
  if (!previous) return next;
  if (!next) return previous;

  const previousWords = previous.split(/\s+/);
  const nextWords = next.split(/\s+/);
  const comparable = (word: string) =>
    word.toLocaleLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, "");
  const maxOverlap = Math.min(8, previousWords.length, nextWords.length);
  let overlap = 0;

  for (let size = maxOverlap; size > 0; size -= 1) {
    const previousTail = previousWords.slice(-size).map(comparable);
    const nextHead = nextWords.slice(0, size).map(comparable);
    if (previousTail.every((word, index) => word && word === nextHead[index])) {
      overlap = size;
      break;
    }
  }

  const suffix = nextWords.slice(overlap).join(" ");
  return suffix ? `${previous} ${suffix}` : previous;
}

export function createLocalVoiceContinuationState(): LocalVoiceContinuationState {
  return {
    transcript: "",
    segmentCount: 0,
    likelyIncomplete: false,
    continuationWindowMs: LOCAL_VOICE_COMPLETE_CONTINUATION_MS,
    shouldListenForContinuation: false,
  };
}

export function addLocalVoiceTranscriptSegment(
  previous: LocalVoiceContinuationState,
  segment: string,
  options: { manualFinish?: boolean; maxSegments?: number } = {},
): LocalVoiceContinuationState {
  const transcript = appendLocalVoiceTranscriptSegment(previous.transcript, segment);
  const segmentCount = previous.segmentCount + (segment.trim() ? 1 : 0);
  const likelyIncomplete = isLikelyIncompleteVoiceTranscript(transcript);
  const maxSegments = options.maxSegments ?? LOCAL_VOICE_MAX_TRANSCRIPT_SEGMENTS;

  return {
    transcript,
    segmentCount,
    likelyIncomplete,
    continuationWindowMs: likelyIncomplete
      ? LOCAL_VOICE_INCOMPLETE_CONTINUATION_MS
      : LOCAL_VOICE_COMPLETE_CONTINUATION_MS,
    shouldListenForContinuation:
      !options.manualFinish && transcript.length > 0 && segmentCount < maxSegments,
  };
}

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
