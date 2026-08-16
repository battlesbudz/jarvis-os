import assert from "node:assert/strict";
import {
  LOCAL_VOICE_COMPLETE_CONTINUATION_MS,
  LOCAL_VOICE_IDLE_PAUSE_MS,
  LOCAL_VOICE_INCOMPLETE_CONTINUATION_MS,
  LOCAL_VOICE_SILENCE_POLL_MS,
  LOCAL_VOICE_TURN_END_SILENCE_MS,
  addLocalVoiceTranscriptSegment,
  appendLocalVoiceTranscriptSegment,
  createLocalVoiceContinuationState,
  createLocalVoiceSilenceState,
  isLikelyIncompleteVoiceTranscript,
  updateLocalVoiceSilenceState,
} from "@shared/localVoiceLoop";

function advanceSilence(ms: number, start = createLocalVoiceSilenceState()) {
  let state = start;
  for (let elapsed = 0; elapsed < ms; elapsed += LOCAL_VOICE_SILENCE_POLL_MS) {
    state = updateLocalVoiceSilenceState(state, { decibels: -80 });
  }
  return state;
}

function testNoSpeechPausesAfterSixtySeconds() {
  const almost = advanceSilence(LOCAL_VOICE_IDLE_PAUSE_MS - LOCAL_VOICE_SILENCE_POLL_MS);
  assert.equal(almost.shouldPause, false);
  assert.equal(almost.shouldSubmit, false);

  const paused = updateLocalVoiceSilenceState(almost, { decibels: -80 });
  assert.equal(paused.shouldPause, true);
  assert.equal(paused.shouldSubmit, false);
  console.log("OK: local voice loop pauses after sixty seconds without speech");
}

function testSpeechThenFiveSecondsSilenceSubmits() {
  let state = createLocalVoiceSilenceState();
  state = updateLocalVoiceSilenceState(state, { decibels: -25 });
  assert.equal(state.speechDetected, true);
  assert.equal(state.shouldSubmit, false);

  const almost = advanceSilence(LOCAL_VOICE_TURN_END_SILENCE_MS - LOCAL_VOICE_SILENCE_POLL_MS, state);
  assert.equal(almost.shouldSubmit, false);
  assert.equal(almost.shouldPause, false);

  const submitted = updateLocalVoiceSilenceState(almost, { decibels: -80 });
  assert.equal(submitted.shouldSubmit, true);
  assert.equal(submitted.shouldPause, false);
  console.log("OK: local voice loop submits after speech plus five seconds of silence");
}

function testMoreSpeechResetsTurnSilence() {
  let state = createLocalVoiceSilenceState();
  state = updateLocalVoiceSilenceState(state, { decibels: -25 });
  state = advanceSilence(LOCAL_VOICE_TURN_END_SILENCE_MS - LOCAL_VOICE_SILENCE_POLL_MS, state);
  state = updateLocalVoiceSilenceState(state, { decibels: -20 });
  assert.equal(state.shouldSubmit, false);
  assert.equal(state.silenceMs, 0);

  const submitted = advanceSilence(LOCAL_VOICE_TURN_END_SILENCE_MS, state);
  assert.equal(submitted.shouldSubmit, true);
  console.log("OK: local voice loop resets silence when the user keeps talking");
}

function testAndroidFinalTranscriptGetsContinuationWindow() {
  const complete = addLocalVoiceTranscriptSegment(
    createLocalVoiceContinuationState(),
    "What do you think about the upgrade",
  );
  assert.equal(complete.likelyIncomplete, false);
  assert.equal(complete.continuationWindowMs, LOCAL_VOICE_COMPLETE_CONTINUATION_MS);
  assert.equal(complete.shouldListenForContinuation, true);

  const incomplete = addLocalVoiceTranscriptSegment(
    createLocalVoiceContinuationState(),
    "How do I make it listen more accurately and also",
  );
  assert.equal(incomplete.likelyIncomplete, true);
  assert.equal(incomplete.continuationWindowMs, LOCAL_VOICE_INCOMPLETE_CONTINUATION_MS);
  assert.equal(incomplete.shouldListenForContinuation, true);
  console.log("OK: Android final transcripts wait for continuation before submission");
}

function testIncompleteThoughtExamplesStayOpen() {
  assert.equal(isLikelyIncompleteVoiceTranscript("I wanted everything deterministic and not just"), true);
  assert.equal(isLikelyIncompleteVoiceTranscript("I need Jarvis to"), true);
  assert.equal(isLikelyIncompleteVoiceTranscript("What do you think I should do about that"), false);
  console.log("OK: incomplete voice thoughts receive the longer continuation window");
}

function testContinuationSegmentsAreStitchedWithoutDuplicateWords() {
  assert.equal(
    appendLocalVoiceTranscriptSegment(
      "How do I make it listen more accurately and also",
      "and also make the voice sound natural",
    ),
    "How do I make it listen more accurately and also make the voice sound natural",
  );

  const manuallyFinished = addLocalVoiceTranscriptSegment(
    createLocalVoiceContinuationState(),
    "Send this now",
    { manualFinish: true },
  );
  assert.equal(manuallyFinished.shouldListenForContinuation, false);
  console.log("OK: continuation stitching deduplicates overlap and respects manual finish");
}

function testContinuationSegmentsHaveAHardLimit() {
  let state = createLocalVoiceContinuationState();
  for (let index = 0; index < 8; index += 1) {
    state = addLocalVoiceTranscriptSegment(state, `segment ${index}`);
  }
  assert.equal(state.segmentCount, 8);
  assert.equal(state.shouldListenForContinuation, false);
  console.log("OK: Android continuation capture cannot loop indefinitely");
}

testNoSpeechPausesAfterSixtySeconds();
testSpeechThenFiveSecondsSilenceSubmits();
testMoreSpeechResetsTurnSilence();
testAndroidFinalTranscriptGetsContinuationWindow();
testIncompleteThoughtExamplesStayOpen();
testContinuationSegmentsAreStitchedWithoutDuplicateWords();
testContinuationSegmentsHaveAHardLimit();
