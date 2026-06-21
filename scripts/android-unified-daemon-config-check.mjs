import { access, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const manifestPath = path.join(projectRoot, "android/app/src/main/AndroidManifest.xml");
const rootBuildGradlePath = path.join(projectRoot, "android/build.gradle");
const settingsGradlePath = path.join(projectRoot, "android/settings.gradle");
const appBuildGradlePath = path.join(projectRoot, "android/app/build.gradle");
const stringsPath = path.join(projectRoot, "android/app/src/main/res/values/strings.xml");
const mainApplicationPath = path.join(projectRoot, "android/app/src/main/java/com/gameplan/MainApplication.kt");
const mainActivityPath = path.join(projectRoot, "android/app/src/main/java/com/gameplan/MainActivity.kt");
const jarvisVoiceInteractionPath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/JarvisVoiceInteraction.kt",
);
const nativeWrapperPath = path.join(projectRoot, "lib/android-daemon-native.ts");
const androidControlCardPath = path.join(projectRoot, "components/androidDaemon/AndroidDeviceControlCard.tsx");
const jarvisDaemonModulePath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/JarvisDaemonModule.kt",
);
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
const legacyAccessibilityServicePath = path.join(
  projectRoot,
  "android-daemon/app/src/main/java/com/jarvis/daemon/JarvisAccessibilityService.kt",
);
const opHandlerPath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/OpHandler.kt",
);
const localGemmaModelManagerPath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/LocalGemmaModelManager.kt",
);
const localGemmaInferenceEnginePath = path.join(
  projectRoot,
  "android/app/src/main/java/com/gameplan/daemon/LocalGemmaInferenceEngine.kt",
);
const pluginPath = path.join(projectRoot, "plugins/withJarvisAndroidDaemon.js");
const pluginTemplateWebSocketPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/WebSocketService.kt",
);
const pluginTemplateJarvisDaemonModulePath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/JarvisDaemonModule.kt",
);
const pluginTemplateJarvisVoiceInteractionPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/JarvisVoiceInteraction.kt",
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
const pluginTemplateLocalGemmaModelManagerPath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/LocalGemmaModelManager.kt",
);
const pluginTemplateLocalGemmaInferenceEnginePath = path.join(
  projectRoot,
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/LocalGemmaInferenceEngine.kt",
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
const interactionServicePath = path.join(projectRoot, "android/app/src/main/res/xml/interaction_service.xml");
const filePathsPath = path.join(projectRoot, "android/app/src/main/res/xml/file_paths.xml");
const apkWorkflowPath = path.join(projectRoot, ".github/workflows/build-jarvis-apk.yml");
const serverBridgePath = path.join(projectRoot, "server/daemon/bridge.ts");

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
  'android:allowBackup="false"',
  'android:name=".daemon.WebSocketService"',
  'android:foregroundServiceType="dataSync"',
  'android:name=".daemon.WakeWordService"',
  'android:foregroundServiceType="microphone"',
  'android:name=".daemon.JarvisVoiceInteractionService"',
  "android.service.voice.VoiceInteractionService",
  'android:name="android.voice_interaction"',
  'android:resource="@xml/interaction_service"',
  'android:name=".daemon.JarvisVoiceInteractionSessionService"',
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
  'android:name=".daemon.JarvisRecognitionService"',
  "android.speech.RecognitionService",
  '@xml/jarvis_recognition_service',
];

