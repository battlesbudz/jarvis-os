import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const protocol = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/EyevueProtocol.kt");
const service = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/EyevueGlassesService.kt");
const boot = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/BootReceiver.kt");
const inference = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/LocalGemmaInferenceEngine.kt");
const wake = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/WakeWordService.kt");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const tool = read("server/agent/tools/daemon.ts");
const settings = read("components/androidDaemon/AndroidDeviceControlCard.tsx");
const bridge = read("server/daemon/bridge.ts");
const routes = read("server/routes.ts");
const nativeModule = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/JarvisDaemonModule.kt");
const approvalRisk = read("server/agent/approvalToolRisk.ts");
const coachConfirmation = read("server/routes/coachActionConfirmationRoutes.ts");
const approvalReceipt = read("server/agent/approvalReceipt.ts");
const agentApproval = read("server/agent/agentApproval.ts");

assert.match(protocol, /0000aa12-0000-1000-8000-00805f9b34fb/);
assert.match(protocol, /fun stopVendorVoice\(\)/);
assert.match(service, /"hey star"/i);
assert.match(service, /Jarvis is offline\./);
assert.match(service, /pendingPhoto.*30, TimeUnit\.SECONDS/s);
assert.match(service, /percent <= 20/);
assert.match(service, /percent <= 10/);
assert.match(service, /temporary copy retained for active visual turn/);
assert.match(service, /requestedCapture == null[\s\S]*eyevue_photo_captured/);
assert.match(service, /val takeNew = op\.optBoolean\("lookAgain", false\)/);
assert.doesNotMatch(service, /lookAgain[\s\S]{0,100}\|\|[\s\S]{0,100}lastPhotoPath/);
assert.match(service, /status != BluetoothGatt\.GATT_SUCCESS[\s\S]*failGattSetup/);
assert.match(service, /fun start\([\s\S]*hasBluetoothPermission\(context\)[\s\S]*return false/);
assert.match(service, /ACCESS_FINE_LOCATION/);
assert.match(service, /scheduleTemporaryPhotoExpiry\(file\.absolutePath, origin\)/);
assert.match(service, /TEMPORARY_PHOTO_TTL_MS/);
assert.match(service, /fun start\([\s\S]*purgeTemporaryPhotos\(context, "pre_service_start"\)[\s\S]*hasBluetoothPermission\(context\)/);
assert.match(service, /onCreate\(\)[\s\S]*purgeTemporaryPhotos\(this, "service_start"\)/);
assert.match(boot, /purgeTemporaryPhotos\(context, "boot"\)[\s\S]*EyevueGlassesService\.start\(context\)/);
assert.match(service, /!file\.exists\(\) \|\| file\.delete\(\)[\s\S]*if \(!deleted\)[\s\S]*return false/);
assert.match(wake, /ACTION_EXTERNAL_WAKE/);
assert.match(wake, /ACTION_EXTERNAL_WAKE[\s\S]*enteringTalkMode[\s\S]*destroyRecognizer\(\)[\s\S]*startListening\(\)/);
assert.match(inference, /Content\.ImageFile/);
assert.match(inference, /15_000L/);
assert.match(inference, /30_000L/);
assert.match(inference, /visionDeadlineAtElapsedMs[\s\S]*remainingMs[\s\S]*future\.get\(remainingMs, TimeUnit\.MILLISECONDS\)/);
assert.match(inference, /quarantineTimedOutNativeAttempt/);
assert.match(inference, /catch \(_: TimeoutException\)[\s\S]*quarantineTimedOutNativeAttempt[\s\S]*active\.job\.cancel\(\)/);
assert.match(inference, /acquireEngineForRequest[\s\S]*engineOwnershipLock[\s\S]*claimEngineForQuarantineLocked/);
assert.match(inference, /cachedEngine = engineState\?\.engine[\s\S]*engineState = null[\s\S]*claimEngineForQuarantineLocked/);
assert.match(inference, /return engineLock\.withLock \{[\s\S]*val lockedCurrent = engineState[\s\S]*onEngineCreated\(lockedCurrent\.engine\)/);
assert.doesNotMatch(inference, /val current = engineState[\s\S]{0,500}return engineLock\.withLock/);
assert.match(inference, /claimEngineForSynchronousClose\(failedEngine\)[\s\S]*failedEngine\.close\(\)/);
assert.match(inference, /quarantinedEngines\.any \{ it === engine \}/);
assert.match(inference, /commitEngineStateForRequest[\s\S]*deadlineExceeded[\s\S]*engineState = state/);
assert.match(inference, /releaseEngineForGeneration\(active, imagePaths\.isNotEmpty\(\), throwOnDeadline = true\)/);
assert.match(inference, /future\.get\(remainingMs, TimeUnit\.MILLISECONDS\)[\s\S]*closeEngineAsync/);
assert.match(inference, /closeTimedOut[\s\S]*active\.engine = null[\s\S]*executor\.shutdown\(\)/);
assert.doesNotMatch(inference, /catch \(_: TimeoutException\)[\s\S]{0,500}future\.cancel\(true\)[\s\S]{0,500}closeEngineAsync/);
assert.doesNotMatch(inference, /catch \(e: LocalGemmaDeadlineExceededException\)[\s\S]{0,200}\.close\(\)/);
assert.match(inference, /catch \(e: Throwable\)[\s\S]*abortRequested\(\)[\s\S]*LocalGemmaDeadlineExceededException/);
assert.match(inference, /conversation\.cancelProcess\(\)/);
assert.match(inference, /stalledEngines\.forEach \{ closeEngineAsync\(it, active\.requestId\) \}/);
assert.match(inference, /visionBackend/);
assert.match(manifest, /BLUETOOTH_SCAN/);
assert.match(manifest, /foregroundServiceType="connectedDevice"/);
assert.match(tool, /android_eyevue_look/);
assert.match(tool, /set lookAgain=true; that new capture requires durable user approval/);
assert.match(approvalRisk, /EYEVUE_CAPTURE_COMMANDS = new Set\(\["photo", "video_start", "audio_start"\]\)/);
assert.match(approvalRisk, /android_eyevue_look" && toolArgs\?\.lookAgain === true\) return `\$\{action\}:lookAgain`/);
assert.match(approvalRisk, /android_eyevue_command[\s\S]*EYEVUE_CAPTURE_COMMANDS/);
assert.match(approvalRisk, /isEyevueCaptureAction[\s\S]*eyevueCaptureApprovalText\(toolName, toolArgs\) !== undefined/);
assert.match(tool, /isEyevueCaptureAction\("daemon_action", args\)[\s\S]*approvalReceiptCoversToolCall/);
assert.match(tool, /originalUserText: eyevueCaptureApprovalText\("daemon_action", args\)/);
assert.match(approvalReceipt, /call\.originalUserText && call\.originalUserText !== receipt\.originalUserText/);
assert.match(routes, /eyeVueCaptureApprovalRequired = isEyevueCaptureAction[\s\S]*requestApproval[\s\S]*approvalGateId/);
assert.match(coachConfirmation, /approveGate\(pending\.approvalGateId, userId\)[\s\S]*createApprovalReceipt[\s\S]*durableApprovalReceipt/);
assert.match(agentApproval, /gt\(agentApprovalGates\.expiresAt, now\)/);
assert.match(routes, /expiresAt: Math\.min\([\s\S]*durableApprovalExpiresAtMs/);
assert.match(coachConfirmation, /gateBeforeApproval\.expiresAt\.getTime\(\) <= Date\.now\(\)[\s\S]*expiresAt: gate\.expiresAt/);
assert.match(settings, /eyeVue Companion/);
assert.match(settings, /eyevuePermissionGranted !== true[\s\S]*requestEyevuePermissions/);
assert.match(nativeModule, /reactApplicationContext\.currentActivity/);
assert.match(nativeModule, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S[\s\S]*ACCESS_FINE_LOCATION/);
assert.match(bridge, /android_eyevue_discard_photo/);
assert.match(bridge, /processDaemonUtterance\([\s\S]*\.finally\(async \(\) =>[\s\S]*android_eyevue_discard_photo/);

for (const name of ["BootReceiver.kt", "EyevueProtocol.kt", "EyevueGlassesService.kt", "LocalGemmaInferenceEngine.kt"]) {
  assert.equal(
    read(`plugins/android-daemon-native/src/main/java/com/gameplan/daemon/${name}`),
    read(`android/app/src/main/java/com/gameplan/daemon/${name}`),
    `${name} must remain identical in the Expo template and generated Android tree`,
  );
}

console.log("OK: eyeVue local-first glasses integration contract is wired");
