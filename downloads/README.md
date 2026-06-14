# APK Downloads

The Jarvis Android Daemon APK is served from this directory by the Express backend
at `GET /api/download/apk` (no authentication required).

## How the endpoint resolves the APK

1. **Local file** — if `downloads/jarvis-daemon.apk` exists on the server
   filesystem, it is streamed directly to the client.
2. **Remote fallback** — if `ANDROID_APK_URL` environment variable is set,
   the endpoint redirects (HTTP 302) to that URL. Use this for GitHub Releases
   or any other hosted URL.
3. **404** — if neither is available, the endpoint returns an error.

## Recommended setup

### Option A — GitHub Releases (no local file needed)

1. Push this project to GitHub.
2. The workflow at `.github/workflows/build-android-apk.yml` builds the APK on
   every push to `main` that touches `android-daemon/` and publishes it under the
   tag `android-daemon-latest`.
3. Set the `ANDROID_APK_URL` secret/environment variable in your hosting platform to:
   ```
   https://github.com/<your-org>/<your-repo>/releases/download/android-daemon-latest/jarvis-daemon.apk
   ```
4. The in-app "Download APK" button and QR code immediately start working.

### Option B — Build locally and place here

```bash
# Requires JDK 17 and Android SDK
cd android-daemon
chmod +x gradlew
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release*.apk ../downloads/jarvis-daemon.apk
```

The backend picks up the file automatically on the next request (no restart needed).
