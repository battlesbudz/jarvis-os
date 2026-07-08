package com.gameplan.daemon

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.util.Locale

class NativeSpeechRecognitionBridge(
    private val reactContext: ReactApplicationContext,
) {
    companion object {
        const val EVENT_NAME = "JarvisNativeSpeechRecognition"
        private const val DEFAULT_TIMEOUT_MS = 60_000L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var speechRecognizer: SpeechRecognizer? = null
    private var listening = false
    private var generation = 0

    fun getStatus(localeTag: String?): WritableMap = buildStatusMap(localeTag)

    fun start(options: JSONObject, promise: Promise) {
        runOnMain {
            try {
                val localeTag = options.optString("locale", "")
                val interimResults = options.optBoolean("interimResults", true)
                val timeoutMs = options.optLong("timeoutMs", DEFAULT_TIMEOUT_MS).coerceAtLeast(5_000L)

                if (!hasRecordAudioPermission()) {
                    promise.reject(
                        "E_NATIVE_STT_PERMISSION",
                        "Microphone permission is required for Android on-device speech recognition.",
                    )
                    return@runOnMain
                }
                if (!supportsOnDeviceRecognitionApi()) {
                    promise.reject(
                        "E_NATIVE_STT_UNSUPPORTED_ANDROID",
                        "This Android version does not expose on-device speech recognition to Jarvis.",
                    )
                    return@runOnMain
                }
                if (!isOnDeviceRecognitionAvailable()) {
                    promise.reject(
                        "E_NATIVE_STT_UNAVAILABLE",
                        "On-device speech recognition is not available. Install or update Google Speech Services and download an offline language pack.",
                    )
                    return@runOnMain
                }

                cancelRecognizer(emitCancelled = false)
                val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(reactContext)
                speechRecognizer = recognizer
                listening = true
                val startGeneration = ++generation

                recognizer.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        if (!isCurrent(startGeneration)) return
                        emit("ready") {
                            putString("locale", resolveLocaleTag(localeTag))
                        }
                    }

                    override fun onBeginningOfSpeech() {
                        if (!isCurrent(startGeneration)) return
                        emit("speech_start")
                    }

                    override fun onRmsChanged(rmsdB: Float) {
                        if (!isCurrent(startGeneration)) return
                        emit("rms") {
                            putDouble("rmsDb", rmsdB.toDouble())
                        }
                    }

                    override fun onBufferReceived(buffer: ByteArray?) = Unit

                    override fun onEndOfSpeech() {
                        if (!isCurrent(startGeneration)) return
                        emit("speech_end")
                    }

                    override fun onError(error: Int) {
                        if (!isCurrent(startGeneration)) return
                        val name = errorName(error)
                        cleanupRecognizer(startGeneration)
                        emit("error") {
                            putInt("errorCode", error)
                            putString("error", name)
                            putString("message", errorMessage(error))
                            putBoolean("recoverable", isRecoverableError(error))
                        }
                    }

                    override fun onResults(results: Bundle?) {
                        if (!isCurrent(startGeneration)) return
                        val best = bestResult(results)
                        val alternatives = resultAlternatives(results)
                        cleanupRecognizer(startGeneration)
                        emit("final") {
                            putString("text", best)
                            putArray("alternatives", alternatives)
                        }
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        if (!isCurrent(startGeneration)) return
                        val best = bestResult(partialResults)
                        if (best.isBlank()) return
                        emit("partial") {
                            putString("text", best)
                            putArray("alternatives", resultAlternatives(partialResults))
                        }
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) = Unit
                })

                recognizer.startListening(buildRecognizerIntent(localeTag, interimResults))
                mainHandler.postDelayed({
                    if (!isCurrent(startGeneration) || !listening) return@postDelayed
                    speechRecognizer?.stopListening()
                }, timeoutMs)

                promise.resolve(buildStatusMap(localeTag).apply {
                    putBoolean("listening", true)
                })
            } catch (err: Throwable) {
                cancelRecognizer(emitCancelled = false)
                promise.reject(
                    "E_NATIVE_STT_START",
                    "Could not start Android on-device speech recognition. ${err.message ?: ""}".trim(),
                    err,
                )
            }
        }
    }

    fun stop(promise: Promise) {
        runOnMain {
            try {
                if (!listening) {
                    promise.resolve(buildStatusMap(null))
                    return@runOnMain
                }
                speechRecognizer?.stopListening()
                promise.resolve(buildStatusMap(null).apply {
                    putBoolean("listening", true)
                    putString("status", "stopping")
                })
            } catch (err: Throwable) {
                promise.reject("E_NATIVE_STT_STOP", err.message, err)
            }
        }
    }

    fun cancel(promise: Promise) {
        runOnMain {
            try {
                cancelRecognizer(emitCancelled = true)
                promise.resolve(buildStatusMap(null))
            } catch (err: Throwable) {
                promise.reject("E_NATIVE_STT_CANCEL", err.message, err)
            }
        }
    }

    fun triggerModelDownload(localeTag: String?, promise: Promise) {
        runOnMain {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                promise.reject(
                    "E_NATIVE_STT_MODEL_DOWNLOAD_UNSUPPORTED",
                    "Android speech model downloads require Android 13 or newer.",
                )
                return@runOnMain
            }
            if (!supportsOnDeviceRecognitionApi()) {
                promise.reject(
                    "E_NATIVE_STT_UNSUPPORTED_ANDROID",
                    "This Android version does not expose on-device speech recognition to Jarvis.",
                )
                return@runOnMain
            }
            var downloadRecognizer: SpeechRecognizer? = null
            try {
                downloadRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(reactContext)
                downloadRecognizer.triggerModelDownload(buildRecognizerIntent(localeTag, interimResults = false))
                emit("model_download_requested") {
                    putString("locale", resolveLocaleTag(localeTag))
                }
                promise.resolve(buildStatusMap(localeTag).apply {
                    putBoolean("modelDownloadScheduled", true)
                })
            } catch (err: Throwable) {
                promise.reject(
                    "E_NATIVE_STT_MODEL_DOWNLOAD",
                    "Could not request an Android speech model download. ${err.message ?: ""}".trim(),
                    err,
                )
            } finally {
                try {
                    downloadRecognizer?.destroy()
                } catch (_: Throwable) {
                }
            }
        }
    }

    fun destroy() {
        runOnMain {
            cancelRecognizer(emitCancelled = false)
        }
    }

    private fun buildRecognizerIntent(localeTag: String?, interimResults: Boolean): Intent {
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interimResults)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            val language = resolveLocaleTag(localeTag)
            if (language.isNotBlank()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
        }
    }

    private fun buildStatusMap(localeTag: String?): WritableMap {
        val supportsApi = supportsOnDeviceRecognitionApi()
        val onDeviceAvailable = supportsApi && isOnDeviceRecognitionAvailable()
        val speechRecognitionAvailable = try {
            SpeechRecognizer.isRecognitionAvailable(reactContext)
        } catch (_: Throwable) {
            false
        }
        val hasMic = hasRecordAudioPermission()
        val map = Arguments.createMap()
        map.putBoolean("available", supportsApi && onDeviceAvailable && hasMic)
        map.putBoolean("speechRecognitionAvailable", speechRecognitionAvailable)
        map.putBoolean("onDeviceRecognitionAvailable", onDeviceAvailable)
        map.putBoolean("microphonePermissionGranted", hasMic)
        map.putBoolean("ttsAvailable", true)
        map.putString("ttsProvider", "android-system")
        map.putString("locale", resolveLocaleTag(localeTag))
        map.putString(
            "status",
            when {
                !hasMic -> "missing_microphone_permission"
                !supportsApi -> "unsupported_android_version"
                !onDeviceAvailable -> "on_device_recognition_unavailable"
                else -> "ready"
            },
        )
        map.putString(
            "message",
            when {
                !hasMic -> "Microphone permission is required for local Android speech recognition."
                !supportsApi -> "This Android version does not expose on-device speech recognition to Jarvis."
                !onDeviceAvailable -> "Install or update Google Speech Services and download an offline language pack."
                else -> "Android local STT and device TTS are ready."
            },
        )
        return map
    }

    private fun supportsOnDeviceRecognitionApi(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    private fun isOnDeviceRecognitionAvailable(): Boolean {
        return try {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(reactContext)
        } catch (_: Throwable) {
            false
        }
    }

    private fun hasRecordAudioPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            reactContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    private fun bestResult(results: Bundle?): String {
        return results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.trim()
            ?: ""
    }

    private fun resultAlternatives(results: Bundle?) =
        Arguments.createArray().apply {
            results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.forEach { value ->
                    val trimmed = value.trim()
                    if (trimmed.isNotBlank()) pushString(trimmed)
                }
        }

    private fun cleanupRecognizer(startGeneration: Int) {
        if (!isCurrent(startGeneration)) return
        try {
            speechRecognizer?.destroy()
        } catch (_: Throwable) {
        }
        speechRecognizer = null
        listening = false
    }

    private fun cancelRecognizer(emitCancelled: Boolean) {
        generation += 1
        listening = false
        try {
            speechRecognizer?.cancel()
        } catch (_: Throwable) {
        }
        try {
            speechRecognizer?.destroy()
        } catch (_: Throwable) {
        }
        speechRecognizer = null
        if (emitCancelled) emit("cancelled")
    }

    private fun isCurrent(startGeneration: Int): Boolean =
        listening && startGeneration == generation

    private fun emit(type: String, block: WritableMap.() -> Unit = {}) {
        val payload = Arguments.createMap()
        payload.putString("type", type)
        payload.putBoolean("onDevice", true)
        payload.block()
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_NAME, payload)
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private fun resolveLocaleTag(localeTag: String?): String {
        val trimmed = localeTag?.trim().orEmpty()
        if (trimmed.isBlank()) return Locale.getDefault().toLanguageTag()
        return Locale.forLanguageTag(trimmed).toLanguageTag()
    }

    private fun isRecoverableError(error: Int): Boolean {
        return error == SpeechRecognizer.ERROR_NO_MATCH ||
            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ||
            error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
            error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ||
            error == SpeechRecognizer.ERROR_TOO_MANY_REQUESTS
    }

    private fun errorName(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "audio"
        SpeechRecognizer.ERROR_CLIENT -> "client"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "insufficient_permissions"
        SpeechRecognizer.ERROR_NETWORK -> "network"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network_timeout"
        SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer_busy"
        SpeechRecognizer.ERROR_SERVER -> "server"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "speech_timeout"
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "too_many_requests"
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "server_disconnected"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "language_not_supported"
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language_unavailable"
        SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT -> "cannot_check_support"
        else -> "unknown"
    }

    private fun errorMessage(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH -> "No speech was detected. Please try again and speak clearly."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I did not hear anything. Please try again."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Android speech recognition is busy. Please try again."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required for speech recognition."
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "This language is not supported by Android on-device speech recognition."
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "This language pack is not available for Android on-device speech recognition."
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "Android speech recognition is rate-limiting requests. Please wait a moment."
        else -> "Android on-device speech recognition failed: ${errorName(error)}."
    }
}
