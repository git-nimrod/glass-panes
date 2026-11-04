package com.nimrod.mirrorkiosk

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.URLDecoder
import java.net.Socket
import kotlin.concurrent.thread

/**
 * A tiny web server so Home Assistant can talk to the mirror (port 8099, local network only):
 *
 *   GET /status                -> JSON about the app: version, is the page loaded, brightness, uptime, presence and
 *                                 its settings, and "memory" (real RAM measurements, see Kiosk.memoryJson)
 *   GET /brightness/<0..100>   -> set brightness; /brightness/default gives control back to Android
 *   GET /rotation/<auto|portrait|portrait_reverse|landscape|landscape_reverse>
 *                              -> turn the picture (the screen is landscape-native; remembered across restarts;
 *                                 "auto" leaves it to Android). If it comes out upside down, use the other one.
 *   GET /reload                -> load the mirror page again
 *   GET /display/fix          -> run the display clean-up again (turns off Qualcomm CABL/PP)
 *   GET /presence              -> camera presence: someone there? (from changes in light only, see Presence.kt)
 *   GET /presence/on | /off    -> turn the camera presence on or off (remembered across restarts)
 *   GET /presence/tune?scans=120&hold=30&thr=10 -> looks per minute (1-240) / seconds to stay "present"
 *                                 after movement (5-600) / how big a brightness change counts (2-60, lower = more
 *                                 sensitive). &vscans=12 is the looks per minute while a video plays, &fps=0 the
 *                                 camera frame rate (0 = the slowest it offers, otherwise 1-30), &report=60 the
 *                                 seconds between "still here" messages to Home Assistant (10-3600). Any can be
 *                                 left out; the camera picks up fps on its next start (/presence/off, /presence/on).
 *   GET /presence/size?w=640   -> camera picture width (default 320; bigger uses more CPU)
 *
 * If you set an API key (adb ... --es key "something"), every call from another device needs ?key=something.
 * Calls from the mirror itself (the page running inside this app) never need it.
 * It also holds a CPU wake lock so the board keeps listening even if the screen is dimmed.
 */
class ControlService : Service() {