const requiredStringSnippets = [
  '<string name="accessibility_service_label">',
  '<string name="accessibility_service_description">',
  '<string name="assistant_service_label">',
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
  mainActivity,
  jarvisVoiceInteraction,
  nativeWrapper,
  androidControlCard,
  jarvisDaemonModule,
  webSocketService,
  screenRecordHandler,
  cameraHandler,
  accessibilityService,
  legacyAccessibilityService,
  opHandler,
  localGemmaModelManager,
  localGemmaInferenceEngine,
  plugin,
  pluginTemplateWebSocket,
  pluginTemplateJarvisDaemonModule,
  pluginTemplateJarvisVoiceInteraction,
  pluginTemplateScreenRecord,
  pluginTemplateCamera,
  pluginTemplateAccessibility,
  pluginTemplateOpHandler,
  pluginTemplateLocalGemmaModelManager,
  pluginTemplateLocalGemmaInferenceEngine,
  accessibilityConfig,
  interactionService,
  apkWorkflow,
  serverBridge,
] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(rootBuildGradlePath, "utf8"),
  readFile(settingsGradlePath, "utf8"),
  readFile(appBuildGradlePath, "utf8"),
  readFile(stringsPath, "utf8"),
  readFile(mainApplicationPath, "utf8"),
  readFile(mainActivityPath, "utf8"),
  readFile(jarvisVoiceInteractionPath, "utf8"),
  readFile(nativeWrapperPath, "utf8"),
  readFile(androidControlCardPath, "utf8"),
  readFile(jarvisDaemonModulePath, "utf8"),
  readFile(webSocketServicePath, "utf8"),
  readFile(screenRecordHandlerPath, "utf8"),
  readFile(cameraHandlerPath, "utf8"),
  readFile(accessibilityServicePath, "utf8"),
  readFile(legacyAccessibilityServicePath, "utf8"),
  readFile(opHandlerPath, "utf8"),
  readFile(localGemmaModelManagerPath, "utf8"),
  readFile(localGemmaInferenceEnginePath, "utf8"),
  readFile(pluginPath, "utf8"),
  readFile(pluginTemplateWebSocketPath, "utf8"),
  readFile(pluginTemplateJarvisDaemonModulePath, "utf8"),
  readFile(pluginTemplateJarvisVoiceInteractionPath, "utf8"),
  readFile(pluginTemplateScreenRecordPath, "utf8"),
  readFile(pluginTemplateCameraPath, "utf8"),
  readFile(pluginTemplateAccessibilityPath, "utf8"),
  readFile(pluginTemplateOpHandlerPath, "utf8"),
  readFile(pluginTemplateLocalGemmaModelManagerPath, "utf8"),
  readFile(pluginTemplateLocalGemmaInferenceEnginePath, "utf8"),
  readFile(accessibilityConfigPath, "utf8"),
  readFile(interactionServicePath, "utf8"),
  readFile(apkWorkflowPath, "utf8"),
  readFile(serverBridgePath, "utf8"),
  assertFileExists(filePathsPath),
  assertFileExists(pluginBlurViewBuildGradlePath),
  assertFileExists(pluginBlurViewSourcePath),
]);

assertIncludes(serverBridge, 'android_local_model_smoke_test: "android_local_model"', "server/daemon/bridge.ts");

for (const permission of requiredPermissions) {
  assertIncludes(manifest, `android:name="${permission}"`, "AndroidManifest.xml");
  assertIncludes(plugin, permission, "plugins/withJarvisAndroidDaemon.js");
}

assertIncludes(manifest, 'android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"', "AndroidManifest.xml");
assertIncludes(manifest, 'android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29"', "AndroidManifest.xml");
assertIncludes(plugin, 'name: "android.permission.READ_EXTERNAL_STORAGE", maxSdkVersion: "32"', "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, 'name: "android.permission.WRITE_EXTERNAL_STORAGE", maxSdkVersion: "29"', "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, 'mainApplication.$["android:allowBackup"] = "false"', "plugins/withJarvisAndroidDaemon.js");

for (const snippet of requiredManifestSnippets) {
  assertIncludes(manifest, snippet, "AndroidManifest.xml");
}

