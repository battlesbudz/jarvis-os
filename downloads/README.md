# Jarvis OS APK Downloads

The main Jarvis Android APK is the default Android install. It includes
integrated device control, so new users do not need to install a separate daemon
app.

Do not commit private signing keys, generated keystores, or locally built APKs
unless the release process explicitly requires a public artifact.

## Main App APK

The workflow at `.github/workflows/build-jarvis-apk.yml` builds the main Jarvis
Android app and publishes:

- `jarvis-app.apk`
- `version.json`

The unified Jarvis APK update manifest is served by the Express backend at:

```text
GET /api/app-update/android
```

The workflow requires:

- GitHub repository variable `JARVIS_PUBLIC_DOMAIN`
- signing secrets for the Jarvis app keystore
- a valid Expo/Android build environment

Recommended release setup:

1. Build and publish the main Jarvis Android APK.
2. Publish a matching `version.json` manifest for the APK.
3. Set `JARVIS_ANDROID_UPDATE_RELEASE_BASE` or
   `JARVIS_ANDROID_UPDATE_MANIFEST_URL` in the hosting environment when the
   manifest is not under the default `jarvis-app-latest` GitHub release.
4. Set `JARVIS_ANDROID_APK_URL` when the manifest does not include an `apkUrl`.

## Legacy Standalone Daemon

The standalone Android daemon APK is legacy. New installs should use the main
Jarvis Android APK, which includes device control.

Legacy standalone daemon clients can still use these endpoints while existing
installs migrate:

```text
GET /api/app-update/android-daemon
GET /api/download/apk
```

Legacy daemon APK resolution order:

1. Local file: if `downloads/jarvis-daemon.apk` exists on the server filesystem,
   it is streamed directly.
2. Remote fallback: if `ANDROID_APK_URL` is set, the endpoint redirects to that
   URL. Use this for GitHub Releases or another hosted artifact.
3. 404: if neither is available, the endpoint returns an error.

## Install Matrix

| Artifact | Used For | Build Path | Hosted By |
|---|---|---|---|
| `jarvis-app.apk` | Main Jarvis mobile app with device control | `.github/workflows/build-jarvis-apk.yml` | GitHub Release `jarvis-app-latest` |
| `jarvis-daemon.apk` | Legacy standalone Android device-control daemon | `.github/workflows/build-android-apk.yml` | GitHub Release `android-daemon-latest` |

## Safety Notes

- APKs control user-facing software. Only publish artifacts built from reviewed
  commits.
- Android device-control permissions are high-risk. Any permission change needs
  focused tests and explicit release notes.
- Keep signing credentials in GitHub secrets or your build provider, never in
  source control.
