package com.nimrod.mirrorkiosk

import android.content.Context
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Listens for one wake word in 16 kHz audio, on the mirror, with a microWakeWord model bundled in the app (assets/wakeword).
 * Audio never leaves the mirror here: it becomes 40 numbers per 10 ms (MicroFrontend), three of those go into the model, and only
 * "the wake word was said" comes out. Runs on the mic thread (EspServer.Mic); one instance per model, closed when switched off.
 *
 * TensorFlow Lite 2.16.1 (Apache-2.0) runs the model on one CPU thread, without XNNPACK (less memory, and the same numbers as
 * TensorFlow's reference kernels). The streaming model keeps state between calls, so after a wake the interpreter is rebuilt.
 */
class WakeWord(private val ctx: Context, val model: WakeLogic.Model) : Closeable {
    private val modelBytes: ByteBuffer = load(ctx, "wakeword/" + model.id + ".tflite")
    private var interpreter: Interpreter = open()
    private val frontend = MicroFrontend()
    private val detector = WakeLogic.Detector(model.cutoff, model.window)
    private val stride: Int
    private val inScale: Float; private val inZero: Int
    private val outScale: Float; private val outZero: Int
    private val input: ByteBuffer
    private val output: ByteBuffer = ByteBuffer.allocateDirect(1).order(ByteOrder.nativeOrder())
    private var frames = 0

    // numbers for /esphome (no audio, no words)
    @Volatile var inferences = 0L; private set
    @Volatile var busyNs = 0L; private set
    @Volatile var wakes = 0; private set
    val peak: Float get() = detector.peak

    init {
        val t = interpreter.getInputTensor(0)
        val shape = t.shape()
        require(t.dataType() == DataType.INT8 && shape.size == 3 && shape[2] == MicroFrontend.CHANNELS) { "unexpected model input" }
        stride = shape[1]
        inScale = t.quantizationParams().scale; inZero = t.quantizationParams().zeroPoint
        val o = interpreter.getOutputTensor(0)
        require(o.dataType() == DataType.UINT8) { "unexpected model output" }
        outScale = o.quantizationParams().scale; outZero = o.quantizationParams().zeroPoint
        input = ByteBuffer.allocateDirect(stride * MicroFrontend.CHANNELS).order(ByteOrder.nativeOrder())
    }

    private fun open(): Interpreter = Interpreter(modelBytes, Interpreter.Options().setNumThreads(1).setUseXNNPACK(false))

    /** Feed audio; true when the wake word was just heard. Give 10 ms (160 samples) at a time or more. */
    fun feed(samples: ShortArray, count: Int): Boolean {
        var pos = 0
        var woke = false
        while (pos < count) {
            pos += frontend.feed(samples, pos, minOf(MicroFrontend.STEP_SAMPLES, count - pos))
            if (!frontend.ready) continue
            for (c in 0 until MicroFrontend.CHANNELS) input.put(frames * MicroFrontend.CHANNELS + c, WakeLogic.quantize(frontend.features[c], inScale, inZero))
            if (++frames < stride) continue
            frames = 0
            val raw = run()
            if (detector.add(WakeLogic.dequantize(raw, outScale, outZero), Kiosk.mono())) { woke = true; wakes++ }
        }
        return woke
    }

    private fun run(): Int {
        val t0 = System.nanoTime()
        input.rewind(); output.rewind()
        interpreter.run(input, output)
        busyNs += System.nanoTime() - t0
        inferences++
        return output.get(0).toInt() and 0xFF
    }

    /** Forget everything heard so far (after a wake, or when the mic was closed): fresh model state, front end and averages. */
    fun reset() {
        try { interpreter.close() } catch (e: Exception) { }
        interpreter = open()
        frontend.reset(); detector.reset(); frames = 0
    }

    override fun close() { try { interpreter.close() } catch (e: Exception) { } }

    /** Milliseconds of CPU per second of audio, from the model only (the front end adds well under 1 ms per second). */
    fun msPerSecond(): Double = if (inferences == 0L) 0.0 else busyNs / 1e6 / (inferences * stride * 0.010)

    companion object {
        private fun load(ctx: Context, path: String): ByteBuffer {
            val bytes = ctx.assets.open(path).use { it.readBytes() }
            return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() }
        }

        /**
         * GET /wake/selftest: run our own 3-second test sound (assets/wakeword/selftest.raw) through the front end and each model,
         * and compare the model's answers with what TensorFlow Lite gave on a PC (selftest_<model>.txt). Shows that the runtime
         * and the model work on this mirror, and how much CPU they take. It does not open the mic.
         */
        fun selftest(ctx: Context): String {
            val sb = StringBuilder("{\"ok\":true,\"models\":[")
            val audio = ctx.assets.open("wakeword/selftest.raw").use { it.readBytes() }
            val samples = ShortArray(audio.size / 2)
            ByteBuffer.wrap(audio).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
            WakeLogic.MODELS.forEachIndexed { i, m ->
                if (i > 0) sb.append(',')
                try {
                    val want = String(ctx.assets.open("wakeword/selftest_" + m.id + ".txt").use { it.readBytes() }).trim().split(',').map { it.toInt() }
                    val ww = WakeWord(ctx, m)
                    val got = ArrayList<Int>()
                    var frames = 0
                    var pos = 0
                    val t0 = System.nanoTime()
                    while (pos + MicroFrontend.STEP_SAMPLES <= samples.size) {
                        pos += ww.frontend.feed(samples, pos, MicroFrontend.STEP_SAMPLES)
                        if (!ww.frontend.ready) continue
                        for (c in 0 until MicroFrontend.CHANNELS) ww.input.put(frames * MicroFrontend.CHANNELS + c, WakeLogic.quantize(ww.frontend.features[c], ww.inScale, ww.inZero))
                        if (++frames < ww.stride) continue
                        frames = 0
                        got.add(ww.run())
                    }
                    val totalMs = (System.nanoTime() - t0) / 1e6
                    ww.close()
                    val maxDiff = if (got.size == want.size) got.indices.maxOfOrNull { Math.abs(got[it] - want[it]) } ?: 0 else -1
                    sb.append("{\"id\":\"").append(m.id).append("\",\"answers\":").append(got.size).append(",\"expected\":").append(want.size)
                        .append(",\"max_difference\":").append(maxDiff).append(",\"match\":").append(maxDiff in 0..2)
                        .append(",\"ms_for_3s_audio\":").append(String.format("%.1f", totalMs)).append('}')
                } catch (e: Throwable) {
                    sb.append("{\"id\":\"").append(m.id).append("\",\"error\":\"").append(AudioLogic.jsonEscape(e.javaClass.simpleName + ": " + (e.message ?: ""))).append("\"}")
                }
            }
            return sb.append("]}").toString()
        }
    }
}
