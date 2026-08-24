import assert from "node:assert/strict";
import fs from "node:fs";

const roots = [
  "android/app/src/main/java/com/gameplan/daemon",
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon",
];

for (const root of roots) {
  const session = fs.readFileSync(`${root}/TalkModeAudioSession.kt`, "utf8");
  for (const state of [
    "IDLE", "LISTENING", "USER_SPEAKING", "RESPONDING", "SPEAKING",
    "INTERRUPTED", "PAUSED", "RECOVERING", "ENDED",
  ]) {
    assert.match(session, new RegExp(`\\b${state}\\b`), `${root} must include ${state}`);
  }
  assert.match(session, /partialTranscript/);
  assert.match(session, /committedTranscript/);
  assert.match(session, /isProbablePlaybackEcho/);
  assert.doesNotMatch(session, /candidateWords\.size < 3/);
  assert.match(session, /snapshot\.state == TalkModeAudioState\.IDLE[\s\S]*?snapshot\.state == TalkModeAudioState\.PAUSED/);
  assert.match(session, /TalkModeAudioMode\.TURN_BASED/);
  assert.match(session, /state = if \(snapshot\.playbackOwner == null\) TalkModeAudioState\.LISTENING else TalkModeAudioState\.SPEAKING/);
  assert.match(session, /snapshot\.captureOwner == null -> TalkModeAudioState\.IDLE/);
  assert.match(session, /modeBeforePlaybackOverride/);
  assert.match(session, /AcousticEchoCanceler\.isAvailable/);
  assert.match(session, /NoiseSuppressor\.isAvailable/);
  assert.match(session, /AutomaticGainControl\.isAvailable/);
  const playback = fs.readFileSync(`${root}/NativeTalkModePlaybackBridge.kt`, "utf8");
  assert.match(playback, /UtteranceProgressListener/);
  assert.match(playback, /onRangeStart/);
  assert.match(playback, /stopForInterruption/);
  assert.match(playback, /resumeAfterRejectedInterruption/);
  assert.match(playback, /tts = null[\s\S]*?engine\?\.shutdown\(\)/);
  assert.match(playback, /if \(initializing\) return[\s\S]*?tts\?\.let/);
}

assert.equal(
  fs.readFileSync(`${roots[0]}/TalkModeAudioSession.kt`, "utf8"),
  fs.readFileSync(`${roots[1]}/TalkModeAudioSession.kt`, "utf8"),
  "generated and plugin Talk Mode session sources must match",
);
assert.equal(
  fs.readFileSync(`${roots[0]}/NativeTalkModePlaybackBridge.kt`, "utf8"),
  fs.readFileSync(`${roots[1]}/NativeTalkModePlaybackBridge.kt`, "utf8"),
  "generated and plugin Talk Mode playback sources must match",
);

const bridge = fs.readFileSync(roots[0] + "/NativeSpeechRecognitionBridge.kt", "utf8");
assert.match(bridge, /internal class NativeSpeechRecognitionBridge/);
assert.match(bridge, /TalkModeAudioSession\.updatePartial/);
assert.match(bridge, /putBoolean\("committed", false\)/);
assert.match(bridge, /TalkModeAudioSession\.commitTranscript/);
assert.match(bridge, /resultConfidenceScores/);

const wrapper = fs.readFileSync("lib/android-daemon-native.ts", "utf8");
assert.match(wrapper, /AndroidTalkModeAudioSessionStatus/);
assert.match(wrapper, /beginAndroidTalkModePlayback/);
assert.match(wrapper, /speakAndroidTalkModeText/);
assert.match(wrapper, /pauseAndroidTalkModeListening/);
assert.match(wrapper, /endAndroidTalkModeAudioSession/);
assert.match(wrapper, /recoverable: event\.recoverable === true/);

const screen = fs.readFileSync("app/(tabs)/insights.tsx", "utf8");
assert.match(screen, /event\.type === 'partial'[\s\S]*?setInput/);
assert.match(screen, /normalizedControl === 'stop talking'[\s\S]*?stopAndroidTalkModeSpeech/);
assert.match(screen, /normalizedControl === 'stop listening'[\s\S]*?pauseAndroidTalkModeListening/);
assert.match(screen, /beginAndroidTalkModePlayback\(playbackRouteOwnerId, trimmedText\)/);
assert.match(screen, /if \(!talkModeRef\.current\)[\s\S]*?Speech\.speak\(trimmedText/);
assert.match(screen, /recognizeAndroidSpeechOnce\([\s\S]*?speakAndroidTalkModeText\(playbackRouteOwnerId, trimmedText\)/);
assert.match(screen, /finishAndroidTalkModePlayback\(playbackRouteOwnerId\)/);
assert.match(screen, /playbackResult\.status === 'stopped'[\s\S]*?playbackResult\.status === 'ended'[\s\S]*?onError\(\)/);
assert.match(screen, /normalizedControl === 'stop talking'[\s\S]*?scheduleTalkModeRecordingStartRef\.current\(400\)/);
assert.match(screen, /recoverable[\s\S]*?continue;/);
assert.match(screen, /speakAbortRef\.current\?\.abort\(\)[\s\S]*?cancelAndroidNativeSpeechRecognition\(\)[\s\S]*?stopAndroidTalkModeSpeech\(\)/);

const opHandler = fs.readFileSync(`${roots[0]}/OpHandler.kt`, "utf8");
assert.match(opHandler, /beginTurnBasedPlayback\("daemon_audio"/);

console.log("Talk Mode Android audio-session contract passed.");
