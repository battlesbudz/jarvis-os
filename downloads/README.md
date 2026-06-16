# Jarvis OS APK Downloads

Jarvis can serve Android APK links for two different clients:

- **Jarvis App APK:** the main Expo/Android app.
- **Jarvis Android Daemon APK:** the optional device-control companion app.

Do not commit private signing keys, generated keystores, or locally built APKs unless the release process explicitly requires a public artifact.

## Android Daemon Endpoint

The Express backend serves the Android daemon APK at:

```text
GET /api/download/apk
```

Resolution order:

1. **Local file:** if `downloads/jarvis-daemon.apk` exists on the server filesystem, it is streamed directly.
2. **Remote fallback:** if `ANDROID_APK_URL` is set, the endpoint redirects to that URL. Use this for GitHub Releases or another hosted artifact.
3. **404:** if neither is available, the endpoint returns an error.

## Recommended Daemon Release Setup

### Option A - GitHub Releases

1. Push this project to GitHub.
2. The workflow at `.github/workflows/build-android-apk.yml` builds the daemon APK on pushes to `main` that touch `android-daemon/`.
3. It publishes the artifact under the `android-daemon-latest` release tag.
4. Set `ANDROID_APK_URL` in your hosting platform:

   ```text
   https://github.com/battlesbudz/jarvis-os/releases/download/android-daemon-latest/jarvis-daemon.apk
   ```

   Forks should replace `battlesbudz/jarvis-os` with their own repository path.

5. The in-app daemon download button and QR code can now resolve the APK.

### Option B - Local Build

```bash
# Requires JDK 17 and Android SDK
cd android-daemon
chmod +x gradlew
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release*.apk ../downloads/jarvis-daemon.apk
```

The backend picks up the file automatically on the next request.

## Main App APK

The workflow at `.github/workflows/build-jarvis-apk.yml` builds the main Jarvis Android app and publishes:

- `jarvis-app.apk`
- `version.json`

The workflow requires:

- GitHub repository variable `JARVIS_PUBLIC_DOMAIN`
- signing secrets for the Jarvis app keystore
- a valid Expo/Android build environment

## Install Matrix

| Artifact | Used For | Build Path | Hosted By |
|---|---|---|---|
| `jarvis-app.apk` | Main Jarvis mobile app | `.github/workflows/build-jarvis-apk.yml` | GitHub Release `jarvis-app-latest` |
| `jarvis-daemon.apk` | Optional Android device-control daemon | `.github/workflows/build-android-apk.yml` | GitHub Release `android-daemon-latest` |

## Safety Notes

- APKs control user-facing software. Only publish artifacts built from reviewed commits.
- Android daemon permissions are high-risk. Any permission change needs focused tests and explicit release notes.
- Keep signing credentials in GitHub secrets or your build provider, never in source control.
