import { access, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const manifestPath = path.join(projectRoot, "android/app/src/main/AndroidManifest.xml");
const rootBuildGradlePath = path.join(projectRoot, "android/build.gradle");
const settingsGradlePath = path.join(projectRoot, "android/settings.gradle");
const appBuildGradlePath = path.join(projectRoot, "android/app/build.gradle");
const stringsPath = path.join(projectRoot, "android/app/src/main/res/values/strings.xml");
const mainApplicationPath = path.join(projectRoot, "android/app/src/main/java/com/gameplan/MainApplication.kt");
const webSocketServicePath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/WebSocketService.kt",
);
const screenRecordHandlerPath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/ScreenRecordHandler.kt",
);
const cameraHandlerPath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/CameraHandler.kt",
);
const accessibilityServicePath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/JarvisAccessibilityService.kt",
);
const opHandlerPath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/OpHandler.kt",
);
const pluginPath = path.join(projectRoot, "plugins/withJarvisAndroidDaemon.js");
const pluginTemplateWebSocketPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/WebSocketService.kt",
);
const pluginTemplateScreenRecordPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/ScreenRecordHandler.kt",
);
const pluginTemplateCameraPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/CameraHandler.kt",
);
const pluginTemplateAccessibilityPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/JarvisAccessibilityService.kt",
);
const pluginTemplateOpHandlerPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/OpHandler.kt",
);
const pluginBlurViewBuildGradlePath = path.join(projectRoot, "plugins/android-blurview-native/build.gradle");
const pluginBlurViewSourcePath = path.join(
  projectRoot,
  "plugins/android-blurview-native/src/main/java/eightbitlab/com/blurview/BlurView.java",
);
const accessibilityConfigPath = path.join(
  projectRoot,
  "android/app/src/main/res/xml/accessibility_service_config.xml",
);
const filePathsPath = path.join(projectRoot, "android/app/src/main/res/xml/file_paths.xml");

const requiredPermissions = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.RECORD_AUDIO",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.WAKE_LOCK",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.QUERY_ALL_PACKAGES",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.CAMERA",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.SEND_SMS",
  "android.permission.FOREGROUND_SERVICE_CAMERA",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
];

const requiredManifestSnippets = [
  'android:name=".daemon.WebSocketService"',
  'android:foregroundServiceType="dataSync|camera|mediaProjection"',
  'android:name=".daemon.WakeWordService"',
  'android:foregroundServiceType="microphone"',
  'android:name=".daemon.JarvisAccessibilityService"',
  "android.accessibilityservice.AccessibilityService",
  'android:name="android.accessibilityservice"',
  'android:resource="@xml/accessibility_service_config"',
  'android:name=".daemon.JarvisNotificationListener"',
  "android.service.notification.NotificationListenerService",
  'android:name=".daemon.BootReceiver"',
  "android.intent.action.BOOT_COMPLETED",
  "android.intent.action.MY_PACKAGE_REPLACED",
  'android:name="androidx.core.content.FileProvider"',
  'android:authorities="${applicationId}.fileprovider"',
  'android:name="android.support.FILE_PROVIDER_PATHS"',
  'android:resource="@xml/file_paths"',
];

const forbiddenManifestSnippets = [
  'android:name=".WebSocketService"',
  'android:name=".WakeWordService"',
  'android:name=".JarvisAccessibilityService"',
  'android:name=".JarvisNotificationListener"',
  'android:name=".BootReceiver"',
];

const requiredStringSnippets = [
  '<string name="accessibility_service_label">',
  '<string name="accessibility_service_description">',
];

const requiredDependencies = [
  'implementation("org.java-websocket:Java-WebSocket:1.5.4")',
  'implementation("org.json:json:20231013")',
  'implementation("com.google.android.gms:play-services-location:21.2.0")',
];

function assertIncludes(contents, expected, source) {
  if (!contents.includes(expected)) {
    throw new Error(`${source} is missing ${expected}`);
  }
}

function assertExcludes(contents, forbidden, source) {
  if (contents.includes(forbidden)) {
    throw new Error(`${source} must not include ${forbidden}`);
  }
}

