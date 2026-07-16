package com.gameplan.daemon

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
        private const val MIN_RECOGNIZER_RESTART_DELAY_MS = 1000L
        private const val RECOGNIZER_RESTART_FAILURE_DELAY_MS = 3000L

        const val ACTION_START = "com.gameplan.daemon.WAKE_WORD_START"
        const val ACTION_STOP = "com.gameplan.daemon.WAKE_WORD_STOP"
        const val ACTION_UPDATE = "com.gameplan.daemon.WAKE_WORD_UPDATE"
        const val EXTRA_WAKE_WORDS = "wake_words"
        const val EXTRA_TALK_MODE = "talk_mode"

        @Volatile var instance: WakeWordService? = null
            private set

        /**
         * Called by OpHandler before playing a voice_speak_audio clip.
         * Temporarily stops the recognizer so the microphone doesn't capture speaker audio.
         */
        fun pauseForPlayback() {
            instance?.handlePauseForPlayback()
        }

        /**
         * Called by user-facing voice controls such as Pause. Unlike TTS playback
         * pause, this must discard any partial utterance so no final result is sent
         * after the user has paused the session.
         */
        fun pauseForUserControl() {
            instance?.handlePauseForUserControl()
        }

        fun endTalkModeForUserControl() {
            instance?.handleEndTalkModeForUserControl()
        }

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
    private var restartRunnable: Runnable? = null
    /** True when Talk Mode is on and we are waiting to capture the user's utterance after a wake word */
    private var capturingUtterance = false

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
        cancelPendingRestart()
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            DaemonLog.add("wake: SpeechRecognizer not available on this device")
            return
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
            checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            DaemonLog.add("wake: RECORD_AUDIO permission not granted — cannot start wake word detection")
            // Broadcast so the UI can prompt the user
            val intent = Intent("com.gameplan.daemon.WAKE_WORD_PERMISSION_DENIED")
            intent.setPackage(packageName)
            sendBroadcast(intent)
            return
        }
        mainHandler.post {
            if (active) return@post
            try {
                destroyRecognizer()
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
        cancelPendingRestart()
        mainHandler.post {
            try {
                speechRecognizer?.stopListening()
                destroyRecognizer()
            } catch (e: Exception) {
                Log.e(TAG, "stopListening error", e)
            }
        }
    }

    private fun destroyRecognizer() {
        try {
            speechRecognizer?.cancel()
            speechRecognizer?.destroy()
        } catch (e: Exception) {
            Log.e(TAG, "destroyRecognizer failed", e)
        } finally {
            speechRecognizer = null
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

    private fun cancelPendingRestart() {
        restartRunnable?.let { mainHandler.removeCallbacks(it) }
        restartRunnable = null
    }

    private fun restartRecognizer(delayMs: Long = MIN_RECOGNIZER_RESTART_DELAY_MS) {
        if (!active || restartRunnable != null) return
        val restart = Runnable {
            restartRunnable = null
            if (active) {
                try {
                    destroyRecognizer()
                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this@WakeWordService)
                    speechRecognizer?.setRecognitionListener(listener)
                    beginRecognizing()
                } catch (e: Exception) {
                    Log.e(TAG, "restartRecognizer failed", e)
                    DaemonLog.add("wake: restart error: ${e.message}")
                    restartRecognizer(RECOGNIZER_RESTART_FAILURE_DELAY_MS)
                }
            }
        }
        restartRunnable = restart
        mainHandler.postDelayed(restart, delayMs.coerceAtLeast(MIN_RECOGNIZER_RESTART_DELAY_MS))
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
                val delay = if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) 2000L else MIN_RECOGNIZER_RESTART_DELAY_MS
                restartRecognizer(delay)
            } else if (active) {
                DaemonLog.add("wake: recognition error: $label")
                restartRecognizer(MIN_RECOGNIZER_RESTART_DELAY_MS)
            }
        }

        override fun onResults(results: Bundle?) {
            if (!active && !capturingUtterance) return
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: emptyList<String>()
            if (capturingUtterance) {
                // Talk Mode: send the captured utterance to the server for AI processing
                val utterance = matches.firstOrNull()?.trim().orEmpty()
                if (utterance.isNotEmpty()) {
                    capturingUtterance = false
                    val event = JSONObject().apply {
                        put("type", "voice_user_utterance")
                        put("text", utterance)
                    }
                    WebSocketService.sendEvent(event.toString())
                    DaemonLog.add("talk: sent utterance \"${utterance.take(60)}\"")
                    // Re-arm for next wake word after sending utterance
                    if (active) restartRecognizer()
                } else {
                    // Empty result — re-arm
                    capturingUtterance = false
                    if (active) restartRecognizer()
                }
                return
            }
            val found = checkForWakeWord(matches)
            if (!found && active) restartRecognizer()
        }

        override fun onPartialResults(partialResults: Bundle?) {
            if (!active) return
            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: emptyList<String>()
            if (!capturingUtterance) checkForWakeWord(matches)
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
        // Talk Mode owns the turn through the daemon; keep the user's current app in focus.
        if (!talkModeEnabled) {
            bringJarvisToForeground()
        }

        val event = JSONObject().apply {
            put("type", "wake_word_triggered")
            put("phrase", phrase)
            put("transcript", fullTranscript)
            // Let the app know whether the daemon is handling the voice turn end-to-end.
            // When true, the app should NOT start its own mic session to avoid competing pipelines.
            put("daemonHandling", talkModeEnabled)
        }
        val eventDelayMs = if (talkModeEnabled) 0L else 400L
        mainHandler.postDelayed({ WebSocketService.sendEvent(event.toString()) }, eventDelayMs)

        if (talkModeEnabled) {
            // Talk Mode: keep the recognizer running to immediately capture the next utterance.
            // SpeechRecognizer will end naturally when the user stops speaking;
            // onResults fires with the utterance text which we relay to the server.
            capturingUtterance = true
            DaemonLog.add("talk: wake detected — waiting for utterance")
            // Safety timeout: if no utterance captured in 15s, reset to wake-word scan mode
            mainHandler.postDelayed({
                if (capturingUtterance) {
                    capturingUtterance = false
                    DaemonLog.add("talk: utterance capture timed out — resuming wake scan")
                    if (active) restartRecognizer()
                }
            }, 15_000L)
        } else {
            // Non-talk mode: pause listening during the conversation; auto-resume after timeout
            active = false
            cancelPendingRestart()
            mainHandler.post { destroyRecognizer() }
            mainHandler.postDelayed({
                if (!active) startListening()
            }, 10_000L)
        }
    }

    /**
     * Brings the Jarvis mobile app to the foreground when a wake word fires.
     *
     * Priority order:
     *   1. The standalone Jarvis Expo app (com.gameplan) — direct launch, no reload
     *   2. Expo Go (host.exp.exponent) — used during development
     *   3. Common browser apps as a last resort for web-only deployments
     */
    private fun bringJarvisToForeground() {
        val candidates = listOf(
            "com.gameplan",           // Standalone Jarvis mobile app (production build)
            "host.exp.exponent",      // Expo Go (development)
            "com.android.chrome",     // Fallback: Chrome (web version)
            "org.mozilla.firefox",
            "com.microsoft.emmx",
            "com.brave.browser",
        )
        for (pkg in candidates) {
            try {
                val intent = packageManager.getLaunchIntentForPackage(pkg) ?: continue
                intent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                )
                startActivity(intent)
                DaemonLog.add("wake: brought $pkg to foreground")
                return
            } catch (e: Exception) {
                // package not installed or launch failed — try next
            }
        }
        DaemonLog.add("wake: could not bring Jarvis app to foreground (no matching package)")
    }

    // ── Talk Mode ────────────────────────────────────────────────────────────

    /**
     * Stop the recognizer while speaker audio plays to prevent mic picking up TTS audio.
     * After playback, onTtsFinished() restarts it via handleTtsFinished().
     */
    private fun handlePauseForPlayback() {
        if (!talkModeEnabled) return
        DaemonLog.add("wake: pausing mic for TTS playback")
        // Set active=false so startListening() in handleTtsFinished() is not a no-op
        active = false
        cancelPendingRestart()
        mainHandler.post { destroyRecognizer() }
    }

    private fun handlePauseForUserControl() {
        if (!talkModeEnabled) return
        DaemonLog.add("wake: pausing user capture")
        capturingUtterance = false
        active = false
        cancelPendingRestart()
        mainHandler.post {
            try {
                destroyRecognizer()
            } catch (e: Exception) {
                Log.e(TAG, "handlePauseForUserControl error", e)
            }
        }
    }

    private fun handleEndTalkModeForUserControl() {
        if (!talkModeEnabled && !capturingUtterance) return
        DaemonLog.add("wake: ending talk mode capture")
        talkModeEnabled = false
        capturingUtterance = false
        active = false
        cancelPendingRestart()
        mainHandler.post {
            try {
                destroyRecognizer()
            } catch (e: Exception) {
                Log.e(TAG, "handleEndTalkModeForUserControl error", e)
            }
            startListening()
        }
    }

    private fun handleTtsFinished() {
        if (!talkModeEnabled) return
        DaemonLog.add("wake: TTS done — re-arming mic for next utterance (talk mode)")
        // Stay in utterance-capture mode: the next speech result is treated as
        // the next user turn without requiring another wake word.
        capturingUtterance = true
        cancelPendingRestart()
        mainHandler.postDelayed({
            if (!active) startListening()
        }, 600L)
        // Safety timeout: fall back to wake-word scan if no utterance in 15s
        mainHandler.postDelayed({
            if (capturingUtterance) {
                capturingUtterance = false
                DaemonLog.add("talk: post-TTS utterance timed out — returning to wake scan")
                if (active) restartRecognizer()
            }
        }, 15_000L)
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
