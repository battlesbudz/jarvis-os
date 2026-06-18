package com.gameplan.daemon

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.util.Log
import com.gameplan.MainActivity

object JarvisAssistantState {
    private const val PREF_ASSISTANT_HOTWORD_STATUS = "assistant_hotword_status"
    private const val PREF_ASSISTANT_HOTWORD_DETAIL = "assistant_hotword_detail"
    private const val PREF_ASSISTANT_HOTWORD_RECOGNITION_ACTIVE = "assistant_hotword_recognition_active"
    private const val PREF_ASSISTANT_HOTWORD_LAST_ERROR = "assistant_hotword_last_error"
    const val HOTWORD_PHRASE = "Hey Jarvis"

    fun component(context: Context): ComponentName {
        return ComponentName(context, JarvisVoiceInteractionService::class.java)
    }

    fun isActiveAssistant(context: Context): Boolean {
        return try {
            VoiceInteractionService.isActiveService(context, component(context))
        } catch (_: Throwable) {
            false
        }
    }

    fun updateHotwordStatus(
        context: Context,
        status: String,
        detail: String,
        recognitionActive: Boolean = false,
        lastError: String? = null,
    ) {
        context.getSharedPreferences(WebSocketService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_ASSISTANT_HOTWORD_STATUS, status)
            .putString(PREF_ASSISTANT_HOTWORD_DETAIL, detail)
            .putBoolean(PREF_ASSISTANT_HOTWORD_RECOGNITION_ACTIVE, recognitionActive)
            .putString(PREF_ASSISTANT_HOTWORD_LAST_ERROR, lastError)
            .apply()
        DaemonLog.add("assistant_hotword: $status - $detail")
    }

    fun hotwordStatus(context: Context): AssistantHotwordStatus {
        val prefs = context.getSharedPreferences(WebSocketService.PREFS_NAME, Context.MODE_PRIVATE)
        return AssistantHotwordStatus(
            phrase = HOTWORD_PHRASE,
            availability = prefs.getString(PREF_ASSISTANT_HOTWORD_STATUS, "not_checked") ?: "not_checked",
            detail = prefs.getString(
                PREF_ASSISTANT_HOTWORD_DETAIL,
                "Choose Jarvis as the Android assistant, then reopen this screen.",
            ) ?: "Choose Jarvis as the Android assistant, then reopen this screen.",
            recognitionActive = prefs.getBoolean(PREF_ASSISTANT_HOTWORD_RECOGNITION_ACTIVE, false),
            lastError = prefs.getString(PREF_ASSISTANT_HOTWORD_LAST_ERROR, null),
        )
    }
}

data class AssistantHotwordStatus(
    val phrase: String,
    val availability: String,
    val detail: String,
    val recognitionActive: Boolean,
    val lastError: String?,
)

object JarvisAssistantLauncher {
    const val EXTRA_SHOW_WHEN_LOCKED = "com.gameplan.daemon.SHOW_WHEN_LOCKED"

    fun voiceIntent(context: Context, source: String): Intent {
        val uri = Uri.parse("jarvis://voice-realtime?source=$source")
        return Intent(Intent.ACTION_VIEW, uri).apply {
            setPackage(context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("source", source)
            if (source == "keyguard") {
                putExtra(EXTRA_SHOW_WHEN_LOCKED, true)
            }
        }
    }

    fun fallbackMainIntent(context: Context, source: String): Intent {
        return Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("jarvis://voice-realtime?source=$source")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("source", source)
            if (source == "keyguard") {
                putExtra(EXTRA_SHOW_WHEN_LOCKED, true)
            }
        }
    }
}

class JarvisVoiceInteractionService : VoiceInteractionService() {
    companion object {
        private const val TAG = "JarvisAssistant"
    }

    override fun onReady() {
        super.onReady()
        JarvisAssistantState.updateHotwordStatus(
            this,
            status = "probing",
            detail = "Jarvis is the active assistant. Checking Android DSP hotword support.",
        )
        probeSystemHotwordSupport()
    }

