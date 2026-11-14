package com.nimrod.mirrorkiosk

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.widget.FrameLayout
import android.widget.ImageView

/**
 * The native video layer over the browser: a looping, silent video played with Android's own MediaPlayer (the browser engine
 * cannot start a video decoder on this device). The rules are in VideoLogic.kt.
 *
 * It draws into a TextureView, not a VideoView, because only a TextureView can hand back the picture it is showing. When a new
 * address arrives while a video is up, that picture goes up as a still, the old player is released, the new one opens on the
 * same surface, and the still comes down once the new video's first frame is on screen. Up to app 0.12.0 the old video was
 * stopped first, and the screen showed what was under it (black) for the 1-2 s the new one took to open.
 *
 * Only one MediaPlayer, so one hardware decoder, exists at a time. Everything here runs on the main thread.
 * [state] gets "starting" | "playing" | "stopped" | "error <what>/<extra>" (what /status shows as "video"); [note] writes the
 * diary (/log), never with a full address (signed links carry a token in their query).
 */
class VideoLayer(
    private val ctx: Context,
    private val root: FrameLayout,
    private val state: (String) -> Unit,
    private val note: (String) -> Unit,
) : TextureView.SurfaceTextureListener {

    private val main = Handler(Looper.getMainLooper())
    private val gate = VideoLogic.Gate()
    private var view: FitTextureView? = null
    private var surface: Surface? = null
    private var player: MediaPlayer? = null
    private var url: String? = null
    private var shown = "stopped"                 // the last state handed to [state]
    private var still: ImageView? = null          // the old video's last picture, up while the new one opens
    private var stillSinceMs = 0L

    /** Frames that reached the screen since the layer was made (for measuring smoothness). */
    var framesShown = 0L
        private set

    fun play(wanted: String) {
        when (VideoLogic.decide(view != null, url, shown, wanted)) {
            VideoLogic.Start.IGNORE -> return
            VideoLogic.Start.NEW_LAYER -> {
                url = wanted
                val v = FitTextureView(ctx)
                v.surfaceTextureListener = this
                root.addView(v, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER))
                view = v
                framesShown = 0
                set("starting")
                note("start " + AudioLogic.safeLabel(wanted))
                // the player opens once the layer has its surface (onSurfaceTextureAvailable)
            }
            VideoLogic.Start.SWAP -> {
                url = wanted
                val t0 = SystemClock.elapsedRealtime()
                val held = holdPicture()
                val t1 = SystemClock.elapsedRealtime()
                releasePlayer()
                val t2 = SystemClock.elapsedRealtime()
                set("starting")
                note("swap to " + AudioLogic.safeLabel(wanted) + ": " +
                    (if (held) "last frame held (grab " + (t1 - t0) + " ms)" else if (still != null) "still already up" else "nothing on screen to hold") +
                    ", old player released in " + (t2 - t1) + " ms")
                if (surface != null) open()
            }
        }
    }

    /** Takes the video away and shows what is under it. [finalState] is what /status says afterwards. */
    fun stop(finalState: String = "stopped") {
        val v = view
        gate.newPlayer()                          // late callbacks from the old player change nothing
        releasePlayer()
        dropStill(null)
        view = null                               // before removeView, so onSurfaceTextureDestroyed knows it was us
        url = null
        if (v != null) {
            root.removeView(v)
            if (finalState == "stopped") note("stop")
        }
        surface?.release()
        surface = null
        set(finalState)
    }

    private fun set(s: String) {
        shown = s
        state(s)
    }

    private fun open() {
        val s = surface ?: return
        val target = url ?: return
        val g = gate.newPlayer()
        val mp = MediaPlayer()
        player = mp
        try {
            mp.setSurface(s)
            mp.setDataSource(target)
            mp.setVolume(0f, 0f)
            mp.isLooping = true
            mp.setOnPreparedListener { p ->
                if (g != gate.gen) return@setOnPreparedListener
                p.isLooping = true
                p.setVolume(0f, 0f)
                gate.prepared(g)
                p.start()
                set("playing")
                // a device that never reports its first frame must not keep the old picture up for long
                main.postDelayed({ if (gate.stillTimedOut(g)) dropStill("no first-frame report") }, VideoLogic.STILL_MAX_MS)
            }
            mp.setOnInfoListener { _, what, _ ->
                if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) gate.renderingStarted(g)
                false
            }
            mp.setOnVideoSizeChangedListener { _, w, h -> if (g == gate.gen) view?.setVideoSize(w, h) }
            mp.setOnErrorListener { _, what, extra ->
                if (g == gate.gen) fail("$what/$extra")
                true
            }
            mp.prepareAsync()
            // a video that never opens (a dead link, a server that never answers) must not hold the old picture forever
            main.postDelayed({
                if (gate.waiting(g)) fail(MediaPlayer.MEDIA_ERROR_TIMED_OUT.toString() + "/0")
            }, VideoLogic.PREPARE_TIMEOUT_MS)
        } catch (e: Exception) {
            fail("1/0 " + e.javaClass.simpleName)                  // 1 = MEDIA_ERROR_UNKNOWN
        }
    }

    private fun fail(what: String) {
        note("error " + what)
        stop("error " + what)
    }

    private fun releasePlayer() {
        val p = player ?: return
        player = null
        try { p.reset() } catch (e: Exception) { }
        try { p.release() } catch (e: Exception) { }
    }

    /** Puts the picture on screen up as a still above the video, if a frame of the current video is showing. True if it did. */
    private fun holdPicture(): Boolean {
        if (still != null) return false           // a swap is already under way: its still is still the right picture
        val v = view ?: return false
        if (!gate.onScreen || !v.isAvailable) return false
        val pic: Bitmap = try { v.bitmap } catch (e: Throwable) { null } ?: return false      // out of memory: this swap just isn't seamless
        val iv = ImageView(ctx)
        iv.scaleType = ImageView.ScaleType.FIT_XY
        iv.setImageBitmap(pic)
        root.addView(iv, FrameLayout.LayoutParams(v.width, v.height, Gravity.CENTER))      // added after the video, so above it
        still = iv
        stillSinceMs = SystemClock.elapsedRealtime()
        return true
    }

    private fun dropStill(why: String?) {
        val iv = still ?: return
        still = null
        root.removeView(iv)
        iv.setImageDrawable(null)                 // the picture is left to the garbage collector (recycling it mid-frame is unsafe)
        if (why != null) note("swapped: last frame held " + (SystemClock.elapsedRealtime() - stillSinceMs) + " ms (" + why + ")")
    }

    // ---------------------------------------------------------------- the layer's surface

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        if (view?.surfaceTexture !== st) return
        surface?.release()
        surface = Surface(st)
        if (player == null && url != null) {
            if (shown != "starting") set("starting")
            open()
        }
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {}

    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        // Our own stop() cleared `view` first. Otherwise the window went away (the screen slept): let go of the player and open
        // it again when the surface comes back, as VideoView did.
        if (view != null) {
            gate.newPlayer()
            releasePlayer()
            dropStill(null)
            surface?.release()
            surface = null
        }
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {
        framesShown++
        // called while the frame is being drawn, so the still comes down in the next one, with the new video already under it
        if (gate.frameShown() && still != null) main.post { dropStill("first frame") }
    }

    /** A TextureView that keeps the video's shape (VideoView did the same), centred by its layout gravity. */
    private class FitTextureView(ctx: Context) : TextureView(ctx) {
        private var videoW = 0
        private var videoH = 0

        fun setVideoSize(w: Int, h: Int) {
            if (w == videoW && h == videoH) return
            videoW = w; videoH = h
            requestLayout()
        }

        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            val box = VideoLogic.fit(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec), videoW, videoH)
            setMeasuredDimension(box[0], box[1])
        }
    }
}
