package com.nimrod.mirrorkiosk

/**
 * The wake-word rules that need no Android: which models the app carries, how audio features become the model's int8 input, and
 * when the model's answers count as "the wake word was said". Mirrors pymicro-wakeword 2.5.0 (`microwakeword.py`), which is what
 * Home Assistant's own microWakeWord add-on uses. Tested in WakeLogicTest; the model itself runs in WakeWord.kt (TensorFlow Lite).
 */
object WakeLogic {
    /** A bundled model (assets/wakeword/<id>.tflite). Values from its JSON file next to it. */
    class Model(val id: String, val phrase: String, val languages: List<String>, val cutoff: Float, val window: Int)

    val MODELS = listOf(
        Model("okay_nabu", "Okay Nabu", listOf("en", "nl", "fr", "de", "it", "es", "sv"), 0.85f, 5),
        Model("hey_jarvis", "Hey Jarvis", listOf("en"), 0.97f, 5),
        Model("hey_mycroft", "Hey Mycroft", listOf("en"), 0.95f, 5),
    )
    const val DEFAULT_MODEL = "okay_nabu"

    fun model(id: String?): Model = MODELS.firstOrNull { it.id == id } ?: MODELS.first { it.id == DEFAULT_MODEL }

    /** After a wake, ignore the model for this long, so one "Okay Nabu" never starts two turns. */
    const val COOLDOWN_MS = 2000L

    /** Feature value (0..65535 from MicroFrontend) -> the model's int8 input: round(value * 0.0390625 / scale + zeroPoint), clamped. */
    fun quantize(value: Int, scale: Float, zeroPoint: Int): Byte {
        val q = Math.rint(value * MicroFrontend.FEATURE_SCALE.toDouble() / scale.toDouble() + zeroPoint).toInt()
        return q.coerceIn(-128, 127).toByte()
    }

    /** The model's uint8 output -> a probability 0..1. */
    fun dequantize(raw: Int, scale: Float, zeroPoint: Int): Float = ((raw and 0xFF) - zeroPoint) * scale

    /**
     * Collects the model's answers: `add` takes one probability and says whether the wake word was just heard (the average of the
     * last `window` answers is above the cutoff, and the cooldown since the last wake is over). Not thread-safe: one listener thread.
     */
    class Detector(private val cutoff: Float, private val window: Int) {
        private val recent = ArrayDeque<Float>()
        private var lastWakeMs = Long.MIN_VALUE / 2
        var lastAverage = 0f; private set
        var peak = 0f; private set

        fun add(probability: Float, nowMs: Long): Boolean {
            recent.addLast(probability)
            while (recent.size > window) recent.removeFirst()
            if (recent.size < window) { lastAverage = 0f; return false }
            lastAverage = recent.sum() / window
            if (lastAverage > peak) peak = lastAverage
            if (lastAverage <= cutoff || nowMs - lastWakeMs < COOLDOWN_MS) return false
            lastWakeMs = nowMs
            recent.clear()
            return true
        }

        fun reset() { recent.clear(); lastAverage = 0f }
        fun resetPeak() { peak = 0f }
    }
}
