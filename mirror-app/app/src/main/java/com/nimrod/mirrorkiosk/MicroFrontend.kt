package com.nimrod.mirrorkiosk

/**
 * The audio "front end" the microWakeWord models were trained on, ported line by line from TensorFlow Lite Micro's
 * `experimental/microfrontend` C code (Apache-2.0; the copy in pymicro-features 2.0.2, with kissfft's 16-bit fixed-point FFT,
 * BSD-3-Clause). It turns 16 kHz 16-bit mono audio into 40 numbers every 10 ms (a 30 ms window): a mel filterbank, noise reduction,
 * PCAN gain control and a log scale, all in whole numbers exactly as the C code does them, so the model sees the same features as on
 * an ESPHome voice device. Pure Kotlin: `MicroFrontendTest` checks it against the C library's own output, bit for bit.
 *
 * Settings are microWakeWord's (pymicro-features `init_cfg`): 30 ms window, 10 ms step, 40 channels from 125 to 7500 Hz, smoothing
 * 10 bits with 0.025/0.06, floor 0.05, PCAN on (strength 0.95, offset 80, 21 gain bits), log on with scale shift 6.
 * `feed` returns the 40 values (0..65535); the model's float input is each value times FEATURE_SCALE.
 */
class MicroFrontend {
    companion object {
        const val SAMPLE_RATE = 16000
        const val STEP_SAMPLES = 160            // 10 ms
        const val WINDOW_SAMPLES = 480          // 30 ms
        const val CHANNELS = 40
        const val FEATURE_SCALE = 0.0390625f    // pymicro-features FLOAT32_SCALE (10/256)

        private const val FFT_SIZE = 512
        private const val NFFT = FFT_SIZE / 2   // the complex FFT inside the real one
        private const val WINDOW_BITS = 12
        private const val FILTERBANK_BITS = 12
        private const val NOISE_BITS = 14
        private const val SMOOTHING_BITS = 10
        private const val PCAN_SNR_BITS = 12
        private const val PCAN_OUTPUT_BITS = 6
        private const val LOG_SCALE_LOG2 = 16
        private const val LOG_SEGMENTS_LOG2 = 7
        private const val LOG_SCALE = 65536
        private const val LOG_COEFF = 45426L
        private val LOG_LUT = intArrayOf(
            0, 224, 442, 654, 861, 1063, 1259, 1450, 1636, 1817, 1992, 2163, 2329, 2490, 2646, 2797, 2944, 3087, 3224, 3358, 3487, 3611,
            3732, 3848, 3960, 4068, 4172, 4272, 4368, 4460, 4549, 4633, 4714, 4791, 4864, 4934, 5001, 5063, 5123, 5178, 5231, 5280, 5326,
            5368, 5408, 5444, 5477, 5507, 5533, 5557, 5578, 5595, 5610, 5622, 5631, 5637, 5640, 5641, 5638, 5633, 5626, 5615, 5602, 5586,
            5568, 5547, 5524, 5498, 5470, 5439, 5406, 5370, 5332, 5291, 5249, 5203, 5156, 5106, 5054, 5000, 4944, 4885, 4825, 4762, 4697,
            4630, 4561, 4490, 4416, 4341, 4264, 4184, 4103, 4020, 3935, 3848, 3759, 3668, 3575, 3481, 3384, 3286, 3186, 3084, 2981, 2875,
            2768, 2659, 2549, 2437, 2323, 2207, 2090, 1971, 1851, 1729, 1605, 1480, 1353, 1224, 1094, 963, 830, 695, 559, 421, 282, 142,
            0, 0,
        )

        /** C's (int16_t) cast: keep the low 16 bits, signed. */
        private fun s16(x: Int): Int = x.toShort().toInt()
        private fun u32(x: Long): Long = x and 0xFFFFFFFFL
        private fun msb32(n: Long): Int = if (n == 0L) 0 else 32 - Integer.numberOfLeadingZeros(n.toInt())
        private fun msb64(n: Long): Int = 64 - java.lang.Long.numberOfLeadingZeros(n)
        private fun freqToMel(freq: Float): Float = 1127.0f * Math.log1p((freq / 700.0f).toDouble()).toFloat()
    }

