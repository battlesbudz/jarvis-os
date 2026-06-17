package com.gameplan.daemon

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

class JarvisDaemonModule(
    private val reactApplicationContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactApplicationContext) {

    override fun getName(): String = "JarvisDaemonModule"

    @ReactMethod
    fun getStatus(promise: Promise) {
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun enable(serverUrl: String, bootstrapToken: String, promise: Promise) {
        if (serverUrl.isBlank()) {
            promise.reject("E_JARVIS_DAEMON_SERVER_URL", "Server URL is required.")
            return
        }
        if (bootstrapToken.isBlank()) {
            promise.reject("E_JARVIS_DAEMON_BOOTSTRAP_TOKEN", "Bootstrap token is required.")
            return
        }

        val intent = Intent(reactApplicationContext, WebSocketService::class.java).apply {
            action = WebSocketService.ACTION_BOOTSTRAP
            putExtra(WebSocketService.EXTRA_SERVER_URL, serverUrl)
            putExtra(WebSocketService.EXTRA_BOOTSTRAP_TOKEN, bootstrapToken)
        }
        startServiceCompat(intent)
        promise.resolve(buildStatusMap("Connecting..."))
    }

    @ReactMethod
    fun disconnect(promise: Promise) {
        val intent = Intent(reactApplicationContext, WebSocketService::class.java).apply {
            action = WebSocketService.ACTION_DISCONNECT
        }
        startServiceCompat(intent)
        promise.resolve(buildStatusMap("Disconnected"))
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        openSettingsIntent(Settings.ACTION_ACCESSIBILITY_SETTINGS, promise)
    }

    @ReactMethod
    fun openNotificationListenerSettings(promise: Promise) {
        openSettingsIntent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, promise)
    }

    @ReactMethod
    fun openAllFilesAccessSettings(promise: Promise) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:${reactApplicationContext.packageName}"),
            )
        } else {
            Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
        }
        openIntent(intent, promise)
    }

    @ReactMethod
    fun requestCameraPermission(promise: Promise) {
        openAppDetailsSettings(promise)
    }

    @ReactMethod
    fun requestMicrophonePermission(promise: Promise) {
        openAppDetailsSettings(promise)
    }

    @ReactMethod
    fun requestScreenRecordPermission(promise: Promise) {
        promise.reject(
            "E_JARVIS_DAEMON_SCREEN_RECORD_SETUP",
            "Screen recording requires a foreground Activity result flow and is not available from this bridge yet.",
        )
    }

    private fun startServiceCompat(intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactApplicationContext.startForegroundService(intent)
        } else {
            reactApplicationContext.startService(intent)
        }
    }

    private fun openSettingsIntent(action: String, promise: Promise) {
        openIntent(Intent(action), promise)
    }

    private fun openAppDetailsSettings(promise: Promise) {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:${reactApplicationContext.packageName}"),
        )
        openIntent(intent, promise)
    }

    private fun openIntent(intent: Intent, promise: Promise) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
            promise.resolve(null)
        } catch (err: Exception) {
            promise.reject("E_JARVIS_DAEMON_SETTINGS", err.message, err)
        }
    }

    private fun buildStatusMap(statusOverride: String? = null): WritableMap {
        val prefs = reactApplicationContext.getSharedPreferences(
            WebSocketService.PREFS_NAME,
            Context.MODE_PRIVATE,
        )
        val service = WebSocketService.instance
        val map = Arguments.createMap()
        map.putBoolean("available", true)
        map.putBoolean("connected", service?.isConnected == true)
        map.putString("status", statusOverride ?: service?.currentStatus ?: "Disconnected")
        map.putBoolean("accessibilityEnabled", JarvisAccessibilityService.instance != null)
        map.putBoolean("notificationListenerActive", JarvisNotificationListener.instance != null)
        map.putString(
            "serverUrl",
            JarvisConfig.normalizeServerUrl(prefs.getString(WebSocketService.PREF_SERVER_URL, "")),
        )
        return map
    }
}
