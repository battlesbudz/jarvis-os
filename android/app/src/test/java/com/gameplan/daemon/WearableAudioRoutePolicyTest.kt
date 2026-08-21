package com.gameplan.daemon

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WearableAudioRoutePolicyTest {
    @Test
    fun `prefers BLE headset over classic SCO`() {
        val selected = WearableAudioRoutePolicy.select(
            listOf(
                candidate(1, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "CY003 classic"),
                candidate(2, AudioDeviceInfo.TYPE_BLE_HEADSET, "CY003 LE Audio"),
            ),
        )

        assertEquals(2, selected?.id)
        assertEquals("CY003 LE Audio", selected?.name)
    }

    @Test
    fun `selects classic SCO glasses when BLE Audio is unavailable`() {
        val selected = WearableAudioRoutePolicy.select(
            listOf(
                candidate(3, AudioDeviceInfo.TYPE_BUILTIN_MIC, "Phone microphone"),
                candidate(4, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "CY003"),
            ),
        )

        assertEquals(4, selected?.id)
        assertEquals("bluetooth_sco", selected?.let { WearableAudioRoutePolicy.typeName(it.type) })
    }

    @Test
    fun `does not misreport A2DP-only output as a communication microphone`() {
        val selected = WearableAudioRoutePolicy.select(
            listOf(
                candidate(5, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, "Media-only glasses"),
                candidate(6, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, "Phone speaker"),
            ),
        )

        assertNull(selected)
        assertFalse(WearableAudioRoutePolicy.isWearableCommunicationType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP))
    }

    @Test
    fun `recognizes supported wearable communication profiles`() {
        assertTrue(WearableAudioRoutePolicy.isWearableCommunicationType(AudioDeviceInfo.TYPE_BLE_HEADSET))
        assertTrue(WearableAudioRoutePolicy.isWearableCommunicationType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO))
        assertTrue(WearableAudioRoutePolicy.isWearableCommunicationType(AudioDeviceInfo.TYPE_HEARING_AID))
        assertFalse(WearableAudioRoutePolicy.isWearableCommunicationType(AudioDeviceInfo.TYPE_BUILTIN_MIC))
    }

    @Test
    fun `excludes hearing aids when only the legacy SCO route is available`() {
        val selected = WearableAudioRoutePolicy.select(
            listOf(
                candidate(7, AudioDeviceInfo.TYPE_HEARING_AID, "ASHA hearing aid"),
                candidate(8, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "Classic headset"),
            ),
            allowHearingAid = false,
        )

        assertEquals(8, selected?.id)
    }

    private fun candidate(id: Int, type: Int, name: String) =
        WearableAudioDeviceCandidate(id = id, type = type, name = name)
}