    // ---- window ----
    private val coefficients = IntArray(WINDOW_SAMPLES)
    private val input = IntArray(WINDOW_SAMPLES)
    private var inputUsed = 0
    private val windowed = IntArray(WINDOW_SAMPLES)
    private var maxAbs = 0

    // ---- FFT (kissfft, 16-bit fixed point) ----
    private val twR = IntArray(NFFT); private val twI = IntArray(NFFT)
    private val superR = IntArray(NFFT / 2); private val superI = IntArray(NFFT / 2)
    private val factors: IntArray
    private val fftIn = IntArray(FFT_SIZE)
    private val tmpR = IntArray(NFFT); private val tmpI = IntArray(NFFT)
    private val outR = IntArray(NFFT + 1); private val outI = IntArray(NFFT + 1)

    // ---- filterbank ----
    private val startIndex: Int
    private var endIndex = 0
    private val chanFreqStarts = IntArray(CHANNELS + 1)
    private val chanWeightStarts = IntArray(CHANNELS + 1)
    private val chanWidths = IntArray(CHANNELS + 1)
    private val weights: IntArray
    private val unweights: IntArray
    private val energy = LongArray(FFT_SIZE + 8)        // the C code reuses the FFT buffer; positions it never fills are read with weight 0
    private val work = LongArray(CHANNELS + 1)
    private val signal = LongArray(CHANNELS)

    // ---- noise reduction, PCAN, log ----
    private val evenSmoothing = (0.025f * (1 shl NOISE_BITS)).toInt()
    private val oddSmoothing = (0.06f * (1 shl NOISE_BITS)).toInt()
    private val minSignalRemaining = (0.05f * (1 shl NOISE_BITS)).toInt()
    private val estimate = LongArray(CHANNELS)
    private val gainLut = IntArray(4 * 32 - 3)
    private val snrShift: Int
    private val correctionBits: Int

    /** The last 40 features (valid after `feed` returned true). */
    val features = IntArray(CHANNELS)

