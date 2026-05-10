# Jarvis Android Daemon

An Android app that gives Jarvis autonomous control over your Android phone — open apps, browse the web, read the screen, take screenshots, tap/type, access files, snap photos/video, get GPS location, send SMS, and record your screen.

## Device Requirements

| Feature | Minimum Android |
|---|---|
| All core features (tap, type, swipe, open app, browse, read screen) | Android 8.0 (API 26) |
| **Screenshot** | **Android 11 (API 30)** — `AccessibilityService.takeScreenshot()` is not available on older versions |
| File manager access | Android 11 (API 30) — MANAGE_EXTERNAL_STORAGE |
| Boot auto-reconnect | Android 8.0 (API 26) |
| **Camera snap/clip** | **Android 8.0 (API 26)** — Camera2 API, requires CAMERA + RECORD_AUDIO grant |
| **GPS location** | **Android 8.0 (API 26)** — FusedLocationProviderClient (Play Services required) |
| **Send SMS** | **Android 8.0 (API 26)** — SEND_SMS; agent always asks for explicit user approval |
| **Screen recording** | **Android 8.0 (API 26)** — MediaProjection; one-time grant from the daemon app UI |

> The app installs on Android 8+ but screenshot will return an error on devices below Android 11.

## Build Requirements

- Android Studio Hedgehog (2023.1.1) or newer
- JDK 17
- Android SDK API 34
- Gradle 8.4

## Building the APK

### Option A: Android Studio
1. Open this folder in Android Studio
2. Wait for Gradle sync to complete
3. Go to **Build → Generate Signed Bundle / APK**
4. Select **APK** → **debug** (or create a release keystore)
5. The APK is output to `app/build/outputs/apk/`

### Option B: Command line

> **Prerequisite**: The `gradle/wrapper/gradle-wrapper.jar` binary must be present. The easiest way to generate it is to open the project in Android Studio once (it downloads the jar automatically). Alternatively, run `gradle wrapper --gradle-version 8.4` if Gradle 8.4 is installed locally.

```bash
cd android-daemon
chmod +x gradlew   # already set in git, but just in case
./gradlew assembleRelease
# APK at: app/build/outputs/apk/release/app-release.apk
```

> **Note**: The first build downloads ~500 MB of Gradle dependencies and the Android SDK. This may take several minutes.

## Installation

1. Transfer the APK to your Android phone
2. In **Settings → Apps → Special app access → Install unknown apps**, allow your file manager or browser to install APKs
3. Open the APK file and tap Install

## Setup

After installing:

1. **Open the app** — you'll see the main screen with two permission checks
2. **Enable Accessibility Service**:
   - Tap "Fix" next to Accessibility Service
   - Find "Jarvis Daemon" → "Jarvis Device Control" and enable it
   - Accept any security warnings — this is what lets Jarvis read your screen and perform taps
3. **Grant All Files Access**:
   - Tap "Fix" next to All Files Access
   - Find "Jarvis Daemon" and toggle "Allow access to manage all files"
4. **Pair with Jarvis**:
   - Enter your Jarvis server URL (e.g. `https://gameplanjarvisai.up.railway.app`)
   - In the Jarvis app, go to Profile → Connected Channels → Android Device → Pair
   - Enter the 8-character code shown in the app
   - Tap "Connect to Jarvis"

## What Jarvis Can Do

Once connected, you can tell Jarvis via Telegram or the app:

- "Open YouTube" → launches the YouTube app
- "Open this URL in Chrome" → opens a URL in the browser
- "Take a screenshot" → captures the current screen
- "What's on my screen right now?" → reads all visible text and UI elements
- "Tap the search bar" → taps at specific coordinates
- "Type 'hello world'" → types text into the focused field
- "Press home" → presses the home button
- "List files in my Downloads folder" → lists all files in Downloads
- "Read the file invoice.pdf in my Downloads" → reads the file content
- "Take a photo with the front camera" → captures a JPEG still from the selfie or rear camera
- "Record a 10-second video clip with the back camera" → records an MP4 clip up to 30 s
- "Where am I right now?" → returns GPS coordinates (lat/lng/accuracy/altitude)
- "Text John that I'll be 10 minutes late" → sends an SMS after explicit agent confirmation
- "Record my screen for the next 30 seconds" → records a MediaProjection MP4 up to 60 s (requires one-time grant from the daemon app)

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| Accessibility Service | Reads screen content, performs taps/swipes/types, takes screenshots |
| MANAGE_EXTERNAL_STORAGE | Unrestricted access to gallery, downloads, and any folder |
| FOREGROUND_SERVICE | Keeps the daemon alive as a persistent background service |
| INTERNET | WebSocket connection to the Jarvis server |
| RECEIVE_BOOT_COMPLETED | Auto-starts after device reboot (once paired) |
| CAMERA | Photo still capture and video clip recording via Camera2 API |
| RECORD_AUDIO | Audio track for camera video clips and screen recordings |
| ACCESS_FINE_LOCATION | Precise GPS fix via FusedLocationProviderClient |
| ACCESS_COARSE_LOCATION | Fallback coarse location when GPS is unavailable |
| SEND_SMS | Sends text messages (always requires agent confirmation before sending) |
| FOREGROUND_SERVICE_MEDIA_PROJECTION | Required on Android 14+ for screen recording foreground service |

## Setup — New Permissions

After updating to this version, open the Jarvis Daemon app to grant the new permissions:

1. **Camera** — tap "Grant" next to Camera; Android will prompt for permission
2. **Screen Recording** — tap "Allow" next to Screen Recording; Android will show the MediaProjection consent dialog. This must be done before Jarvis can record your screen.
3. **Location & SMS** — granted automatically via the standard Android runtime permission flow the first time Jarvis requests them

## Architecture

- **`WebSocketService`** — Foreground service that maintains the WebSocket connection to `/api/daemon/ws`, handles the pair/op/result protocol, and auto-reconnects on Wi-Fi drops
- **`JarvisAccessibilityService`** — Android Accessibility Service that reads the UI tree, performs gestures (tap/swipe), types text, presses system keys, and takes screenshots
- **`OpHandler`** — Routes incoming ops to the correct implementation (open app, browse, read file, camera, location, SMS, screen record, etc.)
- **`CameraHandler`** — Camera2 API still capture (JPEG) and video clip (MP4) with front/rear camera selection
- **`ScreenRecordHandler`** — MediaProjection-based screen recording returning base64 MP4; requires stored projection intent from MainActivity
- **`MainActivity`** — Single-screen pairing UI with permission status (including camera and screen recording grants)
- **`BootReceiver`** — Auto-starts the service after boot if the device was previously paired

## Security

- The daemon only executes ops sent by the Jarvis server after you authenticate via pairing code
- Each action type has a per-permission toggle in the Jarvis app (Profile → Connected Channels → Android Device)
- Screenshot and screen reading are on by default; tap/type requires explicit opt-in
- Camera and location are on by default; SMS is off by default and requires explicit opt-in
- Camera clips, SMS sends, and screen recordings always require an additional agent-level approval prompt before executing
- The service is not exported and cannot be controlled by other apps
