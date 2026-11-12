package com.nimrod.mirrorkiosk

import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.Camera
import android.os.Handler
import android.os.HandlerThread
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import kotlin.math.abs

/**
 * Presence from the mirror's camera, using only changes in light. No faces, no recognition.
 *
 * Nothing leaves the mirror except a few numbers. Pictures are squashed into a tiny 16 x 12 grid of
 * brightness in memory and thrown away; the grid is compared with the previous look (120 looks a minute
 * by default, 1-240 with /presence/tune?scans=).
 * If enough squares got brighter or darker, someone moved in front of the camera. A blurry or frosted
 * cover over the lens works fine for this, because only rough light and shadow matter.
 *
 * To keep the mirror smooth the camera runs at its slowest frame rate on a small picture, and it is
 * looked at much less often while a video plays (pause()/resume(), called from MainActivity).
 *
 * "someone there" = movement seen within the last "presence_hold_s" seconds (default 30). Results go to
 * Home Assistant through a webhook whenever that flips, plus a heartbeat ("report_interval_s", default 60).
 * The webhook id is never built in: it is set on the mirror (adb ... --es webhook "<id>"), and with none
 * set nothing is sent. GET /presence on port 8099 shows the same numbers and the current settings. The old face/distance fields are still in the JSON (always 0 / -1)
 * so anything reading them keeps working.
 */
@Suppress("DEPRECATION")      // the old Camera API is the one that works best on Android 6 with this camera chip
object Presence {
    @Volatile var state = "off"            // off | starting | running | no camera | error: ...
    @Volatile var cameras = -1             // how many cameras Android can see
    @Volatile var previewSize = ""
    @Volatile var fps = ""                 // the frame rate range the camera was told to use
    @Volatile var motion = 0.0             // share of the picture that changed in the last look (0..1)
    @Volatile var lastMotionMs = 0L
    @Volatile var present = false
    @Volatile var lastSent = ""
    @Volatile var lastFrameMs = 0L         // when the camera last handed over a picture (watchdog)
    @Volatile var cameraRestarts = 0       // times the camera was reopened after dying or going quiet

    private var cam: Camera? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var texture: SurfaceTexture? = null
    private var ctx: Context? = null
    private var w = 0
    private var h = 0
    private var bufSize = 0
    private var prevGrid: IntArray? = null
    private var lastLookMs = 0L
    private var lastReportMs = 0L
    private var sentPresent = false
    @Volatile private var slow = false
    private var failures = 0               // reopen attempts in a row without a picture arriving (for backoff)
    private var reopenPending = false

    fun start(context: Context) {
        if (thread != null) return             // already on (running, starting, stalled or retrying after an error)
        ctx = context.applicationContext
        state = "starting"
        val t = HandlerThread("mirror-presence").apply { start() }
        thread = t
        val hd = Handler(t.looper)
        handler = hd
        hd.post { open() }
        hd.postDelayed(object : Runnable {                  // heartbeat + "someone there" timeout
            override fun run() { tick(); hd.postDelayed(this, 1000) }
        }, 1000)
    }

    /** Stop and start again (used after the picture size changes). */
    fun restart(context: Context) {
        stop()
        Handler(android.os.Looper.getMainLooper()).postDelayed({ start(context) }, 1500)
    }

    fun stop() {
        val t = thread ?: return
        val hd = handler
        thread = null; handler = null           // so start() right after stop() builds a fresh thread
        hd?.removeCallbacksAndMessages(null)     // drop the tick and any pending reopen
        hd?.post {
            try { cam?.setPreviewCallbackWithBuffer(null); cam?.stopPreview(); cam?.release() } catch (e: Throwable) {}
            cam = null
            texture?.release(); texture = null
            state = "off"; present = false; slow = false; prevGrid = null; failures = 0; reopenPending = false
            t.quitSafely()
        }
    }

    /**
     * A video is playing: keep the camera on (so someone walking up is still noticed) but look much less
     * often ("video_scans_per_min", default 12 = every 5 s), which leaves the CPU to the video.
     */
    fun pause() { slow = true }

    fun resume() { slow = false }

    /**
     * Watchdog: the camera service can die (on Android 6 it shares a process with video playback) or simply
     * stop sending pictures. Either way: let go of the camera and open it again, waiting longer each time
     * (5 s, 15 s, 45 s ... up to 5 min) until pictures flow again.
     */
    private fun reopen(why: String) {
        if (reopenPending) return
        reopenPending = true
        try { cam?.setPreviewCallbackWithBuffer(null); cam?.stopPreview() } catch (e: Throwable) {}
        try { cam?.release() } catch (e: Throwable) {}
        cam = null
        texture?.release(); texture = null
        prevGrid = null
        state = why
        cameraRestarts++
        val wait = minOf(300000L, 5000L * Math.pow(3.0, minOf(failures, 5).toDouble()).toLong())
        failures++
        handler?.postDelayed({ reopenPending = false; if (state == why) { state = "starting"; open() } }, wait)
    }

