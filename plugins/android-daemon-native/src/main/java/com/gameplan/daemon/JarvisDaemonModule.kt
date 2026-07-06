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
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

class JarvisDaemonModule(
    private val reactApplicationContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactApplicationContext) {

    companion object {
        private const val VOICE_SESSION_CONTROL_EVENT = "JarvisVoiceSessionControl"

        @Volatile private var activeReactContext: ReactApplicationContext? = null

        fun emitVoiceSessionControl(actionName: String, state: String) {
            val context = activeReactContext ?: return
            val payload = Arguments.createMap().apply {
                putString("action", actionName)
                putString("state", state)
                putBoolean("outsideApp", true)
            }
            context
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(VOICE_SESSION_CONTROL_EVENT, payload)
        }
    }

    override fun getName(): String = "JarvisDaemonModule"

    override fun initialize() {
        super.initialize()
        activeReactContext = reactApplicationContext
    }

    override fun invalidate() {
        if (activeReactContext === reactApplicationContext) activeReactContext = null
        super.invalidate()
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by React Native NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by React Native NativeEventEmitter.
    }

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
        if (!startServiceCompat(intent, promise)) return
        promise.resolve(buildStatusMap("Connecting..."))
    }

    @ReactMethod
    fun disconnect(promise: Promise) {
        val intent = Intent(reactApplicationContext, WebSocketService::class.java).apply {
            action = WebSocketService.ACTION_DISCONNECT
        }
        if (!startServiceCompat(intent, promise)) return
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
    fun openAssistantSettings(promise: Promise) {
        val intents = mutableListOf(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            intents.add(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
        }
        intents.add(Intent(Settings.ACTION_SETTINGS))
        openFirstAvailableIntent(intents, promise)
    }

    @ReactMethod
    fun refreshAssistantStatus(promise: Promise) {
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun startOutsideAppVoiceSession(promise: Promise) {
        val intent = OutsideAppVoiceSessionService.startIntent(reactApplicationContext)
        if (!startVoiceSessionServiceCompat(intent, promise)) return
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun pauseOutsideAppVoiceSession(promise: Promise) {
        val intent = OutsideAppVoiceSessionService.controlIntent(
            reactApplicationContext,
            OutsideAppVoiceSessionService.ACTION_PAUSE,
        )
        if (!startVoiceSessionServiceCompat(intent, promise)) return
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun resumeOutsideAppVoiceSession(promise: Promise) {
        val intent = OutsideAppVoiceSessionService.controlIntent(
            reactApplicationContext,
            OutsideAppVoiceSessionService.ACTION_RESUME,
        )
        if (!startVoiceSessionServiceCompat(intent, promise)) return
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun endOutsideAppVoiceSession(promise: Promise) {
        val intent = OutsideAppVoiceSessionService.controlIntent(
            reactApplicationContext,
            OutsideAppVoiceSessionService.ACTION_END,
        )
        if (!startVoiceSessionServiceCompat(intent, promise, foreground = false)) return
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun setOutsideAppVoiceSessionState(state: String, promise: Promise) {
        val nextState = OutsideAppVoiceState.fromWireName(state)
        val intent = OutsideAppVoiceSessionService.setStateIntent(reactApplicationContext, nextState)
        if (!startVoiceSessionServiceCompat(intent, promise)) return
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun setOutsideAppVoiceApproval(prompt: String, promise: Promise) {
        val intent = OutsideAppVoiceSessionService.setApprovalIntent(reactApplicationContext, prompt)
        if (!startVoiceSessionServiceCompat(intent, promise)) return
        promise.resolve(buildStatusMap())
    }

    @ReactMethod
    fun openOverlayPermissionSettings(promise: Promise) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${reactApplicationContext.packageName}"),
            )
        } else {
            Intent(Settings.ACTION_SETTINGS)
        }
        openIntent(intent, promise)
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

    @ReactMethod
    fun getLocalGemmaStatus(model: String, promise: Promise) {
        val result = LocalGemmaModelManager.status(
            reactApplicationContext,
            JSONObject().put("model", model),
        )
        if (result.ok) {
            promise.resolve((result.data as? JSONObject)?.toString() ?: JSONObject().toString())
        } else {
            promise.reject("E_LOCAL_GEMMA_STATUS", result.error ?: "Could not read Phone Gemma status.")
        }
    }

    @ReactMethod
    fun validateLocalGemmaModel(model: String, promise: Promise) {
        validateLocalGemmaModelWithOptions(model, JSONObject().toString(), promise)
    }

    @ReactMethod
    fun validateLocalGemmaModelWithOptions(model: String, optionsJson: String, promise: Promise) {
        val op = parseOptionsJson(optionsJson)
            .put("model", model)
        val result = LocalGemmaModelManager.validate(
            reactApplicationContext,
            op,
        )
        if (result.ok) {
            promise.resolve((result.data as? JSONObject)?.toString() ?: JSONObject().toString())
        } else {
            promise.reject("E_LOCAL_GEMMA_VALIDATE", result.error ?: "Phone Gemma validation failed.")
        }
    }

    @ReactMethod
    fun smokeTestLocalGemmaModel(model: String, optionsJson: String, promise: Promise) {
        val op = parseOptionsJson(optionsJson)
            .put("model", model)
        val result = LocalGemmaModelManager.smokeTest(reactApplicationContext, op)
        if (result.ok) {
            promise.resolve((result.data as? JSONObject)?.toString() ?: JSONObject().toString())
        } else {
            promise.reject("E_LOCAL_GEMMA_SMOKE_TEST", result.error ?: "Phone Gemma smoke test failed.")
        }
    }

    private fun parseOptionsJson(optionsJson: String): JSONObject {
        if (optionsJson.isBlank()) return JSONObject()
        return try {
            JSONObject(optionsJson)
        } catch (_: Exception) {
            JSONObject()
        }
    }

    private fun startServiceCompat(intent: Intent, promise: Promise): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            true
        } catch (err: Exception) {
            promise.reject(
                "E_JARVIS_DAEMON_START",
                "Jarvis could not start Android Device Control. Check app permissions, then try again. ${err.message ?: ""}".trim(),
                err,
            )
            false
        }
    }

    private fun startVoiceSessionServiceCompat(intent: Intent, promise: Promise, foreground: Boolean = true): Boolean {
        return try {
            if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            true
        } catch (err: Exception) {
            promise.reject(
                "E_JARVIS_VOICE_SESSION_START",
                "Jarvis could not start the outside-app voice session. Check microphone and overlay permissions, then try again. ${err.message ?: ""}".trim(),
                err,
            )
            false
        }
    }

    private fun openSettingsIntent(action: String, promise: Promise) {
        openIntent(Intent(action), promise)
    }

    private fun openFirstAvailableIntent(intents: List<Intent>, promise: Promise) {
        val resolved = intents.firstOrNull { intent ->
            intent.resolveActivity(reactApplicationContext.packageManager) != null
        } ?: intents.last()
        openIntent(resolved, promise)
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
        val hotwordStatus = JarvisAssistantState.hotwordStatus(reactApplicationContext)
        val assistantActive = JarvisAssistantState.isActiveAssistant(reactApplicationContext)
        val map = Arguments.createMap()
        map.putBoolean("available", true)
        map.putBoolean("connected", service?.isConnected == true)
        map.putString("status", statusOverride ?: service?.currentStatus ?: "Disconnected")
        map.putBoolean("accessibilityEnabled", JarvisAccessibilityService.instance != null)
        map.putBoolean("notificationListenerActive", JarvisNotificationListener.instance != null)
        map.putBoolean("assistantActive", assistantActive)
        map.putString("assistantStatus", if (assistantActive) "Active assistant" else "Not selected")
        map.putString("hotwordPhrase", hotwordStatus.phrase)
        map.putString("hotwordAvailability", hotwordStatus.availability)
        map.putString("hotwordDetail", hotwordStatus.detail)
        map.putBoolean("hotwordRecognitionActive", hotwordStatus.recognitionActive)
        map.putString("hotwordLastError", hotwordStatus.lastError)
        map.putBoolean("voiceSessionActive", OutsideAppVoiceSessionService.isActive())
        map.putString("voiceSessionState", OutsideAppVoiceSessionService.currentState().wireName)
        map.putBoolean(
            "voiceOverlayPermission",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(reactApplicationContext),
        )
        map.putString(
            "serverUrl",
            JarvisConfig.normalizeServerUrl(prefs.getString(WebSocketService.PREF_SERVER_URL, "")),
        )
        return map
    }
}
