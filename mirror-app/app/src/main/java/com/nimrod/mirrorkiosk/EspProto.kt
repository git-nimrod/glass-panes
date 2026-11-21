package com.nimrod.mirrorkiosk

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream

/**
 * The pieces of ESPHome's "native API" that Home Assistant speaks to an ESPHome device, written by hand with no Android in them,
 * so they are tested on their own in src/test (EspProtoTest, and EspWireTest against the real aioesphomeapi client).
 *
 * The mirror is the server (port 6053) and Home Assistant connects to it. A plaintext frame is byte 0x00, varint payload length,
 * varint message id, then a protobuf payload; the encrypted (Noise) framing is in EspNoise. Message ids and field numbers are from
 * aioesphomeapi 46.30.1 (`api_pb2`, checked Nov 19, 2026).
 */
object EspProto {
    // ---- message ids (api.proto `option (id)`) ----
    const val HELLO_REQUEST = 1
    const val HELLO_RESPONSE = 2
    const val DISCONNECT_REQUEST = 5
    const val DISCONNECT_RESPONSE = 6
    const val PING_REQUEST = 7
    const val PING_RESPONSE = 8
    const val DEVICE_INFO_REQUEST = 9
    const val DEVICE_INFO_RESPONSE = 10
    const val LIST_ENTITIES_REQUEST = 11
    const val LIST_ENTITIES_DONE = 19
    const val SUBSCRIBE_STATES = 20
    const val SUBSCRIBE_LOGS = 28
    const val SUBSCRIBE_HA_SERVICES = 34
    const val SUBSCRIBE_HA_STATES = 38
    const val SUBSCRIBE_BLE_ADVERTISEMENTS = 66
    const val UNSUBSCRIBE_BLE_ADVERTISEMENTS = 87
    const val SUBSCRIBE_VOICE_ASSISTANT = 89
    const val VOICE_ASSISTANT_REQUEST = 90
    const val VOICE_ASSISTANT_RESPONSE = 91
    const val VOICE_ASSISTANT_EVENT = 92
    const val BLE_RAW_ADVERTISEMENTS = 93
    const val VOICE_ASSISTANT_AUDIO = 106
    const val VOICE_ASSISTANT_ANNOUNCE_REQUEST = 119
    const val VOICE_ASSISTANT_ANNOUNCE_FINISHED = 120
    const val VOICE_ASSISTANT_CONFIG_REQUEST = 121
    const val VOICE_ASSISTANT_CONFIG_RESPONSE = 122
    const val VOICE_ASSISTANT_SET_CONFIG = 123
    const val NOISE_SET_KEY_REQUEST = 124
    const val NOISE_SET_KEY_RESPONSE = 125

    /** We answer API 1.14: below 1.15 Home Assistant reads the feature flags from DeviceInfoResponse itself. */
    const val API_MAJOR = 1
    const val API_MINOR = 14

    // ---- feature flags (aioesphomeapi model.py) ----
    const val BT_PASSIVE_SCAN = 1
    const val BT_RAW_ADVERTISEMENTS = 32
    const val BT_FLAGS = BT_PASSIVE_SCAN or BT_RAW_ADVERTISEMENTS            // 33, as ESPHome's passive proxy sends
    const val VA_VOICE_ASSISTANT = 1
    const val VA_API_AUDIO = 4
    const val VA_ANNOUNCE = 16
    const val VA_START_CONVERSATION = 32
    /** 53: voice, audio over the API, announcements and start_conversation. No SPEAKER, so answers come as a URL the app plays. */
    const val VA_FLAGS = VA_VOICE_ASSISTANT or VA_API_AUDIO or VA_ANNOUNCE or VA_START_CONVERSATION

    // ---- voice events (api.proto VoiceAssistantEvent) ----
    const val EV_ERROR = 0
    const val EV_RUN_START = 1
    const val EV_RUN_END = 2
    const val EV_STT_START = 3
    const val EV_STT_END = 4
    const val EV_TTS_END = 8
    const val EV_STT_VAD_START = 11
    const val EV_STT_VAD_END = 12
    const val EV_TTS_STREAM_START = 98
    const val EV_TTS_STREAM_END = 99

