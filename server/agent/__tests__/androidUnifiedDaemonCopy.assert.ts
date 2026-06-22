import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const profileSource = fs.readFileSync(path.join(projectRoot, "app/(tabs)/profile.tsx"), "utf8");
const settingsSource = fs.readFileSync(path.join(projectRoot, "app/(tabs)/settings.tsx"), "utf8");
const coachAgentSource = fs.readFileSync(path.join(projectRoot, "server/channels/coachAgent.ts"), "utf8");
const daemonToolSource = fs.readFileSync(path.join(projectRoot, "server/agent/tools/daemon.ts"), "utf8");
const routesSource = fs.readFileSync(path.join(projectRoot, "server/routes.ts"), "utf8");
const androidControlCardSource = fs.readFileSync(
  path.join(projectRoot, "components/androidDaemon/AndroidDeviceControlCard.tsx"),
  "utf8",
);
const androidAccessibilitySource = fs.readFileSync(
  path.join(projectRoot, "android/app/src/main/java/com/gameplan/daemon/JarvisAccessibilityService.kt"),
  "utf8",
);
const pluginAccessibilitySource = fs.readFileSync(
  path.join(projectRoot, "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/JarvisAccessibilityService.kt"),
  "utf8",
);
const legacyAccessibilitySource = fs.readFileSync(
  path.join(projectRoot, "android-daemon/app/src/main/java/com/jarvis/daemon/JarvisAccessibilityService.kt"),
  "utf8",
);
const nativeWrapperPath = path.join(projectRoot, "lib/android-daemon-native.ts");

assert.equal(
  fs.existsSync(nativeWrapperPath),
  true,
  "Android daemon native wrapper should exist.",
);

const nativeWrapperSource = fs.readFileSync(nativeWrapperPath, "utf8");

assert.match(
  profileSource,
  /Enable Android device control in this Jarvis app/,
  "Profile should describe Android control as built into the Jarvis app.",
);

for (const disallowed of [
  "Install the Jarvis Daemon APK",
  "Open the daemon app",
  "Transfer the APK",
  "Download the Jarvis Daemon APK",
  "Build the APK",
  "Transfer the APK to the Android phone",
  "Open the app → enter the server URL",
]) {
  assert.equal(
    profileSource.includes(disallowed),
    false,
    `Profile should not include standalone daemon copy: ${disallowed}`,
  );
  assert.equal(
    coachAgentSource.includes(disallowed),
    false,
    `Coach setup guidance should not include standalone daemon copy: ${disallowed}`,
  );
}

for (const disallowed of [
  "Jarvis Daemon app",
  "Jarvis Daemon APK",
  "Android daemon APK",
  "open the Jarvis Daemon APK",
  "tap 'Allow' next to Screen Recording",
]) {
  assert.equal(
    daemonToolSource.includes(disallowed),
    false,
    `Daemon tool recovery copy should not include standalone Android app copy: ${disallowed}`,
  );
  assert.equal(
    routesSource.includes(disallowed),
    false,
    `Runtime route guidance should not include standalone Android app copy: ${disallowed}`,
  );
}

assert.match(
  daemonToolSource,
  /Screen recording is not available in the unified Jarvis Android app yet/,
  "Daemon tool recovery copy should not point users to a missing screen-record grant flow.",
);

assert.match(
  androidControlCardSource,
  /nativeAvailable \|\| !!onUnpair/,
  "Android control card should allow server-side unpair when the native module is unavailable.",
);

assert.match(
  androidControlCardSource,
  /const healthy = serverConnected \|\| nativeConnected;/,
  "Android control card should show connected health from server state when native status is unavailable.",
);

assert.match(
  androidControlCardSource,
  /!nativeAvailable && !alreadyConnected/,
  "Android control card should not show pairing setup copy for a server-connected phone on non-native surfaces.",
);

assert.match(
  androidControlCardSource,
  /\/api\/download\/android/,
  "Android control card should provide an install path when the native module is unavailable.",
);

assert.match(
  androidControlCardSource,
  /\/api\/channels\/android-daemon\/bootstrap/,
  "Android control card should request an authenticated in-app bootstrap token.",
);

assert.match(
  androidControlCardSource,
  /AndroidDaemonNative\.enable/,
  "Android control card should enable the local daemon through the native bootstrap bridge.",
);

assert.match(
  androidControlCardSource,
  /Enable Device Control/,
  "Android control card should present a one-device enable action instead of a self-pairing code.",
);

