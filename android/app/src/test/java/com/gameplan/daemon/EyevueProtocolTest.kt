package com.gameplan.daemon

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EyevueProtocolTest {
    @Test
    fun `builds vendor photo command with checksum`() {
        assertArrayEquals(
            byteArrayOf(0xAB.toByte(), 0x55, 0, 3, 34, 0x31, 83),
            EyevueProtocol.photo(),
        )
    }

    @Test
    fun `decodes frames split across BLE packets`() {
        val expected = EyevueProtocol.datagram(EyevueProtocol.CMD_BATTERY, 1, 75)
        val decoder = EyevueFrameDecoder()
        assertEquals(emptyList<EyevueFrame>(), decoder.append(expected.copyOfRange(0, 4)))
        val frame = decoder.append(expected.copyOfRange(4, expected.size)).single()
        assertEquals(EyevueProtocol.CMD_BATTERY, frame.commandId)
        assertArrayEquals(byteArrayOf(1, 75), frame.payload)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects bad protocol checksum`() {
        EyevueProtocol.parse(EyevueProtocol.battery().also { it[it.lastIndex] = 0 })
    }

    @Test
    fun `reassembles AA15 photo chunks`() {
        val assembler = EyevuePhotoAssembler()
        assertNull(assembler.append(photoPacket(EyevueProtocol.CMD_WAKE_START)))
        assertNull(assembler.append(photoPacket(EyevueProtocol.CMD_PHOTO_DATA, byteArrayOf(1, 2, 3))))
        assertArrayEquals(byteArrayOf(1, 2, 3), assembler.append(photoPacket(EyevueProtocol.CMD_PHOTO_END)))
    }

    private fun photoPacket(command: Int, image: ByteArray = byteArrayOf()): ByteArray {
        val packet = ByteArray(12 + image.size)
        packet[0] = 0xAB.toByte()
        packet[1] = 0x55
        packet[4] = command.toByte()
        image.copyInto(packet, 9)
        return packet
    }
}