    init {
        // window: a Hann window in 12-bit fixed point
        val arg = Math.PI.toFloat() * 2.0f / WINDOW_SAMPLES.toFloat()
        for (i in 0 until WINDOW_SAMPLES) {
            val v = 0.5f - 0.5f * Math.cos((arg * (i + 0.5f)).toDouble()).toFloat()
            coefficients[i] = Math.floor((v * (1 shl WINDOW_BITS) + 0.5f).toDouble()).toInt()
        }
        // FFT twiddles
        for (i in 0 until NFFT) {
            val phase = -2.0 * 3.141592653589793238462643383279502884197169399375105820974944 * i / NFFT
            twR[i] = s16(Math.floor(0.5 + 32767 * Math.cos(phase)).toInt()); twI[i] = s16(Math.floor(0.5 + 32767 * Math.sin(phase)).toInt())
        }
        for (i in 0 until NFFT / 2) {
            val phase = -3.14159265358979323846264338327 * ((i + 1).toDouble() / NFFT + .5)
            superR[i] = s16(Math.floor(0.5 + 32767 * Math.cos(phase)).toInt()); superI[i] = s16(Math.floor(0.5 + 32767 * Math.sin(phase)).toInt())
        }
        factors = kfFactor(NFFT)

        // filterbank (FilterbankPopulateState)
        val spectrumSize = FFT_SIZE / 2 + 1
        val centers = FloatArray(CHANNELS + 1)
        val melLow = freqToMel(125.0f)
        val melHi = freqToMel(7500.0f)
        val spacing = (melHi - melLow) / (CHANNELS + 1).toFloat()
        for (i in 0..CHANNELS) centers[i] = melLow + spacing * (i + 1)
        val hzPerSbin = 0.5f * SAMPLE_RATE / (spectrumSize.toFloat() - 1)
        startIndex = (1.5f + 125.0f / hzPerSbin).toInt()
        val actualStarts = IntArray(CHANNELS + 1)
        val actualWidths = IntArray(CHANNELS + 1)
        var chanFreqIndexStart = startIndex
        var weightIndexStart = 0
        var needsZeros = false
        for (chan in 0..CHANNELS) {
            var freqIndex = chanFreqIndexStart
            while (freqToMel(freqIndex * hzPerSbin) <= centers[chan]) freqIndex++
            val width = freqIndex - chanFreqIndexStart
            actualStarts[chan] = chanFreqIndexStart
            actualWidths[chan] = width
            if (width == 0) {
                chanFreqStarts[chan] = 0; chanWeightStarts[chan] = 0; chanWidths[chan] = 4
                if (!needsZeros) {
                    needsZeros = true
                    for (j in 0 until chan) chanWeightStarts[j] += 4
                    weightIndexStart += 4
                }
            } else {
                val alignedStart = (chanFreqIndexStart / 2) * 2          // 4-byte alignment of int16 indexes
                val alignedWidth = chanFreqIndexStart - alignedStart + width
                val paddedWidth = ((alignedWidth - 1) / 4 + 1) * 4
                chanFreqStarts[chan] = alignedStart
                chanWeightStarts[chan] = weightIndexStart
                chanWidths[chan] = paddedWidth
                weightIndexStart += paddedWidth
            }
            chanFreqIndexStart = freqIndex
        }
        weights = IntArray(weightIndexStart); unweights = IntArray(weightIndexStart)
        for (chan in 0..CHANNELS) {
            var frequency = actualStarts[chan]
            val offset = frequency - chanFreqStarts[chan]
            val ws = chanWeightStarts[chan]
            val denom = if (chan == 0) melLow else centers[chan - 1]
            for (j in 0 until actualWidths[chan]) {
                val w = (centers[chan] - freqToMel(frequency * hzPerSbin)) / (centers[chan] - denom)
                weights[ws + offset + j] = s16(Math.floor((w * (1 shl FILTERBANK_BITS) + 0.5f).toDouble()).toInt())
                unweights[ws + offset + j] = s16(Math.floor(((1.0f - w) * (1 shl FILTERBANK_BITS) + 0.5f).toDouble()).toInt())
                frequency++
            }
            if (frequency > endIndex) endIndex = frequency
        }
        check(endIndex < spectrumSize)

        // PCAN gain table (PcanGainControlPopulateState)
        correctionBits = msb32(FFT_SIZE.toLong()) - 1 - (FILTERBANK_BITS / 2)
        snrShift = 21 - correctionBits - PCAN_SNR_BITS
        val inputBits = SMOOTHING_BITS - correctionBits
        fun gain(x: Long): Int {
            val xf = x.toFloat() / (1L shl inputBits).toFloat()
            val g = (1L shl 21).toFloat() * Math.pow((xf + 80.0f).toDouble(), (-0.95f).toDouble()).toFloat()
            return if (g > 0x7FFF) 0x7FFF else (g + 0.5f).toInt().toShort().toInt()
        }
        gainLut[0] = gain(0); gainLut[1] = gain(1)
        for (interval in 2..32) {
            val x0 = 1L shl (interval - 1)
            val x1 = x0 + (x0 shr 1)
            val x2 = if (interval == 32) x0 + (x0 - 1) else 2 * x0
            val y0 = gain(x0); val y1 = gain(x1); val y2 = gain(x2)
            val diff1 = y1 - y0; val diff2 = y2 - y0
            val a1 = 4 * diff1 - diff2
            val a2 = diff2 - a1
            gainLut[4 * interval - 6] = y0
            gainLut[4 * interval - 5] = s16(a1)
            gainLut[4 * interval - 4] = s16(a2)
        }
        reset()
    }

    /** Back to silence (FrontendReset), for example after the mic was closed. */
    fun reset() {
        input.fill(0); windowed.fill(0); inputUsed = 0; maxAbs = 0
        fftIn.fill(0); outR.fill(0); outI.fill(0)
        work.fill(0); estimate.fill(0)
    }

    /**
     * Give up to `count` samples (FrontendProcessSamples). Returns how many were used; `ready` is then true when a new set of 40
     * features is in `features`. Call it with 160 samples (10 ms) at a time, as pymicro-features does.
     */
    var ready = false; private set