    // ---- VoiceAssistantRequest flags ----
    const val REQUEST_USE_VAD = 1
    const val REQUEST_USE_WAKE_WORD = 2

    /** Largest frame we accept from Home Assistant; anything bigger closes the connection. */
    const val MAX_FRAME = 256 * 1024
    /** ESPHome's BLUETOOTH_PROXY_ADVERTISEMENT_BATCH_SIZE default. */
    const val ADV_BATCH = 16
    /** BluetoothLERawAdvertisement.data is at most 62 bytes (advertisement + scan response). */
    const val ADV_MAX = 62

    // ================= protobuf writing =================

    class Writer {
        private val out = ByteArrayOutputStream()
        fun bytes(): ByteArray = out.toByteArray()

        private fun rawVarint(value: Long) {
            var v = value
            while (true) {
                if ((v and 0x7FL.inv()) == 0L) { out.write(v.toInt()); return }
                out.write(((v and 0x7F) or 0x80).toInt())
                v = v ushr 7
            }
        }
        private fun tag(field: Int, wire: Int) = rawVarint(((field shl 3) or wire).toLong())

        /** uint32 / uint64 / enum. proto3: a zero is left out. */
        fun varint(field: Int, value: Long): Writer { if (value != 0L) { tag(field, 0); rawVarint(value) }; return this }
        fun uint(field: Int, value: Int): Writer = varint(field, value.toLong() and 0xFFFFFFFFL)
        fun bool(field: Int, value: Boolean): Writer = varint(field, if (value) 1 else 0)
        /** sint32 (zigzag). Written even when zero, like ESPHome's `force` on rssi. */
        fun sint32(field: Int, value: Int, force: Boolean = false): Writer {
            val z = ((value shl 1) xor (value shr 31)).toLong() and 0xFFFFFFFFL
            if (z != 0L || force) { tag(field, 0); rawVarint(z) }
            return this
        }
        fun uint64Forced(field: Int, value: Long): Writer { tag(field, 0); rawVarint(value); return this }
        fun bytes(field: Int, value: ByteArray, force: Boolean = false): Writer {
            if (value.isNotEmpty() || force) { tag(field, 2); rawVarint(value.size.toLong()); out.write(value) }
            return this
        }
        fun string(field: Int, value: String): Writer = bytes(field, value.toByteArray(Charsets.UTF_8))
        fun message(field: Int, value: ByteArray): Writer { tag(field, 2); rawVarint(value.size.toLong()); out.write(value); return this }
        fun float(field: Int, value: Float): Writer {
            if (value != 0f) { tag(field, 5); val b = java.lang.Float.floatToIntBits(value); for (i in 0 until 4) out.write((b ushr (8 * i)) and 0xFF) }
            return this
        }
    }

    fun varintBytes(value: Long): ByteArray {
        val o = ByteArrayOutputStream(); var v = value
        while (true) { if ((v and 0x7FL.inv()) == 0L) { o.write(v.toInt()); break }; o.write(((v and 0x7F) or 0x80).toInt()); v = v ushr 7 }
        return o.toByteArray()
    }

    // ================= protobuf reading =================

    /** A decoded message: each field number maps to its values in order (Long for varints and fixed ints, ByteArray for bytes). */
    class Fields(private val map: Map<Int, List<Any>>) {
        fun long(f: Int): Long = (map[f]?.lastOrNull() as? Long) ?: 0L
        fun int(f: Int): Int = long(f).toInt()
        fun bool(f: Int): Boolean = long(f) != 0L
        fun bytes(f: Int): ByteArray = (map[f]?.lastOrNull() as? ByteArray) ?: ByteArray(0)
        fun string(f: Int): String = String(bytes(f), Charsets.UTF_8)
        fun all(f: Int): List<Any> = map[f] ?: emptyList()
    }

