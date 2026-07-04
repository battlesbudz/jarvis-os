import assert from "node:assert/strict";
import {
  LOCAL_VOICE_IDLE_PAUSE_MS,
  LOCAL_VOICE_SILENCE_POLL_MS,
  LOCAL_VOICE_TURN_END_SILENCE_MS,
  createLocalVoiceSilenceState,
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

testNoSpeechPausesAfterSixtySeconds();
testSpeechThenFiveSecondsSilenceSubmits();
testMoreSpeechResetsTurnSilence();
