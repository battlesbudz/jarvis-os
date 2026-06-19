const { promises: fs } = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  CodeGenerator,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
  withSettingsGradle,
  withStringsXml,
} = require("@expo/config-plugins");

const GENERATED_TAG = "jarvis-android-daemon-dependencies";
const KOTLIN_METADATA_COMPAT_TAG = "jarvis-kotlin-metadata-compat";
const BLURVIEW_PROJECT_GRADLE_TAG = "jarvis-blurview-dependency-substitution";
const BLURVIEW_SETTINGS_GRADLE_TAG = "jarvis-blurview-project-include";
const DAEMON_SOURCE_TEMPLATE_DIR = "android-daemon-native/src/main/java/com/gameplan/daemon";
const BLURVIEW_SOURCE_TEMPLATE_DIR = "android-blurview-native";

const DAEMON_GRADLE_DEPENDENCIES = [
  'implementation("org.java-websocket:Java-WebSocket:1.5.4")',
  'implementation("org.json:json:20231013")',
  'implementation("com.google.android.gms:play-services-location:21.2.0")',
  'implementation("com.google.ai.edge.litertlm:litertlm-android:0.13.1")',
  'implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")',
];

const DAEMON_XML_RESOURCES = [
  "accessibility_service_config.xml",
  "file_paths.xml",
  "interaction_service.xml",
];
const STALE_DAEMON_XML_RESOURCES = [
  "jarvis_recognition_service.xml",
];

const BLURVIEW_SETTINGS_GRADLE_SNIPPET = [
  "include ':blurview'",
  "project(':blurview').projectDir = new File(rootDir, 'third-party/blurview')",
].join("\n");

const BLURVIEW_PROJECT_GRADLE_SNIPPET = [
  "  configurations.configureEach {",
  "    resolutionStrategy.dependencySubstitution {",
  "      substitute module('com.github.Dimezis:BlurView') using project(':blurview')",
  "    }",
  "  }",
].join("\n");

const KOTLIN_METADATA_COMPAT_SNIPPET = [
  "subprojects {",
  "  tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {",
  "    kotlinOptions {",
  "      freeCompilerArgs += [\"-Xskip-metadata-version-check\"]",
  "    }",
  "  }",
  "}",
].join("\n");

const DAEMON_STRING_ITEMS = [
  {
    $: { name: "accessibility_service_label" },
    _: "Jarvis Device Control",
  },
  {
    $: { name: "accessibility_service_description" },
    _: "Allows Jarvis to read screen content, tap, type, swipe, and take screenshots on your behalf - only when you send a command through the Jarvis app or Telegram.",
  },
  {
    $: { name: "assistant_service_label" },
    _: "Jarvis Assistant",
  },
];

const DAEMON_XML_CONTENTS = {
  "accessibility_service_config.xml": `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowContentChanged|typeViewClicked"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagReportViewIds|flagRetrieveInteractiveWindows"
    android:canPerformGestures="true"
    android:canRetrieveWindowContent="true"
    android:canTakeScreenshot="true"
    android:description="@string/accessibility_service_description"
    android:notificationTimeout="100" />
`,
  "file_paths.xml": `<?xml version="1.0" encoding="utf-8"?>
<paths>
    <external-files-path name="update_apk" path="." />
    <external-path name="external_storage" path="." />
    <external-path name="dcim" path="DCIM/" />
    <external-path name="pictures" path="Pictures/" />
    <external-path name="downloads" path="Download/" />
</paths>
`,
  "interaction_service.xml": `<?xml version="1.0" encoding="utf-8"?>
<voice-interaction-service
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:sessionService="com.gameplan.daemon.JarvisVoiceInteractionSessionService"
    android:settingsActivity="com.gameplan.MainActivity"
    android:supportsAssist="true"
    android:supportsLaunchVoiceAssistFromKeyguard="true"
    android:supportsLocalInteraction="true" />
`,
};

const LEGACY_DAEMON_SERVICE_NAMES = [
  ".WebSocketService",
  ".WakeWordService",
  ".JarvisAccessibilityService",
  ".JarvisNotificationListener",
  ".daemon.JarvisRecognitionService",
];

const LEGACY_DAEMON_RECEIVER_NAMES = [
  ".BootReceiver",
];