    private fun open() {
        var c: Camera? = null
        try {
            cameras = Camera.getNumberOfCameras()
            if (cameras < 1) { state = "no camera"; return }
            // prefer a front-facing camera (the one looking out of the glass); otherwise the first one
            var id = 0
            val info = Camera.CameraInfo()
            for (i in 0 until cameras) {
                Camera.getCameraInfo(i, info)
                if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) { id = i; break }
            }
            c = Camera.open(id)
            val p = c.parameters
            // Motion needs only a rough picture, so a small one is used (default width 320, change it with
            // /presence/size?w=640). 4:3 shapes are preferred.
            val wantW = ctx?.let { Kiosk.prefs(it).getInt("preview_w", 320) } ?: 320
            val all = p.supportedPreviewSizes
            val four3 = all.filter { it.width * 3 == it.height * 4 }
            val size = (if (four3.isNotEmpty()) four3 else all).minByOrNull { abs(it.width - wantW) }!!
            p.setPreviewSize(size.width, size.height)
            w = size.width; h = size.height
            previewSize = "${w}x$h"
            // The camera normally streams ~30 pictures a second but only ~2 are looked at. By default ask for
            // the slowest frame rate it offers (numbers are frames per second x 1000), which saves CPU and
            // memory. "preview_fps" (set with /presence/tune?fps=) picks the range whose top speed is
            // nearest to that many frames a second instead; 0 means the slowest.
            val wantFps = (ctx?.let { Kiosk.prefs(it).getInt("preview_fps", 0) } ?: 0) * 1000
            val ranges = p.supportedPreviewFpsRange
            val chosen = if (wantFps > 0) ranges?.minWithOrNull(compareBy({ abs(it[1] - wantFps) }, { it[0] }))
                         else ranges?.minWithOrNull(compareBy({ it[1] }, { it[0] }))
            if (chosen != null) {
                p.setPreviewFpsRange(chosen[0], chosen[1])
                fps = "${chosen[0] / 1000}-${chosen[1] / 1000}"
            }
            try { c.parameters = p } catch (e: Exception) { fps = "default"; /* keep the camera's own defaults */ }
            texture = SurfaceTexture(10)                  // the picture goes nowhere on screen
            c.setPreviewTexture(texture)
            bufSize = w * h * 3 / 2
            repeat(2) { c.addCallbackBuffer(ByteArray(bufSize)) }
            c.setPreviewCallbackWithBuffer { data, camera -> look(data); camera.addCallbackBuffer(data) }
            // the camera service died or the camera hit an error: callbacks arrive on this thread's looper
            c.setErrorCallback { code, _ -> reopen("camera error $code") }
            c.startPreview()
            cam = c
            lastFrameMs = Kiosk.mono()      // the frame watchdog counts from here
            state = "running"
        } catch (e: Exception) {
            // let go of a half-opened camera, or every retry fails with "Fail to connect to camera service"
            try { c?.release() } catch (x: Throwable) {}
            if (cam === c) cam = null
            texture?.release(); texture = null
            state = "error: " + (e.message ?: e.javaClass.simpleName).replace("\"", "'")
            handler?.postDelayed({ if (state.startsWith("error")) { state = "starting"; open() } }, 30000)
        }
    }

    // ---- motion: compare a tiny brightness grid with the one from the last look ("scans_per_min", default 120) ----
    private fun look(data: ByteArray) {
        val now = Kiosk.mono()
        lastFrameMs = now; failures = 0
        val prefs = ctx?.let { Kiosk.prefs(it) }
        var perMin = (prefs?.getInt("scans_per_min", 120) ?: 120).coerceIn(1, 240)
        if (slow) perMin = minOf(perMin, (prefs?.getInt("video_scans_per_min", 12) ?: 12).coerceIn(1, 240))
        if (now - lastLookMs < 60000L / perMin - 20) return        // -20 ms so a frame landing a hair early still counts
        lastLookMs = now
        val gw = 16; val gh = 12
        val grid = IntArray(gw * gh)
        val sx = w / gw; val sy = h / gh
        for (gy in 0 until gh) for (gx in 0 until gw) {
            var sum = 0; var n = 0
            var y = gy * sy
            while (y < (gy + 1) * sy) {
                var x = gx * sx
                while (x < (gx + 1) * sx) { sum += data[y * w + x].toInt() and 0xff; n++; x += 2 }
                y += 2
            }
            grid[gy * gw + gx] = if (n > 0) sum / n else 0
        }
        prevGrid?.let { prev ->
            // The whole room getting brighter or darker (a lamp, a cloud) shifts every square the same
            // amount; take that shift out so only parts of the picture changing differently count.
            var shift = 0
            for (i in grid.indices) shift += grid[i] - prev[i]
            shift /= grid.size
            val thr = ctx?.let { Kiosk.prefs(it).getInt("motion_thr", 10) } ?: 10
            var changed = 0
            for (i in grid.indices) if (abs(grid[i] - prev[i] - shift) > thr) changed++
            motion = changed.toDouble() / grid.size
            if (motion > 0.03) lastMotionMs = now
        }
        prevGrid = grid
    }

    // ---- once a second: decide "someone there", report to Home Assistant when it matters ----
    private fun tick() {
        val now = Kiosk.mono()
        // no picture for 30 s while "running" (the slowest look is every 5 s): the camera went quiet
        if (state == "running" && now - lastFrameMs > 30000) reopen("stalled")
        val holdMs = (ctx?.let { Kiosk.prefs(it).getInt("presence_hold_s", 30) } ?: 30) * 1000L
        present = now - lastMotionMs < holdMs
        val changed = present != sentPresent
        val beatMs = (ctx?.let { Kiosk.prefs(it).getInt("report_interval_s", 60) } ?: 60).coerceIn(10, 3600) * 1000L
        if ((changed && now - lastReportMs >= 2000) || now - lastReportMs >= beatMs) {
            lastReportMs = now; sentPresent = present
            report()
        }
    }

    private fun report() {
        val c = ctx ?: return
        val p = Kiosk.prefs(c)
        val id = p.getString("presence_webhook", "") ?: ""
        if (id.isEmpty()) { lastSent = "no webhook set"; return }
        // Home Assistant is the host the mirror page is loaded from.
        val page = p.getString("url", "") ?: ""
        val base = try { URL(page).let { "${it.protocol}://${it.host}" + (if (it.port > 0) ":${it.port}" else "") } }
                   catch (e: Exception) { lastSent = "no page address set"; return }
        val body = json()
        thread(isDaemon = true) {
            try {
                val conn = URL("$base/api/webhook/$id").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"; conn.doOutput = true
                conn.connectTimeout = 4000; conn.readTimeout = 4000
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                lastSent = "HTTP " + conn.responseCode
                conn.disconnect()
            } catch (e: Exception) { lastSent = "failed: " + (e.message ?: "").replace("\"", "'") }
        }
    }

    /** The settings that can be changed with /presence/tune (and the one on/off switch), for /status and /presence. */
    fun settingsJson(): String {
        val p = ctx?.let { Kiosk.prefs(it) } ?: return "{}"
        return "{\"enabled\":${p.getBoolean("presence", true)}," +
            "\"scans_per_min\":${p.getInt("scans_per_min", 120)}," +
            "\"video_scans_per_min\":${p.getInt("video_scans_per_min", 12)}," +
            "\"hold_s\":${p.getInt("presence_hold_s", 30)}," +
            "\"threshold\":${p.getInt("motion_thr", 10)}," +
            "\"preview_w\":${p.getInt("preview_w", 320)}," +
            "\"preview_fps\":${p.getInt("preview_fps", 0)}," +
            "\"report_interval_s\":${p.getInt("report_interval_s", 60)}," +
            "\"webhook_set\":${(p.getString("presence_webhook", "") ?: "").isNotEmpty()}}"
    }

    fun json(): String {
        val now = Kiosk.mono()
        fun ago(t: Long): Long = if (t == 0L) -1L else (now - t) / 1000
        // faces / distance / hardware_faces are kept (always empty) so Home Assistant's side keeps working
        return "{\"present\":$present,\"distance_m\":-1.0,\"faces\":0," +
            "\"motion\":${Math.round(motion * 100) / 100.0},\"seconds_since_face\":-1," +
            "\"seconds_since_motion\":${ago(lastMotionMs)},\"state\":\"$state\",\"cameras\":$cameras," +
            "\"hardware_faces\":0,\"preview\":\"$previewSize\",\"fps\":\"$fps\",\"rotation\":0," +
            "\"seconds_since_frame\":${ago(lastFrameMs)},\"camera_restarts\":$cameraRestarts," +
            "\"last_report\":\"$lastSent\",\"settings\":${settingsJson()}}"
    }
}
