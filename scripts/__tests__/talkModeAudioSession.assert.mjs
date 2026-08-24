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
  assert.match(session, /longestOrderedMatch/);
  assert.doesNotMatch(session, /candidateWords\.count \{ it in playbackWords \}/);
  assert.doesNotMatch(session, /candidateWords\.size < 3/);
  assert.match(session, /snapshot\.state == TalkModeAudioState\.IDLE[\s\S]*?snapshot\.state == TalkModeAudioState\.PAUSED/);
  assert.match(session, /snapshot\.playbackOwner != null && snapshot\.playbackOwner != owner/);
  assert.match(session, /TalkModeAudioMode\.TURN_BASED/);
  assert.match(session, /state = if \(snapshot\.playbackOwner == null\) TalkModeAudioState\.LISTENING else TalkModeAudioState\.SPEAKING/);
  assert.match(session, /snapshot\.captureOwner == null -> TalkModeAudioState\.IDLE/);
  assert.match(session, /modeBeforePlaybackOverride/);
  assert.match(session, /fun stopTalking[\s\S]*?TalkModeAudioState\.PAUSED -> TalkModeAudioState\.PAUSED[\s\S]*?TalkModeAudioState\.ENDED -> TalkModeAudioState\.ENDED/);
  assert.match(session, /fun recover[\s\S]*?TalkModeAudioState\.IDLE \|\| snapshot\.state == TalkModeAudioState\.ENDED\) return snapshot/);
  assert.match(session, /fun beginResponse[\s\S]*?TalkModeAudioState\.IDLE[\s\S]*?TalkModeAudioState\.PAUSED[\s\S]*?TalkModeAudioState\.ENDED/);
  assert.match(session, /fun recovered[\s\S]*?TalkModeAudioState\.IDLE[\s\S]*?TalkModeAudioState\.PAUSED[\s\S]*?TalkModeAudioState\.ENDED[\s\S]*?return snapshot/);
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
  assert.match(playback, /session\.playbackOwner != ownerId \|\| session\.state != TalkModeAudioState\.SPEAKING/);
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
assert.match(bridge, /snapshot\(\)\.state == TalkModeAudioState\.INTERRUPTED[\s\S]*?resumeAfterRejectedInterruption\(\)/);
assert.match(bridge, /val participatesInTalkMode[\s\S]*?if \(participatesInTalkMode\)[\s\S]*?TalkModeAudioSession\.acquireCapture/);

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
assert.match(screen, /speakAndroidTalkModeText\(playbackRouteOwnerId, trimmedText\)[\s\S]*?speakAbortRef\.current !== abortController\) return/);
assert.match(screen, /ownsCurrentPlayback[\s\S]*?cancelAndroidNativeSpeechRecognition[\s\S]*?if \(ownsCurrentPlayback\)[\s\S]*?setAudioModeAsync/);
assert.match(screen, /recoverableRecognitionFailures < 5[\s\S]*?setTimeout/);
assert.match(screen, /event\.type === 'echo_rejected'[\s\S]*?current === interruptionPreview/);
assert.match(screen, /session\?\.state !== 'speaking'[\s\S]*?session\.playbackOwner !== `react_tts:/);
assert.match(screen, /playbackRejectedByCompetingOwner[\s\S]*?if \(playbackRejectedByCompetingOwner\)[\s\S]*?onError\(\)/);
assert.match(screen, /if \(!playbackLifecycleStarted\)[\s\S]*?releaseAndroidNativeVoicePlaybackRoute\(playbackRouteOwnerId\)/);
assert.match(screen, /interruptionPreview = event\.text/);
assert.match(screen, /current === interruptionPreview \? '' : current/);
assert.match(screen, /normalizedControl === 'stop talking'[\s\S]*?scheduleTalkModeRecordingStartRef\.current\(400\)/);
assert.match(screen, /recoverable[\s\S]*?continue;/);
assert.match(screen, /nativeSpeechActiveRef\.current = true;[\s\S]*?recognizeAndroidSpeechOnce\([\s\S]*?\.finally\(\(\) => \{[\s\S]*?nativeSpeechActiveRef\.current = false;/);
assert.match(screen, /speakAbortRef\.current\?\.abort\(\)[\s\S]*?cancelAndroidNativeSpeechRecognition\(\)[\s\S]*?stopAndroidTalkModeSpeech\(\)/);

const opHandler = fs.readFileSync(`${roots[0]}/OpHandler.kt`, "utf8");
assert.match(opHandler, /beginTurnBasedPlayback\("daemon_audio"/);
assert.match(opHandler, /currentPlayer \?: run[\s\S]*?playbackOwner == "daemon_audio"[\s\S]*?TalkModeAudioSession\.stopTalking\(\)/);
assert.match(opHandler, /@Synchronized\s+fun startPlayback[\s\S]*?beginTurnBasedPlayback\("daemon_audio"[\s\S]*?session\.playbackOwner != "daemon_audio"[\s\S]*?player\.start\(\)/);
assert.match(opHandler, /existingOwner != null && existingOwner != "daemon_audio"/);

console.log("Talk Mode Android audio-session contract passed.");
