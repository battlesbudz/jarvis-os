# Android Main App Daemon Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one Jarvis Android APK where the main Jarvis app owns the current Android daemon foreground service, permissions, pairing, wake word, screen context, operator actions, local model ops, and reconnect behavior.

**Architecture:** Keep the existing server `/api/daemon/ws` protocol and Android `android_*` op contract intact, but move the native daemon implementation into the main Expo Android package `com.gameplan`. The React Native app becomes the setup and control UI, while a native Android module starts/stops the foreground service, reports status, opens permission settings, and stores reconnect credentials inside the main app sandbox. The old standalone `com.jarvis.daemon` APK becomes migration-only and can be removed after the unified APK is paired.

**Tech Stack:** Expo SDK 54 / React Native 0.81, Expo prebuild native Android project, Kotlin Android services, Android AccessibilityService, ForegroundService, NotificationListenerService, MediaProjection, Camera2, FusedLocationProviderClient, Java-WebSocket, existing Jarvis Express daemon bridge and Node test suite.

---

## Scope Check

This is one vertical feature with three coupled subsystems:

- Native Android packaging: create/own the checked-in `android/` project for the Expo app.
- Daemon runtime migration: port daemon Kotlin services and resources from `android-daemon/` into the app package.
- Product surface cleanup: replace "install the daemon app" copy with "enable device control in this app" while keeping the server-side daemon bridge stable.

Do not change model-provider routing as part of this plan. Android local Gemma remains a first-class selected provider, and daemon control-plane connectivity must stay separate from the selected LLM runtime.

## Important Migration Constraint

The standalone daemon currently installs as `com.jarvis.daemon`; the main app installs as `com.gameplan`. Android app private storage cannot be migrated directly between those package names without a deliberate export/import handshake. The safe rollout is:

1. Release a final standalone daemon build that tells users to open/update the main Jarvis app.
2. In the main app, show an "Integrated device control" setup card.
3. Require one fresh pair action from the main app.
4. After the unified service is connected, tell the user the old Jarvis Daemon app can be uninstalled.

## File Structure

Create or modify these files:

- Create `android/`: generated Expo native Android project committed to the repo.
- Create `android/app/src/main/java/com/gameplan/daemon/`: unified daemon Kotlin package, ported from `android-daemon/app/src/main/java/com/jarvis/daemon/`.
- Create `android/app/src/main/java/com/gameplan/daemon/JarvisDaemonModule.kt`: React Native bridge for pairing, reconnect, disconnect, status, permission helpers, and update checks.
- Create `android/app/src/main/java/com/gameplan/daemon/JarvisDaemonPackage.kt`: registers the native module.
- Modify `android/app/src/main/AndroidManifest.xml`: merge daemon permissions, services, receiver, provider, queries, foreground service types, and intent filters into the main app manifest.
- Modify `android/app/build.gradle`: add daemon dependencies and Kotlin compile settings needed by the ported classes.
- Copy/adapt `android-daemon/app/src/main/res/xml/*`, `res/drawable/*`, `res/mipmap/*` only where needed for accessibility config, FileProvider paths, notification icons, and service resources.
- Modify `app.json`: add config plugin or native-project ownership note so future prebuilds do not wipe daemon changes.
- Create `plugins/withJarvisAndroidDaemon.js`: Expo config plugin that re-applies manifest permissions/services and Gradle dependencies if prebuild is run again.
- Create `lib/android-daemon-native.ts`: typed JS wrapper around the native module with web/iOS no-op guards.
- Create `components/androidDaemon/AndroidDeviceControlCard.tsx`: unified setup/status/permissions card for the main app.
- Modify `app/(tabs)/profile.tsx`: replace standalone daemon install/pair instructions with the unified card and keep per-action permission toggles.
- Modify `app/(tabs)/settings.tsx`: replace standalone daemon copy in Android provider/setup areas with integrated-service copy.
- Modify `lib/app-update.ts`: treat `/api/app-update/android` as the unified Jarvis APK update source; stop sending main-app users to standalone daemon update flows.
- Modify `server/routes/appUpdateRoutes.ts`: mark `/api/app-update/android-daemon` as legacy and keep it only for old standalone daemon clients.
- Modify `server/channels/coachAgent.ts`: update no-daemon guidance from "install the Android daemon APK" to "open Jarvis app, enable Android device control, pair from Profile."
- Modify `server/daemon/bridge.ts`: keep protocol stable, but improve connected-device metadata so unified Android app and legacy standalone daemon can be distinguished.
- Create `server/agent/__tests__/androidUnifiedDaemonCopy.assert.ts`: guards user-facing copy against telling unified app users to install a separate daemon.
- Create `server/agent/__tests__/androidUnifiedDaemonBridge.assert.ts`: source-level/server tests for metadata, platform routing, and permission preservation.
- Create `android/app/src/test/java/com/gameplan/daemon/UnifiedDaemonContractTest.kt`: JVM tests for status serialization, op parsing, and reconnect state helpers.
- Create `docs/operations/android-unified-daemon-release.md`: release and migration checklist.

