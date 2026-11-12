package com.nimrod.mirrorkiosk

/**
 * What the mirror has done since it started, step by step, so the launch screen can show a loading bar and so a boot that
 * got stuck says exactly where. Pure Kotlin (no Android), tested on its own in src/test.
 *
 * The steps, in order:
 *   STARTED   the app is running
 *   SERVER    the control server (port 8099) is listening
 *   NETWORK   Android says it is online (Wi-Fi can take a couple of minutes after power-on)
 *   PAGE      the Home Assistant page finished loading
 *   PANE      the player says it is showing the pane that was selected for this display
 *
 * "Fully booted" means the last step: the selected pane is on screen. An older player that never reports its pane
 * cannot reach PANE, so while [paneTracked] is false the last step is left out and PAGE is the finish line.
 *
 * Each step has a time it is allowed to take after the step before it. Going over it makes [stuck] true. That is a
 * warning on the screen and in the log, not a failure: a slow Wi-Fi is normal.
 */
class BootTimeline(private val now: () -> Long = { System.nanoTime() / 1_000_000 }) {   // the app passes Kiosk.mono()

    enum class Step(val key: String, val label: String, val allowedS: Int) {
        STARTED("started", "Starting up", 0),
        SERVER("server", "Starting the control server", 30),
        NETWORK("network", "Waiting for Wi-Fi", 180),
        PAGE("page", "Loading the page", 120),
        PANE("pane", "Showing your pane", 120),
    }

    val startedMs: Long = now()
    private val reached = LinkedHashMap<Step, Long>()

    /** Whether the player reports which pane it shows. False until the first report arrives. */
    @Volatile var paneTracked = false

    init { reach(Step.STARTED) }

    /** The steps that count right now (the last one only when the player reports its pane). */
    fun steps(): List<Step> = if (paneTracked) Step.values().toList() else Step.values().toList().filter { it != Step.PANE }

    /** Marks a step as done. Only the first time counts. Returns true if this was the first time. */
    @Synchronized fun reach(step: Step): Boolean {
        if (reached.containsKey(step)) return false
        reached[step] = now()
        return true
    }

    @Synchronized fun reachedAtMs(step: Step): Long? = reached[step]

    /** Seconds from the start of this boot to a step, or -1 if it has not happened. */
    @Synchronized fun secondsTo(step: Step): Long = reached[step]?.let { (it - startedMs) / 1000 } ?: -1L

    /** The first counted step that has not happened yet, or null when everything has. */
    @Synchronized fun waitingFor(): Step? = steps().firstOrNull { !reached.containsKey(it) }

    @Synchronized fun fullyBooted(): Boolean = waitingFor() == null

    /** 0 to 100: how many counted steps are done. */
    @Synchronized fun percent(): Int {
        val all = steps()
        val done = all.count { reached.containsKey(it) }
        return done * 100 / all.size
    }

    /** Seconds spent on the step being waited for (counted from the latest step already done, or from the start). */
    @Synchronized fun waitedS(): Long {
        val since = reached.values.maxOrNull() ?: startedMs
        return (now() - since).coerceAtLeast(0) / 1000
    }

    /** True when the step being waited for has taken longer than it is allowed to. */
    @Synchronized fun stuck(): Boolean {
        val step = waitingFor() ?: return false
        return waitedS() > step.allowedS
    }

    /** Seconds from the start to fully booted, or -1 while it has not finished. */
    @Synchronized fun secondsToReady(): Long {
        val last = steps().last()
        return if (fullyBooted()) secondsTo(last) else -1L
    }

    /** A short line for the launch screen, like "3 of 5 · Waiting for Wi-Fi · 42 s". */
    @Synchronized fun line(): String {
        val all = steps()
        val step = waitingFor() ?: return "Ready"
        val n = all.indexOf(step) + 1
        return "$n of ${all.size} · ${step.label} · ${waitedS()} s" + (if (stuck()) " · taking longer than usual" else "")
    }

    /** JSON for /status. */
    @Synchronized fun json(bootId: Int): String {
        val sb = StringBuilder()
        sb.append("{\"boot_id\":").append(bootId)
        sb.append(",\"fully_booted\":").append(fullyBooted())
        sb.append(",\"pane_tracked\":").append(paneTracked)
        sb.append(",\"percent\":").append(percent())
        sb.append(",\"seconds_to_ready\":").append(secondsToReady())
        sb.append(",\"waiting_for\":").append(waitingFor()?.let { "\"" + it.key + "\"" } ?: "null")
        sb.append(",\"waited_s\":").append(waitedS())
        sb.append(",\"stuck\":").append(stuck())
        sb.append(",\"steps\":{")
        var first = true
        for (s in Step.values()) {
            if (!first) sb.append(',')
            first = false
            sb.append('"').append(s.key).append("\":").append(secondsTo(s))
        }
        sb.append("}}")
        return sb.toString()
    }
}
