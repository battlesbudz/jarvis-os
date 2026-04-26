package com.jarvis.daemon

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.Locale

/**
 * Persistent foreground service that listens for wake words using Android's SpeechRecognizer.
 *
 * When a configured wake phrase ("Hey Jarvis", "Jarvis", "Computer") is detected in the
 * recognised text, it fires a `wake_word_triggered` event over the daemon WebSocket so the
 * server can initiate a voice session immediately.
 *
 * Also supports Talk Mode: when the server signals that TTS playback has finished
 * (via the `voice_tts_finished` op) the mic is automatically re-armed so the next
 * utterance is captured without any tapping.
 *
 * Requires:
 *   - RECORD_AUDIO permission (must be granted at runtime on Android 6+)
 *   - FOREGROUND_SERVICE_TYPE_MICROPHONE declared in AndroidManifest (Android 12+)
 */
class WakeWordService : Service() {

    companion object {
        private const val TAG = "JarvisWake"
        private const val CHANNEL_ID = "jarvis_wake_word"
        private const val NOTIFICATION_ID = 1002

        const val ACTION_START = "com.jarvis.daemon.WAKE_WORD_START"
        const val ACTION_STOP = "com.jarvis.daemon.WAKE_WORD_STOP"
        const val ACTION_UPDATE = "com.jarvis.daemon.WAKE_WORD_UPDATE"
        const val EXTRA_WAKE_WORDS = "wake_words"
        const val EXTRA_TALK_MODE = "talk_mode"

        @Volatile var instance: WakeWordService? = null
            private set

        /**
         * Called by OpHandler when TTS audio finishes playing.
         * Re-arms the microphone when Talk Mode is on.
         */
        fun onTtsFinished() {
            instance?.handleTtsFinished()
        }
    }

    // ── State ────────────────────────────────────────────────────────────────

    private var speechRecognizer: SpeechRecognizer? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var wakeWords: List<String> = listOf("hey jarvis", "jarvis", "computer")
    private var talkModeEnabled = false
    private var active = false

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        when (intent?.action ?: ACTION_START) {
            ACTION_START -> {
                val words = intent?.getStringArrayExtra(EXTRA_WAKE_WORDS)
                if (!words.isNullOrEmpty()) wakeWords = words.map { it.lowercase(Locale.US) }
                talkModeEnabled = intent?.getBooleanExtra(EXTRA_TALK_MODE, false) ?: false
                startListening()
            }
            ACTION_UPDATE -> {
                val words = intent?.getStringArrayExtra(EXTRA_WAKE_WORDS)
                if (!words.isNullOrEmpty()) wakeWords = words.map { it.lowercase(Locale.US) }
                talkModeEnabled = intent?.getBooleanExtra(EXTRA_TALK_MODE, talkModeEnabled) ?: talkModeEnabled
                DaemonLog.add("wake: words updated to [${wakeWords.joinToString()}] talkMode=$talkModeEnabled")
                if (!active) startListening()
            }
            ACTION_STOP -> {
                stopListening()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        instance = null
        stopListening()
        super.onDestroy()
    }

    // ── SpeechRecognizer ────────────────────────────────────────────────────

    private fun startListening() {
        if (active) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            DaemonLog.add("wake: SpeechRecognizer not available on this device")
            return
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
            checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            DaemonLog.add("wake: RECORD_AUDIO permission not granted — cannot start wake word detection")
            // Broadcast so the UI can prompt the user
            val intent = Intent("com.jarvis.daemon.WAKE_WORD_PERMISSION_DENIED")
            intent.setPackage(packageName)
            sendBroadcast(intent)
            return
        }
        mainHandler.post {
            try {
                speechRecognizer?.destroy()
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this@WakeWordService)
                speechRecognizer?.setRecognitionListener(listener)
                beginRecognizing()
                active = true
                DaemonLog.add("wake: listening started — phrases: [${wakeWords.joinToString()}]")
            } catch (e: Exception) {
                Log.e(TAG, "startListening failed", e)
                DaemonLog.add("wake: startListening error: ${e.message}")
            }
        }
    }

    private fun stopListening() {
        active = false
        mainHandler.post {
            try {
                speechRecognizer?.stopListening()
                speechRecognizer?.destroy()
                speechRecognizer = null
            } catch (e: Exception) {
                Log.e(TAG, "stopListening error", e)
            }
        }
    }

    private fun beginRecognizing() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
        }
        speechRecognizer?.startListening(intent)
    }

    private fun restartRecognizer(delayMs: Long = 300) {
        if (!active) return
        mainHandler.postDelayed({
            if (!active) return@postDelayed
            try {
                speechRecognizer?.destroy()
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this@WakeWordService)
                speechRecognizer?.setRecognitionListener(listener)
                beginRecognizing()
            } catch (e: Exception) {
                Log.e(TAG, "restartRecognizer failed", e)
                DaemonLog.add("wake: restart error: ${e.message}")
                restartRecognizer(3000)
            }
        }, delayMs)
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            val label = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "timeout"
                SpeechRecognizer.ERROR_AUDIO -> "audio"
                SpeechRecognizer.ERROR_NETWORK -> "network"
                SpeechRecognizer.ERROR_CLIENT -> "client"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer_busy"
                SpeechRecognizer.ERROR_SERVER -> "server"
                else -> "error_$error"
            }
            // no_match and timeout are normal during silence — restart silently
            if (active && error != SpeechRecognizer.ERROR_CLIENT) {
                val delay = if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) 2000L else 300L
                restartRecognizer(delay)
            } else if (active) {
                DaemonLog.add("wake: recognition error: $label")
                restartRecognizer(1000)
            }
        }

        override fun onResults(results: Bundle?) {
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: emptyList<String>()
            val found = checkForWakeWord(matches)
            if (!found && active) restartRecognizer(100)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: emptyList<String>()
            checkForWakeWord(matches)
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    // ── Wake word detection ──────────────────────────────────────────────────

    private fun checkForWakeWord(results: List<String>): Boolean {
        val transcript = results.joinToString(" ").lowercase(Locale.US)
        for (phrase in wakeWords) {
            if (transcript.contains(phrase)) {
                DaemonLog.add("wake: detected \"$phrase\" in \"${transcript.take(80)}\"")
                onWakeWordDetected(phrase, transcript)
                return true
            }
        }
        return false
    }

    private fun onWakeWordDetected(phrase: String, fullTranscript: String) {
        val event = JSONObject().apply {
            put("type", "wake_word_triggered")
            put("phrase", phrase)
            put("transcript", fullTranscript)
        }
        WebSocketService.sendEvent(event.toString())
        // Pause listening during the conversation; auto-resume after a guard timeout
        active = false
        mainHandler.postDelayed({
            if (!active) startListening()
        }, 10_000L)
    }

    // ── Talk Mode ────────────────────────────────────────────────────────────

    private fun handleTtsFinished() {
        if (!talkModeEnabled) return
        DaemonLog.add("wake: TTS done — re-arming mic (talk mode)")
        mainHandler.postDelayed({ startListening() }, 600L)
    }

    // ── Foreground notification ──────────────────────────────────────────────

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            val chan = NotificationChannel(
                CHANNEL_ID,
                "Jarvis Wake Word",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Listens for 'Hey Jarvis' wake word in the background"
                setShowBadge(false)
            }
            (getSystemService(NotificationManager::class.java)).createNotificationChannel(chan)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Jarvis is listening")
            .setContentText("Say \"Hey Jarvis\" to start a conversation")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }
}