assert.match(
  androidControlCardSource,
  /needsAccessibility/,
  "Android control card should not treat a connected phone as fully ready until Accessibility is enabled.",
);

assert.match(
  androidControlCardSource,
  /Open Accessibility/,
  "Android control card should provide a direct accessibility setup action for device control.",
);

assert.match(
  settingsSource,
  /openAccessibilitySettings/,
  "Settings Device Control row should provide a direct accessibility setup action.",
);

assert.match(
  settingsSource,
  /AppState\.addEventListener\('change'/,
  "Settings should refresh Android Accessibility status when returning from system Settings.",
);

assert.match(
  settingsSource,
  /apiRequest\('GET', '\/api\/channels'\)/,
  "Settings native status refresh should also refresh the server Android daemon channel state.",
);

assert.match(
  settingsSource,
  /setAndroidDaemonConnected\(serverConnected \|\| nativeResult\.value\.connected\)/,
  "Settings native status refresh should merge server and native Android daemon state.",
);

assert.match(
  settingsSource,
  /androidDaemonNeedsAccessibility/,
  "Settings should not treat a connected phone as ready when Accessibility is still off.",
);

assert.match(
  androidControlCardSource,
  /await onUnpair\?\.\(\)/,
  "Android control card should call the server-side unpair callback during disconnect.",
);

assert.match(
  routesSource,
  /tap Enable Device Control/,
  "Runtime guidance should match the unified Android card native enable flow.",
);

assert.match(
  coachAgentSource,
  /Tap Enable Device Control/,
  "Channel guidance should match the unified Android card native enable flow.",
);

for (const staleGuidance of [
  "Get Pairing Code",
  "Server URL is https://gameplanjarvisai.up.railway.app",
  "tap Pair",
  "tap Code",
  "tap Connect",
  "navigates the phone back to the Jarvis chat in the browser",
]) {
  assert.equal(
    routesSource.includes(staleGuidance),
    false,
    `Runtime route guidance should not include stale Android setup copy: ${staleGuidance}`,
  );
  assert.equal(
    coachAgentSource.includes(staleGuidance),
    false,
    `Channel guidance should not include stale Android setup copy: ${staleGuidance}`,
  );
}

for (const stalePairingCopy of [
  "/api/channels/daemon/code",
  "Pair code",
  "pairCode",
  "GamePlan Daemon app",
]) {
  assert.equal(
    androidControlCardSource.includes(stalePairingCopy),
    false,
    `Android control card should not expose self-pairing code workflow: ${stalePairingCopy}`,
  );
  assert.equal(
    settingsSource.includes(stalePairingCopy),
    false,
    `Settings should not expose self-pairing Android daemon workflow: ${stalePairingCopy}`,
  );
}

assert.match(
  routesSource,
  /returns the phone to the Jarvis app or existing chat surface/,
  "Runtime guidance should describe return-to-Jarvis as app-first, not browser-only.",
);

for (const source of [androidAccessibilitySource, pluginAccessibilitySource, legacyAccessibilitySource]) {
  assert.match(
    source,
    /Bitmap\.wrapHardwareBuffer\(hardwareBuffer,\s*result\.colorSpace\)/,
    "Accessibility screenshots should read ScreenshotResult hardware buffers directly.",
  );
  assert.match(
    source,
    /catch \(throwable: Throwable\) \{\s*hardwareBuffer\.close\(\)\s*throw throwable\s*\}/,
    "Accessibility screenshots should close the hardware buffer if wrapping fails.",
  );
  assert.match(
    source,
    /finally \{\s*hardwareBitmap\.recycle\(\)\s*hardwareBuffer\.close\(\)\s*\}/,
    "Accessibility screenshots should recycle the wrapped hardware bitmap after copying.",
  );
  assert.doesNotMatch(
    source,
    /getHardwareBitmap|getBitmap/,
    "Accessibility screenshots should not reflect nonexistent ScreenshotResult bitmap getters.",
  );
}

for (const method of [
  "getStatus",
  "enable",
  "disconnect",
  "openAccessibilitySettings",
  "openNotificationListenerSettings",
  "openAssistantSettings",
  "refreshAssistantStatus",
  "openAllFilesAccessSettings",
  "requestCameraPermission",
  "requestMicrophonePermission",
  "requestScreenRecordPermission",
]) {
  assert.match(
    nativeWrapperSource,
    new RegExp(`${method}\\(`),
    `AndroidDaemonNative wrapper should expose ${method}.`,
  );
}