    fun feed(samples: ShortArray, offset: Int = 0, count: Int = samples.size - offset): Int {
        ready = false
        val take = minOf(WINDOW_SAMPLES - inputUsed, count)
        for (i in 0 until take) input[inputUsed + i] = samples[offset + i].toInt()
        inputUsed += take
        if (inputUsed < WINDOW_SAMPLES) return take

        // window
        var max = 0
        for (i in 0 until WINDOW_SAMPLES) {
            val v = s16((input[i] * coefficients[i]) shr WINDOW_BITS)
            windowed[i] = v
            val a = s16(if (v < 0) -v else v)
            if (a > max) max = a
        }
        System.arraycopy(input, STEP_SAMPLES, input, 0, WINDOW_SAMPLES - STEP_SAMPLES)
        inputUsed -= STEP_SAMPLES
        maxAbs = max

        // FFT, scaled up so the fixed-point FFT keeps as much resolution as it can
        val inputShift = 15 - msb32(maxAbs.toLong())
        for (i in 0 until WINDOW_SAMPLES) fftIn[i] = s16((windowed[i] and 0xFFFF) shl inputShift)
        for (i in WINDOW_SAMPLES until FFT_SIZE) fftIn[i] = 0
        kissFftr()

        // energy and filterbank
        for (i in startIndex until endIndex) {
            val re = outR[i]; val im = outI[i]
            energy[i] = (re * re + im * im).toLong()               // int32 in C, then read back sign-extended
        }
        var w = 0L; var u = 0L
        for (i in 0..CHANNELS) {
            val fs = chanFreqStarts[i]; val wsx = chanWeightStarts[i]
            for (j in 0 until chanWidths[i]) {
                val mag = if (fs + j in startIndex until endIndex) energy[fs + j] else 0L
                w += weights[wsx + j] * mag
                u += unweights[wsx + j] * mag
            }
            work[i] = w; w = u; u = 0L
        }
        for (i in 0 until CHANNELS) signal[i] = u32(sqrt64(work[i + 1]) ushr inputShift)

        // noise reduction
        for (i in 0 until CHANNELS) {
            val smoothing = (if (i and 1 == 0) evenSmoothing else oddSmoothing).toLong()
            val oneMinus = (1L shl NOISE_BITS) - smoothing
            val scaledUp = u32(signal[i] shl SMOOTHING_BITS)
            var est = u32((scaledUp * smoothing + estimate[i] * oneMinus) ushr NOISE_BITS)
            estimate[i] = est
            if (est > scaledUp) est = scaledUp
            val floor = u32((signal[i] * minSignalRemaining) ushr NOISE_BITS)
            val subtracted = (scaledUp - est) ushr SMOOTHING_BITS
            signal[i] = if (subtracted > floor) subtracted else floor
        }

        // PCAN gain control
        for (i in 0 until CHANNELS) {
            val gain = u32(wideDynamic(estimate[i]).toLong())
            val snr = u32((signal[i] * gain) ushr snrShift)
            signal[i] = pcanShrink(snr)
        }

        // log scale
        for (i in 0 until CHANNELS) {
            var v = signal[i]
            v = if (correctionBits < 0) v ushr -correctionBits else u32(v shl correctionBits)
            v = if (v > 1) log(v) else 0
            features[i] = if (v < 0xFFFF) v.toInt() else 0xFFFF
        }
        ready = true
        return take
    }

    // ---------------- kissfft, 16-bit fixed point (only the radix-4 and radix-2 steps a 256-point FFT needs) ----------------

    private fun kfFactor(n0: Int): IntArray {
        val out = ArrayList<Int>()
        var n = n0; var p = 4
        val floorSqrt = Math.floor(Math.sqrt(n.toDouble()))
        do {
            while (n % p != 0) {
                p = when (p) { 4 -> 2; 2 -> 3; else -> p + 2 }
                if (p > floorSqrt) p = n
            }
            n /= p
            out.add(p); out.add(n)
        } while (n > 1)
        return out.toIntArray()
    }

    private fun sround(x: Int): Int = s16((x + (1 shl 14)) shr 15)