for (const snippet of forbiddenManifestSnippets) {
  assertExcludes(manifest, snippet, "AndroidManifest.xml");
}
assertExcludes(manifest, 'android:foregroundServiceType="dataSync|camera|mediaProjection"', "AndroidManifest.xml");
assertExcludes(plugin, '"android:foregroundServiceType": "dataSync|camera|mediaProjection"', "plugins/withJarvisAndroidDaemon.js");

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
assertIncludes(interactionService, "JarvisVoiceInteractionSessionService", "interaction_service.xml");
assertExcludes(interactionService, "JarvisRecognitionService", "interaction_service.xml");
assertIncludes(plugin, "interaction_service.xml", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "STALE_DAEMON_XML_RESOURCES", "plugins/withJarvisAndroidDaemon.js");
assertExcludes(plugin, '"android:name": ".daemon.JarvisRecognitionService"', "plugins/withJarvisAndroidDaemon.js");
assertExcludes(plugin, '"android:name": "android.speech.RecognitionService"', "plugins/withJarvisAndroidDaemon.js");

for (const dependency of requiredDependencies) {
  assertIncludes(appBuildGradle, dependency, "android/app/build.gradle");
}

assertIncludes(rootBuildGradle, "substitute module('com.github.Dimezis:BlurView') using project(':blurview')", "android/build.gradle");
assertIncludes(rootBuildGradle, "-Xskip-metadata-version-check", "android/build.gradle");
assertIncludes(settingsGradle, "include ':blurview'", "android/settings.gradle");
assertIncludes(settingsGradle, "project(':blurview').projectDir = new File(rootDir, 'third-party/blurview')", "android/settings.gradle");
assertIncludes(plugin, "withProjectBuildGradle", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "-Xskip-metadata-version-check", "plugins/withJarvisAndroidDaemon.js");
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
assertIncludes(mainActivity, "applyAssistantKeyguardVisibility(intent)", "MainActivity.kt");
assertIncludes(mainActivity, "override fun onNewIntent(intent: Intent)", "MainActivity.kt");
assertIncludes(mainActivity, "override fun onDestroy()", "MainActivity.kt");
assertIncludes(mainActivity, "JarvisAssistantLauncher.shouldShowWhenLocked(this, intent)", "MainActivity.kt");
assertExcludes(mainActivity, 'getQueryParameter("source")', "MainActivity.kt");
assertIncludes(mainActivity, "assistantKeyguardVisibilityHandler", "MainActivity.kt");
assertIncludes(mainActivity, "private fun clearAssistantKeyguardVisibilityIfUnlocked()", "MainActivity.kt");
assertIncludes(mainActivity, "private fun isDeviceKeyguardLocked()", "MainActivity.kt");
assertIncludes(mainActivity, "setShowWhenLocked(showWhenLocked)", "MainActivity.kt");
assertIncludes(mainActivity, "setTurnScreenOn(showWhenLocked)", "MainActivity.kt");
assertIncludes(jarvisVoiceInteraction, "EXTRA_SHOW_WHEN_LOCKED_TOKEN", "JarvisVoiceInteraction.kt");
assertIncludes(jarvisVoiceInteraction, "UUID.randomUUID()", "JarvisVoiceInteraction.kt");
assertIncludes(jarvisVoiceInteraction, "fun shouldShowWhenLocked(context: Context, intent: Intent?)", "JarvisVoiceInteraction.kt");
assertIncludes(jarvisVoiceInteraction, "suppliedToken != expectedToken", "JarvisVoiceInteraction.kt");
assertIncludes(pluginTemplateJarvisVoiceInteraction, "EXTRA_SHOW_WHEN_LOCKED_TOKEN", "plugins/android-daemon-native/JarvisVoiceInteraction.kt");
assertIncludes(pluginTemplateJarvisVoiceInteraction, "UUID.randomUUID()", "plugins/android-daemon-native/JarvisVoiceInteraction.kt");
assertIncludes(
  pluginTemplateJarvisVoiceInteraction,
  "fun shouldShowWhenLocked(context: Context, intent: Intent?)",
  "plugins/android-daemon-native/JarvisVoiceInteraction.kt",
);
assertIncludes(plugin, "patchMainActivityAsync", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "function ensureKotlinImport", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "MainActivity.kt is missing a Kotlin package declaration.", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, 'contents = ensureKotlinImport(contents, importName)', "plugins/withJarvisAndroidDaemon.js");
assertExcludes(plugin, "import expo.modules.splashscreen.SplashScreenManager\\n\\n", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "onCreateMatch", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "override fun onNewIntent(intent: Intent)", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "keyguardSetIntentLine", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "keyguardApplyLine", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "insertKeyguardBlock", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "override fun onDestroy()", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "JarvisAssistantLauncher.shouldShowWhenLocked(this, intent)", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "assistantKeyguardVisibilityHandler", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "private fun clearAssistantKeyguardVisibilityIfUnlocked()", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "private fun isDeviceKeyguardLocked()", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(plugin, "setShowWhenLocked(showWhenLocked)", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(nativeWrapper, "enable(serverUrl: string, bootstrapToken: string)", "lib/android-daemon-native.ts");
assertIncludes(nativeWrapper, "openAssistantSettings", "lib/android-daemon-native.ts");
assertIncludes(nativeWrapper, "refreshAssistantStatus", "lib/android-daemon-native.ts");
assertIncludes(nativeWrapper, "getAndroidLocalGemmaStatus", "lib/android-daemon-native.ts");
assertIncludes(nativeWrapper, "validateAndroidLocalGemmaModel", "lib/android-daemon-native.ts");
assertExcludes(nativeWrapper, "connect(serverUrl: string, pairCode: string)", "lib/android-daemon-native.ts");
assertIncludes(androidControlCard, "/api/channels/android-daemon/bootstrap", "AndroidDeviceControlCard.tsx");
assertIncludes(androidControlCard, "AndroidDaemonNative.enable", "AndroidDeviceControlCard.tsx");
assertIncludes(androidControlCard, "Enable Device Control", "AndroidDeviceControlCard.tsx");
assertExcludes(androidControlCard, "/api/channels/daemon/code", "AndroidDeviceControlCard.tsx");
assertExcludes(androidControlCard, "Pair code", "AndroidDeviceControlCard.tsx");
assertExcludes(androidControlCard, "pairCode", "AndroidDeviceControlCard.tsx");
assertIncludes(jarvisDaemonModule, "fun enable(serverUrl: String, bootstrapToken: String", "JarvisDaemonModule.kt");
assertIncludes(jarvisDaemonModule, "E_JARVIS_DAEMON_START", "JarvisDaemonModule.kt");
assertIncludes(jarvisDaemonModule, "private fun startServiceCompat(intent: Intent, promise: Promise): Boolean", "JarvisDaemonModule.kt");
assertIncludes(jarvisDaemonModule, "fun getLocalGemmaStatus(model: String, promise: Promise)", "JarvisDaemonModule.kt");
assertIncludes(jarvisDaemonModule, "fun validateLocalGemmaModel(model: String, promise: Promise)", "JarvisDaemonModule.kt");
assertExcludes(jarvisDaemonModule, "fun connect(serverUrl: String, pairCode: String", "JarvisDaemonModule.kt");
assertIncludes(pluginTemplateJarvisDaemonModule, "fun enable(serverUrl: String, bootstrapToken: String", "plugins/android-daemon-native/JarvisDaemonModule.kt");
assertIncludes(pluginTemplateJarvisDaemonModule, "E_JARVIS_DAEMON_START", "plugins/android-daemon-native/JarvisDaemonModule.kt");
assertIncludes(pluginTemplateJarvisDaemonModule, "private fun startServiceCompat(intent: Intent, promise: Promise): Boolean", "plugins/android-daemon-native/JarvisDaemonModule.kt");
assertIncludes(pluginTemplateJarvisDaemonModule, "fun getLocalGemmaStatus(model: String, promise: Promise)", "plugins/android-daemon-native/JarvisDaemonModule.kt");
assertIncludes(pluginTemplateJarvisDaemonModule, "fun validateLocalGemmaModel(model: String, promise: Promise)", "plugins/android-daemon-native/JarvisDaemonModule.kt");
assertExcludes(pluginTemplateJarvisDaemonModule, "fun connect(serverUrl: String, pairCode: String", "plugins/android-daemon-native/JarvisDaemonModule.kt");
assertIncludes(webSocketService, "private fun startForegroundCompat(): Boolean", "WebSocketService.kt");
assertIncludes(webSocketService, "Failed to start foreground daemon service", "WebSocketService.kt");
assertIncludes(webSocketService, "return START_NOT_STICKY", "WebSocketService.kt");
assertIncludes(webSocketService, 'put("clientKind", "unified_android_app")', "WebSocketService.kt");
assertIncludes(webSocketService, 'put("appPackage", packageName)', "WebSocketService.kt");
assertIncludes(webSocketService, "private var currentConnectUsesDaemonId = false", "WebSocketService.kt");
assertIncludes(webSocketService, "private var currentConnectUsesBootstrapToken = false", "WebSocketService.kt");
assertIncludes(webSocketService, "ACTION_BOOTSTRAP", "WebSocketService.kt");
assertIncludes(webSocketService, "EXTRA_BOOTSTRAP_TOKEN", "WebSocketService.kt");
assertIncludes(webSocketService, '"android_app_bootstrap"', "WebSocketService.kt");
assertIncludes(webSocketService, "null -> {", "WebSocketService.kt");
assertIncludes(webSocketService, "Skipping sticky restart reconnect", "WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "private var currentConnectUsesDaemonId = false", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "private var currentConnectUsesBootstrapToken = false", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "private fun startForegroundCompat(): Boolean", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "Failed to start foreground daemon service", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "return START_NOT_STICKY", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "ACTION_BOOTSTRAP", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "EXTRA_BOOTSTRAP_TOKEN", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, '"android_app_bootstrap"', "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "null -> {", "plugins/android-daemon-native/WebSocketService.kt");
assertIncludes(pluginTemplateWebSocket, "Skipping sticky restart reconnect", "plugins/android-daemon-native/WebSocketService.kt");
assertExcludes(screenRecordHandler, "Jarvis app app", "ScreenRecordHandler.kt");
assertExcludes(screenRecordHandler, "Allow Screen Capture", "ScreenRecordHandler.kt");
assertExcludes(pluginTemplateScreenRecord, "Jarvis app app", "plugins/android-daemon-native/ScreenRecordHandler.kt");
assertExcludes(pluginTemplateScreenRecord, "Allow Screen Capture", "plugins/android-daemon-native/ScreenRecordHandler.kt");
assertIncludes(cameraHandler, "IMPORTANCE_FOREGROUND", "CameraHandler.kt");
assertExcludes(cameraHandler, "IMPORTANCE_FOREGROUND_SERVICE", "CameraHandler.kt");
assertExcludes(cameraHandler, "Jarvis app app", "CameraHandler.kt");
assertIncludes(pluginTemplateCamera, "IMPORTANCE_FOREGROUND", "plugins/android-daemon-native/CameraHandler.kt");
assertExcludes(pluginTemplateCamera, "IMPORTANCE_FOREGROUND_SERVICE", "plugins/android-daemon-native/CameraHandler.kt");
assertExcludes(pluginTemplateCamera, "Jarvis app app", "plugins/android-daemon-native/CameraHandler.kt");
assertIncludes(accessibilityService, '"enter"         -> pressImeAction()', "JarvisAccessibilityService.kt");
assertExcludes(accessibilityService, '"enter"         -> { pressImeAction(); true }', "JarvisAccessibilityService.kt");
assertIncludes(pluginTemplateAccessibility, '"enter"         -> pressImeAction()', "plugins/android-daemon-native/JarvisAccessibilityService.kt");
assertExcludes(pluginTemplateAccessibility, '"enter"         -> { pressImeAction(); true }', "plugins/android-daemon-native/JarvisAccessibilityService.kt");
for (const [contents, source] of [
  [accessibilityService, "JarvisAccessibilityService.kt"],
  [pluginTemplateAccessibility, "plugins/android-daemon-native/JarvisAccessibilityService.kt"],
]) {
  assertIncludes(contents, "ForegroundPackageObservation", source);
  assertIncludes(contents, "lastForegroundPackage = null", source);
  assertIncludes(contents, "launchAttemptStartedAtUptimeMs", source);
  assertIncludes(contents, "observedAtUptimeMs = event.eventTime.takeIf { it > 0L } ?: SystemClock.uptimeMillis()", source);
  assertIncludes(contents, "it.observedAtUptimeMs >= launchAttemptStartedAtUptimeMs", source);
}
for (const [contents, source] of [
  [accessibilityService, "JarvisAccessibilityService.kt"],
  [pluginTemplateAccessibility, "plugins/android-daemon-native/JarvisAccessibilityService.kt"],
  [legacyAccessibilityService, "android-daemon/JarvisAccessibilityService.kt"],
]) {
  assertIncludes(contents, "private fun isSensitiveCompactNode", source);
  assertIncludes(contents, "node.isPassword", source);
  assertIncludes(contents, "SCREEN_CONTEXT_REDACTED", source);
  assertIncludes(contents, '"one time code"', source);
  assertIncludes(contents, "private fun containsCompactPinToken", source);
  assertIncludes(contents, "fields.any { containsCompactPinToken(it) }", source);
  assertIncludes(contents, ".replace('_', ' ')", source);
  assertIncludes(contents, 'Regex("""(?i)(^|[^a-z])pin($|[^a-z])""")', source);
  assertIncludes(contents, '.put("content_desc", safeDesc)', source);
}
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
  assertIncludes(contents, "svc.launchApp(context.packageName)", source);
  assertIncludes(contents, "waitForForegroundPackage(svc, context.packageName)", source);
  assertIncludes(contents, '.put("verified", true)', source);
  assertIncludes(contents, "could not verify Jarvis reached the foreground", source);
  assertIncludes(contents, "Browser fallback: bring an existing Jarvis tab forward", source);
  assertExcludes(contents, "brought unified app to foreground", source);
  assertIncludes(contents, "resolveSharedStoragePath(context, path) ?: return privateFilePathDenied(path)", source);
  assertIncludes(contents, "resolveSharedStoragePath(context, requestedRootPath)", source);
  assertIncludes(contents, '"/data/data/$packageName"', source);
  assertIncludes(contents, "context.applicationInfo.dataDir", source);
  assertIncludes(contents, "File(path).isAbsolute", source);
  assertIncludes(contents, '"android_local_model_status" -> LocalGemmaModelManager.status(context, op)', source);
  assertIncludes(contents, '"android_local_model_validate" -> LocalGemmaModelManager.validate(context, op)', source);
  assertIncludes(contents, '"android_local_model_smoke_test" -> LocalGemmaModelManager.smokeTest(context, op)', source);
  assertIncludes(contents, '"android_local_model_generate" -> LocalGemmaModelManager.generate(context, op)', source);
  assertIncludes(contents, "val json = JSONObject(svc.readScreenContent())", source);
  assertIncludes(contents, "OpResult(true, data = svc.captureScreenContext().toJson())", source);
  assertExcludes(contents, 'path.startsWith("/") -> path', source);
}
for (const [contents, source] of [
  [localGemmaModelManager, "LocalGemmaModelManager.kt"],
  [pluginTemplateLocalGemmaModelManager, "plugins/android-daemon-native/LocalGemmaModelManager.kt"],
]) {
  assertIncludes(contents, "package com.gameplan.daemon", source);
  assertIncludes(contents, 'private const val DEFAULT_MODEL = "gemma-4-e4b-it"', source);
  assertIncludes(contents, "val modelRevision = buildModelRevision(context, model, file)", source);
  assertIncludes(contents, "LocalGemmaInferenceEngine.validate(context, model, file, modelRevision, op)", source);
  assertIncludes(contents, "LocalGemmaInferenceEngine.generate(context, model, file, modelRevision, generationOpForValidatedProfile(op, metadata))", source);
  assertIncludes(contents, "generationOpForValidatedProfile", source);
  assertIncludes(contents, "fun smokeTest(context: Context, op: JSONObject): OpResult", source);
  assertIncludes(contents, "LocalGemmaInferenceEngine.releaseWarmEngine()", source);
  assertIncludes(contents, "val validationError = if (engineValidated) null else lastEngineError ?: engineLastValidationError", source);
  assertIncludes(contents, "preserveExistingValidation", source);
  assertIncludes(contents, "sha256=$metadataSha;$fileRevision", source);
  assertIncludes(contents, "LocalGemmaInferenceEngine.cancel(op)", source);
  assertIncludes(contents, '.put("modelFileReady", modelFileReady)', source);
  assertIncludes(contents, '.put("engineBundled", true)', source);
  assertIncludes(contents, '.put("generationReady", generationReady)', source);
  assertIncludes(contents, '.put("needsEngineValidation", needsEngineValidation)', source);
  assertIncludes(contents, '.put("engineValidated", engineValidated)', source);
  assertIncludes(contents, "LOCAL_MODEL_VALIDATION_REQUIRED", source);
  assertIncludes(contents, "shouldPreserveExistingValidation(error)", source);
  assertIncludes(contents, '.put("needsEngineBundle", false)', source);
  assertExcludes(contents, "ENGINE_NOT_BUNDLED_MESSAGE", source);
  assertIncludes(contents, "context.filesDir", source);
}
assertIncludes(appBuildGradle, "com.google.ai.edge.litertlm:litertlm-android", "android/app/build.gradle");
assertIncludes(plugin, "com.google.ai.edge.litertlm:litertlm-android", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(appBuildGradle, "com.google.ai.edge.litertlm:litertlm-android:0.13.1", "android/app/build.gradle");
assertIncludes(plugin, "com.google.ai.edge.litertlm:litertlm-android:0.13.1", "plugins/withJarvisAndroidDaemon.js");
for (const [contents, source] of [
  [localGemmaInferenceEngine, "LocalGemmaInferenceEngine.kt"],
  [pluginTemplateLocalGemmaInferenceEngine, "plugins/android-daemon-native/LocalGemmaInferenceEngine.kt"],
]) {
  assertIncludes(contents, "DEFAULT_CONTEXT_TOKENS", source);
  assertIncludes(contents, "DEFAULT_ALLOW_CPU_FALLBACK = false", source);
  assertIncludes(contents, "DEFAULT_CONTEXT_TOKENS = 2048", source);
  assertIncludes(contents, "DEFAULT_MAX_COMPLETION_TOKENS = 128", source);
  assertIncludes(contents, "fun validate(context: Context, model: String, modelFile: File, modelRevision: String, op: JSONObject): OpResult", source);
  assertIncludes(contents, "LOCAL_MODEL_VALIDATION_FAILED", source);
  assertIncludes(contents, "MIN_GPU_AVAILABLE_MEMORY_BYTES", source);
  assertIncludes(contents, "MIN_CPU_AVAILABLE_MEMORY_BYTES", source);
  assertIncludes(contents, "MIN_CPU_AVAILABLE_MEMORY_BYTES = 2800L * 1024L * 1024L", source);
  assertIncludes(contents, "trimPromptForContext", source);
  assertIncludes(contents, 'put("inputTrimmed", prompt.length != rawPrompt.length)', source);
  assertIncludes(contents, 'put("defaultCpuFallbackAllowed", DEFAULT_ALLOW_CPU_FALLBACK)', source);
  assertIncludes(contents, 'put("cpuFallbackAllowed", allowCpuFallback)', source);
  assertIncludes(contents, "backendCandidates(backendName, memory, allowCpuFallback)", source);
  assertIncludes(contents, "disabled by default to avoid Android low-memory kills", source);
  assertIncludes(contents, "speculativeDecodingCandidates(preference: Boolean?): List<Boolean>", source);
  assertIncludes(contents, "ExperimentalFlags.enableSpeculativeDecoding = enableSpeculativeDecoding", source);
  assertIncludes(contents, "decodingModeName(speculativeDecodingEnabled)", source);
  assertIncludes(contents, 'failures.add("$candidateBackendName: ${decodingModeName(speculativeDecodingEnabled)}: ${formatEngineError(e)}")', source);
  assertIncludes(contents, "requestedSpeculativeDecoding = false", source);
  assertIncludes(contents, "retry_standard", source);
  assertIncludes(contents, "LOCAL_MODEL_BUSY", source);
  assertIncludes(contents, "LOCAL_MODEL_DEVICE_MEMORY_LOW", source);
  assertIncludes(contents, "keepEngineWarm", source);
  assertIncludes(contents, "releaseEngine(clearLastError = false)", source);
  assertIncludes(contents, "fun releaseWarmEngine()", source);
  assertIncludes(contents, "if (activeRequests.isNotEmpty()) return", source);
  assertIncludes(contents, "if (!keepEngineWarm || !generationSucceeded)", source);
  assertIncludes(contents, "retry_cpu", source);
  assertIncludes(contents, "generationRetries", source);
  assertIncludes(contents, "shouldRetryGenerationOnCpu", source);
  assertIncludes(contents, "SupervisorJob(job)", source);
  assertIncludes(contents, "maxNumTokens = contextTokens", source);
  assertIncludes(contents, "engineModelRevision", source);
  assertIncludes(contents, 'put("engineSpeculativeDecoding", state?.speculativeDecodingEnabled ?: JSONObject.NULL)', source);
  assertIncludes(contents, "state.modelRevision == modelRevision", source);
  assertIncludes(contents, "state.speculativeDecodingEnabled == speculativeDecodingPreference", source);
  assertIncludes(contents, "val previousEngine = lockedCurrent?.engine", source);
  assertIncludes(contents, "try { failedEngine.close() } catch (_: Throwable) {}", source);
  assertIncludes(contents, "var engine: Engine? = null", source);
  assertIncludes(contents, "configureExperimentalFlags(speculativeDecodingEnabled)", source);
  assertIncludes(contents, "val initializedEngine = Engine(", source);
  assertIncludes(contents, "EngineState(modelPath, modelRevision, candidateBackendName, speculativeDecodingEnabled, contextTokens, initializedEngine)", source);
  assertIncludes(contents, "backendCandidates(backendName, memory, allowCpuFallback)", source);
  assertIncludes(contents, "reusableBackendsFor(backendName, candidateBackends)", source);
  assertIncludes(contents, "listOf(candidateBackendName)", source);
  assertIncludes(contents, 'put("requestedBackend", active.backend)', source);
  assertIncludes(contents, 'put("lastEngineError", lastEngineError ?: JSONObject.NULL)', source);
  assertIncludes(contents, "previousEngine?.let { previous ->", source);
  assertExcludes(contents, "lockedCurrent?.engine?.close()", source);
  assertIncludes(contents, "hasReachedCompletionLimit(chunks, maxCompletionTokens)", source);
  assertIncludes(contents, 'conversation.cancelProcess()', source);
  assertIncludes(contents, '.put("finishReason", attempt.finishReason)', source);
  assertIncludes(contents, '.put("completionLimitEnforced", true)', source);
}
assertIncludes(manifest, "libOpenCL.so", "AndroidManifest.xml");
assertExcludes(plugin, "android-daemon/app", "plugins/withJarvisAndroidDaemon.js");
assertIncludes(
  plugin,
  "android-daemon-native/src/main/java/com/gameplan/daemon",
  "plugins/withJarvisAndroidDaemon.js",
);
assertIncludes(apkWorkflow, "https://github.com/${{ github.repository }}/releases/download/jarvis-app-latest/jarvis-app.apk", "build-jarvis-apk.yml");
assertIncludes(apkWorkflow, "https://github.com/${{ github.repository }}/releases/tag/jarvis-app-latest", "build-jarvis-apk.yml");
assertIncludes(apkWorkflow, '"commitSha": "${{ github.sha }}"', "build-jarvis-apk.yml");
assertIncludes(apkWorkflow, "Move latest release tag to this build", "build-jarvis-apk.yml");
assertExcludes(apkWorkflow, "battlesbudz/Gameplanjarvisai/releases", "build-jarvis-apk.yml");

console.log("OK: unified Android daemon native config is present");
