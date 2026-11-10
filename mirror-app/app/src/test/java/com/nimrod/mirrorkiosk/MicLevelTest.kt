package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The microphone test must tell silence, a weak microphone and a working one apart, and must report numbers only. */
class MicLevelTest {
    private fun feed(meter: MicLevel.Meter, value: Short, count: Int) {
        val chunk = ShortArray(count) { value }
        meter.add(chunk, count)
    }

    @Test fun anAllZeroSignalIsSilentAndSaysSo() {
        val m = MicLevel.Meter()
        feed(m, 0, 48_000)
        val r = m.result()
        assertEquals(MicLevel.SILENT_DB, r.rmsDb, 0.001)
        assertEquals(MicLevel.SILENT_DB, r.peakDb, 0.001)
        assertEquals(1.0, r.zeroShare, 0.0001)
        assertTrue(MicLevel.verdict(r, 3).contains("silent: every sample was zero"))
    }

    @Test fun fullScaleIsZeroDecibels() {
        val m = MicLevel.Meter()
        feed(m, 32767, 48_000)
        val r = m.result()
        assertEquals(0.0, r.peakDb, 0.01)
        assertEquals(0.0, r.rmsDb, 0.01)
        assertTrue(MicLevel.verdict(r, 3).contains("loud"))
    }

    @Test fun halfAmplitudeIsAboutMinusSixDecibels() {
        val m = MicLevel.Meter()
        feed(m, 16384, 48_000)
        assertEquals(-6.0, m.result().peakDb, 0.1)
    }

    @Test fun aWeakButAliveSignalIsToldApartFromSilence() {
        val m = MicLevel.Meter()
        val chunk = ShortArray(48_000) { i -> if (i % 2 == 0) 40 else -40 }      // about -58 dB
        m.add(chunk, chunk.size)
        val r = m.result()
        assertTrue(r.peakDb < -50.0 && r.peakDb > -80.0)
        assertFalse(MicLevel.verdict(r, 3).contains("every sample was zero"))
        assertTrue(MicLevel.verdict(r, 3).contains("almost silent"))
    }

    @Test fun aNormalSpeechLevelIsReportedAsNormal() {
        val m = MicLevel.Meter()
        val chunk = ShortArray(48_000) { i -> if (i % 2 == 0) 3000 else -3000 }     // about -20 dB
        m.add(chunk, chunk.size)
        assertTrue(MicLevel.verdict(m.result(), 3).contains("normal level"))
    }

    @Test fun tooFewSamplesMeansTheMicrophoneWasBusyOrBlocked() {
        val m = MicLevel.Meter()
        feed(m, 1000, 1000)                                                         // far fewer than 3 seconds of audio
        assertTrue(MicLevel.verdict(m.result(), 3).contains("far less sound"))
        assertEquals(0L, MicLevel.Meter().samples())
        assertEquals(0, MicLevel.Meter().result().samples.toInt())
    }

    @Test fun onlyPartOfAChunkIsCounted() {
        val m = MicLevel.Meter()
        val chunk = ShortArray(100) { 30000 }
        m.add(chunk, 10)
        assertEquals(10L, m.samples())
    }

    @Test fun secondsMustBeOneToTen() {
        assertNull(MicLevel.checkSeconds(1)); assertNull(MicLevel.checkSeconds(10)); assertNull(MicLevel.checkSeconds(3))
        assertNotNull(MicLevel.checkSeconds(0)); assertNotNull(MicLevel.checkSeconds(11)); assertNotNull(MicLevel.checkSeconds(null))
    }

    @Test fun theAnswerHasNumbersAndAVerdictAndNothingElse() {
        val m = MicLevel.Meter()
        feed(m, 3000, 48_000)
        val json = MicLevel.json(m.result(), 3, null)
        assertTrue(json.startsWith("{\"ok\":true,\"seconds\":3,\"sample_rate\":16000,\"samples\":48000"))
        assertTrue(json.contains("\"rms_db\":-20.8") || json.contains("\"rms_db\":-20.7"))
        assertTrue(json.contains("\"verdict\":\"the microphone hears sound at a normal level\""))
        val failed = MicLevel.json(MicLevel.Meter().result(), 3, "permission \"denied\"")
        assertEquals("{\"ok\":false,\"error\":\"permission \\\"denied\\\"\"}", failed)
    }
}