    private fun kissFftr() {
        // the 512 real samples are read as 256 complex ones (even = real, odd = imaginary)
        kfWork(0, 0, 1, 0)
        var tdcR = tmpR[0]; var tdcI = tmpI[0]
        tdcR = sround(tdcR * (32767 / 2)); tdcI = sround(tdcI * (32767 / 2))
        outR[0] = s16(tdcR + tdcI); outR[NFFT] = s16(tdcR - tdcI)
        outI[0] = 0; outI[NFFT] = 0
        for (k in 1..NFFT / 2) {
            var fpkR = tmpR[k]; var fpkI = tmpI[k]
            var fpnkR = tmpR[NFFT - k]; var fpnkI = s16(-tmpI[NFFT - k])
            fpkR = sround(fpkR * 16383); fpkI = sround(fpkI * 16383)
            fpnkR = sround(fpnkR * 16383); fpnkI = sround(fpnkI * 16383)
            val f1kR = s16(fpkR + fpnkR); val f1kI = s16(fpkI + fpnkI)
            val f2kR = s16(fpkR - fpnkR); val f2kI = s16(fpkI - fpnkI)
            val twr = sround(f2kR * superR[k - 1] - f2kI * superI[k - 1])
            val twi = sround(f2kR * superI[k - 1] + f2kI * superR[k - 1])
            outR[k] = s16((f1kR + twr) shr 1); outI[k] = s16((f1kI + twi) shr 1)
            outR[NFFT - k] = s16((f1kR - twr) shr 1); outI[NFFT - k] = s16((twi - f1kI) shr 1)
        }
    }

    /** kf_work: out[outPos..] = FFT of the input read from complex index `inPos` every `fstride`. */
    private fun kfWork(outPos: Int, inPos: Int, fstride: Int, fi: Int) {
        val p = factors[fi]; val m = factors[fi + 1]
        var f = inPos
        if (m == 1) {
            for (j in 0 until p) { tmpR[outPos + j] = fftIn[2 * f]; tmpI[outPos + j] = fftIn[2 * f + 1]; f += fstride }
        } else {
            for (j in 0 until p) { kfWork(outPos + j * m, f, fstride * p, fi + 2); f += fstride }
        }
        when (p) {
            4 -> bfly4(outPos, fstride, m)
            2 -> bfly2(outPos, fstride, m)
            else -> throw IllegalStateException("radix $p is not needed for a 256-point FFT")
        }
    }

    private fun bfly2(pos: Int, fstride: Int, m: Int) {
        for (k in 0 until m) {
            val a = pos + k; val b = a + m
            tmpR[a] = sround(tmpR[a] * 16383); tmpI[a] = sround(tmpI[a] * 16383)
            tmpR[b] = sround(tmpR[b] * 16383); tmpI[b] = sround(tmpI[b] * 16383)
            val t = k * fstride
            val tr = sround(tmpR[b] * twR[t] - tmpI[b] * twI[t]); val ti = sround(tmpR[b] * twI[t] + tmpI[b] * twR[t])
            tmpR[b] = s16(tmpR[a] - tr); tmpI[b] = s16(tmpI[a] - ti)
            tmpR[a] = s16(tmpR[a] + tr); tmpI[a] = s16(tmpI[a] + ti)
        }
    }

    private fun bfly4(pos: Int, fstride: Int, m: Int) {
        for (k in 0 until m) {
            val i0 = pos + k; val i1 = i0 + m; val i2 = i0 + 2 * m; val i3 = i0 + 3 * m
            for (i in intArrayOf(i0, i1, i2, i3)) { tmpR[i] = sround(tmpR[i] * 8191); tmpI[i] = sround(tmpI[i] * 8191) }
            val t1 = k * fstride; val t2 = 2 * k * fstride; val t3 = 3 * k * fstride
            val s0r = sround(tmpR[i1] * twR[t1] - tmpI[i1] * twI[t1]); val s0i = sround(tmpR[i1] * twI[t1] + tmpI[i1] * twR[t1])
            val s1r = sround(tmpR[i2] * twR[t2] - tmpI[i2] * twI[t2]); val s1i = sround(tmpR[i2] * twI[t2] + tmpI[i2] * twR[t2])
            val s2r = sround(tmpR[i3] * twR[t3] - tmpI[i3] * twI[t3]); val s2i = sround(tmpR[i3] * twI[t3] + tmpI[i3] * twR[t3])
            val s5r = s16(tmpR[i0] - s1r); val s5i = s16(tmpI[i0] - s1i)
            tmpR[i0] = s16(tmpR[i0] + s1r); tmpI[i0] = s16(tmpI[i0] + s1i)
            val s3r = s16(s0r + s2r); val s3i = s16(s0i + s2i)
            val s4r = s16(s0r - s2r); val s4i = s16(s0i - s2i)
            tmpR[i2] = s16(tmpR[i0] - s3r); tmpI[i2] = s16(tmpI[i0] - s3i)
            tmpR[i0] = s16(tmpR[i0] + s3r); tmpI[i0] = s16(tmpI[i0] + s3i)
            tmpR[i1] = s16(s5r + s4i); tmpI[i1] = s16(s5i - s4r)
            tmpR[i3] = s16(s5r - s4i); tmpI[i3] = s16(s5i + s4r)
        }
    }

