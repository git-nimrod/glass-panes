package com.nimrod.mirrorkiosk

/**
 * The "still alive" message the mirror sends to Home Assistant, as JSON. Pure Kotlin (no Android), tested on its own in src/test.
 * Numbers and short words only: no pictures, no addresses, no tokens (the diary lines it carries are already cleaned).
 */
object AlivePayload {
    /** The diary lines worth copying to Home Assistant. The rest (every page load, every retry) stay on the mirror, in /log. */
    val IMPORTANT = setOf("app_start", "fully_booted", "load_stalled", "app_restart", "app_restart_failed", "watchdog_reload",
        "engine_crash", "engine_killed", "pane", "settings", "timed_reload")

    fun important(events: List<EventLog.Event>, max: Int = 10): List<EventLog.Event> =
        events.filter { it.kind in IMPORTANT }.takeLast(max)

    fun build(version: String, bootId: Int, fullyBooted: Boolean, secondsToReady: Long, waitingFor: String?, stuck: Boolean,
              pane: String, uptimeS: Long, pageOk: Boolean, events: List<EventLog.Event>): String {
        val sb = StringBuilder("{\"type\":\"alive\"")
        sb.append(",\"version\":\"").append(EventLog.esc(version)).append('"')
        sb.append(",\"boot_id\":").append(bootId)
        sb.append(",\"fully_booted\":").append(fullyBooted)
        sb.append(",\"seconds_to_ready\":").append(secondsToReady)
        sb.append(",\"waiting_for\":").append(if (waitingFor == null) "null" else "\"" + EventLog.esc(waitingFor) + "\"")
        sb.append(",\"stuck\":").append(stuck)
        sb.append(",\"pane\":\"").append(EventLog.esc(pane)).append('"')
        sb.append(",\"page_ok\":").append(pageOk)
        sb.append(",\"uptime_s\":").append(uptimeS)
        sb.append(",\"events\":[")
        events.forEachIndexed { i, e ->
            if (i > 0) sb.append(',')
            sb.append("{\"boot\":").append(e.boot).append(",\"t\":").append(e.atS)
                .append(",\"kind\":\"").append(EventLog.esc(e.kind)).append("\",\"detail\":\"").append(EventLog.esc(e.detail)).append("\"}")
        }
        return sb.append("]}").toString()
    }

    /** Whether to send now: it is time for the regular message, or something important happened and the last message was a few seconds ago. */
    fun due(intervalS: Int, lastSentMs: Long, nowMs: Long, importantPending: Boolean): Boolean {
        if (intervalS <= 0) return false                         // switched off
        val since = nowMs - lastSentMs
        return since >= intervalS * 1000L || (importantPending && since >= 5_000)
    }
}
