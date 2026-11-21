package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class WakeLogicTest {
    private val assets = listOf(File("src/main/assets/wakeword"), File("app/src/main/assets/wakeword")).first { it.isDirectory }

    @Test fun theTableMatchesTheBundledModelFiles() {
        for (m in WakeLogic.MODELS) {
            val json = File(assets, m.id + ".json").readText()
            assertTrue(json.contains("\"wake_word\": \"" + m.phrase + "\""))
            assertTrue(json.contains("\"probability_cutoff\": " + m.cutoff.toString()))
            assertTrue(json.contains("\"sliding_window_size\": " + m.window))
            assertTrue(json.contains("\"model\": \"" + m.id + ".tflite\""))
            for (l in m.languages) assertTrue(json.contains("\"$l\""))
            assertTrue(File(assets, m.id + ".tflite").length() in 20_000L..200_000L)
            assertTrue(File(assets, "selftest_" + m.id + ".txt").exists())
        }
        assertEquals("okay_nabu", WakeLogic.model("nope").id)
        assertEquals("hey_jarvis", WakeLogic.model("hey_jarvis").id)
    }

    @Test fun quantizeLikePymicroWakeword() {
        val scale = 0.10196078568696976f
        val zero = -128
        assertEquals(-128, WakeLogic.quantize(0, scale, zero).toInt())
        // 100 * 0.0390625 / 0.10196 - 128 = -89.69 -> -90
        assertEquals(-90, WakeLogic.quantize(100, scale, zero).toInt())
        assertEquals(127, WakeLogic.quantize(65535, scale, zero).toInt())     // clamped
        assertEquals(0.5f, WakeLogic.dequantize(128, 0.00390625f, 0), 1e-6f)
    }

    @Test fun detectorAveragesTheWindowAndWaitsAfterAWake() {
        val d = WakeLogic.Detector(0.85f, 5)
        var t = 0L
        repeat(4) { assertFalse(d.add(1f, t)); t += 30 }                   // not enough answers yet
        assertTrue(d.add(1f, t)); t += 30                                    // average 1.0 > 0.85
        repeat(5) { assertFalse(d.add(1f, t)); t += 30 }                   // cooldown
        t += WakeLogic.COOLDOWN_MS
        assertTrue(d.add(1f, t)); t += 30                                    // the window is still full of 1.0: wakes again at once
        repeat(4) { assertFalse(d.add(1f, t)); t += 30 }                   // a wake empties the window
        val e = WakeLogic.Detector(0.85f, 5)
        for (p in listOf(0.9f, 0.9f, 0.9f, 0.9f, 0.5f)) assertFalse(e.add(p, 0))   // average 0.82: not enough
        assertTrue(e.peak > 0.8f)
    }
}
