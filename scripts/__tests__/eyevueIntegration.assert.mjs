import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const protocol = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/EyevueProtocol.kt");
const service = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/EyevueGlassesService.kt");
const inference = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/LocalGemmaInferenceEngine.kt");
const wake = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/WakeWordService.kt");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const tool = read("server/agent/tools/daemon.ts");
const settings = read("components/androidDaemon/AndroidDeviceControlCard.tsx");
const bridge = read("server/daemon/bridge.ts");
const nativeModule = read("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/JarvisDaemonModule.kt");

assert.match(protocol, /0000aa12-0000-1000-8000-00805f9b34fb/);
assert.match(protocol, /fun stopVendorVoice\(\)/);
assert.match(service, /"hey star"/i);
assert.match(service, /Jarvis is offline\./);
assert.match(service, /pendingPhoto.*30, TimeUnit\.SECONDS/s);
assert.match(service, /percent <= 20/);
assert.match(service, /percent <= 10/);
assert.match(service, /temporary copy retained for active visual turn/);
assert.match(service, /requestedCapture == null[\s\S]*eyevue_photo_captured/);
assert.match(service, /status != BluetoothGatt\.GATT_SUCCESS[\s\S]*failGattSetup/);
assert.match(service, /fun start\([\s\S]*hasBluetoothPermission\(context\)[\s\S]*return false/);
assert.match(service, /ACCESS_FINE_LOCATION/);
assert.match(service, /scheduleTemporaryPhotoExpiry\(file\.absolutePath, origin\)/);
assert.match(service, /TEMPORARY_PHOTO_TTL_MS/);
assert.match(service, /!file\.exists\(\) \|\| file\.delete\(\)[\s\S]*if \(!deleted\)[\s\S]*return false/);
assert.match(wake, /ACTION_EXTERNAL_WAKE/);
assert.match(wake, /ACTION_EXTERNAL_WAKE[\s\S]*enteringTalkMode[\s\S]*destroyRecognizer\(\)[\s\S]*startListening\(\)/);
assert.match(inference, /Content\.ImageFile/);
assert.match(inference, /15_000L/);
assert.match(inference, /30_000L/);
assert.match(inference, /visionDeadlineAtElapsedMs[\s\S]*remainingMs[\s\S]*future\.get\(remainingMs, TimeUnit\.MILLISECONDS\)/);
assert.match(inference, /quarantineTimedOutNativeAttempt/);
assert.match(inference, /releaseEngineForGeneration\(active, imagePaths\.isNotEmpty\(\), throwOnDeadline = true\)/);
assert.match(inference, /future\.get\(remainingMs, TimeUnit\.MILLISECONDS\)[\s\S]*closeEngineAsync/);
assert.match(inference, /catch \(e: Throwable\)[\s\S]*abortRequested\(\)[\s\S]*LocalGemmaDeadlineExceededException/);
assert.match(inference, /conversation\.cancelProcess\(\)/);
assert.match(inference, /stalledEngine\.close\(\)/);
assert.match(inference, /visionBackend/);
assert.match(manifest, /BLUETOOTH_SCAN/);
assert.match(manifest, /foregroundServiceType="connectedDevice"/);
assert.match(tool, /android_eyevue_look/);
assert.match(tool, /lookAgain=true only when the user says/);
assert.match(settings, /eyeVue Companion/);
assert.match(settings, /eyevuePermissionGranted !== true[\s\S]*requestEyevuePermissions/);
assert.match(nativeModule, /reactApplicationContext\.currentActivity/);
assert.match(nativeModule, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S[\s\S]*ACCESS_FINE_LOCATION/);
assert.match(bridge, /android_eyevue_discard_photo/);
assert.match(bridge, /processDaemonUtterance\([\s\S]*\.finally\(async \(\) =>[\s\S]*android_eyevue_discard_photo/);

for (const name of ["EyevueProtocol.kt", "EyevueGlassesService.kt"]) {
  assert.equal(
    read(`plugins/android-daemon-native/src/main/java/com/gameplan/daemon/${name}`),
    read(`android/app/src/main/java/com/gameplan/daemon/${name}`),
    `${name} must remain identical in the Expo template and generated Android tree`,
  );
}

console.log("OK: eyeVue local-first glasses integration contract is wired");
