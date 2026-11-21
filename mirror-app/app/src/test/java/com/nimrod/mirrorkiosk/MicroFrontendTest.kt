package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The Kotlin front end must give exactly what the C front end gives (pymicro-features 2.0.2, the code ESPHome and microWakeWord
 * use), or the wake-word model sees different numbers than it was trained on. The reference files are made by
 * mirror-app/tools/make_frontend_vectors.py: a 3-second test sound (silence, a rising tone, loud noise, a clipped tone, quiet).
 */
class MicroFrontendTest {
    private fun resource(name: String): ByteArray = javaClass.classLoader!!.getResourceAsStream("microfrontend/$name")!!.readBytes()

    private fun run(chunk: Int): List<IntArray> {
        val audio = resource("audio.raw")
        val samples = ShortArray(audio.size / 2)
        ByteBuffer.wrap(audio).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
        val fe = MicroFrontend()
        val out = ArrayList<IntArray>()
        var pos = 0
        while (pos + chunk <= samples.size) {
            pos += fe.feed(samples, pos, chunk)
            if (fe.ready) out.add(fe.features.copyOf())
        }
        return out
    }

    private fun reference(): List<IntArray> {
        val raw = resource("features.raw")
        val b = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN)
        return (0 until raw.size / 80).map { IntArray(40) { b.short.toInt() and 0xFFFF } }
    }

    @Test fun matchesTheCFrontEndBitForBit() {
        val want = reference()
        val got = run(MicroFrontend.STEP_SAMPLES)
        assertEquals(want.size, got.size)
        var differing = 0
        val firstDiff = StringBuilder()
        for (f in want.indices) for (c in 0 until 40) if (want[f][c] != got[f][c]) {
            if (differing++ < 5) firstDiff.append("frame $f channel $c: want ${want[f][c]} got ${got[f][c]}\n")
        }
        assertEquals("values that differ:\n$firstDiff", 0, differing)
    }

    @Test fun silenceGivesZerosAndTheToneGivesSomething() {
        val got = run(MicroFrontend.STEP_SAMPLES)
        assertTrue(got[5].all { it == 0 })                     // 0.4 s of silence at the start
        assertTrue(got[80].any { it > 100 })                   // the tone
    }

    @Test fun resetForgetsTheNoiseEstimate() {
        val fe = MicroFrontend()
        val loud = ShortArray(160) { if (it % 2 == 0) 20000 else -20000 }
        repeat(50) { fe.feed(loud) }
        fe.reset()
        val quiet = ShortArray(160)
        repeat(3) { fe.feed(quiet) }
        assertTrue(fe.ready && fe.features.all { it == 0 })
    }
}
