import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const profileSource = fs.readFileSync(path.join(projectRoot, "app/(tabs)/profile.tsx"), "utf8");
const coachAgentSource = fs.readFileSync(path.join(projectRoot, "server/channels/coachAgent.ts"), "utf8");
const daemonToolSource = fs.readFileSync(path.join(projectRoot, "server/agent/tools/daemon.ts"), "utf8");
const routesSource = fs.readFileSync(path.join(projectRoot, "server/routes.ts"), "utf8");
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

for (const method of [
  "getStatus",
  "connect",
  "disconnect",
  "openAccessibilitySettings",
  "openNotificationListenerSettings",
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
