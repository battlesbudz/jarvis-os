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
  assert.match(session, /longestContiguousMatch/);
  assert.doesNotMatch(session, /candidateWords\.count \{ it in playbackWords \}/);
  assert.doesNotMatch(session, /candidateWords\.size < 3/);
  assert.match(session, /snapshot\.state == TalkModeAudioState\.IDLE[\s\S]*?snapshot\.state == TalkModeAudioState\.PAUSED/);
  assert.match(session, /fun acquireCapture[\s\S]*?snapshot\.state == TalkModeAudioState\.PAUSED -> TalkModeAudioState\.PAUSED/);
  assert.match(session, /fun resumeCapture\(owner: String\)[\s\S]*?snapshot\.playbackOwner == null\) TalkModeAudioState\.LISTENING else TalkModeAudioState\.SPEAKING/);
  assert.match(session, /snapshot\.playbackOwner != null && snapshot\.playbackOwner != owner/);
  assert.match(session, /TalkModeAudioMode\.TURN_BASED/);
  assert.match(session, /state = if \(snapshot\.playbackOwner == null\) TalkModeAudioState\.LISTENING else TalkModeAudioState\.SPEAKING/);
  assert.match(session, /snapshot\.sessionId == 0L -> TalkModeAudioState\.IDLE/);
  assert.match(session, /modeBeforePlaybackOverride/);
  assert.match(session, /fun stopTalking[\s\S]*?TalkModeAudioState\.PAUSED -> TalkModeAudioState\.PAUSED[\s\S]*?TalkModeAudioState\.ENDED -> TalkModeAudioState\.ENDED/);
  assert.match(session, /fun recover[\s\S]*?TalkModeAudioState\.IDLE[\s\S]*?TalkModeAudioState\.PAUSED[\s\S]*?TalkModeAudioState\.ENDED[\s\S]*?return snapshot/);
  assert.match(session, /fun beginResponse[\s\S]*?TalkModeAudioState\.IDLE[\s\S]*?TalkModeAudioState\.PAUSED[\s\S]*?TalkModeAudioState\.ENDED/);
  assert.match(session, /fun recovered[\s\S]*?TalkModeAudioState\.IDLE[\s\S]*?TalkModeAudioState\.PAUSED[\s\S]*?TalkModeAudioState\.ENDED[\s\S]*?return snapshot/);
  assert.match(session, /fun recover[\s\S]*?snapshot\.state == TalkModeAudioState\.INTERRUPTED -> TalkModeAudioState\.INTERRUPTED/);
  assert.match(session, /fun recovered[\s\S]*?snapshot\.state == TalkModeAudioState\.INTERRUPTED -> TalkModeAudioState\.INTERRUPTED/);
  assert.match(session, /fun rejectInterruption[\s\S]*?TalkModeAudioState\.INTERRUPTED[\s\S]*?resumeAfterRejectedInterruption\(\)/);
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
  assert.match(playback, /ensureTts \{ engine -> if \(!tentativeInterruption\) speakRemaining\(engine\) \}/);
  assert.match(playback, /session\.playbackOwner != ownerId \|\| session\.state != TalkModeAudioState\.SPEAKING/);
  assert.match(playback, /consumeSuppression\(ownerId\)[\s\S]*?TalkModeAudioSession\.finishPlayback\(ownerId\)[\s\S]*?putString\("status", "stopped"\)/);
  assert.match(playback, /JarvisTalkModePlayback/);
  assert.match(playback, /completedOffset = acknowledgedOffset[\s\S]*?putInt\("acknowledgedOffset", completedOffset\)/);
  assert.match(playback, /status != "interrupted"[\s\S]*?playbackOwner == completedOwner[\s\S]*?stopTalking\(\)/);
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
assert.match(bridge, /currentSession\.state == TalkModeAudioState\.PAUSED[\s\S]*?E_NATIVE_STT_PAUSED[\s\S]*?return@runOnMain/);
assert.match(bridge, /onError\(error: Int\)[\s\S]*?wasInterruption[\s\S]*?TalkModeAudioSession\.rejectInterruption\(\)[\s\S]*?playbackBridge\.resumeAfterRejectedInterruption\(\)/);
assert.match(bridge, /fun cancelRecognizer[\s\S]*?TalkModeAudioState\.INTERRUPTED[\s\S]*?TalkModeAudioSession\.rejectInterruption\(\)[\s\S]*?playbackBridge\.resumeAfterRejectedInterruption\(\)/);

