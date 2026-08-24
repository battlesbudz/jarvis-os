package com.gameplan.daemon

import android.content.Context
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import java.util.Locale

enum class TalkModeAudioState(val wireName: String) {
    IDLE("idle"),
    LISTENING("listening"),
    USER_SPEAKING("user-speaking"),
    RESPONDING("responding"),
    SPEAKING("speaking"),
    INTERRUPTED("interrupted"),
    PAUSED("paused"),
    RECOVERING("recovering"),
    ENDED("ended"),
}

enum class TalkModeAudioMode(val wireName: String) {
    CONTINUOUS("continuous"),
    TURN_BASED("turn-based"),
}

data class TalkModeEchoControlStatus(
    val acousticEchoCancellationAvailable: Boolean,
    val noiseSuppressionAvailable: Boolean,
    val automaticGainControlAvailable: Boolean,
    val platformManaged: Boolean,
)

data class TalkModeAudioSnapshot(
    val sessionId: Long,
    val state: TalkModeAudioState,
    val mode: TalkModeAudioMode,
    val captureOwner: String?,
    val playbackOwner: String?,
    val partialTranscript: String,
    val committedTranscript: String,
    val playbackText: String,
    val speechSuppressed: Boolean,
    val routeState: String,
    val lastError: String?,
    val echoControls: TalkModeEchoControlStatus,
)

/** Pure transition model so the Android voice lifecycle can be unit tested without services. */
internal class TalkModeAudioSessionStateMachine {
    private var nextSessionId = 0L
    private var snapshot = emptySnapshot()
    private var modeBeforePlaybackOverride: TalkModeAudioMode? = null

    @Synchronized
    fun snapshot(): TalkModeAudioSnapshot = snapshot

    @Synchronized
    fun beginSession(
        owner: String,
        continuousSupported: Boolean,
        echoControls: TalkModeEchoControlStatus,
    ): TalkModeAudioSnapshot {
        if (snapshot.state != TalkModeAudioState.IDLE && snapshot.state != TalkModeAudioState.ENDED) {
            return snapshot
        }
        snapshot = emptySnapshot().copy(
            sessionId = ++nextSessionId,
            state = TalkModeAudioState.LISTENING,
            mode = if (continuousSupported) TalkModeAudioMode.CONTINUOUS else TalkModeAudioMode.TURN_BASED,
            captureOwner = owner,
            echoControls = echoControls,
        )
        modeBeforePlaybackOverride = null
        return snapshot
    }

    @Synchronized
    fun acquireCapture(owner: String): TalkModeAudioSnapshot {
        ensureSession(owner)
        snapshot = snapshot.copy(
            captureOwner = owner,
            state = if (snapshot.playbackOwner == null) TalkModeAudioState.LISTENING else snapshot.state,
            lastError = null,
        )
        return snapshot
    }

    @Synchronized
    fun releaseCapture(owner: String): TalkModeAudioSnapshot {
        if (snapshot.captureOwner == owner) snapshot = snapshot.copy(captureOwner = null)
        return snapshot
    }

    @Synchronized
    fun speechStarted(owner: String): TalkModeAudioSnapshot {
        if (snapshot.captureOwner != owner || snapshot.state == TalkModeAudioState.PAUSED) return snapshot
        snapshot = snapshot.copy(
            state = if (snapshot.state == TalkModeAudioState.SPEAKING) {
                TalkModeAudioState.INTERRUPTED
            } else {
                TalkModeAudioState.USER_SPEAKING
            },
            partialTranscript = "",
        )
        return snapshot
    }

    @Synchronized
    fun updatePartial(owner: String, text: String): TalkModeAudioSnapshot {
        if (snapshot.captureOwner != owner || snapshot.state == TalkModeAudioState.PAUSED) return snapshot
        snapshot = snapshot.copy(partialTranscript = text.trim())
        return snapshot
    }

    /** Returns false for recognized Jarvis playback so echo can never become a committed user turn. */
    @Synchronized
    fun commitTranscript(owner: String, text: String): Boolean {
        if (snapshot.captureOwner != owner || snapshot.state == TalkModeAudioState.PAUSED) return false
        val committed = text.trim()
        if (committed.isBlank()) {
            resumeAfterRejectedInterruption()
            return false
        }
        if (snapshot.state == TalkModeAudioState.INTERRUPTED && isProbablePlaybackEcho(committed, snapshot.playbackText)) {
            resumeAfterRejectedInterruption()
            return false
        }
        val restoredMode = modeBeforePlaybackOverride ?: snapshot.mode
        modeBeforePlaybackOverride = null
        snapshot = snapshot.copy(
            state = TalkModeAudioState.RESPONDING,
            mode = restoredMode,
            partialTranscript = "",
            committedTranscript = committed,
            playbackOwner = null,
            playbackText = "",
        )
        return true
    }

