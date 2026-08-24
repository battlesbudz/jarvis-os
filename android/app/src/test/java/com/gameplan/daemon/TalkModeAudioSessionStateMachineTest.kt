package com.gameplan.daemon

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TalkModeAudioSessionStateMachineTest {
    private val effects = TalkModeEchoControlStatus(true, true, true, true)

    @Test
    fun `ordinary playback cannot create a Talk Mode session`() {
        val machine = TalkModeAudioSessionStateMachine()

        val unchanged = machine.beginPlayback("tts", "Read this aloud")
        assertEquals(TalkModeAudioState.IDLE, unchanged.state)
        assertNull(unchanged.playbackOwner)
    }

    @Test
    fun `partial transcript remains transient until commit`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.speechStarted("app")
        val partial = machine.updatePartial("app", "send the draft")

        assertEquals(TalkModeAudioState.USER_SPEAKING, partial.state)
        assertEquals("send the draft", partial.partialTranscript)
        assertEquals("", partial.committedTranscript)

        assertTrue(machine.commitTranscript("app", "send the draft now"))
        assertEquals("send the draft now", machine.snapshot().committedTranscript)
        assertEquals("", machine.snapshot().partialTranscript)
    }

    @Test
    fun `recognized Jarvis playback is rejected as echo`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.beginPlayback("tts", "Your report is ready for review")
        assertEquals(TalkModeAudioState.INTERRUPTED, machine.speechStarted("app").state)
        machine.updatePartial("app", "your report is ready for review")

        assertFalse(machine.commitTranscript("app", "your report is ready for review"))
        assertEquals(TalkModeAudioState.SPEAKING, machine.snapshot().state)
        assertEquals("", machine.snapshot().committedTranscript)
    }

    @Test
    fun `short fragments of Jarvis playback are rejected as echo`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.beginPlayback("tts", "Your report is ready for review")
        machine.speechStarted("app")

        assertFalse(machine.commitTranscript("app", "report review"))
        assertEquals(TalkModeAudioState.SPEAKING, machine.snapshot().state)

        machine.speechStarted("app")
        assertFalse(machine.commitTranscript("app", "review"))
        assertEquals(TalkModeAudioState.SPEAKING, machine.snapshot().state)
    }

    @Test
    fun `content bearing interruption commits and stops obsolete playback`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.beginPlayback("tts", "Your report is ready for review")
        machine.speechStarted("app")

        assertTrue(machine.commitTranscript("app", "Actually send it to Andrea"))
        assertEquals(TalkModeAudioState.RESPONDING, machine.snapshot().state)
        assertEquals("Actually send it to Andrea", machine.snapshot().committedTranscript)
        assertNull(machine.snapshot().playbackOwner)
        assertEquals("", machine.snapshot().playbackText)
    }

    @Test
    fun `stop talking and stop listening control separate resources`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.beginPlayback("tts", "Long answer")

        val speechStopped = machine.stopTalking()
        assertEquals(TalkModeAudioState.LISTENING, speechStopped.state)
        assertEquals("app", speechStopped.captureOwner)
        assertNull(speechStopped.playbackOwner)
        assertTrue(speechStopped.speechSuppressed)

        val listeningStopped = machine.stopListening()
        assertEquals(TalkModeAudioState.PAUSED, listeningStopped.state)
        assertNull(listeningStopped.captureOwner)
    }

    @Test
    fun `completed playback returns an active capture session to listening`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.beginPlayback("tts", "Done soon")

        val finished = machine.finishPlayback("tts")
        assertEquals(TalkModeAudioState.LISTENING, finished.state)
        assertEquals("app", finished.captureOwner)
        assertNull(finished.playbackOwner)
    }

    @Test
    fun `route failure falls back and recovers without ending session`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)

        val fallback = machine.fallBack("duplex audio unavailable")
        assertEquals(TalkModeAudioMode.TURN_BASED, fallback.mode)
        assertEquals(TalkModeAudioState.RECOVERING, fallback.state)

        val recovered = machine.recovered("app", "phone_fallback")
        assertEquals(TalkModeAudioState.LISTENING, recovered.state)
        assertEquals("phone_fallback", recovered.routeState)
        assertEquals(TalkModeAudioMode.TURN_BASED, recovered.mode)
    }

    @Test
    fun `capture recovery preserves active playback and interruption handling`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.beginPlayback("tts", "Your report is ready")

        assertEquals(TalkModeAudioState.SPEAKING, machine.recover("app", "recovering").state)
        val recovered = machine.recovered("app", "speaker_and_mic")
        assertEquals(TalkModeAudioState.SPEAKING, recovered.state)
        assertEquals("tts", recovered.playbackOwner)
        assertEquals(TalkModeAudioState.INTERRUPTED, machine.speechStarted("app").state)
    }

    @Test
    fun `ending releases capture and playback ownership`() {
        val machine = TalkModeAudioSessionStateMachine()
        machine.beginSession("app", continuousSupported = true, echoControls = effects)
        machine.beginPlayback("tts", "Goodbye")

        val ended = machine.end()
        assertEquals(TalkModeAudioState.ENDED, ended.state)
        assertNull(ended.captureOwner)
        assertNull(ended.playbackOwner)
        assertEquals("", ended.partialTranscript)
        assertEquals("", ended.playbackText)
    }
}
