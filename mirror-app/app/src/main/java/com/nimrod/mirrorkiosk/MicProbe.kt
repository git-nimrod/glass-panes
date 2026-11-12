package com.nimrod.mirrorkiosk

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

/**
 * GET /mic/test?seconds=3: listens through the microphone for a few seconds and reports how loud it was (numbers only).
 * It answers one question: does this mirror have a working microphone? Nothing is saved, sent anywhere or written to the diary;
 * every chunk is measured and dropped (see MicLevel.kt). Only one test runs at a time.
 */
object MicProbe {
    private val busy = java.util.concurrent.atomic.AtomicBoolean(false)

    /** Blocks for about `seconds` seconds, so call it from the request's own thread. Returns the JSON answer. */
    fun run(ctx: Context, seconds: Int): String {
        if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return MicLevel.json(MicLevel.Meter().result(), seconds,
                "the app has no permission to use the microphone. Grant it once with: adb shell pm grant com.nimrod.mirrorkiosk android.permission.RECORD_AUDIO")
        }
        if (!busy.compareAndSet(false, true)) return MicLevel.json(MicLevel.Meter().result(), seconds, "a microphone test is already running")
        var rec: AudioRecord? = null
        try {
            val minBytes = AudioRecord.getMinBufferSize(MicLevel.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (minBytes <= 0) return MicLevel.json(MicLevel.Meter().result(), seconds, "this device offers no 16 kHz microphone input (code $minBytes)")
            rec = AudioRecord(MediaRecorder.AudioSource.MIC, MicLevel.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBytes * 4)
            if (rec.state != AudioRecord.STATE_INITIALIZED) return MicLevel.json(MicLevel.Meter().result(), seconds, "the microphone could not be opened (something else may be using it)")
            val meter = MicLevel.Meter()
            val chunk = ShortArray(MicLevel.SAMPLE_RATE / 10)
            val wanted = MicLevel.SAMPLE_RATE.toLong() * seconds
            val deadline = Kiosk.mono() + seconds * 1000L + 3000      // never hang if the microphone stops delivering
            rec.startRecording()
            while (meter.samples() < wanted && Kiosk.mono() < deadline) {
                val n = rec.read(chunk, 0, chunk.size)
                if (n < 0) return MicLevel.json(MicLevel.Meter().result(), seconds, "reading the microphone failed (code $n)")
                if (n > 0) meter.add(chunk, n)
            }
            Kiosk.log("mic_test", "seconds=" + seconds)                              // that a test ran, never what was heard
            return MicLevel.json(meter.result(), seconds, null)
        } catch (e: Exception) {
            return MicLevel.json(MicLevel.Meter().result(), seconds, "the microphone test failed (" + e.javaClass.simpleName + ")")
        } finally {
            try { rec?.stop() } catch (e: Exception) { }
            try { rec?.release() } catch (e: Exception) { }
            busy.set(false)
        }
    }
}
