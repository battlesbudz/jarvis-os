import assert from "node:assert/strict";
import fs from "node:fs";

const routeManager = fs.readFileSync(
  "android/app/src/main/java/com/gameplan/daemon/WearableAudioRouteManager.kt",
  "utf8",
);
const nativeSpeech = fs.readFileSync(
  "android/app/src/main/java/com/gameplan/daemon/NativeSpeechRecognitionBridge.kt",
  "utf8",
);
const talkMode = fs.readFileSync(
  "android/app/src/main/java/com/gameplan/daemon/WakeWordService.kt",
  "utf8",
);
const playback = fs.readFileSync(
  "android/app/src/main/java/com/gameplan/daemon/OpHandler.kt",
  "utf8",
);
const outsideVoice = fs.readFileSync(
  "android/app/src/main/java/com/gameplan/daemon/OutsideAppVoiceSessionService.kt",
  "utf8",
);
const daemonModule = fs.readFileSync(
  "android/app/src/main/java/com/gameplan/daemon/JarvisDaemonModule.kt",
  "utf8",
);
const insights = fs.readFileSync("app/(tabs)/insights.tsx", "utf8");
const pluginSourceRoot = "plugins/android-daemon-native/src/main/java/com/gameplan/daemon";
const pluginRouteManager = fs.readFileSync(`${pluginSourceRoot}/WearableAudioRouteManager.kt`, "utf8");
const pluginNativeSpeech = fs.readFileSync(`${pluginSourceRoot}/NativeSpeechRecognitionBridge.kt`, "utf8");
const pluginTalkMode = fs.readFileSync(`${pluginSourceRoot}/WakeWordService.kt`, "utf8");
const pluginPlayback = fs.readFileSync(`${pluginSourceRoot}/OpHandler.kt`, "utf8");
const pluginOutsideVoice = fs.readFileSync(`${pluginSourceRoot}/OutsideAppVoiceSessionService.kt`, "utf8");
const pluginDaemonModule = fs.readFileSync(`${pluginSourceRoot}/JarvisDaemonModule.kt`, "utf8");

