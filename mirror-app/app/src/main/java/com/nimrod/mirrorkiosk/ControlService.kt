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
 *   GET /log                   -> the mirror's diary of what it did (kept in a file, so it survives a power cycle). ?boot=previous
 *                                 (or current, or a number, default all kept) and ?since=<n> to skip the first n
 *   GET /audio                 -> the audio player: state, volume, title, artist, position (see AudioPlayer.kt)
 *   GET /audio/play?url=<http(s) address>&title=&artist=&volume=0-100&start=<seconds>  -> play a stream through the mirror's speaker
 *   GET /audio/pause | /audio/resume | /audio/stop
 *   GET /audio/seek?s=<seconds> | /audio/volume?v=0-100   (the volume is remembered across restarts)
 *   GET /bluetooth/test?seconds=5 -> turns Bluetooth on if needed, listens for 1-15 seconds and reports COUNTS of nearby advertisements
 *                                 (no addresses or names are kept), then switches Bluetooth off again if the test turned it on.
 *                                 Needs: adb shell pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION
 *   GET /mic/test?seconds=3    -> listens for 1-10 seconds and reports how loud it was (numbers only: nothing is recorded or sent).
 *                                 Needs: adb shell pm grant com.nimrod.mirrorkiosk android.permission.RECORD_AUDIO
 *   GET /recovery              -> the settings for getting unstuck and for the "still alive" messages
 *   GET /recovery/tune?load_timeout=90&restart_after=15&reload_hours=0&alive_report=60 -> change them (ranges in Recovery.kt)
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
        Kiosk.init(this)
        AudioPlayer.init(this)
        if (!running) start()
        return START_STICKY            // Android restarts us if we get killed
    }

    override fun onDestroy() {
        running = false
        AudioPlayer.stop()
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
                    if (Kiosk.boot.reach(BootTimeline.Step.SERVER)) Kiosk.log("server_up", "port " + Kiosk.PORT)
                    while (running) {
                        val client = server.accept()
                        // at most a few requests at once, so a flood of connections cannot exhaust the app's memory or threads
                        if (!slots.tryAcquire()) { try { client.close() } catch (e: Exception) { }; continue }
                        thread(isDaemon = true) { try { handle(client) } finally { slots.release() } }
                    }
                }
            } catch (e: Exception) {
                // Port busy or network hiccup: wait a bit and try to listen again.
                try { Thread.sleep(5000) } catch (ie: InterruptedException) { /* stopping */ }
            }
        }
    }

    private val slots = java.util.concurrent.Semaphore(8)
    private val MAX_LINE = 4096
    private val MAX_HEADERS = 64
    /** The web page origin allowed to read this request's answer (one value per request thread). */
    private val allowOrigin = ThreadLocal<String>()

    /** One line of the request, at most MAX_LINE characters (null at the end of the stream or if the line is too long). */
    private fun boundedLine(r: BufferedReader): String? {
        val sb = StringBuilder()
        while (true) {
            val c = r.read()
            if (c == -1) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            if (sb.length >= MAX_LINE) return null
            sb.append(c.toChar())
        }
    }

    /** Where the player page lives (scheme://host:port of the saved page address); "" when no page is set. */
    private fun pageOrigin(): String {
        val url = Kiosk.prefs(this).getString("url", "") ?: ""
        return try { val u = java.net.URI(url); if (u.scheme == null || u.host == null) "" else u.scheme + "://" + u.host + (if (u.port > 0) ":" + u.port else "") } catch (e: Exception) { "" }
    }

    private fun handle(sock: Socket) {
        try {
            sock.use { s ->
                s.soTimeout = 5000
                val reader = BufferedReader(InputStreamReader(s.getInputStream()))
                val first = boundedLine(reader) ?: return
                var origin = ""
                for (i in 0 until MAX_HEADERS) {                // read the headers (bounded); only Origin matters
                    val line = boundedLine(reader) ?: return
                    if (line.isEmpty()) break
                    if (line.startsWith("origin:", ignoreCase = true)) origin = line.substringAfter(':').trim()
                }
                // A web page from another site, opened in any browser on the home network, must not be able to drive the mirror.
                // Requests with no Origin (Home Assistant, curl, a typed address) and from the player's own page are fine.
                if (origin.isNotEmpty() && origin != "null" && origin != pageOrigin() && !(s.inetAddress?.isLoopbackAddress == true)) {
                    reply(s, 403, """{"ok":false,"error":"not allowed from this web page"}""")
                    return
                }
                allowOrigin.set(if (origin.isNotEmpty() && origin == pageOrigin()) origin else "")
                val target = first.split(" ").getOrElse(1) { "/" }
                val path = target.substringBefore('?')
                val query = target.substringAfter('?', "")

                val wantedKey = Kiosk.prefs(this).getString("key", "") ?: ""
                val fromThisDevice = s.inetAddress?.isLoopbackAddress == true
                val givenKey = query.split("&").map { it.split("=", limit = 2) }
                    .firstOrNull { it[0] == "key" }?.getOrNull(1)
                    ?.let { try { URLDecoder.decode(it, "UTF-8") } catch (e: Exception) { it } } ?: ""
                // compared in constant time, so the key cannot be guessed a character at a time
                val keyOk = java.security.MessageDigest.isEqual(wantedKey.toByteArray(Charsets.UTF_8), givenKey.toByteArray(Charsets.UTF_8))
                if (wantedKey.isNotEmpty() && !keyOk && !fromThisDevice) {
                    reply(s, 403, """{"ok":false,"error":"bad key"}""")
                    return
                }

                when {
                    path == "/" || path == "/status" -> reply(s, 200, statusJson())
                    path == "/alive" -> {
                        // the player page says it is running. Only the page on the mirror itself may say so.
                        if (fromThisDevice) {
                            Kiosk.lastAliveMs = Kiosk.mono()
                            // A running page must never sit behind the loading screen (UI work belongs on the main thread).
                            Kiosk.main.post { Kiosk.activity?.pageAlive() }
                            val p = Kiosk.prefs(this)
                            if (!p.getBoolean("heartbeat", false)) p.edit().putBoolean("heartbeat", true).apply()
                            // From player 0.10.8 on, the heartbeat says which pane is showing (pane) and which was asked for (want)
                            val args = params(query)
                            if (args.containsKey("pane")) {
                                Kiosk.boot.paneTracked = true
                                val pane = args["pane"] ?: ""
                                val want = args["want"] ?: ""
                                if (pane != Kiosk.shownPane) {
                                    Kiosk.shownPane = pane
                                    Kiosk.log("pane", "showing=" + pane + " selected=" + want)
                                }
                                if (pane.isNotEmpty() && pane == want && Kiosk.boot.reach(BootTimeline.Step.PANE)) {
                                    Kiosk.log("fully_booted", Kiosk.boot.secondsToReady().toString() + " s after the app started")
                                }
                            }
                            reply(s, 200, """{"ok":true}""")
                        } else reply(s, 403, """{"ok":false,"error":"only the page on the mirror"}""")
                    }
                    path == "/log" -> {
                        val args = params(query)
                        val which = args["boot"] ?: "all"
                        val boot: Int? = when (which) {
                            "all" -> null
                            "current" -> Kiosk.bootId
                            "previous" -> Kiosk.bootId - 1
                            else -> which.toIntOrNull()
                        }
                        val since = args["since"]?.toIntOrNull() ?: 0
                        reply(s, 200, Kiosk.eventLog?.json(boot, since) ?: """{"ok":true,"count":0,"events":[]}""")
                    }
                    path == "/recovery" -> reply(s, 200, Kiosk.recoveryJson(this))
                    path == "/recovery/tune" -> {
                        val args = params(query)
                        val timeout = args["load_timeout"]?.toIntOrNull()
                        val restart = args["restart_after"]?.toIntOrNull()
                        val reload = args["reload_hours"]?.toIntOrNull()
                        val alive = args["alive_report"]?.toIntOrNull()
                        val bad = Recovery.check(timeout, restart, reload, alive)
                        if (bad != null) {
                            reply(s, 400, """{"ok":false,"error":"$bad"}""")
                        } else {
                            val ed = Kiosk.prefs(this).edit()
                            if (timeout != null) ed.putInt("load_timeout_s", timeout)
                            if (restart != null) ed.putInt("restart_after_min", restart)
                            if (reload != null) ed.putInt("reload_hours", reload)
                            if (alive != null) ed.putInt("alive_report_s", alive)
                            ed.apply()
                            Kiosk.log("settings", "recovery " + Kiosk.recoveryJson(this))
                            reply(s, 200, """{"ok":true,"recovery":${Kiosk.recoveryJson(this)}}""")
                        }
                    }
                    path == "/reload" -> {
                        Kiosk.main.post { Kiosk.activity?.reloadPage() }
                        reply(s, 200, """{"ok":true}""")
                    }
                    path == "/video/start" -> {
                        val raw = query.split("&").map { it.split("=", limit = 2) }
                            .firstOrNull { it[0] == "url" }?.getOrNull(1)
                        val url = raw?.let { URLDecoder.decode(it, "UTF-8") }
                        val scheme = url?.substringBefore(':', "")?.lowercase()
                        if (url.isNullOrEmpty()) {
                            reply(s, 400, """{"ok":false,"error":"need ?url="}""")
                        } else if (scheme != "http" && scheme != "https") {
                            // only web addresses: never files or other apps' content on the device
                            reply(s, 400, """{"ok":false,"error":"only http and https addresses can be played"}""")
                        } else {
                            Kiosk.main.post { Kiosk.activity?.playVideo(url) }
                            reply(s, 200, """{"ok":true}""")
                        }
                    }
                    path == "/video/stop" -> {
                        Kiosk.main.post { Kiosk.activity?.stopVideo() }
                        reply(s, 200, """{"ok":true}""")
                    }
                    path == "/bluetooth/test" -> {
                        val seconds = params(query)["seconds"]?.let { it.toIntOrNull() } ?: BtLogic.DEFAULT_SECONDS
                        val bad = BtLogic.checkSeconds(seconds)
                        if (bad != null) reply(s, 400, """{"ok":false,"error":"$bad"}""")
                        else reply(s, 200, BtProbe.run(this, seconds))
                    }
                    path == "/mic/test" -> {
                        val seconds = params(query)["seconds"]?.let { it.toIntOrNull() } ?: MicLevel.DEFAULT_SECONDS
                        val bad = MicLevel.checkSeconds(seconds)
                        if (bad != null) reply(s, 400, """{"ok":false,"error":"$bad"}""")
                        else reply(s, 200, MicProbe.run(this, seconds))
                    }
                    path == "/audio" -> reply(s, 200, AudioPlayer.json())
                    path == "/audio/play" -> {
                        val args = params(query)
                        val url = args["url"]
                        val volume = args["volume"]?.toIntOrNull()
                        val problem = AudioLogic.checkUrl(url) ?: (if (args.containsKey("volume")) AudioLogic.checkVolume(volume) else null)
                        if (problem != null) {
                            reply(s, 400, """{"ok":false,"error":"${AudioLogic.jsonEscape(problem)}"}""")
                        } else {
                            val startMs = ((args["start"]?.toDoubleOrNull() ?: 0.0) * 1000).toInt().coerceAtLeast(0)
                            AudioPlayer.play(this, url!!, AudioLogic.cleanText(args["title"]), AudioLogic.cleanText(args["artist"]), volume, startMs)
                            reply(s, 200, """{"ok":true}""")
                        }
                    }
                    path == "/audio/pause" -> { AudioPlayer.pause(); reply(s, 200, """{"ok":true}""") }
                    path == "/audio/resume" -> { AudioPlayer.resume(); reply(s, 200, """{"ok":true}""") }
                    path == "/audio/stop" -> { AudioPlayer.stop(); reply(s, 200, """{"ok":true}""") }
                    path == "/audio/seek" -> {
                        val sec = params(query)["s"]?.toDoubleOrNull()
                        if (sec == null || sec < 0) reply(s, 400, """{"ok":false,"error":"use ?s= seconds from the start"}""")
                        else { AudioPlayer.seek(sec); reply(s, 200, """{"ok":true}""") }
                    }
                    path == "/audio/volume" -> {
                        val v = params(query)["v"]?.toIntOrNull()
                        val problem = AudioLogic.checkVolume(v)
                        if (problem != null) reply(s, 400, """{"ok":false,"error":"$problem"}""")
                        else { AudioPlayer.setVolume(this, v!!); reply(s, 200, """{"ok":true,"volume":$v}""") }
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
        } catch (e: Throwable) {
            // A dropped connection, or even running out of memory on one request, is not worth crashing the app over.
        }
    }

    private fun statusJson(): String {
        val now = Kiosk.mono()
        val up = (now - Kiosk.startedMs) / 1000
        val since = if (Kiosk.lastLoadMs == 0L) -1L else (now - Kiosk.lastLoadMs) / 1000
        return "{\"ok\":true,\"app\":\"mirror-kiosk\",\"version\":\"" + Kiosk.versionName(this) + "\"," +
            "\"page_ok\":" + Kiosk.pageOk + "," +
            "\"seconds_since_page_load\":" + since + "," +
            "\"engine_restarts\":" + Kiosk.engineRestarts + "," +
            "\"blocked_loads\":" + Kiosk.blockedLoads + "," +
            "\"seconds_since_heartbeat\":" + (if (Kiosk.lastAliveMs == 0L) -1L else (now - Kiosk.lastAliveMs) / 1000) + "," +
            "\"brightness\":" + Kiosk.brightnessPct + "," +
            "\"orientation\":\"" + Kiosk.orientation + "\"," +
            "\"video\":\"" + Kiosk.videoState + "\"," +
            "\"display_pp\":\"" + DisplayPostProc.state + "\"," +
            "\"display_pp_detail\":\"" + DisplayPostProc.detail.replace("\"", "'") + "\"," +
            "\"boot\":" + Kiosk.boot.json(Kiosk.bootId) + "," +
            "\"recovery\":" + Kiosk.recoveryJson(this) + "," +
            "\"alive_report\":\"" + AliveReport.last.replace("\"", "'") + "\"," +
            "\"audio\":" + AudioPlayer.json() + "," +
            "\"presence\":" + Presence.json() + "," +
            "\"memory\":" + Kiosk.memoryJson(this) + "," +
            "\"uptime_s\":" + up + "}"
    }

    /** The ?a=1&b=2 part of an address as a map, with the values decoded. Used by the newer calls. */
    private fun params(query: String): Map<String, String> =
        query.split("&").filter { it.isNotEmpty() }.associate { part ->
            val kv = part.split("=", limit = 2)
            val v = kv.getOrElse(1) { "" }
            kv[0] to (try { URLDecoder.decode(v, "UTF-8") } catch (e: Exception) { v })
        }

    private fun reply(s: Socket, code: Int, body: String) {
        val text = when (code) { 200 -> "OK"; 400 -> "Bad Request"; 403 -> "Forbidden"; else -> "Not Found" }
        val bytes = body.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $code $text\r\nContent-Type: application/json\r\n" +
            (allowOrigin.get()?.takeIf { it.isNotEmpty() }?.let { "Access-Control-Allow-Origin: $it\r\nVary: Origin\r\n" } ?: "") + "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        s.getOutputStream().apply {
            write(head.toByteArray(Charsets.UTF_8))
            write(bytes)
            flush()
        }
    }
}