function byAndroidName(entry) {
  return entry?.$?.["android:name"];
}

function upsertByName(items, nextItem) {
  const name = byAndroidName(nextItem);
  const index = items.findIndex((item) => byAndroidName(item) === name);
  if (index === -1) {
    items.push(nextItem);
  } else {
    items[index] = nextItem;
  }
}

function mergePermission(manifest, permission) {
  const nextPermission = { $: { ...permission.$ } };
  const permissions = (manifest.manifest["uses-permission"] ||= []);
  const index = permissions.findIndex((item) => byAndroidName(item) === byAndroidName(nextPermission));

  if (index === -1) {
    permissions.push(nextPermission);
  } else {
    permissions[index].$ = {
      ...permissions[index].$,
      ...nextPermission.$,
    };
  }
}

function getMainApplication(manifest) {
  return AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
}

function removeEntriesByName(items, namesToRemove) {
  return (items || []).filter((item) => !namesToRemove.includes(byAndroidName(item)));
}

function getDaemonServices() {
  return [
    {
      $: {
        "android:name": ".daemon.WebSocketService",
        "android:enabled": "true",
        "android:exported": "false",
        "android:foregroundServiceType": "dataSync",
      },
    },
    {
      $: {
        "android:name": ".daemon.WakeWordService",
        "android:enabled": "true",
        "android:exported": "false",
        "android:foregroundServiceType": "microphone",
      },
    },
    {
      $: {
        "android:name": ".daemon.JarvisVoiceInteractionService",
        "android:enabled": "true",
        "android:exported": "true",
        "android:label": "@string/assistant_service_label",
        "android:permission": "android.permission.BIND_VOICE_INTERACTION",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.service.voice.VoiceInteractionService",
              },
            },
          ],
        },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.voice_interaction",
            "android:resource": "@xml/interaction_service",
          },
        },
      ],
    },
    {
      $: {
        "android:name": ".daemon.JarvisVoiceInteractionSessionService",
        "android:enabled": "true",
        "android:exported": "true",
        "android:permission": "android.permission.BIND_VOICE_INTERACTION",
      },
    },
    {
      $: {
        "android:name": ".daemon.JarvisAccessibilityService",
        "android:enabled": "true",
        "android:exported": "true",
        "android:label": "@string/accessibility_service_label",
        "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.accessibilityservice.AccessibilityService",
              },
            },
          ],
        },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.accessibilityservice",
            "android:resource": "@xml/accessibility_service_config",
          },
        },
      ],
    },
    {
      $: {
        "android:name": ".daemon.JarvisNotificationListener",
        "android:enabled": "true",
        "android:exported": "true",
        "android:label": "Jarvis Notification Access",
        "android:permission": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.service.notification.NotificationListenerService",
              },
            },
          ],
        },
      ],
    },
  ];
}

function getBootReceiver() {
  return {
    $: {
      "android:name": ".daemon.BootReceiver",
      "android:enabled": "true",
      "android:exported": "true",
    },
    "intent-filter": [
      {
        $: {
          "android:priority": "1000",
        },
        action: [
          {
            $: {
              "android:name": "android.intent.action.BOOT_COMPLETED",
            },
          },
          {
            $: {
              "android:name": "android.intent.action.MY_PACKAGE_REPLACED",
            },
          },
        ],
      },
    ],
  };
}

function getFileProvider() {
  return {
    $: {
      "android:name": "androidx.core.content.FileProvider",
      "android:authorities": "${applicationId}.fileprovider",
      "android:exported": "false",
      "android:grantUriPermissions": "true",
    },
    "meta-data": [
      {
        $: {
          "android:name": "android.support.FILE_PROVIDER_PATHS",
          "android:resource": "@xml/file_paths",
        },
      },
    ],
  };
}