## Task 1: Native Android Ownership

**Files:**
- Create: `android/`
- Modify: `app.json`
- Create: `plugins/withJarvisAndroidDaemon.js`
- Modify: `package.json`

- [x] **Step 1: Commit or park unrelated dirty docs work**

Before execution, inspect:

```powershell
git status --short
```

Expected: only existing unrelated docs/public-docs changes are present. Do not modify or revert them.

- [x] **Step 2: Generate the Expo Android project**

Run:

```powershell
npx.cmd expo prebuild --platform android
```

Expected: `android/` exists with `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, and Expo React Native application classes.

- [x] **Step 3: Add daemon config plugin registration**

Modify `app.json` plugins so it includes the daemon plugin after existing Expo plugins:

```json
"plugins": [
  [
    "expo-router",
    {
      "origin": "https://gameplanjarvisai.up.railway.app/"
    }
  ],
  "expo-font",
  "expo-web-browser",
  "./plugins/withJarvisAndroidDaemon"
]
```

- [x] **Step 4: Create config plugin**

Create `plugins/withJarvisAndroidDaemon.js` with logic that:

- Adds Android permissions from `android-daemon/app/src/main/AndroidManifest.xml`.
- Adds service declarations for `WebSocketService`, `WakeWordService`, `JarvisAccessibilityService`, and `JarvisNotificationListener`.
- Adds `BootReceiver`.
- Adds FileProvider metadata using authority `${applicationId}.fileprovider`.
- Adds Gradle dependencies:
  - `org.java-websocket:Java-WebSocket:1.5.4`
  - `org.json:json:20231013`
  - `com.google.android.gms:play-services-location:21.2.0`

Use `@expo/config-plugins` helpers, not string replacement.

- [x] **Step 5: Add a verification script**

Add `scripts/android-unified-daemon-config-check.mjs` and package script:

```json
"jarvis:android-daemon:config-check": "node scripts/android-unified-daemon-config-check.mjs"
```

The script should read `android/app/src/main/AndroidManifest.xml` and `android/app/build.gradle`, then assert the service names, key permissions, and dependencies are present.

- [x] **Step 6: Verify**

Run:

```powershell
npm.cmd run jarvis:android-daemon:config-check
```

Expected: `OK: unified Android daemon native config is present`.

## Task 2: Port Native Daemon Runtime Into Main App

**Files:**
- Create: `android/app/src/main/java/com/gameplan/daemon/*.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Copy/adapt: `android/app/src/main/res/xml/accessibility_service_config.xml`
- Copy/adapt: `android/app/src/main/res/xml/file_paths.xml`

- [x] **Step 1: Copy Kotlin source into the main app package**

Port the current daemon classes from:

```text
android-daemon/app/src/main/java/com/jarvis/daemon/
```

to:

```text
android/app/src/main/java/com/gameplan/daemon/
```

Change package declarations from:

```kotlin
package com.jarvis.daemon
```

to:

```kotlin
package com.gameplan.daemon
```

Keep these classes:

- `WebSocketService`
- `OpHandler`
- `JarvisAccessibilityService`
- `JarvisNotificationListener`
- `BootReceiver`
- `JarvisConfig`
- `NotificationHelper`
- `CameraHandler`
- `ScreenRecordHandler`
- `WakeWordService`
- `ScreenContextEngine`
- `ScreenContextModels`
- `OperatorAction`
- `OperatorActionExecutor`
- `LocalGemmaModelManager` if present in the current branch

- [x] **Step 2: Remove standalone launcher assumptions**

Do not port `MainActivity.kt` as the app launcher. The Expo app already owns the launcher.

If a native permission screen is still needed, create:

```text
android/app/src/main/java/com/gameplan/daemon/DaemonPermissionActivity.kt
```

This activity should only open Android permission panels and return to the React Native app. It must not duplicate the full pairing UI.

- [x] **Step 3: Preserve op behavior**

Keep `OpHandler.handle(context, op)` behavior for all existing ops:

- `android_open_app`
- `android_browse`
- `android_screenshot`
- `android_read_screen`
- `android_screen_context`
- `android_operator_action`
- `android_tap`
- `android_type`
- `android_swipe`
- `android_pinch`
- `android_press_key`
- `android_file_list`
- `android_file_read`
- `android_notifications_list`
- `android_notification_reply`
- `android_file_search`
- `android_open_file`
- `android_copy_to_clipboard`
- `android_camera_snap`
- `android_camera_clip`
- `android_location_get`
- `android_sms_send`
- `android_screen_record`
- `android_view_hierarchy`
- `android_paste_text`
- `android_get_focused_field`
- `android_clear_field`
- `android_start_training`
- `android_get_display_size`
- `voice_set_wake_words`
- `voice_set_talk_mode`
- `voice_tts_finished`
- `voice_speak_audio`

- [x] **Step 4: Add native contract tests**

Create `android/app/src/test/java/com/gameplan/daemon/UnifiedDaemonContractTest.kt` covering:

- `OpHandler` rejects unknown op type with `ok=false`.
- `JarvisConfig.normalizeServerUrl("gameplanjarvisai.up.railway.app")` returns `https://gameplanjarvisai.up.railway.app`.
- reconnect state keys remain `daemon_id` and `reconnect_secret`.
- local model path helper, if present, stores under `filesDir/local_models/<safe-model-id>/model.bin`.

- [ ] **Step 5: Run JVM tests**

Run:

```powershell
cd android
.\gradlew.bat :app:testDebugUnitTest
```

Expected: tests pass. If Gradle wrapper is unavailable, open the generated project once in Android Studio or run the same task in EAS/CI and record the blocker.

Task 2 note: local execution reached Gradle but is blocked in this environment because no Android SDK path is configured (`ANDROID_HOME` / `android/local.properties` missing). Re-run after installing/configuring the Android SDK or via EAS/CI.

## Task 3: React Native Bridge And Unified Setup UI

**Files:**
- Create: `android/app/src/main/java/com/gameplan/daemon/JarvisDaemonModule.kt`
- Create: `android/app/src/main/java/com/gameplan/daemon/JarvisDaemonPackage.kt`
- Create: `lib/android-daemon-native.ts`
- Create: `components/androidDaemon/AndroidDeviceControlCard.tsx`
- Modify: `app/(tabs)/profile.tsx`

- [ ] **Step 1: Add native module methods**

Expose these methods from `JarvisDaemonModule`:

```kotlin
@ReactMethod fun getStatus(promise: Promise)
@ReactMethod fun connect(serverUrl: String, pairCode: String, promise: Promise)
@ReactMethod fun disconnect(promise: Promise)
@ReactMethod fun openAccessibilitySettings(promise: Promise)
@ReactMethod fun openNotificationListenerSettings(promise: Promise)
@ReactMethod fun openAllFilesAccessSettings(promise: Promise)
@ReactMethod fun requestCameraPermission(promise: Promise)
@ReactMethod fun requestMicrophonePermission(promise: Promise)
@ReactMethod fun requestScreenRecordPermission(promise: Promise)
```

`connect()` should start `WebSocketService` with `ACTION_CONNECT`, `EXTRA_SERVER_URL`, and `EXTRA_PAIR_CODE`.

- [ ] **Step 2: Add TypeScript wrapper**

Create `lib/android-daemon-native.ts`:

```ts
import { NativeModules, Platform } from "react-native";

type AndroidDaemonStatus = {
  available: boolean;
  connected: boolean;
  status: string;
  accessibilityEnabled: boolean;
  notificationListenerActive: boolean;
  serverUrl?: string;
};

const NativeJarvisDaemon = NativeModules.JarvisDaemonModule as
  | {
      getStatus(): Promise<AndroidDaemonStatus>;
      connect(serverUrl: string, pairCode: string): Promise<AndroidDaemonStatus>;
      disconnect(): Promise<AndroidDaemonStatus>;
      openAccessibilitySettings(): Promise<void>;
      openNotificationListenerSettings(): Promise<void>;
      openAllFilesAccessSettings(): Promise<void>;
      requestCameraPermission(): Promise<void>;
      requestMicrophonePermission(): Promise<void>;
      requestScreenRecordPermission(): Promise<void>;
    }
  | undefined;

export async function getAndroidDaemonStatus(): Promise<AndroidDaemonStatus> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon) {
    return { available: false, connected: false, status: "Unavailable", accessibilityEnabled: false, notificationListenerActive: false };
  }
  return NativeJarvisDaemon.getStatus();
}

export const AndroidDaemonNative = NativeJarvisDaemon;
```

- [ ] **Step 3: Build setup card**

`components/androidDaemon/AndroidDeviceControlCard.tsx` should:

- Fetch `/api/channels/daemon/code`.
- Show the 8-character pair code.
- Call `AndroidDaemonNative.connect(getApiUrl(), code)`.
- Show permission rows for Accessibility, Notifications, All Files, Camera, Microphone, and Screen Recording.
- Show a connected state when both server channel status and native service status are healthy.
- Keep existing Android per-action permission toggles from `profile.tsx`.

- [ ] **Step 4: Replace standalone install copy**

In `app/(tabs)/profile.tsx`, replace the Android Device section that says to install/open the daemon app with the new card.

Allowed copy:

```text
Enable Android device control in this Jarvis app.
```

Disallowed copy in the unified path:

```text
Install the Jarvis Daemon APK
Open the daemon app
Transfer the APK
```

- [ ] **Step 5: Add copy guard test**

Create `server/agent/__tests__/androidUnifiedDaemonCopy.assert.ts` that reads `app/(tabs)/profile.tsx`, `app/(tabs)/settings.tsx`, and `server/channels/coachAgent.ts`.

Assert:

- unified copy includes `Enable Android device control in this Jarvis app`
- unified copy does not include `Install the Jarvis Daemon APK`
- no-daemon coach guidance tells the user to open Jarvis app Profile, not build/install a separate APK

## Task 4: Server Metadata And Backward Compatibility

**Files:**
- Modify: `server/daemon/bridge.ts`
- Modify: `server/channels/coachAgent.ts`
- Modify: `server/routes/appUpdateRoutes.ts`
- Create: `server/agent/__tests__/androidUnifiedDaemonBridge.assert.ts`

- [ ] **Step 1: Preserve platform routing**

Do not rename the daemon channel or WebSocket path. The unified app should still send:

```json
{ "type": "pair", "code": "ABCDEFGH", "platform": "android", "hostname": "<device model>" }
```

Server routing must still send `android_*` and `voice_*` ops only to the Android socket.

- [ ] **Step 2: Add client metadata**

Update the pair/reconnect message parsing to accept optional metadata:

```ts
clientKind?: "unified_android_app" | "standalone_android_daemon" | "desktop_daemon";
appPackage?: string;
appVersion?: string;
```

Record these under `channel_links.metadata.android_client`.

- [ ] **Step 3: Preserve permissions**

Keep `metadata.android_permissions` exactly where it is today. Existing user permission toggles must survive reconnects and fresh unified app pairing.

- [ ] **Step 4: Make legacy update explicit**

In `server/routes/appUpdateRoutes.ts`:

- `/api/app-update/android` remains the main Jarvis APK manifest.
- `/api/app-update/android-daemon` remains available for old standalone daemon clients.
- Add a `legacy: true` field to the daemon response.
- Add `migrationTarget: "/api/app-update/android"` to the daemon response.

- [ ] **Step 5: Add server tests**

Create `server/agent/__tests__/androidUnifiedDaemonBridge.assert.ts` to assert:

- `sendDaemonOp()` still identifies `android_*` ops as Android-only.
- Android permissions mapping still includes `android_screen_context -> android_read_screen`.
- `android_operator_action` still derives nested permission via `operatorActionPermKey`.
- bridge source records `clientKind`, `appPackage`, and `appVersion`.
- app update route source marks `android-daemon` as legacy.

## Task 5: Local Model And Selected Runtime Integrity

**Files:**
- Modify only if needed: `server/agent/providers/androidLocalGemma.ts`
- Modify only if needed: `server/agent/modelRouter.ts`
- Modify only if needed: `shared/modelProviderCatalog.ts`
- Modify only if needed: `server/agent/__tests__/modelRouter.assert.ts`
- Modify only if needed: `server/agent/__tests__/providerRuntimeAdapters.assert.ts`

- [ ] **Step 1: Confirm no routing changes are needed**

Run:

```powershell
rg -n "android-local-gemma|android_local_model|LocalGemma" shared server android-daemon android
```

Expected: Android local Gemma remains a provider selected through `modelPrefs.chat`, not an implicit daemon fallback.

- [ ] **Step 2: Keep selected model as source of truth**

If any code tries to use the unified daemon as the active LLM just because the phone is connected, remove that behavior. The correct rule is:

```text
Connected Android device = control plane available.
Selected Android Local Gemma model = LLM runtime available.
```

- [ ] **Step 3: Preserve fail-closed local generation**

Until native Gemma inference is actually bundled, Android local generation must keep returning the visible fail-closed error from `LocalGemmaModelManager` instead of silently falling back to desktop daemon, Codex OAuth, or Gemini.

- [ ] **Step 4: Run provider tests**

Run:

```powershell
npm.cmd test
```

Expected: catalog, router, runtime adapter, and auth/default-model tests pass.

## Task 6: Release And Migration UX

**Files:**
- Modify: `lib/app-update.ts`
- Modify: `server/routes/appUpdateRoutes.ts`
- Create: `docs/operations/android-unified-daemon-release.md`
- Modify: `downloads/README.md`

- [ ] **Step 1: Update app update behavior**

`lib/app-update.ts` should use `/api/app-update/android` for the unified Jarvis APK. It should not point main app users to `/api/app-update/android-daemon`.

- [ ] **Step 2: Document migration**

Create `docs/operations/android-unified-daemon-release.md` with this checklist:

```md
# Android Unified Daemon Release Checklist

- [ ] Build unified Jarvis APK.
- [ ] Install on physical Android device.
- [ ] Log in to Jarvis.
- [ ] Open Profile -> Android Device.
- [ ] Generate pair code.
- [ ] Start integrated device control from the main app.
- [ ] Grant Accessibility Service.
- [ ] Grant Notification Access.
- [ ] Grant All Files Access.
- [ ] Verify `/api/channels/status` reports `android_daemon_connected: true`.
- [ ] Run `daemon_action` smoke ops: ping, read screen, screenshot, open app.
- [ ] Verify tap/type remains blocked until Android tap/type permission is enabled.
- [ ] Enable tap/type and run one operator action with explicit approval.
- [ ] Reboot the phone and verify boot reconnect.
- [ ] Confirm the old standalone Jarvis Daemon app can be uninstalled.
```

- [ ] **Step 3: Update download docs**

`downloads/README.md` should describe one Android APK as the default install. Keep a short legacy note:

```text
The standalone Android daemon APK is legacy. New installs should use the main Jarvis Android APK, which includes device control.
```

## Task 7: End-To-End Verification

**Files:**
- No new files unless a bug is found during verification.

- [ ] **Step 1: Static checks**

Run:

```powershell
git diff --check
npm.cmd run jarvis:android-daemon:config-check
npm.cmd test
npm.cmd run server:build
```

Expected:

- no whitespace errors
- daemon config check passes
- Node test suite passes
- server build passes

- [ ] **Step 2: Android build**

Run one of:

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

or:

```powershell
npm.cmd run android:apk
```

Expected: APK builds successfully. If local Gradle is unavailable, use EAS build and attach the build URL to the closeout.

- [ ] **Step 3: Physical device smoke**

On a real Android device:

1. Install the unified APK.
2. Log in.
3. Open Profile -> Android Device.
4. Tap Enable Android device control.
5. Grant Accessibility Service.
6. Pair with the generated code.
7. Verify connected status in the app.

- [ ] **Step 4: Server op smoke**

From Jarvis chat or a controlled test harness, run:

- `android_read_screen`
- `android_screenshot`
- `android_open_app`
- `android_screen_context`
- `android_operator_action` with a safe `wait` or `done` action

Expected: ops are handled by the unified app socket. No op should require the standalone `com.jarvis.daemon` app.

- [ ] **Step 5: Permission smoke**

Verify:

- screenshot/read screen work with read permissions enabled
- tap/type is blocked when `android_tap_type` is disabled
- tap/type works only after user enables the permission and approves the specific action
- SMS still requires both Android runtime permission and agent-level approval

- [ ] **Step 6: Reboot reconnect**

Reboot the Android device.

Expected:

- `BootReceiver` starts `WebSocketService`.
- service reconnects using stored `daemon_id` and `reconnect_secret`.
- server status returns `android_daemon_connected: true`.

## Commit Plan

Use small commits:

1. `chore: add expo android native project`
2. `feat(android): port daemon runtime into main app`
3. `feat(android): add unified daemon native bridge`
4. `feat(android): replace standalone daemon setup UI`
5. `feat(server): track unified android daemon clients`
6. `docs(android): add unified daemon release checklist`

## Acceptance Criteria

- One installed Jarvis Android app can do all work the standalone daemon did.
- The standalone daemon APK is not required for new Android installs.
- Existing server daemon tools and permission gates continue to work.
- Android local Gemma remains an explicit selected provider, not an automatic fallback.
- Reconnect survives app restart and device reboot.
- The old standalone daemon path remains legacy-compatible long enough to migrate users.
- Verification includes server tests, Android build evidence, and at least one physical-device smoke run.