    override fun onShutdown() {
        JarvisAssistantState.updateHotwordStatus(
            this,
            status = "inactive",
            detail = "Jarvis is not currently bound as the Android assistant.",
        )
        super.onShutdown()
    }

    override fun onLaunchVoiceAssistFromKeyguard() {
        showJarvisSession("keyguard")
    }

    fun showJarvisSession(source: String) {
        val args = Bundle().apply {
            putString("source", source)
            putString("phrase", JarvisAssistantState.HOTWORD_PHRASE)
        }
        try {
            showSession(args, 0)
        } catch (err: Throwable) {
            Log.w(TAG, "showSession failed; launching activity directly", err)
            try {
                startActivity(JarvisAssistantLauncher.fallbackMainIntent(this, source))
            } catch (fallbackErr: Throwable) {
                DaemonLog.add("assistant: unable to open Jarvis voice UI: ${fallbackErr.message}")
            }
        }
    }

    private fun probeSystemHotwordSupport() {
        val detectorClass = try {
            Class.forName("android.service.voice.AlwaysOnHotwordDetector")
        } catch (err: ClassNotFoundException) {
            JarvisAssistantState.updateHotwordStatus(
                this,
                status = "system_api_blocked",
                detail = "Android hides DSP hotword APIs from this APK. Use the assistant gesture while Jarvis checks privileged options.",
                lastError = err.message,
            )
            return
        }

        val detectorCallbackClass = try {
            Class.forName("android.service.voice.AlwaysOnHotwordDetector\$Callback")
        } catch (err: ClassNotFoundException) {
            JarvisAssistantState.updateHotwordStatus(
                this,
                status = "system_api_blocked",
                detail = "Android exposes the detector class but hides the callback API from this APK.",
                lastError = err.message,
            )
            return
        }

        val createDetectorMethod = VoiceInteractionService::class.java.methods.firstOrNull { method ->
            method.name == "createAlwaysOnHotwordDetector" &&
                method.parameterTypes.any { it == detectorCallbackClass }
        }

        if (createDetectorMethod == null) {
            JarvisAssistantState.updateHotwordStatus(
                this,
                status = "system_api_blocked",
                detail = "This Android SDK does not expose createAlwaysOnHotwordDetector to Jarvis.",
                lastError = detectorClass.name,
            )
            return
        }

        try {
            JarvisAssistantState.updateHotwordStatus(
                this,
                status = "privileged_required",
                detail = "Android exposes a DSP hotword hook, but using it requires a system/privileged callback implementation.",
                lastError = createDetectorMethod.toGenericString(),
            )
        } catch (err: SecurityException) {
            JarvisAssistantState.updateHotwordStatus(
                this,
                status = "permission_blocked",
                detail = "Android blocked DSP hotword access for this install.",
                lastError = err.message,
            )
        } catch (err: UnsupportedOperationException) {
            JarvisAssistantState.updateHotwordStatus(
                this,
                status = "unsupported",
                detail = "This device build does not expose a compatible system hotword detector.",
                lastError = err.message,
            )
        } catch (err: Throwable) {
            JarvisAssistantState.updateHotwordStatus(
                this,
                status = "error",
                detail = "Could not create the Android system hotword detector.",
                lastError = err.message,
            )
        }
    }
}

class JarvisVoiceInteractionSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return JarvisVoiceInteractionSession(this)
    }
}

class JarvisVoiceInteractionSession(context: Context) : VoiceInteractionSession(context) {
    override fun onPrepareShow(args: Bundle?, showFlags: Int) {
        super.onPrepareShow(args, showFlags)
        setUiEnabled(false)
    }

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        closeSystemDialogs()
        val source = args?.getString("source") ?: "assistant"
        try {
            startAssistantActivity(JarvisAssistantLauncher.voiceIntent(context, source))
        } catch (err: Throwable) {
            Log.w("JarvisAssistant", "startAssistantActivity failed", err)
            context.startActivity(JarvisAssistantLauncher.fallbackMainIntent(context, source))
        } finally {
            finish()
        }
    }
}
