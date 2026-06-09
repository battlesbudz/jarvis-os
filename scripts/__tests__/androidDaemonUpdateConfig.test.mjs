import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

const updateChecker = read("android-daemon/app/src/main/java/com/jarvis/daemon/UpdateChecker.kt");
const jarvisConfig = read("android-daemon/app/src/main/java/com/jarvis/daemon/JarvisConfig.kt");
const mainActivity = read("android-daemon/app/src/main/java/com/jarvis/daemon/MainActivity.kt");
const bootReceiver = read("android-daemon/app/src/main/java/com/jarvis/daemon/BootReceiver.kt");
const webSocketService = read("android-daemon/app/src/main/java/com/jarvis/daemon/WebSocketService.kt");
const appUpdateRoutes = read("server/routes/appUpdateRoutes.ts");
const downloadRoutes = read("server/downloadRoutes.ts");
const daemonWorkflow = read(".github/workflows/build-android-apk.yml");

assert.match(
  jarvisConfig,
  /normalizeServerUrl/,
  "Android daemon should centralize server URL normalization",
);
assert.match(
  jarvisConfig,
  /replit|repl/i,
  "Android daemon URL normalization should detect stale Replit URLs",
);
for (const [name, source] of [
  ["MainActivity", mainActivity],
  ["BootReceiver", bootReceiver],
  ["WebSocketService", webSocketService],
]) {
  assert.match(
    source,
    /JarvisConfig\.normalizeServerUrl/,
    `${name} should normalize persisted server URLs before connecting`,
  );
}

assert.doesNotMatch(
  updateChecker,
  /battlesbudz\/JarvisAi/i,
  "Android daemon updater must not point at the old JarvisAi release repo",
);
assert.match(
  updateChecker,
  /JarvisConfig\.SERVER_URL/,
  "Android daemon updater should use the configured Railway server as update source",
);
assert.match(
  updateChecker,
  /\/api\/app-update\/android-daemon/,
  "Android daemon updater should fetch a daemon-specific update manifest from Railway",
);
assert.match(
  updateChecker,
  /\/api\/download\/apk/,
  "Android daemon updater should download APKs through the Railway APK endpoint",
);

assert.match(
  appUpdateRoutes,
  /\/api\/app-update\/android-daemon/,
  "Server should expose an Android daemon update manifest endpoint",
);
assert.match(
  appUpdateRoutes,
  /android-daemon-latest/,
  "Android daemon update manifest should default to the android-daemon-latest release",
);
assert.match(
  appUpdateRoutes,
  /apkUrl:\s*manifest\.apkUrl\s*\|\|\s*railwayApkUrl/,
  "Android daemon update manifest should default APK installs through Railway",
);

assert.match(
  downloadRoutes,
  /JARVIS_ANDROID_DAEMON_APK_URL/,
  "APK download endpoint should support a daemon-specific hosted APK URL",
);
assert.match(
  downloadRoutes,
  /jarvis-daemon\.apk/,
  "APK download endpoint should default to the daemon APK release asset",
);
assert.match(
  downloadRoutes,
  /proxyFallbackApk/,
  "APK download endpoint should proxy hosted APKs through Railway",
);
assert.match(
  downloadRoutes,
  /pipeline\(Readable\.fromWeb/,
  "APK download endpoint should stream proxied APKs instead of buffering them",
);
assert.doesNotMatch(
  downloadRoutes,
  /Buffer\.from\(await remote\.arrayBuffer\(\)\)/,
  "APK download endpoint should not buffer hosted APKs in Railway memory",
);
assert.doesNotMatch(
  downloadRoutes,
  /res\.redirect\(302,\s*fallback\)/,
  "APK download endpoint should not make Android clients follow GitHub release redirects",
);
assert.match(
  downloadRoutes,
  /ANDROID_APK_URL/,
  "APK download endpoint should keep the legacy APK URL env fallback",
);

assert.match(
  daemonWorkflow,
  /branches:\s*\[[^\]]*codex\/replit-main-continuation[^\]]*\]/,
  "Android daemon APK workflow should run from the deployed continuation branch",
);

console.log("OK: Android daemon update/download config targets Railway and the current repo");
