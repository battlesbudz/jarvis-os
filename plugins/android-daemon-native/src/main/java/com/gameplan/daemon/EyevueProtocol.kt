package com.gameplan.daemon

import java.io.ByteArrayOutputStream
import java.util.UUID

data class EyevueFrame(val commandId: Int, val payload: ByteArray)

/** eyeVue AA12 protocol, isolated here so it can be tested without Android hardware. */
object EyevueProtocol {
    val SERVICE_UUID: UUID = UUID.fromString("0000aa12-0000-1000-8000-00805f9b34fb")
    val COMMAND_WRITE_UUID: UUID = UUID.fromString("0000aa13-0000-1000-8000-00805f9b34fb")
    val COMMAND_NOTIFY_UUID: UUID = UUID.fromString("0000aa14-0000-1000-8000-00805f9b34fb")
    val PHOTO_NOTIFY_UUID: UUID = UUID.fromString("0000aa15-0000-1000-8000-00805f9b34fb")
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    const val CMD_CAPACITY = 22
    const val CMD_BATTERY = 23
    const val CMD_PHOTO = 34
    const val CMD_VIDEO = 35
    const val CMD_STOP_RECORD = 36
    const val CMD_AUDIO = 52
    const val CMD_STOP_VOICE = 86
    /** AA14 command-channel notification emitted when the glasses accept Hey Star. */
    const val CMD_WAKE_START = 151
    /** AA14 command-channel notification emitted when the voice stream ends. */
    const val CMD_WAKE_END = 153
    /** AA14 Opus microphone packet notification. */
    const val CMD_VOICE_DATA = 70
    /** AA15 uses the same numeric ids for its independent photo framing. */
    const val CMD_TRANSFER_START = CMD_WAKE_START
    const val CMD_PHOTO_DATA = 152
    const val CMD_PHOTO_END = 153

    fun datagram(command: Int, vararg payload: Int): ByteArray {
        require(command in 0..255)
        val length = payload.size + 2
        val result = ByteArray(payload.size + 6)
        result[0] = 0xAB.toByte()
        result[1] = 0x55
        result[2] = (length shr 8).toByte()
        result[3] = length.toByte()
        result[4] = command.toByte()
        var checksum = command
        payload.forEachIndexed { index, value ->
            result[index + 5] = value.toByte()
            checksum += value and 0xff
        }
        result[result.lastIndex] = checksum.toByte()
        return result
    }

    fun parse(packet: ByteArray): EyevueFrame {
        require(packet.size >= 6 && packet[0] == 0xAB.toByte() && packet[1] == 0x55.toByte())
        val declared = ((packet[2].toInt() and 0xff) shl 8) or (packet[3].toInt() and 0xff)
        require(packet.size == declared + 4)
        val command = packet[4].toInt() and 0xff
        val payload = packet.copyOfRange(5, packet.lastIndex)
        require(((command + payload.sumOf { it.toInt() and 0xff }) and 0xff) == (packet.last().toInt() and 0xff))
        return EyevueFrame(command, payload)
    }

    fun battery() = datagram(CMD_BATTERY, 0)
    fun capacity() = datagram(CMD_CAPACITY, 0)
    fun photo() = datagram(CMD_PHOTO, 0x31)
    fun video(start: Boolean) = if (start) datagram(CMD_VIDEO, 1) else datagram(CMD_STOP_RECORD, 0)
    fun audio(start: Boolean) = datagram(CMD_AUDIO, if (start) 1 else 0)
    fun stopVendorVoice() = datagram(CMD_STOP_VOICE, 0)
}

/** Handles split AA14 frames and the raw AA15 image stream. */
class EyevueFrameDecoder {
    private val bytes = ByteArrayOutputStream()
    fun reset() {
        bytes.reset()
    }

    fun append(chunk: ByteArray): List<EyevueFrame> {
        bytes.write(chunk)
        val source = bytes.toByteArray()
        val frames = mutableListOf<EyevueFrame>()
        var cursor = 0
        while (cursor + 4 <= source.size) {
            while (cursor + 1 < source.size && (source[cursor] != 0xAB.toByte() || source[cursor + 1] != 0x55.toByte())) cursor++
            if (cursor + 4 > source.size) break
            val length = ((source[cursor + 2].toInt() and 0xff) shl 8) or (source[cursor + 3].toInt() and 0xff)
            val size = length + 4
            if (length < 2 || cursor + size > source.size) break
            runCatching { EyevueProtocol.parse(source.copyOfRange(cursor, cursor + size)) }.getOrNull()?.let(frames::add)
            cursor += size
        }
        bytes.reset()
        if (cursor < source.size) bytes.write(source, cursor, source.size - cursor)
        return frames
    }
}

class EyevuePhotoAssembler(
    private val maxPhotoBytes: Int = MAX_PHOTO_BYTES,
) {
    companion object {
        const val MAX_PHOTO_BYTES = 20 * 1024 * 1024
    }

    init {
        require(maxPhotoBytes > 0)
    }

    private val image = ByteArrayOutputStream()
    private var active = false
    fun reset() {
        active = false
        image.reset()
    }

    fun append(packet: ByteArray): ByteArray? {
        if (packet.size < 8) return null
        return when (packet[4].toInt() and 0xff) {
            EyevueProtocol.CMD_TRANSFER_START -> { image.reset(); active = true; null }
            EyevueProtocol.CMD_PHOTO_DATA -> {
                val end = packet.size - 3
                val chunkSize = end - 9
                if (active && chunkSize > 0) {
                    if (chunkSize > maxPhotoBytes - image.size()) {
                        reset()
                    } else {
                        image.write(packet, 9, chunkSize)
                    }
                }
                null
            }
            EyevueProtocol.CMD_PHOTO_END -> {
                if (!active) null else image.toByteArray().takeIf { it.isNotEmpty() }.also { active = false; image.reset() }
            }
            else -> null
        }
    }
}