    @Synchronized
    fun beginResponse(): TalkModeAudioSnapshot {
        if (snapshot.state != TalkModeAudioState.PAUSED && snapshot.state != TalkModeAudioState.ENDED) {
            snapshot = snapshot.copy(state = TalkModeAudioState.RESPONDING)
        }
        return snapshot
    }

    @Synchronized
    fun beginPlayback(owner: String, text: String, turnBased: Boolean = false): TalkModeAudioSnapshot {
        if (
            snapshot.state == TalkModeAudioState.IDLE ||
            snapshot.state == TalkModeAudioState.PAUSED ||
            snapshot.state == TalkModeAudioState.ENDED
        ) return snapshot
        val playbackMode = if (turnBased) {
            if (modeBeforePlaybackOverride == null) modeBeforePlaybackOverride = snapshot.mode
            TalkModeAudioMode.TURN_BASED
        } else {
            val restoredMode = modeBeforePlaybackOverride ?: snapshot.mode
            modeBeforePlaybackOverride = null
            restoredMode
        }
        snapshot = snapshot.copy(
            state = TalkModeAudioState.SPEAKING,
            mode = playbackMode,
            playbackOwner = owner,
            playbackText = text.trim(),
            speechSuppressed = false,
        )
        return snapshot
    }

    @Synchronized
    fun finishPlayback(owner: String): TalkModeAudioSnapshot {
        if (snapshot.playbackOwner != owner) return snapshot
        val restoredMode = modeBeforePlaybackOverride ?: snapshot.mode
        modeBeforePlaybackOverride = null
        snapshot = snapshot.copy(
            state = when {
                snapshot.state == TalkModeAudioState.PAUSED -> TalkModeAudioState.PAUSED
                snapshot.captureOwner == null -> TalkModeAudioState.IDLE
                else -> TalkModeAudioState.LISTENING
            },
            mode = restoredMode,
            playbackOwner = null,
            playbackText = "",
            partialTranscript = "",
        )
        return snapshot
    }

    @Synchronized
    fun stopTalking(): TalkModeAudioSnapshot {
        val restoredMode = modeBeforePlaybackOverride ?: snapshot.mode
        modeBeforePlaybackOverride = null
        snapshot = snapshot.copy(
            state = when (snapshot.state) {
                TalkModeAudioState.PAUSED -> TalkModeAudioState.PAUSED
                TalkModeAudioState.ENDED -> TalkModeAudioState.ENDED
                else -> if (snapshot.captureOwner == null) TalkModeAudioState.IDLE else TalkModeAudioState.LISTENING
            },
            playbackOwner = null,
            mode = restoredMode,
            playbackText = "",
            speechSuppressed = true,
        )
        return snapshot
    }

    @Synchronized
    fun stopListening(): TalkModeAudioSnapshot {
        snapshot = snapshot.copy(state = TalkModeAudioState.PAUSED, captureOwner = null, partialTranscript = "")
        return snapshot
    }

    @Synchronized
    fun recover(owner: String, routeState: String, error: String? = null): TalkModeAudioSnapshot {
        if (snapshot.state == TalkModeAudioState.IDLE || snapshot.state == TalkModeAudioState.ENDED) return snapshot
        ensureSession(owner)
        snapshot = snapshot.copy(
            state = if (snapshot.playbackOwner == null) TalkModeAudioState.RECOVERING else TalkModeAudioState.SPEAKING,
            routeState = routeState,
            lastError = error,
        )
        return snapshot
    }

    @Synchronized
    fun recovered(owner: String, routeState: String): TalkModeAudioSnapshot {
        if (snapshot.state == TalkModeAudioState.IDLE || snapshot.state == TalkModeAudioState.ENDED) return snapshot
        ensureSession(owner)
        snapshot = snapshot.copy(
            state = if (snapshot.playbackOwner == null) TalkModeAudioState.LISTENING else TalkModeAudioState.SPEAKING,
            captureOwner = snapshot.captureOwner ?: owner,
            routeState = routeState,
            lastError = null,
        )
        return snapshot
    }

    @Synchronized
    fun fallBack(error: String): TalkModeAudioSnapshot {
        modeBeforePlaybackOverride = null
        snapshot = snapshot.copy(
            state = if (snapshot.playbackOwner == null) TalkModeAudioState.RECOVERING else TalkModeAudioState.SPEAKING,
            mode = TalkModeAudioMode.TURN_BASED,
            lastError = error,
        )
        return snapshot
    }

    @Synchronized
    fun end(): TalkModeAudioSnapshot {
        modeBeforePlaybackOverride = null
        snapshot = snapshot.copy(
            state = TalkModeAudioState.ENDED,
            captureOwner = null,
            playbackOwner = null,
            partialTranscript = "",
            playbackText = "",
            speechSuppressed = false,
        )
        return snapshot
    }

    private fun ensureSession(owner: String) {
        if (snapshot.state == TalkModeAudioState.IDLE || snapshot.state == TalkModeAudioState.ENDED) {
            beginSession(owner, continuousSupported = false, echoControls = snapshot.echoControls)
        }
    }