    // ---------------- square roots, PCAN, log (whole numbers, as the C code) ----------------

    private fun sqrt32(n0: Long): Long {
        var num = n0
        if (num == 0L) return 0
        var res = 0L
        var maxBit = 32 - msb32(num)
        maxBit = maxBit or 1
        var bit = 1L shl (31 - maxBit)
        var iterations = (31 - maxBit) / 2 + 1
        while (iterations-- > 0) {
            if (num >= res + bit) { num -= res + bit; res = (res ushr 1) + bit } else res = res ushr 1
            bit = bit ushr 2
        }
        if (num > res && res != 0xFFFFL) res++
        return res and 0xFFFF
    }

    private fun sqrt64(n0: Long): Long {
        var num = n0
        if ((num ushr 32) == 0L) return sqrt32(num)
        var res = 0L
        var maxBit = 64 - msb64(num)
        maxBit = maxBit or 1
        var bit = 1L shl (63 - maxBit)
        var iterations = (63 - maxBit) / 2 + 1
        while (iterations-- > 0) {
            if (java.lang.Long.compareUnsigned(num, res + bit) >= 0) { num -= res + bit; res = (res ushr 1) + bit } else res = res ushr 1
            bit = bit ushr 2
        }
        if (java.lang.Long.compareUnsigned(num, res) > 0 && res != 0xFFFFFFFFL) res++
        return u32(res)
    }

    private fun wideDynamic(x: Long): Int {
        if (x <= 2) return gainLut[x.toInt()]
        val interval = msb32(x)
        val base = 4 * interval - 6
        val frac = (if (interval < 11) u32(x shl (11 - interval)) else (x ushr (interval - 11))).toInt() and 0x3FF
        var result = (gainLut[base + 2] * frac) shr 5
        result += gainLut[base + 1] shl 5
        result *= frac
        result = (result + (1 shl 14)) shr 15
        result += gainLut[base]
        return s16(result)
    }

    private fun pcanShrink(x: Long): Long =
        if (x < (2L shl PCAN_SNR_BITS)) u32(x * x) ushr (2 + 2 * PCAN_SNR_BITS - PCAN_OUTPUT_BITS)
        else u32((x ushr (PCAN_SNR_BITS - PCAN_OUTPUT_BITS)) - (1L shl PCAN_OUTPUT_BITS))

    private fun log(x: Long): Long {
        val integer = msb32(x) - 1
        var frac = (x - (1L shl integer)).toInt()
        frac = if (integer < LOG_SCALE_LOG2) frac shl (LOG_SCALE_LOG2 - integer) else frac shr (integer - LOG_SCALE_LOG2)
        val baseSeg = frac ushr (LOG_SCALE_LOG2 - LOG_SEGMENTS_LOG2)
        val segUnit = (1 shl LOG_SCALE_LOG2) shr LOG_SEGMENTS_LOG2
        val c0 = LOG_LUT[baseSeg]; val c1 = LOG_LUT[baseSeg + 1]
        val relPos = ((c1 - c0) * (frac - segUnit * baseSeg)) shr LOG_SCALE_LOG2
        val fraction = u32((frac + c0 + relPos).toLong())
        val log2 = u32((integer.toLong() shl LOG_SCALE_LOG2) + fraction)
        val round = (LOG_SCALE / 2).toLong()
        val loge = u32((LOG_COEFF * log2 + round) ushr LOG_SCALE_LOG2)
        return u32((u32(loge shl 6) + round) ushr LOG_SCALE_LOG2)
    }
}