async function addDaemonManifestConfigAsync(config) {
  const manifest = config.modResults;
  const mainApplication = getMainApplication(manifest);

  mainApplication.$["android:allowBackup"] = "false";

  for (const permission of getDaemonPermissions()) {
    mergePermission(manifest, permission);
  }

  mainApplication.service = removeEntriesByName(mainApplication.service, LEGACY_DAEMON_SERVICE_NAMES);
  for (const service of getDaemonServices()) {
    upsertByName(mainApplication.service, service);
  }

  mainApplication.receiver = removeEntriesByName(mainApplication.receiver, LEGACY_DAEMON_RECEIVER_NAMES);
  upsertByName(mainApplication.receiver, getBootReceiver());

  mainApplication.provider ||= [];
  upsertByName(mainApplication.provider, getFileProvider());

  mainApplication["uses-native-library"] ||= [];
  upsertByName(mainApplication["uses-native-library"], {
    $: {
      "android:name": "libvndksupport.so",
      "android:required": "false",
    },
  });
  upsertByName(mainApplication["uses-native-library"], {
    $: {
      "android:name": "libOpenCL.so",
      "android:required": "false",
    },
  });

  config.modResults = manifest;
  return config;
}

async function addDaemonStringResourcesAsync(config) {
  config.modResults = AndroidConfig.Strings.setStringItem(DAEMON_STRING_ITEMS, config.modResults);
  return config;
}