    fun parse(data: ByteArray): Fields {
        val map = HashMap<Int, MutableList<Any>>()
        var i = 0
        fun varint(): Long {
            var result = 0L; var shift = 0
            while (true) {
                if (i >= data.size) throw IOException("truncated varint")
                val b = data[i++].toInt() and 0xFF
                result = result or ((b and 0x7F).toLong() shl shift)
                if (b and 0x80 == 0) return result
                shift += 7
                if (shift > 63) throw IOException("varint too long")
            }
        }
        while (i < data.size) {
            val key = varint()
            val field = (key ushr 3).toInt()
            val value: Any = when ((key and 7).toInt()) {
                0 -> varint()
                1 -> { if (i + 8 > data.size) throw IOException("truncated"); var v = 0L; for (k in 0 until 8) v = v or ((data[i + k].toLong() and 0xFF) shl (8 * k)); i += 8; v }
                2 -> { val n = varint().toInt(); if (n < 0 || i + n > data.size) throw IOException("truncated"); val b = data.copyOfRange(i, i + n); i += n; b }
                5 -> { if (i + 4 > data.size) throw IOException("truncated"); var v = 0L; for (k in 0 until 4) v = v or ((data[i + k].toLong() and 0xFF) shl (8 * k)); i += 4; v }
                else -> throw IOException("unsupported wire type")
            }
            map.getOrPut(field) { ArrayList() }.add(value)
        }
        return Fields(map)
    }

    // ================= framing (plaintext) =================

    fun frame(type: Int, payload: ByteArray): ByteArray {
        val len = varintBytes(payload.size.toLong())
        val t = varintBytes(type.toLong())
        val out = ByteArray(1 + len.size + t.size + payload.size)
        out[0] = 0
        System.arraycopy(len, 0, out, 1, len.size)
        System.arraycopy(t, 0, out, 1 + len.size, t.size)
        System.arraycopy(payload, 0, out, 1 + len.size + t.size, payload.size)
        return out
    }

    class Frame(val type: Int, val payload: ByteArray)

    /** Thrown when the client starts a Noise (encrypted) session: byte 0x01 instead of 0x00. */
    class NoiseRequested : IOException("the client wants an encrypted (Noise) connection")

    private fun readVarint(input: InputStream): Long {
        var result = 0L; var shift = 0
        while (true) {
            val b = input.read()
            if (b < 0) throw EOFException()
            result = result or ((b and 0x7F).toLong() shl shift)
            if (b and 0x80 == 0) return result
            shift += 7
            if (shift > 35) throw IOException("varint too long")
        }
    }

    /** Reads one frame (blocking). Null at a clean end of the stream. */
    fun readFrame(input: InputStream): Frame? {
        val first = input.read()
        if (first < 0) return null
        if (first == 1) throw NoiseRequested()
        if (first != 0) throw IOException("not an ESPHome plaintext frame")
        val len = readVarint(input)
        if (len < 0 || len > MAX_FRAME) throw IOException("frame too large")
        val type = readVarint(input).toInt()
        val payload = ByteArray(len.toInt())
        var off = 0
        while (off < payload.size) {
            val n = input.read(payload, off, payload.size - off)
            if (n < 0) throw EOFException()
            off += n
        }
        return Frame(type, payload)
    }

    // ================= message bodies =================

    fun helloResponse(name: String): ByteArray =
        Writer().uint(1, API_MAJOR).uint(2, API_MINOR).string(3, "Glass Panes mirror").string(4, name).bytes()

    class DeviceInfo(
        val name: String, val friendlyName: String, val mac: String, val btMac: String,
        val version: String, val btFlags: Int, val voiceFlags: Int,
        /** Always true: the mirror speaks Noise. */
        val encryptionSupported: Boolean = true,
        /** True while the mirror has no key yet: Home Assistant may then hand one over on a zero-key Noise connection. */
        val provisionable: Boolean = false,
    )

    fun deviceInfoResponse(d: DeviceInfo): ByteArray {
        val w = Writer()
            .string(2, d.name)
            .string(3, d.mac)
            .string(4, d.version)
            .string(6, "Lululemon Studio Mirror (Android 6)")
            .string(12, "Glass Panes")
            .string(13, d.friendlyName)
            .uint(15, d.btFlags)
            .uint(17, d.voiceFlags)
        if (d.btFlags != 0) w.string(18, d.btMac)
        w.bool(19, d.encryptionSupported).bool(26, d.provisionable)
        return w.bytes()
    }