    private fun resumeAfterRejectedInterruption() {
        snapshot = snapshot.copy(
            state = if (snapshot.playbackOwner == null) TalkModeAudioState.LISTENING else TalkModeAudioState.SPEAKING,
            partialTranscript = "",
        )
    }

    private fun emptySnapshot() = TalkModeAudioSnapshot(
        sessionId = 0,
        state = TalkModeAudioState.IDLE,
        mode = TalkModeAudioMode.TURN_BASED,
        captureOwner = null,
        playbackOwner = null,
        partialTranscript = "",
        committedTranscript = "",
        playbackText = "",
        speechSuppressed = false,
        routeState = "idle",
        lastError = null,
        echoControls = TalkModeEchoControlStatus(false, false, false, false),
    )

    private fun isProbablePlaybackEcho(candidate: String, playback: String): Boolean {
        val candidateWords = normalizedWords(candidate)
        val playbackWords = normalizedWords(playback)
        if (candidateWords.isEmpty() || playbackWords.isEmpty()) return false
        if (candidateWords.joinToString(" ") == playbackWords.joinToString(" ")) return true
        // Preserve order when comparing partial recognition. An unordered bag-of-words
        // match can discard a real barge-in such as "send the timer" when playback
        // previously said "stop the timer, then send the report".
        val longestOrderedMatch = IntArray(playbackWords.size + 1)
        candidateWords.forEach { candidateWord ->
            var diagonal = 0
            playbackWords.forEachIndexed { index, playbackWord ->
                val previous = longestOrderedMatch[index + 1]
                longestOrderedMatch[index + 1] = if (candidateWord == playbackWord) {
                    diagonal + 1
                } else {
                    maxOf(longestOrderedMatch[index + 1], longestOrderedMatch[index])
                }
                diagonal = previous
            }
        }
        return longestOrderedMatch.last().toDouble() / candidateWords.size >= 0.8
    }

    private fun normalizedWords(value: String): List<String> = value
        .lowercase(Locale.US)
        .replace(Regex("[^a-z0-9']+"), " ")
        .trim()
        .split(Regex("\\s+"))
        .filter { it.isNotBlank() }
}

/** The only process-level owner of Talk Mode capture/playback lifecycle state. */
internal object TalkModeAudioSession {
    private val machine = TalkModeAudioSessionStateMachine()

    fun snapshot(): TalkModeAudioSnapshot = machine.snapshot()

    fun begin(context: Context, owner: String): TalkModeAudioSnapshot {
        val effects = echoControlStatus()
        val continuousSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            effects.acousticEchoCancellationAvailable
        return machine.beginSession(owner, continuousSupported, effects)
    }

    fun acquireCapture(context: Context, owner: String): TalkModeAudioSnapshot {
        begin(context, owner)
        return machine.acquireCapture(owner)
    }

    fun releaseCapture(owner: String): TalkModeAudioSnapshot = machine.releaseCapture(owner)
    fun speechStarted(owner: String): TalkModeAudioSnapshot = machine.speechStarted(owner)
    fun updatePartial(owner: String, text: String): TalkModeAudioSnapshot = machine.updatePartial(owner, text)
    fun commitTranscript(owner: String, text: String): Boolean = machine.commitTranscript(owner, text)
    fun beginResponse(): TalkModeAudioSnapshot = machine.beginResponse()
    fun beginPlayback(owner: String, text: String): TalkModeAudioSnapshot = machine.beginPlayback(owner, text)
    fun beginTurnBasedPlayback(owner: String, text: String): TalkModeAudioSnapshot =
        machine.beginPlayback(owner, text, turnBased = true)
    fun finishPlayback(owner: String): TalkModeAudioSnapshot = machine.finishPlayback(owner)
    fun stopTalking(): TalkModeAudioSnapshot = machine.stopTalking()
    fun stopListening(): TalkModeAudioSnapshot = machine.stopListening()
    fun recover(owner: String, routeState: String, error: String? = null) = machine.recover(owner, routeState, error)
    fun recovered(owner: String, routeState: String) = machine.recovered(owner, routeState)
    fun fallBack(error: String): TalkModeAudioSnapshot = machine.fallBack(error)
    fun end(): TalkModeAudioSnapshot = machine.end()

    private fun echoControlStatus() = TalkModeEchoControlStatus(
        acousticEchoCancellationAvailable = runCatching { AcousticEchoCanceler.isAvailable() }.getOrDefault(false),
        noiseSuppressionAvailable = runCatching { NoiseSuppressor.isAvailable() }.getOrDefault(false),
        automaticGainControlAvailable = runCatching { AutomaticGainControl.isAvailable() }.getOrDefault(false),
        // SpeechRecognizer owns its AudioRecord/session ID. Android applies supported voice-recognition
        // preprocessing for that managed session; Jarvis must not create duplicate effects against it.
        platformManaged = true,
    )
}
