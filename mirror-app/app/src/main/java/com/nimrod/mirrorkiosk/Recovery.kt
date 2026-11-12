package com.nimrod.mirrorkiosk

/**
 * The rules for getting unstuck, with no Android in them so they are tested on their own in src/test.
 *
 * Three levels, mildest first:
 *   1. A page load that has not finished after [loadTimeoutS] is stopped and tried again, waiting longer each time.
 *   2. If the mirror has not finished booting after [restartAfterMin] minutes, the app restarts itself (at most once
 *      every [RESTART_COOLDOWN_MIN] minutes, so a mirror that can never boot does not restart in a loop).
 *   3. A full power cycle needs the smart plug, which lives in Home Assistant. The app cannot reboot Android: the unit has no root.
 *
 * All the numbers are settings (see /recovery/tune) and stay within the ranges below.
 */
object Recovery {
    const val DEFAULT_LOAD_TIMEOUT_S = 90
    const val DEFAULT_RESTART_AFTER_MIN = 15
    const val RESTART_COOLDOWN_MIN = 30
    const val DEFAULT_RELOAD_HOURS = 0              // 0 = never reload the page on a timer
    const val DEFAULT_ALIVE_REPORT_S = 60

    val LOAD_TIMEOUT_S = 30..600
    val RESTART_AFTER_MIN = 0..240                   // 0 = never restart the app by itself
    val RELOAD_HOURS = 0..168
    val ALIVE_REPORT_S = 0..3600                     // 0 = do not send "still alive" messages to Home Assistant

    /** Waits between tries after a stalled load: 10 s, 30 s, 1 min, 2 min, then 5 min. [attempt] counts from 0. */
    fun waitMs(attempt: Int): Long {
        val waits = longArrayOf(10_000, 30_000, 60_000, 120_000, 300_000)
        return waits[attempt.coerceIn(0, waits.size - 1)]
    }

    /** A load started at [startedMs] is stalled if nothing has finished since it began and it has taken too long. */
    fun loadStalled(startedMs: Long, lastFinishedMs: Long, nowMs: Long, timeoutS: Int): Boolean =
        startedMs > 0 && lastFinishedMs < startedMs && nowMs - startedMs > timeoutS * 1000L

    /** Time to restart the app: boot is stuck past the limit, and the last app restart was long enough ago.
     *  Times are "milliseconds since the device booted", which starts again from 0 after a power cycle, so a saved
     *  restart time that is LATER than now belongs to an earlier power-on and counts as long ago. */
    fun shouldRestartApp(bootStuckForS: Long, restartAfterMin: Int, lastRestartMs: Long, nowMs: Long): Boolean {
        if (restartAfterMin <= 0) return false
        if (bootStuckForS < restartAfterMin * 60L) return false
        return lastRestartMs <= 0 || lastRestartMs > nowMs || nowMs - lastRestartMs >= RESTART_COOLDOWN_MIN * 60_000L
    }

    /** Settings sent to /recovery/tune. A null means "not given". Returns an error sentence, or null when every given value is fine. */
    fun check(loadTimeoutS: Int?, restartAfterMin: Int?, reloadHours: Int?, aliveReportS: Int?): String? {
        if (loadTimeoutS != null && loadTimeoutS !in LOAD_TIMEOUT_S) return "load_timeout 30-600 seconds"
        if (restartAfterMin != null && restartAfterMin !in RESTART_AFTER_MIN) return "restart_after 0-240 minutes (0 = never)"
        if (reloadHours != null && reloadHours !in RELOAD_HOURS) return "reload_hours 0-168 (0 = never)"
        if (aliveReportS != null && aliveReportS !in ALIVE_REPORT_S) return "alive_report 0-3600 seconds (0 = off)"
        return null
    }
}
