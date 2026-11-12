package com.nimrod.mirrorkiosk

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Sends the "still alive" message (see [AlivePayload]) to Home Assistant, so Home Assistant can tell "the mirror is gone"
 * from "nobody is in front of it", and keeps a copy of the important diary lines even if the mirror later dies.
 *
 * It uses its OWN webhook id, set on the mirror with `--es alive_webhook '<id>'`, and does nothing until one is set. It is separate
 * from the presence webhook on purpose: an automation reading the presence messages should not suddenly receive another kind.
 * How often it sends is the "alive_report" setting (/recovery/tune, 0 = never; default 60 seconds).
 */
object AliveReport {
    @Volatile var last = "not set up"          // shown in /status: "HTTP 200", "failed: ...", "not set up"
    private var lastSentMs = 0L
    private var seen = 0                       // how many of this run's diary lines have already gone out

    /** Called every few seconds from the main screen. Cheap: it only does work when a message is due. */
    fun maybeSend(ctx: Context) {
        val p = Kiosk.prefs(ctx)
        val id = p.getString("alive_webhook", "") ?: ""
        if (id.isEmpty()) { last = "not set up"; return }
        val log = Kiosk.eventLog ?: return
        val pending = AlivePayload.important(log.addedSince(seen))
        val now = Kiosk.mono()
        if (!AlivePayload.due(Kiosk.aliveReportS(ctx), lastSentMs, now, pending.isNotEmpty())) return
        val page = p.getString("url", "") ?: ""
        val base = try { URL(page).let { "${it.protocol}://${it.host}" + (if (it.port > 0) ":${it.port}" else "") } }
                   catch (e: Exception) { last = "no page address set"; return }
        val upTo = log.addedCount()
        val b = Kiosk.boot
        val body = AlivePayload.build(Kiosk.versionName(ctx), Kiosk.bootId, b.fullyBooted(), b.secondsToReady(), b.waitingFor()?.key,
            b.stuck(), Kiosk.shownPane, (now - Kiosk.startedMs) / 1000, Kiosk.pageOk, pending)
        lastSentMs = now
        thread(isDaemon = true) {
            try {
                val conn = URL("$base/api/webhook/$id").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"; conn.doOutput = true
                conn.connectTimeout = 4000; conn.readTimeout = 4000
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                last = "HTTP $code"
                if (code in 200..299) seen = upTo           // only count the lines as sent once Home Assistant took them
                conn.disconnect()
            } catch (e: Exception) { last = "failed: " + (e.message ?: "").replace("\"", "'") }
        }
    }
}