const wrapper = fs.readFileSync("lib/android-daemon-native.ts", "utf8");
assert.match(wrapper, /AndroidTalkModeAudioSessionStatus/);
assert.match(wrapper, /beginAndroidTalkModePlayback/);
assert.match(wrapper, /speakAndroidTalkModeText/);
assert.match(wrapper, /pauseAndroidTalkModeListening/);
assert.match(wrapper, /endAndroidTalkModeAudioSession/);
assert.match(wrapper, /recoverable: event\.recoverable === true/);
assert.match(wrapper, /errorCode: event\.errorCode/);
assert.match(wrapper, /JarvisTalkModePlayback/);

const screen = fs.readFileSync("app/(tabs)/insights.tsx", "utf8");
assert.match(screen, /event\.type === 'partial'[\s\S]*?setInput/);
assert.match(screen, /normalizedControl === 'stop talking'[\s\S]*?stopSpeakingRef\.current\(\)/);
assert.match(screen, /normalizedControl === 'stop listening'[\s\S]*?pauseAndroidTalkModeListening/);
assert.match(screen, /normalizedControl === 'stop listening'[\s\S]*?nativeVoiceStateSyncHeldRef\.current = true[\s\S]*?pauseAndroidTalkModeListening/);
assert.match(screen, /beginAndroidTalkModePlayback\(playbackRouteOwnerId, trimmedText\)/);
assert.match(screen, /if \(!talkModeRef\.current\)[\s\S]*?Speech\.speak\(trimmedText/);
assert.match(screen, /recognizeAndroidSpeechOnce\([\s\S]*?speakAndroidTalkModeText\(playbackRouteOwnerId, trimmedText,/);
assert.match(screen, /finishAndroidTalkModePlayback\(playbackRouteOwnerId\)/);
assert.match(screen, /playbackResult\.status === 'stopped'[\s\S]*?playbackResult\.status === 'ended'[\s\S]*?onError\(\)/);
assert.match(screen, /speakAndroidTalkModeText\(playbackRouteOwnerId, trimmedText,[\s\S]*?speakAbortRef\.current !== abortController\) return/);
assert.match(screen, /if \(ownsCurrentPlayback\)[\s\S]*?!options\.suppressAutoListen[\s\S]*?!insightsFocusedRef\.current[\s\S]*?handoffAndroidOutsideAppVoiceCapture\(\)/);
assert.match(screen, /resumeTalkModeCaptureAfterQueue[\s\S]*?!insightsFocusedRef\.current[\s\S]*?handoffAndroidOutsideAppVoiceCapture\(\)[\s\S]*?response\.queue\.settled\(\)\.then/);
assert.match(screen, /recoverableRecognitionFailures < 5[\s\S]*?setTimeout/);
assert.match(screen, /event\.type === 'speech_start' \|\| event\.type === 'partial'[\s\S]*?interruptionSpeechDetected = true[\s\S]*?status === 'interrupted' \|\| interruptionSpeechDetected[\s\S]*?await monitor/);
assert.match(screen, /event\.type === 'echo_rejected'[\s\S]*?clearInterruptionPreview\(\)/);
assert.match(screen, /const clearInterruptionPreview[\s\S]*?current === abandonedPreview[\s\S]*?if \(result\.text\.trim\(\)\)[\s\S]*?clearInterruptionPreview\(\)[\s\S]*?catch \(error\)[\s\S]*?clearInterruptionPreview\(\)/);
assert.match(screen, /const composerDraft = interruptionComposerDraft[\s\S]*?current === abandonedPreview \? composerDraft \?\? '' : current[\s\S]*?interruptionComposerDraft = inputRef\.current/);
assert.match(screen, /const clearInterruptionPreview[\s\S]*?interruptionSpeechDetected = false/);
assert.match(screen, /options\.nativeOnly[\s\S]*?new Promise<void>[\s\S]*?Fallback speech playback failed/);
assert.match(screen, /if \(!transcript\)[\s\S]*?providerInterruptionPending = false[\s\S]*?soundRef\.current\?\.play\(\)/);
assert.match(screen, /while \(!abortController\.signal\.aborted && providerPlaybackOwnerId === ownerId\)[\s\S]*?if \(!transcript\)[\s\S]*?soundRef\.current\?\.play\(\);[\s\S]*?continue;/);
assert.match(screen, /streaming interruption monitor fell back to turn-taking:[\s\S]*?recoverableRecognitionFailures < 5|recoverableRecognitionFailures < 5[\s\S]*?streaming interruption monitor fell back to turn-taking:/);
assert.match(screen, /const activeTurnSettled = activeChatTurnSettledRef\.current;[\s\S]*?const activeSpeech = streamingSpeechRef\.current;[\s\S]*?await activeTurnSettled;[\s\S]*?await activeSpeech\?\.queue\.settled\(\)[\s\S]*?handoffAndroidOutsideAppVoiceCapture\(\)/);
assert.match(screen, /const interruptedAssistantId = streamingSpeechRef\.current\?\.assistantId[\s\S]*?markAssistantSpeechStopped\(interruptedAssistantId\)[\s\S]*?stopSpeaking\(\)/);
assert.match(screen, /if \(!next\) \{[\s\S]*?stopSpeaking\(\)[\s\S]*?endAndroidTalkModeAudioSession/);
assert.match(screen, /while \(providerInterruptionPending && !abortController\.signal\.aborted\)/);
assert.match(screen, /onStart: options\.onFirstAudio/);
assert.match(screen, /session\.playbackOwner !== `react_tts:\$\{ownerId\}`[\s\S]*?rejected provider playback startup/);
assert.match(screen, /session\?\.state !== 'speaking'[\s\S]*?session\.playbackOwner !== `react_tts:/);
assert.match(screen, /allowTurnBasedFallback = !session \|\| session\.state === 'idle'[\s\S]*?playbackRejectedByCompetingOwner \|\| !allowTurnBasedFallback/);
assert.match(screen, /if \(!playbackLifecycleStarted\)[\s\S]*?releaseAndroidNativeVoicePlaybackRoute\(playbackRouteOwnerId\)/);
assert.match(screen, /if \(playbackLifecycleStarted\)[\s\S]*?onError\(\)[\s\S]*?!options\.suppressAutoListen[\s\S]*?insightsFocusedRef\.current[\s\S]*?scheduleTalkModeRecordingStart\(400\)[\s\S]*?if \(options\.nativeOnly\) throw error[\s\S]*?return;/);
assert.match(screen, /catch \(error\) \{\s+markAssistantSpeechStopped\(assistantId\);\s+cancelStreamingSpeech\(assistantId\)/);
assert.match(screen, /streaming speech queue failed:[\s\S]*?markAssistantSpeechStopped\(response\.assistantId\)[\s\S]*?streamingSpeechRef\.current = null/);
assert.match(screen, /Platform\.OS === 'android' \? 'android_native_fallback' : 'streaming_provider_retry'/);
assert.match(screen, /providerCompletedPcmBytes \+ Math\.floor\(providerActiveSegmentPcmBytes \* activeSegmentRatio\)/);
assert.match(screen, /providerContinuousCapture = continuousCapture[\s\S]*?setAudioModeAsync\(\{ allowsRecording: providerContinuousCapture, playsInSilentMode: true \}\)/);
assert.match(screen, /providerInterruptedAtPcmByte = getProviderPlayedPcmBytes\(\)[\s\S]*?getProviderAcknowledgedOffset[\s\S]*?providerAcknowledgedPrefix = trimmedText\.slice\(0, providerAcknowledgedOffset\)[\s\S]*?activeSpeech\.heardText/);
assert.match(screen, /parsed\.type === 'error'[\s\S]*?markAssistantSpeechStopped\(assistantId\)[\s\S]*?cancelStreamingSpeech\(assistantId\)/);
assert.match(screen, /return \(\) => \{[\s\S]*?streamingSpeechRef\.current\?\.queue\.suppress\(\)[\s\S]*?isSpeakingRef\.current = false[\s\S]*?speakAbortRef\.current\?\.abort\(\)/);
assert.match(screen, /Fallback also failed:[\s\S]*?onError\(\)[\s\S]*?if \(options\.nativeOnly\)[\s\S]*?throw fallbackErr/);
assert.match(screen, /if \(options\.providerOnly\) \{[\s\S]*?stopSpeaking\(options\.preserveResponseQueue\)[\s\S]*?onError\(\)[\s\S]*?throw error/);
assert.match(screen, /const clearProviderInterruptionPreview[\s\S]*?composerDraft \?\? ''[\s\S]*?interruptionComposerDraft = inputRef\.current/);
assert.match(screen, /let interruptionAccepted = false[\s\S]*?if \(!transcript\)[\s\S]*?interruptionAccepted = true[\s\S]*?finally \{[\s\S]*?if \(!interruptionAccepted\) clearProviderInterruptionPreview\(\)/);
assert.match(screen, /interruptionPreview = event\.text/);
assert.match(screen, /playbackResult\.acknowledgedOffset[\s\S]*?trimmedText\.slice\(0, acknowledgedOffset\)[\s\S]*?activeSpeech\.heardText/);
assert.match(screen, /ownsCurrentPlayback[\s\S]*?cancelAndroidNativeSpeechRecognition[\s\S]*?if \(ownsCurrentPlayback\)[\s\S]*?setAudioModeAsync/);
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