    private var serverThread: Thread? = null
    @Volatile private var running = false
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!running) start()
        return START_STICKY            // Android restarts us if we get killed
    }

    override fun onDestroy() {
        running = false
        Presence.stop()
        wake?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun start() {
        running = true
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mirrorkiosk:control").apply {
            setReferenceCounted(false)
            acquire()
        }
        serverThread = thread(name = "mirror-control-http", isDaemon = true) { serve() }
        if (Kiosk.prefs(this).getBoolean("presence", true)) Presence.start(this)
    }

    private fun serve() {
        while (running) {
            try {
                ServerSocket(Kiosk.PORT).use { server ->
                    while (running) {
                        val client = server.accept()
                        thread(isDaemon = true) { handle(client) }
                    }
                }
            } catch (e: Exception) {
                // Port busy or network hiccup: wait a bit and try to listen again.
                try { Thread.sleep(5000) } catch (ie: InterruptedException) { /* stopping */ }
            }
        }
    }

    private fun handle(sock: Socket) {
        try {
            sock.use { s ->
                s.soTimeout = 5000
                val reader = BufferedReader(InputStreamReader(s.getInputStream()))
                val first = reader.readLine() ?: return
                while (true) {                                  // read and ignore the headers
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                }
                val target = first.split(" ").getOrElse(1) { "/" }
                val path = target.substringBefore('?')
                val query = target.substringAfter('?', "")

                val wantedKey = Kiosk.prefs(this).getString("key", "") ?: ""
                val fromThisDevice = s.inetAddress?.isLoopbackAddress == true
                val givenKey = query.split("&").map { it.split("=", limit = 2) }
                    .firstOrNull { it[0] == "key" }?.getOrNull(1) ?: ""
                if (wantedKey.isNotEmpty() && wantedKey != givenKey && !fromThisDevice) {
                    reply(s, 403, """{"ok":false,"error":"bad key"}""")
                    return
                }

                when {
                    path == "/" || path == "/status" -> reply(s, 200, statusJson())
                    path == "/reload" -> {
                        Kiosk.main.post { Kiosk.activity?.reloadPage() }
                        reply(s, 200, """{"ok":true}""")
                    }
                    path == "/video/start" -> {
                        val raw = query.split("&").map { it.split("=", limit = 2) }
                            .firstOrNull { it[0] == "url" }?.getOrNull(1)
                        val url = raw?.let { URLDecoder.decode(it, "UTF-8") }
                        if (url.isNullOrEmpty()) {
                            reply(s, 400, """{"ok":false,"error":"need ?url="}""")
                        } else {
                            Kiosk.main.post { Kiosk.activity?.playVideo(url) }
                            reply(s, 200, """{"ok":true}""")
                        }
                    }
                    path == "/video/stop" -> {
                        Kiosk.main.post { Kiosk.activity?.stopVideo() }
                        reply(s, 200, """{"ok":true}""")
                    }
                    path == "/presence" -> reply(s, 200, Presence.json())
                    path == "/presence/on" -> {
                        Kiosk.prefs(this).edit().putBoolean("presence", true).apply()
                        Presence.start(this)
                        reply(s, 200, """{"ok":true,"presence":"on"}""")
                    }
                    path == "/presence/off" -> {
                        Kiosk.prefs(this).edit().putBoolean("presence", false).apply()
                        Presence.stop()
                        reply(s, 200, """{"ok":true,"presence":"off"}""")
                    }
                    path == "/presence/tune" -> {
                        val args = query.split("&").map { it.split("=", limit = 2) }
                        val hold = args.firstOrNull { it[0] == "hold" }?.getOrNull(1)?.toIntOrNull()
                        val thr = args.firstOrNull { it[0] == "thr" }?.getOrNull(1)?.toIntOrNull()
                        val scans = args.firstOrNull { it[0] == "scans" }?.getOrNull(1)?.toIntOrNull()
                        val vscans = args.firstOrNull { it[0] == "vscans" }?.getOrNull(1)?.toIntOrNull()
                        val fps = args.firstOrNull { it[0] == "fps" }?.getOrNull(1)?.toIntOrNull()
                        val report = args.firstOrNull { it[0] == "report" }?.getOrNull(1)?.toIntOrNull()
                        if ((hold != null && hold !in 5..600) || (thr != null && thr !in 2..60) ||
                            (scans != null && scans !in 1..240) || (vscans != null && vscans !in 1..240) ||
                            (fps != null && fps !in 0..30) || (report != null && report !in 10..3600)) {
                            reply(s, 400, """{"ok":false,"error":"hold 5-600 seconds, thr 2-60, scans and vscans 1-240 per minute, fps 0-30, report 10-3600 seconds"}""")
                        } else {
                            val ed = Kiosk.prefs(this).edit()
                            if (scans != null) ed.putInt("scans_per_min", scans)
                            if (vscans != null) ed.putInt("video_scans_per_min", vscans)
                            if (fps != null) ed.putInt("preview_fps", fps)
                            if (report != null) ed.putInt("report_interval_s", report)
                            if (hold != null) ed.putInt("presence_hold_s", hold)
                            if (thr != null) ed.putInt("motion_thr", thr)
                            ed.apply()
                            reply(s, 200, """{"ok":true}""")
                        }
                    }
                    path == "/presence/size" -> {
                        val w = query.split("&").map { it.split("=", limit = 2) }
                            .firstOrNull { it[0] == "w" }?.getOrNull(1)?.toIntOrNull()
                        if (w == null || w < 160 || w > 1920) reply(s, 400, """{"ok":false,"error":"use ?w= between 160 and 1920"}""")
                        else {
                            Kiosk.prefs(this).edit().putInt("preview_w", w).apply()
                            Presence.restart(this)
                            reply(s, 200, """{"ok":true,"preview_w":$w,"note":"restarting the camera, check /presence in a few seconds"}""")
                        }
                    }
                    path == "/display/fix" -> {
                        DisplayPostProc.ensureOff(this)
                        reply(s, 200, """{"ok":true}""")
                    }
                    path.startsWith("/brightness/") -> {
                        val v = path.removePrefix("/brightness/")
                        val pct = if (v == "default") -1 else v.toIntOrNull()
                        if (pct == null || pct > 100) {
                            reply(s, 400, """{"ok":false,"error":"use 0-100 or default"}""")
                        } else {
                            Kiosk.brightnessPct = pct
                            Kiosk.prefs(this).edit().putInt("brightness", pct).apply()
                            Kiosk.main.post { Kiosk.activity?.applyBrightness() }
                            reply(s, 200, """{"ok":true,"brightness":$pct}""")
                        }
                    }
                    path.startsWith("/rotation/") -> {
                        val v = path.removePrefix("/rotation/")
                        if (v !in Kiosk.orientations) {
                            reply(s, 400, """{"ok":false,"error":"use auto, portrait, portrait_reverse, landscape or landscape_reverse"}""")
                        } else {
                            Kiosk.orientation = v
                            Kiosk.prefs(this).edit().putString("orientation", v).apply()
                            Kiosk.main.post { Kiosk.activity?.applyOrientation() }
                            reply(s, 200, """{"ok":true,"orientation":"$v"}""")
                        }
                    }
                    else -> reply(s, 404, """{"ok":false,"error":"not found"}""")
                }
            }
        } catch (e: Exception) {
            // A dropped connection is not worth crashing over.
        }
    }

    private fun statusJson(): String {
        val now = System.currentTimeMillis()
        val up = (now - Kiosk.startedMs) / 1000
        val since = if (Kiosk.lastLoadMs == 0L) -1L else (now - Kiosk.lastLoadMs) / 1000
        return "{\"ok\":true,\"app\":\"mirror-kiosk\",\"version\":\"" + Kiosk.versionName(this) + "\"," +
            "\"page_ok\":" + Kiosk.pageOk + "," +
            "\"seconds_since_page_load\":" + since + "," +
            "\"brightness\":" + Kiosk.brightnessPct + "," +
            "\"orientation\":\"" + Kiosk.orientation + "\"," +
            "\"video\":\"" + Kiosk.videoState + "\"," +
            "\"display_pp\":\"" + DisplayPostProc.state + "\"," +
            "\"display_pp_detail\":\"" + DisplayPostProc.detail.replace("\"", "'") + "\"," +
            "\"presence\":" + Presence.json() + "," +
            "\"memory\":" + Kiosk.memoryJson(this) + "," +
            "\"uptime_s\":" + up + "}"
    }

    private fun reply(s: Socket, code: Int, body: String) {
        val text = when (code) { 200 -> "OK"; 400 -> "Bad Request"; 403 -> "Forbidden"; else -> "Not Found" }
        val bytes = body.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $code $text\r\nContent-Type: application/json\r\n" +
            "Access-Control-Allow-Origin: *\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        s.getOutputStream().apply {
            write(head.toByteArray(Charsets.UTF_8))
            write(bytes)
            flush()
        }
    }
}
