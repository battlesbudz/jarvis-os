# APK Downloads

The main Jarvis Android APK is the default Android install. It includes
integrated device control, so users do not need to install a separate daemon app.

The unified Jarvis APK update manifest is served by the Express backend at
`GET /api/app-update/android`.

## Recommended setup

1. Build and publish the main Jarvis Android APK.
2. Publish a matching `version.json` manifest for the APK.
3. Set `JARVIS_ANDROID_UPDATE_RELEASE_BASE` or
   `JARVIS_ANDROID_UPDATE_MANIFEST_URL` in the hosting environment when the
   manifest is not under the default `jarvis-app-latest` GitHub release.
4. Set `JARVIS_ANDROID_APK_URL` when the manifest does not include an `apkUrl`.

## Legacy standalone daemon

The standalone Android daemon APK is legacy. New installs should use the main Jarvis Android APK, which includes device control.

Legacy standalone daemon clients can still use `GET /api/app-update/android-daemon`
and `GET /api/download/apk` while existing installs migrate.
