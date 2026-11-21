package com.nimrod.mirrorkiosk

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class EspProtoTest {
    private fun hex(b: ByteArray) = b.joinToString("") { String.format("%02x", it.toInt() and 0xFF) }

    @Test fun frameIsZeroLengthTypePayload() {
        // PingResponse (8), empty payload: 00 00 08
        assertEquals("000008", hex(EspProto.frame(8, ByteArray(0))))
        // a 300-byte payload needs a two-byte varint length (ac 02)
        val f = EspProto.frame(93, ByteArray(300))
        assertEquals("00ac025d", hex(f.copyOf(4)))
        assertEquals(304, f.size)
    }

    @Test fun readFrameRoundTrip() {
        val payload = EspProto.helloResponse("glass-panes-abcdef")
        val stream = ByteArrayInputStream(EspProto.frame(2, payload) + EspProto.frame(8, ByteArray(0)))
        val a = EspProto.readFrame(stream)!!
        assertEquals(2, a.type); assertArrayEquals(payload, a.payload)
        assertEquals(8, EspProto.readFrame(stream)!!.type)
        assertEquals(null, EspProto.readFrame(stream))
    }

    @Test(expected = EspProto.NoiseRequested::class) fun noiseHelloIsRecognised() {
        EspProto.readFrame(ByteArrayInputStream(byteArrayOf(1, 0, 0)))
    }

    @Test fun helloResponseFields() {
        val f = EspProto.parse(EspProto.helloResponse("glass-panes-abcdef"))
        assertEquals(1, f.int(1)); assertEquals(14, f.int(2)); assertEquals("glass-panes-abcdef", f.string(4))
    }

    @Test fun deviceInfoCarriesFlagsOnlyWhenOn() {
        val on = EspProto.parse(EspProto.deviceInfoResponse(EspProto.DeviceInfo("n", "F", "02:11:22:33:44:55", "02:11:22:33:44:56", "2025.9.0", 33, 37)))
        assertEquals(33, on.int(15)); assertEquals(37, on.int(17)); assertEquals("02:11:22:33:44:56", on.string(18)); assertEquals("02:11:22:33:44:55", on.string(3))
        val off = EspProto.parse(EspProto.deviceInfoResponse(EspProto.DeviceInfo("n", "F", "02:11:22:33:44:55", "x", "v", 0, 0)))
        assertEquals(0, off.int(15)); assertEquals(0, off.int(17)); assertEquals("", off.string(18))
    }

    @Test fun rawAdvertisementEncoding() {
        val adv = EspProto.Adv(EspProto.macToLong("AA:BB:CC:DD:EE:FF"), -60, byteArrayOf(2, 1, 6))
        val outer = EspProto.parse(EspProto.rawAdvertisements(listOf(adv, adv)))
        assertEquals(2, outer.all(1).size)
        val inner = EspProto.parse(outer.all(1)[0] as ByteArray)
        assertEquals(0xAABBCCDDEEFFL, inner.long(1))
        // sint32 zigzag: -60 -> 119
        assertEquals(119L, inner.long(2))
        assertArrayEquals(byteArrayOf(2, 1, 6), inner.bytes(4))
    }

    @Test fun macHelpers() {
        assertEquals(0xAABBCCDDEEFFL, EspProto.macToLong("AA:BB:CC:DD:EE:FF"))
        assertEquals(-1L, EspProto.macToLong("02:00:00:00:00"))
        assertEquals(-1L, EspProto.macToLong(null))
        assertEquals("AA:BB:CC:DD:EE:FF", EspProto.longToMac(0xAABBCCDDEEFFL))
        val m = EspProto.localMac(byteArrayOf(0xFF.toByte(), 1, 2, 3, 4, 5))
        assertEquals("FE:01:02:03:04:05", m)          // locally administered bit set, multicast bit cleared
        assertEquals("glass-panes-030405", EspProto.deviceName(m))
    }

    @Test fun trimStopsAtPaddingAndCaps() {
        val raw = ByteArray(62); raw[0] = 2; raw[1] = 1; raw[2] = 6; raw[3] = 3; raw[4] = 0xFF.toByte(); raw[5] = 1; raw[6] = 2
        assertArrayEquals(raw.copyOf(7), EspProto.trimAdvertisement(raw))
        val overrun = byteArrayOf(2, 1, 6, 9, 1)            // second structure claims 9 bytes but only 1 follows
        assertArrayEquals(byteArrayOf(2, 1, 6), EspProto.trimAdvertisement(overrun))
        assertEquals(0, EspProto.trimAdvertisement(null).size)
        assertTrue(EspProto.trimAdvertisement(ByteArray(100) { 1 }).size <= 62)
    }

    @Test fun voiceMessages() {
        val r = EspProto.parse(EspProto.voiceAssistantRequest(true))
        assertTrue(r.bool(1)); assertEquals(0, r.int(3))
        val stop = EspProto.parse(EspProto.voiceAssistantRequest(false))
        assertEquals(false, stop.bool(1))
        val a = EspProto.parse(EspProto.voiceAudio(byteArrayOf(1, 2, 3, 4)))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), a.bytes(1))
    }

    @Test fun eventParsing() {
        val data = EspProto.Writer().string(1, "url").string(2, "http://ha.local:8123/api/tts_proxy/x.mp3").bytes()
        val ev = EspProto.Writer().uint(1, EspProto.EV_TTS_END).message(2, data).bytes()
        val (type, map) = EspProto.parseEvent(ev)
        assertEquals(8, type); assertEquals("http://ha.local:8123/api/tts_proxy/x.mp3", map["url"])
    }

    @Test fun deviceInfoSaysEncryptionIsSupportedAndWhetherAKeyMayBeHandedOver() {
        val f = EspProto.parse(EspProto.deviceInfoResponse(EspProto.DeviceInfo("n", "F", "m", "b", "v", 0, 0, provisionable = true)))
        assertTrue(f.bool(19)); assertTrue(f.bool(26))
        val g = EspProto.parse(EspProto.deviceInfoResponse(EspProto.DeviceInfo("n", "F", "m", "b", "v", 0, 0, provisionable = false)))
        assertTrue(g.bool(19)); assertEquals(false, g.bool(26))
    }

    @Test fun wakeWordConfiguration() {
        val r = EspProto.parse(EspProto.configurationResponse(listOf(EspProto.WakeWordInfo("okay_nabu", "Okay Nabu", listOf("en", "nl"))), listOf("okay_nabu"), 1))
        val ww = EspProto.parse(r.all(1)[0] as ByteArray)
        assertEquals("okay_nabu", ww.string(1)); assertEquals("Okay Nabu", ww.string(2)); assertEquals(2, ww.all(3).size)
        assertEquals("okay_nabu", r.string(2)); assertEquals(1, r.int(3))
        assertEquals(0, EspProto.configurationResponse(emptyList(), emptyList(), 0).size)
        assertEquals(listOf("hey_jarvis"), EspProto.parseSetConfiguration(EspProto.Writer().string(1, "hey_jarvis").bytes()))
    }

    @Test fun setKeyMessages() {
        val req = EspProto.Writer().bytes(1, "QUJD".toByteArray()).bytes()
        assertArrayEquals("QUJD".toByteArray(), EspProto.parseSetKey(req))
        assertTrue(EspProto.parse(EspProto.setKeyResponse(true)).bool(1))
        assertEquals(0, EspProto.setKeyResponse(false).size)
    }

    @Test fun base64RoundTripsAndIsStrict() {
        for (n in 1..40) {
            val b = ByteArray(n) { (it * 37 + n).toByte() }
            assertArrayEquals(b, EspProto.unbase64(EspProto.base64(b)))
        }
        assertEquals("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", EspProto.base64(ByteArray(32)))   // aioesphomeapi ZERO_NOISE_PSK
        assertEquals(null, EspProto.unbase64("abc"))
        assertEquals(null, EspProto.unbase64("ab=c"))
        assertEquals(null, EspProto.unbase64("a-cd"))
        assertEquals("fe0102030405", EspProto.plainMac("FE:01:02:03:04:05"))
    }

    @Test fun loudness() {
        assertEquals(-120.0, EspProto.rmsDb(ByteArray(10), 10), 0.01)
        val full = ByteArray(4); full[0] = 0xFF.toByte(); full[1] = 0x7F; full[2] = 0xFF.toByte(); full[3] = 0x7F
        assertEquals(0.0, EspProto.rmsDb(full, 4), 0.01)
    }
}
