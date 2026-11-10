package com.nimrod.mirrorkiosk

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * The maths behind the microphone test (GET /mic/test), with no Android in it so it is tested on its own in src/test.
 *
 * The test listens for a few seconds and reports only NUMBERS about how loud it was. The sound itself is never stored, never sent
 * anywhere and never logged: each chunk is measured and thrown away (see MicProbe.kt).
 */
object MicLevel {
    const val SAMPLE_RATE = 16000                 // what Home Assistant's voice pipeline wants too
    val SECONDS = 1..10
    const val DEFAULT_SECONDS = 3
    const val SILENT_DB = -60.0                   // reported for an all-zero signal instead of minus infinity

    /** Running totals for one test. Add chunks of 16-bit samples, then ask for the result. */
    class Meter {
        private var count = 0L
        private var sumSquares = 0.0
        private var peak = 0
        private var zeros = 0L

        fun add(samples: ShortArray, length: Int) {
            for (i in 0 until length) {
                val v = samples[i].toInt()
                sumSquares += v.toDouble() * v
                val a = abs(v)
                if (a > peak) peak = a
                if (v == 0) zeros++
            }
            count += length
        }

        fun samples(): Long = count

        fun result(): Result {
            if (count == 0L) return Result(0, SILENT_DB, SILENT_DB, 0.0)
            val rms = sqrt(sumSquares / count)
            return Result(count, toDb(rms), toDb(peak.toDouble()), zeros.toDouble() / count)
        }
    }

    /** `rmsDb` and `peakDb` are decibels relative to full scale (0 = as loud as the format goes, negative = quieter). */
    data class Result(val samples: Long, val rmsDb: Double, val peakDb: Double, val zeroShare: Double)

    fun toDb(amplitude: Double): Double {
        if (amplitude <= 0.0) return SILENT_DB
        return (20 * log10(amplitude / 32768.0)).coerceIn(SILENT_DB, 0.0)
    }

    /** A plain-words reading of a result, so the person running the test does not have to know what decibels are. */
    fun verdict(r: Result, seconds: Int): String = when {
        r.samples < SAMPLE_RATE.toLong() * seconds / 2 -> "the microphone gave far less sound than expected (it may be busy or blocked)"
        r.zeroShare > 0.999 -> "the microphone is silent: every sample was zero (no working microphone, or it is muted)"
        r.peakDb < -50.0 -> "almost silent: the microphone works but hears nearly nothing (very quiet room, or a weak microphone)"
        r.peakDb < -20.0 -> "the microphone hears sound at a normal level"
        else -> "the microphone hears loud sound (or is clipping)"
    }

    fun checkSeconds(s: Int?): String? = if (s == null || s !in SECONDS) "use seconds from ${SECONDS.first} to ${SECONDS.last}" else null

    fun json(r: Result, seconds: Int, error: String?): String {
        if (error != null) return "{\"ok\":false,\"error\":\"" + AudioLogic.jsonEscape(error) + "\"}"
        return "{\"ok\":true,\"seconds\":" + seconds + ",\"sample_rate\":" + SAMPLE_RATE + ",\"samples\":" + r.samples +
            ",\"rms_db\":" + String.format(java.util.Locale.US, "%.1f", r.rmsDb) +
            ",\"peak_db\":" + String.format(java.util.Locale.US, "%.1f", r.peakDb) +
            ",\"zero_share\":" + String.format(java.util.Locale.US, "%.3f", r.zeroShare) +
            ",\"verdict\":\"" + AudioLogic.jsonEscape(verdict(r, seconds)) + "\"}"
    }
}
