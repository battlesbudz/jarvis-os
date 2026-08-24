package com.gameplan.daemon

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TalkModeAudioSessionStateMachineTest {
    private val effects = TalkModeEchoControlStatus(true, true, true, true)

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