assert.match(routeManager, /availableCommunicationDevices/);
assert.match(routeManager, /setCommunicationDevice\(device\)/);
assert.match(routeManager, /clearCommunicationDevice\(\)/);
assert.match(routeManager, /TYPE_BLE_HEADSET/);
assert.match(routeManager, /TYPE_BLUETOOTH_SCO/);
assert.match(routeManager, /TYPE_HEARING_AID/);
assert.match(
  routeManager,
  /val ownsActiveRoute = owners\.isNotEmpty\(\) && routeState == "active"/,
);
assert.match(
  routeManager,
  /allowHearingAid = Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S/,
);
assert.match(routeManager, /ACTION_SCO_AUDIO_STATE_UPDATED/);
assert.match(routeManager, /SCO_AUDIO_STATE_CONNECTED/);
assert.match(routeManager, /waitForLegacyScoConfirmation\(requestGeneration\)/);
assert.match(
  routeManager,
  /routeState == "active" &&\s+requestedDeviceId == device\.id/,
);
assert.match(
  routeManager,
  /routeState != "requesting" && routeState != "active"/,
);
assert.match(routeManager, /handleLegacyScoTerminalState\(error: String, teardownSettled: Boolean\)/);
assert.match(routeManager, /waitForLegacyScoTeardown\(teardownSettled\)/);
assert.match(routeManager, /legacyScoTeardownPending/);
assert.match(routeManager, /legacyScoTeardownWaitElapsed/);
assert.match(routeManager, /legacyScoTeardownGeneration/);
assert.match(routeManager, /routeRecoveryRunnable: Runnable\?/);
assert.match(routeManager, /mainHandler\.removeCallbacks\(it\)/);
assert.match(routeManager, /private fun cancelScheduledRouteRecovery\(\)/);
assert.match(routeManager, /ROUTE_RETRY_MAX_DELAY_MS/);
assert.match(routeManager, /routeRetryAttempt\.coerceAtMost\(6\)/);
assert.match(routeManager, /legacy SCO teardown confirmation timed out/);
assert.match(routeManager, /LEGACY_SCO_STALE_DISCONNECT_GRACE_MS/);
assert.match(routeManager, /preserveLegacyScoTeardownGuardAfterConnection\(\)/);
assert.match(routeManager, /replacementStillRouted[\s\S]*audioManager\?\.isBluetoothScoOn == true/);
assert.match(routeManager, /ignored stale legacy SCO teardown after replacement connected/);
assert.match(routeManager, /legacy SCO stale teardown guard expired after replacement connected/);
assert.match(
  routeManager,
  /if \(waitForLegacyTeardown\) beginLegacyScoTeardownWait\(\)/,
);
assert.doesNotMatch(
  routeManager,
  /private fun clearRoute\(\)[\s\S]*?legacyScoTeardownPending = false[\s\S]*?private fun refreshAfterDeviceChange/,
);
assert.match(routeManager, /OnCommunicationDeviceChangedListener/);
assert.match(routeManager, /addOnCommunicationDeviceChangedListener/);
assert.match(routeManager, /handleCommunicationDeviceChanged\(device: AudioDeviceInfo\?\)/);
assert.match(routeManager, /communicationDeviceOwnedByJarvis = true/);
assert.match(
  routeManager,
  /if \(communicationDeviceOwnedByJarvis\) manager\.clearCommunicationDevice\(\)/,
);
assert.match(routeManager, /@TargetApi\(Build\.VERSION_CODES\.S\)/);
assert.match(routeManager, /private object Api31CommunicationDeviceMonitor/);
assert.ok(
  routeManager.indexOf("OnCommunicationDeviceChangedListener") >
    routeManager.indexOf("private object Api31CommunicationDeviceMonitor"),
  "API 31 listener types must remain isolated in the API-gated implementation",
);
assert.match(routeManager, /DaemonLog\.add\([\s\S]*communication route lost/);
assert.match(routeManager, /legacy SCO route lost/);
assert.match(routeManager, /route recovery \$outcome/);
assert.match(routeManager, /route recovery cancelled/);
assert.match(
  routeManager,
  /if \(manager\.mode == AudioManager\.MODE_IN_COMMUNICATION\) \{\s+manager\.mode = previousMode/,
);
assert.match(routeManager, /ROUTE_RETRY_DELAY_MS/);
assert.match(
  routeManager,
  /if \(!accepted\) \{[\s\S]*routeRecoveryPending = true[\s\S]*scheduleRouteRecovery\(expectLegacy = false\)/,
);
assert.match(
  routeManager,
  /communication route confirmation timed out[\s\S]*scheduleRouteRecovery\(expectLegacy = false\)/,
);
assert.match(
  routeManager,
  /legacy SCO startup failed[\s\S]*scheduleRouteRecovery\(expectLegacy = true\)/,
);
assert.doesNotMatch(
  routeManager,
  /startBluetoothSco\(\)[\s\S]{0,160}routeState = "active"/,
);
assert.doesNotMatch(routeManager, /BluetoothLeScanner|startScan\(/);

assert.match(nativeSpeech, /WearableAudioRouteManager\.acquire\(reactContext, WEARABLE_AUDIO_OWNER\)/);
assert.match(nativeSpeech, /OutsideAppVoiceSessionService\.prepareForInAppCapture\(\)/);
assert.match(nativeSpeech, /fun cancelForOutsideAppHandoff\(\)/);
assert.match(nativeSpeech, /WearableAudioRouteManager\.release\(WEARABLE_AUDIO_OWNER\)/);
assert.match(nativeSpeech, /pendingStartPromise: Promise\?/);
assert.match(nativeSpeech, /E_NATIVE_STT_CANCELLED/);
assert.match(nativeSpeech, /rejectPendingStart\(/);
assert.match(talkMode, /WearableAudioRouteManager\.acquire\(this, WEARABLE_AUDIO_OWNER\)/);
assert.match(talkMode, /WearableAudioRouteManager\.release\(WEARABLE_AUDIO_OWNER\)/);
assert.match(
  talkMode,
  /SpeechRecognizer not available[\s\S]{0,160}WearableAudioRouteManager\.release\(WEARABLE_AUDIO_OWNER\)/,
);
assert.match(
  talkMode,
  /RECORD_AUDIO permission not granted[\s\S]{0,320}WearableAudioRouteManager\.release\(WEARABLE_AUDIO_OWNER\)/,
);
assert.match(
  talkMode,
  /private fun handlePauseForUserControl\(\)[\s\S]*?WearableAudioRouteManager\.release\(WEARABLE_AUDIO_OWNER\)[\s\S]*?private fun handlePauseForResponse/,
);
assert.match(playback, /USAGE_VOICE_COMMUNICATION/);
assert.match(playback, /CONTENT_TYPE_SPEECH/);
assert.match(talkMode, /fun pauseForInAppCapture\(\)/);
assert.match(talkMode, /microphone ownership returned to the in-app recognizer/);
assert.match(outsideVoice, /ACTION_TAKE_CAPTURE/);
assert.match(outsideVoice, /ownsVoiceCapture/);
assert.match(outsideVoice, /fun prepareForInAppCapture\(\)/);
assert.match(daemonModule, /fun handoffOutsideAppVoiceCapture\(promise: Promise\)/);
assert.match(
  insights,
  /Cleanup on blur[\s\S]*stopRecordingSilentlyRef\.current\(\)\.finally\([\s\S]*handoffAndroidOutsideAppVoiceCapture\(\)/,
);

assert.equal(pluginRouteManager, routeManager, "Expo prebuild route manager must match the app source");
assert.equal(pluginNativeSpeech, nativeSpeech, "Expo prebuild speech bridge must match the app source");
assert.equal(pluginTalkMode, talkMode, "Expo prebuild talk-mode service must match the app source");
assert.equal(pluginPlayback, playback, "Expo prebuild playback handler must match the app source");
assert.equal(pluginOutsideVoice, outsideVoice, "Expo prebuild outside-app voice service must match the app source");
assert.equal(pluginDaemonModule, daemonModule, "Expo prebuild daemon module must match the app source");

console.log("OK: Android wearable audio route is session-scoped, observable, and scan-free");
