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
import java.util.Locale

/** Android TTS owner used by continuous Talk Mode so capture and playback share one lifecycle. */
internal class NativeTalkModePlaybackBridge(
    private val context: ReactApplicationContext,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var initializing = false
    private var generation = 0
    private var owner: String? = null
    private var spokenText = ""
    private var baseOffset = 0
    private var acknowledgedOffset = 0
    private var tentativeInterruption = false
    private var pendingPromise: Promise? = null

    fun speak(ownerId: String, text: String, promise: Promise) {
        runOnMain {
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
            ensureTts { engine -> if (!tentativeInterruption) speakRemaining(engine) }
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
            if (owner == null || !tentativeInterruption) return@runOnMain
            tentativeInterruption = false
            baseOffset = acknowledgedOffset.coerceIn(0, spokenText.length)
            ensureTts { engine -> speakRemaining(engine) }
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

    private fun ensureTts(ready: (TextToSpeech) -> Unit) {
        // The callback from the in-flight initialization reads the latest owner/text,
        // so replacement utterances only need to wait for that callback.
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
            override fun onStart(id: String?) = Unit

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
                    // Range start is the last position known to have crossed the audible frontier.
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
        owner = null
        spokenText = ""
        baseOffset = 0
        acknowledgedOffset = 0
        tentativeInterruption = false
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
        })
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }
}