    /** One advertisement for BluetoothLERawAdvertisementsResponse: address uint64, rssi sint32, address_type, data (<= 62 bytes). */
    class Adv(val address: Long, val rssi: Int, val data: ByteArray)

    fun rawAdvertisements(batch: List<Adv>): ByteArray {
        val w = Writer()
        for (a in batch) {
            val inner = Writer().uint64Forced(1, a.address).sint32(2, a.rssi, force = true).bytes(4, a.data, force = true).bytes()
            w.message(1, inner)
        }
        return w.bytes()
    }

    fun voiceAssistantRequest(start: Boolean, conversationId: String = "", flags: Int = 0, wakeWordPhrase: String = ""): ByteArray =
        Writer().bool(1, start).string(2, conversationId).uint(3, flags).string(5, wakeWordPhrase).bytes()

    fun voiceAudio(pcm: ByteArray, end: Boolean = false): ByteArray = Writer().bytes(1, pcm).bool(2, end).bytes()

    fun announceFinished(success: Boolean): ByteArray = Writer().bool(1, success).bytes()

    /** A wake word the mirror can listen for (VoiceAssistantWakeWord): its id, the phrase, and the languages it was trained on. */
    class WakeWordInfo(val id: String, val phrase: String, val languages: List<String>)

    /**
     * VoiceAssistantConfigurationResponse: the wake words on offer, the active ones, and how many may be active. Home Assistant shows
     * the list as the ESPHome device's "Wake word" select. With the wake word switched off the list is empty, so there is no select.
     */
    fun configurationResponse(available: List<WakeWordInfo>, active: List<String>, maxActive: Int): ByteArray {
        val w = Writer()
        for (ww in available) {
            val inner = Writer().string(1, ww.id).string(2, ww.phrase)
            for (l in ww.languages) inner.string(3, l)
            w.message(1, inner.bytes())
        }
        for (a in active) w.string(2, a)
        return w.uint(3, maxActive).bytes()
    }

    /** VoiceAssistantSetConfiguration: the wake word ids Home Assistant chose. */
    fun parseSetConfiguration(payload: ByteArray): List<String> = parse(payload).all(1).map { String(it as ByteArray, Charsets.UTF_8) }

    /** NoiseEncryptionSetKeyRequest.key: the new key as Home Assistant sends it (base64 text of 32 bytes). Empty means "clear". */
    fun parseSetKey(payload: ByteArray): ByteArray = parse(payload).bytes(1)

    fun setKeyResponse(success: Boolean): ByteArray = Writer().bool(1, success).bytes()

    /** DisconnectRequest with a reason (1 = provisioning closed). */
    fun disconnectRequest(reason: Int): ByteArray = Writer().uint(1, reason).bytes()

    /** VoiceAssistantEventResponse: the event type and its data as name -> value. */
    fun parseEvent(payload: ByteArray): Pair<Int, Map<String, String>> {
        val f = parse(payload)
        val data = HashMap<String, String>()
        for (raw in f.all(2)) {
            val d = parse(raw as ByteArray)
            data[d.string(1)] = d.string(2)
        }
        return f.int(1) to data
    }

    // ================= helpers =================

    /** "AA:BB:CC:DD:EE:FF" -> 0xAABBCCDDEEFF (most significant byte first, as ESPHome packs it). -1 if it is not a MAC. */
    fun macToLong(mac: String?): Long {
        if (mac == null) return -1
        val parts = mac.split(':')
        if (parts.size != 6) return -1
        var v = 0L
        for (p in parts) { val b = p.toIntOrNull(16) ?: return -1; if (p.length != 2) return -1; v = (v shl 8) or b.toLong() }
        return v
    }

    fun longToMac(v: Long): String = (5 downTo 0).joinToString(":") { String.format("%02X", (v ushr (8 * it)) and 0xFF) }

