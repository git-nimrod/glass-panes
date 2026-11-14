package com.nimrod.mirrorkiosk

/**
 * The rules for the native video layer, with no Android in them so they are tested on their own in src/test (VideoLogicTest).
 * VideoLayer.kt is the part that talks to Android.
 *
 * A new address swaps the video in place: the frame on screen is held up as a still picture while the old player lets go of its
 * decoder and the new one opens, and the still comes down once the NEW video has drawn a frame of its own. So the screen does not
 * go black between two videos, and only one decoder is ever open (the mirror's chip and memory are small).
 */
object VideoLogic {
    /** How long a new video may take to open before it counts as an error (the page then tries again, see player widgets.js). */
    const val PREPARE_TIMEOUT_MS = 20_000L

    /** The longest the held frame stays up after the new video has opened, in case the device never reports its first frame. */
    const val STILL_MAX_MS = 3_000L

    enum class Start { IGNORE, NEW_LAYER, SWAP }

    /**
     * What /video/start should do. The address already playing (or opening) changes nothing, so the page can ask again safely.
     * Anything else replaces it: on a fresh layer when there is none, otherwise in place.
     */
    fun decide(hasLayer: Boolean, current: String?, state: String, wanted: String): Start = when {
        !hasLayer -> Start.NEW_LAYER
        wanted == current && !state.startsWith("error") -> Start.IGNORE
        else -> Start.SWAP
    }

    /**
     * The largest box with the video's shape that fits in [w] x [h] (the caller centres it). Until the video's size is known it
     * fills the space. Whole-number maths, so a video with the screen's own shape fills it exactly.
     */
    fun fit(w: Int, h: Int, videoW: Int, videoH: Int): IntArray {
        if (w <= 0 || h <= 0 || videoW <= 0 || videoH <= 0) return intArrayOf(w, h)
        return if (videoW.toLong() * h > w.toLong() * videoH) intArrayOf(w, (w.toLong() * videoH / videoW).toInt())    // wider: full width
        else intArrayOf((h.toLong() * videoW / videoH).toInt(), h)                                                     // taller or the same: full height
    }

    /**
     * When the held frame may come down, for one player after another. Every new player gets a new number, so a late callback from
     * an old one changes nothing. Frames that reach the screen before the new player has said its first picture is on its way
     * (MEDIA_INFO_VIDEO_RENDERING_START) do not count: a decoder may push blank frames while it shuts down, and those must stay
     * hidden under the still.
     */
    class Gate {
        var gen = 0
            private set
        private var prepared = false
        private var renderingStarted = false
        private var framesSincePrepared = 0

        /** A frame of the current video has been on screen, so a swap has something to hold up. */
        var onScreen = false
            private set

        /** A new player is about to open. Returns its number. */
        fun newPlayer(): Int {
            gen++
            prepared = false; renderingStarted = false; framesSincePrepared = 0; onScreen = false
            return gen
        }

        fun prepared(g: Int) { if (g == gen) prepared = true }

        /** True while player [g] is the current one and has not opened yet (for the open timeout). */
        fun waiting(g: Int): Boolean = g == gen && !prepared

        fun renderingStarted(g: Int) { if (g == gen && prepared) renderingStarted = true }

        /** A frame reached the screen. True when it is the current video's own, so the held frame can come down now. */
        fun frameShown(): Boolean {
            if (!prepared) return false
            framesSincePrepared++
            if (renderingStarted) onScreen = true
            return renderingStarted
        }

        /**
         * [STILL_MAX_MS] after player [g] opened. True when the still should come down anyway (the device never reported the first
         * frame). Frames seen since it opened count as being on screen then.
         */
        fun stillTimedOut(g: Int): Boolean {
            if (g != gen) return false
            if (framesSincePrepared > 0) onScreen = true
            return true
        }
    }
}
