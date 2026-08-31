package com.gameplan.daemon

import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

/** Android TTS owner used by continuous Talk Mode so capture and playback share one lifecycle. */
internal class NativeTalkModePlaybackBridge(
    private val context: ReactApplicationContext,
    private val consumeSuppression: (String) -> Boolean = { false },
) {
    companion object {
        private const val WEARABLE_PLAYBACK_OWNER_PREFIX = "native_tts_playback:"
        private const val WEARABLE_PLAYBACK_RECOVERY_TIMEOUT_MS = 10_000L
        private const val WEARABLE_PLAYBACK_ROUTE_POLL_MS = 250L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var initializing = false
    private var generation = 0
    private var owner: String? = null
    private var wearablePlaybackOwner: String? = null
    private var wearableRouteRunnable: Runnable? = null
    private var wearableRequired = false
    private var spokenText = ""
    private var baseOffset = 0
    private var acknowledgedOffset = 0
    private var tentativeInterruption = false
    private var pendingPromise: Promise? = null

    fun speak(ownerId: String, text: String, promise: Promise) {
        runOnMain {
            if (consumeSuppression(ownerId)) {
                TalkModeAudioSession.finishPlayback(ownerId)
                promise.resolve(Arguments.createMap().apply {
                    putString("status", "stopped")
                    putInt("acknowledgedOffset", 0)
                })
                return@runOnMain
            }
            stopInternal("replaced")
            owner = ownerId
            spokenText = text.trim()
            baseOffset = 0
            acknowledgedOffset = 0
            tentativeInterruption = false
            pendingPromise = promise
            val session = TalkModeAudioSession.beginPlayback(ownerId, spokenText)
            if (session.playbackOwner != ownerId || session.state != TalkModeAudioState.SPEAKING) {
                finish(if (session.state == TalkModeAudioState.ENDED) "ended" else "stopped")
                return@runOnMain
            }

            val initialRoute = WearableAudioRouteManager.snapshot(context)
            if (!initialRoute.available) {
                wearableRequired = false
                ensureTts { engine -> if (!tentativeInterruption) speakRemaining(engine) }
                return@runOnMain
            }

            wearableRequired = true
            val routeOwner = "$WEARABLE_PLAYBACK_OWNER_PREFIX$ownerId"
            wearablePlaybackOwner = routeOwner
            WearableAudioRouteManager.acquire(context, routeOwner) {
                runOnMain {
                    if (owner != ownerId || wearablePlaybackOwner != routeOwner) return@runOnMain
                    waitForWearableRoute(
                        ownerId,
                        routeOwner,
                        System.currentTimeMillis() + WEARABLE_PLAYBACK_RECOVERY_TIMEOUT_MS,
                    )
                }
            }
        }
    }

    fun stopForInterruption() {
        runOnMain {
            if (owner == null || tentativeInterruption) return@runOnMain
            tentativeInterruption = true
            generation += 1
            tts?.stop()
        }
    }

    fun resumeAfterRejectedInterruption() {
        runOnMain {
            val activeOwner = owner ?: return@runOnMain
            if (!tentativeInterruption) return@runOnMain
            tentativeInterruption = false
            baseOffset = acknowledgedOffset.coerceIn(0, spokenText.length)
            val routeOwner = wearablePlaybackOwner
            if (wearableRequired && routeOwner != null) {
                waitForWearableRoute(
                    activeOwner,
                    routeOwner,
                    System.currentTimeMillis() + WEARABLE_PLAYBACK_RECOVERY_TIMEOUT_MS,
                )
            } else {
                ensureTts { engine -> speakRemaining(engine) }
            }
        }
    }

    fun commitInterruption() {
        runOnMain {
            if (owner == null) return@runOnMain
            tentativeInterruption = false
            generation += 1
            tts?.stop()
            finish("interrupted")
        }
    }

    fun stop() {
        runOnMain { stopInternal("stopped") }
    }

    fun destroy() {
        runOnMain {
            stopInternal("ended")
            tts?.shutdown()
            tts = null
        }
    }

    private fun waitForWearableRoute(ownerId: String, routeOwner: String, deadlineMs: Long) {
        if (owner != ownerId || wearablePlaybackOwner != routeOwner || !wearableRequired) return
        val route = WearableAudioRouteManager.snapshot(context)
        if (route.active) {
            cancelWearableRouteCheck()
            startOrResumeWearablePlayback(ownerId, routeOwner)
            return
        }
        if (System.currentTimeMillis() >= deadlineMs) {
            cancelWearableRouteCheck()
            finish("error", "Jarvis could not restore the glasses speaker within 10 seconds.")
            return
        }
        scheduleWearableRouteCheck {
            waitForWearableRoute(ownerId, routeOwner, deadlineMs)
        }
    }

    private fun startOrResumeWearablePlayback(ownerId: String, routeOwner: String) {
        if (owner != ownerId || wearablePlaybackOwner != routeOwner || !wearableRequired) return
        ensureTts { engine ->
            if (
                owner == ownerId &&
                wearablePlaybackOwner == routeOwner &&
                !tentativeInterruption &&
                WearableAudioRouteManager.snapshot(context).active
            ) {
                speakRemaining(engine)
            }
        }
        monitorWearableRoute(ownerId, routeOwner)
    }

    private fun monitorWearableRoute(ownerId: String, routeOwner: String) {
        if (owner != ownerId || wearablePlaybackOwner != routeOwner || !wearableRequired) return
        if (tentativeInterruption) {
            scheduleWearableRouteCheck { monitorWearableRoute(ownerId, routeOwner) }
            return
        }
        val route = WearableAudioRouteManager.snapshot(context)
        if (!route.active) {
            generation += 1
            tts?.stop()
            baseOffset = acknowledgedOffset.coerceIn(0, spokenText.length)
            waitForWearableRoute(
                ownerId,
                routeOwner,
                System.currentTimeMillis() + WEARABLE_PLAYBACK_RECOVERY_TIMEOUT_MS,
            )
            return
        }
        scheduleWearableRouteCheck { monitorWearableRoute(ownerId, routeOwner) }
    }

    private fun scheduleWearableRouteCheck(block: () -> Unit) {
        cancelWearableRouteCheck()
        val next = Runnable {
            wearableRouteRunnable = null
            block()
        }
        wearableRouteRunnable = next
        mainHandler.postDelayed(next, WEARABLE_PLAYBACK_ROUTE_POLL_MS)
    }

    private fun cancelWearableRouteCheck() {
        wearableRouteRunnable?.let { mainHandler.removeCallbacks(it) }
        wearableRouteRunnable = null
    }

    private fun ensureTts(ready: (TextToSpeech) -> Unit) {
        if (initializing) return
        tts?.let {
            ready(it)
            return
        }
        initializing = true
        tts = TextToSpeech(context.applicationContext) { status ->
            initializing = false
            val engine = tts
            if (status != TextToSpeech.SUCCESS || engine == null) {
                tts = null
                runCatching { engine?.shutdown() }
                finish("error", "Android text-to-speech could not initialize.")
                return@TextToSpeech
            }
            engine.language = Locale.US
            engine.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            ready(engine)
        }
    }

    private fun speakRemaining(engine: TextToSpeech) {
        val activeOwner = owner ?: return
        if (baseOffset >= spokenText.length) {
            finish("done")
            return
        }
        val currentGeneration = ++generation
        val utteranceId = "jarvis-talk-${TalkModeAudioSession.snapshot().sessionId}-$currentGeneration"
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {
                runOnMain {
                    if (!isCurrent(activeOwner, currentGeneration) || tentativeInterruption) return@runOnMain
                    context
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("JarvisTalkModePlayback", Arguments.createMap().apply {
                            putString("type", "start")
                            putString("ownerId", activeOwner)
                        })
                }
            }

            override fun onDone(id: String?) {
                runOnMain {
                    if (!isCurrent(activeOwner, currentGeneration) || tentativeInterruption) return@runOnMain
                    acknowledgedOffset = spokenText.length
                    finish("done")
                }
            }

            @Deprecated("Deprecated in Android")
            override fun onError(id: String?) {
                runOnMain {
                    if (isCurrent(activeOwner, currentGeneration) && !tentativeInterruption) {
                        finish("error", "Android text-to-speech playback failed.")
                    }
                }
            }

            override fun onError(id: String?, errorCode: Int) = onError(id)

            override fun onRangeStart(id: String?, start: Int, end: Int, frame: Int) {
                runOnMain {
                    if (!isCurrent(activeOwner, currentGeneration) || tentativeInterruption) return@runOnMain
                    acknowledgedOffset = (baseOffset + start).coerceIn(acknowledgedOffset, spokenText.length)
                }
            }
        })
        val params = Bundle().apply {
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f)
        }
        val result = engine.speak(
            spokenText.substring(baseOffset),
            TextToSpeech.QUEUE_FLUSH,
            params,
            utteranceId,
        )
        if (result == TextToSpeech.ERROR) finish("error", "Android rejected text-to-speech playback.")
    }

    private fun isCurrent(expectedOwner: String, expectedGeneration: Int): Boolean =
        owner == expectedOwner && generation == expectedGeneration

    private fun stopInternal(status: String) {
        generation += 1
        tts?.stop()
        if (owner != null) finish(status)
    }

    private fun finish(status: String, error: String? = null) {
        val completedOwner = owner
        val completedOffset = acknowledgedOffset.coerceIn(0, spokenText.length)
        val completedRouteOwner = wearablePlaybackOwner
        cancelWearableRouteCheck()
        owner = null
        wearablePlaybackOwner = null
        wearableRequired = false
        spokenText = ""
        baseOffset = 0
        acknowledgedOffset = 0
        tentativeInterruption = false
        if (completedRouteOwner != null) {
            WearableAudioRouteManager.release(completedRouteOwner)
        }
        if (completedOwner != null) {
            if (status == "done") TalkModeAudioSession.finishPlayback(completedOwner)
            else if (
                status != "interrupted" &&
                TalkModeAudioSession.snapshot().playbackOwner == completedOwner
            ) TalkModeAudioSession.stopTalking()
        }
        val promise = pendingPromise
        pendingPromise = null
        promise?.resolve(Arguments.createMap().apply {
            putString("status", status)
            putString("error", error)
            putInt("acknowledgedOffset", completedOffset)
        })
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }
}