async function assertFileExists(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${path.relative(projectRoot, filePath)} is missing`);
  }
}

const [
  manifest,
  rootBuildGradle,
  settingsGradle,
  appBuildGradle,
  strings,
  mainApplication,
  webSocketService,
  screenRecordHandler,
  cameraHandler,
  accessibilityService,
  opHandler,
  plugin,
  pluginTemplateWebSocket,
  pluginTemplateScreenRecord,
  pluginTemplateCamera,
  pluginTemplateAccessibility,
  pluginTemplateOpHandler,
  accessibilityConfig,
] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(rootBuildGradlePath, "utf8"),
  readFile(settingsGradlePath, "utf8"),
  readFile(appBuildGradlePath, "utf8"),
  readFile(stringsPath, "utf8"),
  readFile(mainApplicationPath, "utf8"),
  readFile(webSocketServicePath, "utf8"),
  readFile(screenRecordHandlerPath, "utf8"),
  readFile(cameraHandlerPath, "utf8"),
  readFile(accessibilityServicePath, "utf8"),
  readFile(opHandlerPath, "utf8"),
  readFile(pluginPath, "utf8"),
  readFile(pluginTemplateWebSocketPath, "utf8"),
  readFile(pluginTemplateScreenRecordPath, "utf8"),
  readFile(pluginTemplateCameraPath, "utf8"),
  readFile(pluginTemplateAccessibilityPath, "utf8"),
  readFile(pluginTemplateOpHandlerPath, "utf8"),
  readFile(accessibilityConfigPath, "utf8"),
  assertFileExists(filePathsPath),
  assertFileExists(pluginBlurViewBuildGradlePath),
  assertFileExists(pluginBlurViewSourcePath),
]);

for (const permission of requiredPermissions) {
  assertIncludes(manifest, `android:name="${permission}"`, "AndroidManifest.xml");
  assertIncludes(plugin, permission, "plugins/withJarvisAndroidDaemon.js");
}

assertIncludes(manifest, 'android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"', "AndroidManifest.xml");
assertIncludes(manifest, 'android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29"', "AndroidManifest.xml");
assertIncludes(plugin, 'name: "android.permission.READ_EXTERNAL_STORAGE", maxSdkVersion: "32"', "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, 'name: "android.permission.WRITE_EXTERNAL_STORAGE", maxSdkVersion: "29"', "plugins/withJarvisAndroidDaemon.js");

for (const snippet of requiredManifestSnippets) {
  assertIncludes(manifest, snippet, "AndroidManifest.xml");
}

for (const snippet of forbiddenManifestSnippets) {
  assertExcludes(manifest, snippet, "AndroidManifest.xml");
}

for (const snippet of requiredStringSnippets) {
  assertIncludes(strings, snippet, "strings.xml");
}

assertIncludes(strings, "Jarvis Device Control", "strings.xml");
assertIncludes(
  strings,
  "Allows Jarvis to read screen content, tap, type, swipe, and take screenshots on your behalf",
  "strings.xml",
);
assertExcludes(accessibilityConfig, "android:packageNames", "accessibility_service_config.xml");
assertExcludes(plugin, "android:packageNames", "plugins/withJarvisAndroidDaemon.js");

for (const dependency of requiredDependencies) {
  assertIncludes(appBuildGradle, dependency, "android/app/build.gradle");
}

assertIncludes(rootBuildGradle, "substitute module('com.github.Dimezis:BlurView') using project(':blurview')", "android/build.gradle");
assertIncludes(settingsGradle, "include ':blurview'", "android/settings.gradle");
assertIncludes(settingsGradle, "project(':blurview').projectDir = new File(rootDir, 'third-party/blurview')", "android/settings.gradle");
assertIncludes(plugin, "withProjectBuildGradle", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "withSettingsGradle", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "android-blurview-native", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "third-party/blurview", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "substitute module('com.github.Dimezis:BlurView') using project(':blurview')", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "project(':blurview').projectDir = new File(rootDir, 'third-party/blurview')", "plugins/withJarvisAndroidDaemon.js");

assertExcludes(appBuildGradle, "storeFile file('debug.keystore')", "android/app/build.gradle");
assertExcludes(appBuildGradle, "signingConfig signingConfigs.debug", "android/app/build.gradle");
assertIncludes(
  mainApplication,
  "import com.gameplan.daemon.JarvisDaemonPackage",
  "MainApplication.kt",
);
assertIncludes(mainApplication, "add(JarvisDaemonPackage())", "MainApplication.kt");
assertIncludes(webSocketService, 'put("clientKind", "unified_android_app")', "WebSocketService.kt");
assertIncludes(webSocketService, 'put("appPackage", packageName)', "WebSocketService.kt");
assertIncludes(webSocketService, "private var currentConnectUsesDaemonId = false", "WebSocketService.kt");
assertIncludes(webSocketService, "null -> {", "WebSocketService.kt");
assertIncludes(webSocketService, "Skipping sticky restart reconnect", "WebSocketService.kt");
assertIncludes(webSocketService, 'pairCode = ""', "WebSocketService.kt");
assertIncludes(webSocketService, "Pair code rejected", "WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "private var currentConnectUsesDaemonId = false", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "null -> {", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "Skipping sticky restart reconnect", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, 'pairCode = ""', "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "Pair code rejected", "plugins/android-daemon-native/WebSocketService.kt");
assertExcludes(screenRecordHandler, "Jarvis app app", "ScreenRecordHandler.kt");
assertExcludes(screenRecordHandler, "Allow Screen Capture", "ScreenRecordHandler.kt");
assertExcludes(pluginTemplateScreenRecord, "Jarvis app app", "plugins/android-daemon-native/ScreenRecordHandler.kt");
assertExcludes(pluginTemplateScreenRecord, "Allow Screen Capture", "plugins/android-daemon-native/ScreenRecordHandler.kt");
assertIncludes(cameraHandler, "IMPORTANCE_FOREGROUND", "CameraHandler.kt");
assertExcludes(cameraHandler, "IMPORTANCE_FOREGROUND_SERVICE", "CameraHandler.kt");
assertIncludes(pluginTemplateCamera, "IMPORTANCE_FOREGROUND", "plugins/android-daemon-native/CameraHandler.kt");
assertExcludes(pluginTemplateCamera, "IMPORTANCE_FOREGROUND_SERVICE", "plugins/android-daemon-native/CameraHandler.kt");
assertIncludes(accessibilityService, '"enter"         -> pressImeAction()', "JarvisAccessibilityService.kt");
assertExcludes(accessibilityService, '"enter"         -> { pressImeAction(); true }', "JarvisAccessibilityService.kt");
assertIncludes(pluginTemplateAccessibility, '"enter"         -> pressImeAction()', "plugins/android-daemon-native/JarvisAccessibilityService.kt");
assertExcludes(pluginTemplateAccessibility, '"enter"         -> { pressImeAction(); true }', "plugins/android-daemon-native/JarvisAccessibilityService.kt");
for (const [contents, source] of [
  [opHandler, "OpHandler.kt"],
  [pluginTemplateOpHandler, "plugins/android-daemon-native/OpHandler.kt"],
]) {
  assertIncludes(contents, '"android_file_list" -> handleFileList(context, op)', source);
  assertIncludes(contents, '"android_file_read" -> handleFileRead(context, op)', source);
  assertIncludes(contents, '"android_file_search" -> handleFileSearch(context, op)', source);
  assertIncludes(contents, "import com.gameplan.MainActivity", source);
  assertIncludes(contents, "Intent(context, MainActivity::class.java)", source);
  assertIncludes(contents, '.put("target", "app")', source);
  assertIncludes(contents, "Browser fallback: bring an existing Jarvis tab forward", source);
  assertIncludes(contents, "resolveSharedStoragePath(context, path) ?: return privateFilePathDenied(path)", source);
  assertIncludes(contents, "resolveSharedStoragePath(context, requestedRootPath)", source);
  assertIncludes(contents, '"/data/data/$packageName"', source);
  assertIncludes(contents, "context.applicationInfo.dataDir", source);
  assertIncludes(contents, "File(path).isAbsolute", source);
  assertExcludes(contents, 'path.startsWith("/") -> path', source);
}
assertExcludes(plugin, "android-daemon/app", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(
  plugin,
  "android-daemon-native/src/main/java/com/gameplan/daemon",
  "plugins/withJarvisAndroidDaemon.js",
);

console.log("OK: unified Android daemon native config is present");