    /**
     * Android's ScanRecord.getBytes() is the raw 62-byte buffer, padded with zeros. Keep only the AD structures (length, type, data...)
     * up to the first zero length, at most 62 bytes, so Home Assistant parses exactly what was on the air.
     */
    fun trimAdvertisement(raw: ByteArray?): ByteArray {
        if (raw == null) return ByteArray(0)
        val limit = minOf(raw.size, ADV_MAX)
        var i = 0
        while (i < limit) {
            val l = raw[i].toInt() and 0xFF
            if (l == 0) break
            if (i + 1 + l > limit) break           // a structure that runs past the end: drop it
            i += 1 + l
        }
        return raw.copyOfRange(0, i)
    }

    /**
     * A made-up, stable MAC for this mirror (Android 6 only gives apps 02:00:00:00:00:00). "Locally administered", unicast, from
     * six random bytes saved once in the settings. Home Assistant keys the device on it, so it must never change.
     */
    fun localMac(random: ByteArray): String {
        require(random.size >= 6)
        val b = random.copyOf(6)
        b[0] = ((b[0].toInt() and 0xFC) or 0x02).toByte()    // locally administered, unicast
        return b.joinToString(":") { String.format("%02X", it.toInt() and 0xFF) }
    }

    /** ESPHome device names are lowercase letters, digits and dashes. */
    fun deviceName(mac: String): String = "glass-panes-" + mac.replace(":", "").takeLast(6).lowercase()

    // ---- base64 (Android 6 has no java.util.Base64; android.util.Base64 is not available in the PC tests) ----

    private const val B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    fun base64(data: ByteArray): String {
        val sb = StringBuilder()
        var i = 0
        while (i < data.size) {
            val b0 = data[i].toInt() and 0xFF
            val b1 = if (i + 1 < data.size) data[i + 1].toInt() and 0xFF else -1
            val b2 = if (i + 2 < data.size) data[i + 2].toInt() and 0xFF else -1
            sb.append(B64[b0 shr 2])
            sb.append(B64[((b0 and 3) shl 4) or (if (b1 < 0) 0 else b1 shr 4)])
            sb.append(if (b1 < 0) '=' else B64[((b1 and 15) shl 2) or (if (b2 < 0) 0 else b2 shr 6)])
            sb.append(if (b2 < 0) '=' else B64[b2 and 63])
            i += 3
        }
        return sb.toString()
    }

    /** Strict standard base64 (with padding), or null if it is not that. */
    fun unbase64(text: String): ByteArray? {
        val t = text.trim()
        if (t.isEmpty() || t.length % 4 != 0) return null
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < t.length) {
            val c = IntArray(4) { k -> val ch = t[i + k]; if (ch == '=') -2 else B64.indexOf(ch) }
            if (c.any { it == -1 } || c[0] < 0 || c[1] < 0) return null
            if (c[2] == -2 && c[3] != -2) return null
            if ((c[2] == -2 || c[3] == -2) && i + 4 != t.length) return null
            out.write((c[0] shl 2) or (c[1] shr 4))
            if (c[2] >= 0) out.write(((c[1] and 15) shl 4) or (c[2] shr 2))
            if (c[3] >= 0) out.write(((c[2] and 3) shl 6) or c[3])
            i += 4
        }
        return out.toByteArray()
    }

    /** ESPHome's MAC form in the Noise server hello: 12 lower-case hex digits. */
    fun plainMac(mac: String): String = mac.replace(":", "").lowercase()

    /** 16-bit PCM loudness of one chunk in dBFS (little-endian bytes), for the /esphome numbers (never the audio itself). */
    fun rmsDb(pcm: ByteArray, n: Int): Double {
        if (n < 2) return -120.0
        var sum = 0.0; var count = 0
        var i = 0
        while (i + 1 < n) { val s = ((pcm[i + 1].toInt() shl 8) or (pcm[i].toInt() and 0xFF)).toShort().toDouble(); sum += s * s; count++; i += 2 }
        val rms = Math.sqrt(sum / count) / 32768.0
        return if (rms <= 0) -120.0 else 20 * Math.log10(rms)
    }
}