function addDaemonGradleDependencies(buildGradle) {
  const dependencyBlock = DAEMON_GRADLE_DEPENDENCIES.map((dependency) => `    ${dependency}`).join("\n");
  const mergeResult = CodeGenerator.mergeContents({
    tag: GENERATED_TAG,
    src: buildGradle,
    newSrc: dependencyBlock,
    anchor: /dependencies\s*\{/,
    offset: 1,
    comment: "//",
  });

  return mergeResult.contents;
}

function addBlurViewProjectInclude(settingsGradle) {
  if (settingsGradle.includes("project(':blurview').projectDir")) {
    return settingsGradle;
  }

  const mergeResult = CodeGenerator.mergeContents({
    tag: BLURVIEW_SETTINGS_GRADLE_TAG,
    src: settingsGradle,
    newSrc: BLURVIEW_SETTINGS_GRADLE_SNIPPET,
    anchor: /include\s+['"]:app['"]/,
    offset: 1,
    comment: "//",
  });

  return mergeResult.contents;
}

function addBlurViewDependencySubstitution(buildGradle) {
  if (buildGradle.includes("substitute module('com.github.Dimezis:BlurView') using project(':blurview')")) {
    return buildGradle;
  }

  const mergeResult = CodeGenerator.mergeContents({
    tag: BLURVIEW_PROJECT_GRADLE_TAG,
    src: buildGradle,
    newSrc: BLURVIEW_PROJECT_GRADLE_SNIPPET,
    anchor: /allprojects\s*\{/,
    offset: 1,
    comment: "//",
  });

  return mergeResult.contents;
}

function addKotlinMetadataCompatibility(buildGradle) {
  if (buildGradle.includes("-Xskip-metadata-version-check")) {
    return buildGradle;
  }

  const mergeResult = CodeGenerator.mergeContents({
    tag: KOTLIN_METADATA_COMPAT_TAG,
    src: buildGradle,
    newSrc: KOTLIN_METADATA_COMPAT_SNIPPET,
    anchor: /apply plugin: "expo-root-project"/,
    offset: 0,
    comment: "//",
  });

  return mergeResult.contents;
}

function getDaemonPermissions() {
  return [
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
    { name: "android.permission.READ_EXTERNAL_STORAGE", maxSdkVersion: "32" },
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    { name: "android.permission.WRITE_EXTERNAL_STORAGE", maxSdkVersion: "29" },
    "android.permission.CAMERA",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.SEND_SMS",
    "android.permission.FOREGROUND_SERVICE_CAMERA",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
  ].map((permission) => {
    if (typeof permission === "string") {
      return { $: { "android:name": permission } };
    }
    return {
      $: {
        "android:name": permission.name,
        "android:maxSdkVersion": permission.maxSdkVersion,
      },
    };
  });
}

async function copyDirectoryAsync(sourceDir, destinationDir) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryAsync(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function copyDaemonKotlinSourcesAsync(pluginRoot, platformProjectRoot) {
  const sourceDir = path.join(pluginRoot, DAEMON_SOURCE_TEMPLATE_DIR);
  const destinationDir = path.join(platformProjectRoot, "app/src/main/java/com/gameplan/daemon");

  await copyDirectoryAsync(sourceDir, destinationDir);
}

async function copyBlurViewSourcesAsync(pluginRoot, platformProjectRoot) {
  const sourceDir = path.join(pluginRoot, BLURVIEW_SOURCE_TEMPLATE_DIR);
  const destinationDir = path.join(platformProjectRoot, "third-party/blurview");

  await fs.rm(destinationDir, { recursive: true, force: true });
  await copyDirectoryAsync(sourceDir, destinationDir);
}

async function copyDaemonXmlResourcesAsync(platformProjectRoot) {
  const destinationDir = path.join(platformProjectRoot, "app/src/main/res/xml");

  await fs.mkdir(destinationDir, { recursive: true });

  for (const fileName of STALE_DAEMON_XML_RESOURCES) {
    await fs.rm(path.join(destinationDir, fileName), { force: true });
  }

  for (const fileName of DAEMON_XML_RESOURCES) {
    await fs.writeFile(path.join(destinationDir, fileName), DAEMON_XML_CONTENTS[fileName], "utf8");
  }
}

async function patchMainApplicationAsync(platformProjectRoot) {
  const mainApplicationPath = path.join(platformProjectRoot, "app/src/main/java/com/gameplan/MainApplication.kt");
  let contents = await fs.readFile(mainApplicationPath, "utf8");

  if (!contents.includes("import com.gameplan.daemon.JarvisDaemonPackage")) {
    contents = contents.replace(
      "import com.facebook.react.defaults.DefaultReactNativeHost\n",
      "import com.facebook.react.defaults.DefaultReactNativeHost\nimport com.gameplan.daemon.JarvisDaemonPackage\n",
    );
  }

  if (!contents.includes("add(JarvisDaemonPackage())")) {
    contents = contents.replace(
      /(PackageList\(this\)\.packages\.apply\s*\{\r?\n)/,
      "$1              add(JarvisDaemonPackage())\n",
    );
  }

  await fs.writeFile(mainApplicationPath, contents, "utf8");
}

async function patchMainActivityAsync(platformProjectRoot) {
  const mainActivityPath = path.join(platformProjectRoot, "app/src/main/java/com/gameplan/MainActivity.kt");
  let contents = await fs.readFile(mainActivityPath, "utf8");

  if (!contents.includes("import android.content.Intent")) {
    contents = contents.replace(
      "import expo.modules.splashscreen.SplashScreenManager\n\n",
      "import expo.modules.splashscreen.SplashScreenManager\n\nimport android.content.Intent\n",
    );
  }
  if (!contents.includes("import android.app.KeyguardManager")) {
    contents = contents.replace(
      "import android.content.Intent\n",
      "import android.app.KeyguardManager\nimport android.content.Intent\n",
    );
  }
  if (!contents.includes("import android.content.Context")) {
    contents = contents.replace(
      "import android.content.Intent\n",
      "import android.content.Context\nimport android.content.Intent\n",
    );
  }
  if (!contents.includes("import android.view.WindowManager")) {
    contents = contents.replace(
      "import android.os.Bundle\n",
      "import android.os.Bundle\nimport android.view.WindowManager\n",
    );
  }
  if (!contents.includes("import android.os.Handler")) {
    contents = contents.replace(
      "import android.os.Bundle\n",
      "import android.os.Bundle\nimport android.os.Handler\n",
    );
  }
  if (!contents.includes("import android.os.Looper")) {
    contents = contents.replace(
      "import android.os.Handler\n",
      "import android.os.Handler\nimport android.os.Looper\n",
    );
  }
  if (!contents.includes("import com.gameplan.daemon.JarvisAssistantLauncher")) {
    contents = contents.replace(
      "import com.facebook.react.defaults.DefaultReactActivityDelegate\n",
      "import com.facebook.react.defaults.DefaultReactActivityDelegate\nimport com.gameplan.daemon.JarvisAssistantLauncher\n",
    );
  }
  if (!contents.includes("assistantKeyguardVisibilityHandler")) {
    contents = contents.replace(
      /class MainActivity : ReactActivity\(\) \{\r?\n/,
      "class MainActivity : ReactActivity() {\n  private val assistantKeyguardVisibilityHandler = Handler(Looper.getMainLooper())\n  private val clearAssistantKeyguardVisibilityWhenUnlocked = object : Runnable {\n      override fun run() {\n          clearAssistantKeyguardVisibilityIfUnlocked()\n      }\n  }\n  private var assistantKeyguardVisibilityActive = false\n\n",
    );
  }
  contents = contents.replace(
    /override fun onNewIntent\(intent: Intent\?\)/g,
    "override fun onNewIntent(intent: Intent)",
  );
  contents = contents.replace(
    /      val showWhenLocked =\r?\n          intent\?\.getBooleanExtra\(JarvisAssistantLauncher\.EXTRA_SHOW_WHEN_LOCKED, false\) == true \|\|\r?\n          intent\?\.data\?\.getQueryParameter\("source"\) == "keyguard"/g,
    "      val showWhenLocked = JarvisAssistantLauncher.shouldShowWhenLocked(this, intent)",
  );
  contents = contents.replace(
    /      val uri = intent\?\.data\r?\n      val isKeyguardDeepLink =\r?\n          if \(uri == null \|\| !uri\.isHierarchical\) \{\r?\n              false\r?\n          \} else \{\r?\n              uri\.getQueryParameter\("source"\) == "keyguard"\r?\n          \}\r?\n      val showWhenLocked =\r?\n          intent\?\.getBooleanExtra\(JarvisAssistantLauncher\.EXTRA_SHOW_WHEN_LOCKED, false\) == true \|\|\r?\n          isKeyguardDeepLink/g,
    "      val showWhenLocked = JarvisAssistantLauncher.shouldShowWhenLocked(this, intent)",
  );
  if (!contents.includes("applyAssistantKeyguardVisibility(intent)")) {
    contents = contents.replace(
      "    SplashScreenManager.registerOnActivity(this)\n    // @generated end expo-splashscreen\n    super.onCreate(null)\n",
      "    SplashScreenManager.registerOnActivity(this)\n    // @generated end expo-splashscreen\n    applyAssistantKeyguardVisibility(intent)\n    super.onCreate(null)\n",
    );
  }
  if (!contents.includes("override fun onNewIntent(intent: Intent)")) {
    contents = contents.replace(
      /(  }\r?\n)(\r?\n  \/\*\*\r?\n   \* Returns the name of the main component)/,
      "$1\n  override fun onNewIntent(intent: Intent) {\n    super.onNewIntent(intent)\n    setIntent(intent)\n    applyAssistantKeyguardVisibility(intent)\n  }\n$2",
    );
  }
  const onResumeFunction = "  override fun onResume() {\n    super.onResume()\n    clearAssistantKeyguardVisibilityIfUnlocked()\n  }\n";
  const onDestroyFunction = "  override fun onDestroy() {\n    assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)\n    super.onDestroy()\n  }\n";
  contents = contents.replace(
    /^([ \t]*)override fun onResume\(\) \{[\s\S]*?^\1\}/m,
    (method, indent) => {
      const bodyIndent = `${indent}    `;
      if (method.includes("clearAssistantKeyguardVisibilityIfUnlocked()")) {
        return method;
      }
      if (method.includes("super.onResume()")) {
        return method.replace(
          /(super\.onResume\(\)\r?\n)/,
          `$1${bodyIndent}clearAssistantKeyguardVisibilityIfUnlocked()\n`,
        );
      }
      return method.replace(
        /(override fun onResume\(\) \{\r?\n)/,
        `$1${bodyIndent}clearAssistantKeyguardVisibilityIfUnlocked()\n`,
      );
    },
  );
  if (!contents.includes("override fun onResume()")) {
    contents = contents.replace(
      /(\r?\n  \/\*\*\r?\n   \* Returns the name of the main component)/,
      `\n${onResumeFunction}$1`,
    );
  }
  contents = contents.replace(
    /^([ \t]*)override fun onDestroy\(\) \{[\s\S]*?^\1\}/m,
    (method, indent) => {
      const bodyIndent = `${indent}    `;
      if (method.includes("assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)")) {
        return method;
      }
      if (method.includes("super.onDestroy()")) {
        return method.replace(
          /(super\.onDestroy\(\)\r?\n)/,
          `${bodyIndent}assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)\n$1`,
        );
      }
      return method.replace(
        /(override fun onDestroy\(\) \{\r?\n)/,
        `$1${bodyIndent}assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)\n`,
      );
    },
  );
  if (!contents.includes("override fun onDestroy()")) {
    contents = contents.replace(
      /(\r?\n  \/\*\*\r?\n   \* Returns the name of the main component)/,
      `\n${onDestroyFunction}$1`,
    );
  }
  const assistantKeyguardApplyFunction = `  private fun applyAssistantKeyguardVisibility(intent: Intent?) {
      val showWhenLocked = JarvisAssistantLauncher.shouldShowWhenLocked(this, intent)
      setAssistantKeyguardVisibility(showWhenLocked)
      if (showWhenLocked) {
          scheduleKeyguardVisibilityClear()
      } else {
          assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)
      }
  }`;
  const assistantKeyguardHelperFunctions = `  private fun setAssistantKeyguardVisibility(showWhenLocked: Boolean) {
      assistantKeyguardVisibilityActive = showWhenLocked
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          setShowWhenLocked(showWhenLocked)
          setTurnScreenOn(showWhenLocked)
      } else if (showWhenLocked) {
          window.addFlags(
              WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          )
      } else {
          window.clearFlags(
              WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          )
      }
  }

  private fun scheduleKeyguardVisibilityClear() {
      assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)
      assistantKeyguardVisibilityHandler.postDelayed(clearAssistantKeyguardVisibilityWhenUnlocked, 1_000L)
  }

  private fun clearAssistantKeyguardVisibilityIfUnlocked() {
      if (!assistantKeyguardVisibilityActive) {
          return
      }
      if (isDeviceKeyguardLocked()) {
          scheduleKeyguardVisibilityClear()
          return
      }
      assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)
      setAssistantKeyguardVisibility(false)
  }

  private fun isDeviceKeyguardLocked(): Boolean {
      val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      return keyguardManager?.isKeyguardLocked == true
  }`;
  contents = contents.replace(
    /^  private fun applyAssistantKeyguardVisibility\(intent: Intent\?\) \{[\s\S]*?^  \}/m,
    assistantKeyguardApplyFunction,
  );
  if (!contents.includes("private fun applyAssistantKeyguardVisibility(intent: Intent?)")) {
    contents = contents.replace(
      /\r?\n}\s*$/,
      `\n\n${assistantKeyguardApplyFunction}\n\n${assistantKeyguardHelperFunctions}\n}\n`,
    );
  } else if (!contents.includes("private fun setAssistantKeyguardVisibility(showWhenLocked: Boolean)")) {
    contents = contents.replace(
      /\r?\n}\s*$/,
      `\n\n${assistantKeyguardHelperFunctions}\n}\n`,
    );
  }

  await fs.writeFile(mainActivityPath, contents, "utf8");
}

const withJarvisAndroidDaemon = (config) => {
  config = withAndroidManifest(config, addDaemonManifestConfigAsync);
  config = withStringsXml(config, addDaemonStringResourcesAsync);

  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("Jarvis Android daemon config requires a Groovy android/app/build.gradle file.");
    }

    config.modResults.contents = addDaemonGradleDependencies(config.modResults.contents);
    return config;
  });

  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("Jarvis Android daemon config requires a Groovy android/build.gradle file.");
    }

    config.modResults.contents = addKotlinMetadataCompatibility(
      addBlurViewDependencySubstitution(config.modResults.contents),
    );
    return config;
  });

  config = withSettingsGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("Jarvis Android daemon config requires a Groovy android/settings.gradle file.");
    }

    config.modResults.contents = addBlurViewProjectInclude(config.modResults.contents);
    return config;
  });

  config = withDangerousMod(config, [
    "android",
    async (config) => {
      await copyBlurViewSourcesAsync(__dirname, config.modRequest.platformProjectRoot);
      await copyDaemonKotlinSourcesAsync(__dirname, config.modRequest.platformProjectRoot);
      await copyDaemonXmlResourcesAsync(config.modRequest.platformProjectRoot);
      await patchMainApplicationAsync(config.modRequest.platformProjectRoot);
      await patchMainActivityAsync(config.modRequest.platformProjectRoot);
      return config;
    },
  ]);

  return config;
};

module.exports = createRunOncePlugin(
  withJarvisAndroidDaemon,
  "withJarvisAndroidDaemon",
  "1.0.0",
);
