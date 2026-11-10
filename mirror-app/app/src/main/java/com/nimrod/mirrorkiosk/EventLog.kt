package com.nimrod.mirrorkiosk

import java.io.File

/**
 * A short diary the mirror keeps about itself, saved in a file so it is still there after a power cycle. That is the
 * point: when a boot gets stuck and the mirror is power cycled, the next boot can read what the stuck one did.
 *
 * Pure Kotlin (no Android), tested on its own in src/test. Each event is one line in the file:
 *   boot|seconds into that boot|wall clock ms|kind|detail
 * "Seconds into that boot" is the reliable time. The wall clock can jump when the mirror finds the real time on the
 * network a minute after starting, so it is only there as a hint.
 *
 * Tokens and keys never get in: [clean] blanks them out of every line before it is written. Only the newest [max]
 * events are kept.
 */
class EventLog(private val file: File?, private val max: Int = 500) {

    data class Event(val boot: Int, val atS: Long, val wallMs: Long, val kind: String, val detail: String)

    private val events = ArrayList<Event>()
    private var sinceRewrite = 0
    private var added = 0

    init {
        // read what an earlier run saved; a damaged or missing file just means an empty diary
        try {
            if (file != null && file.exists()) {
                file.forEachLine { line -> parse(line)?.let { events.add(it) } }
                while (events.size > max) events.removeAt(0)
            }
        } catch (e: Exception) { events.clear() }
    }

    @Synchronized fun add(boot: Int, atS: Long, wallMs: Long, kind: String, detail: String = "") {
        val ev = Event(boot, atS, wallMs, clean(kind, 40), clean(detail, 300))
        events.add(ev)
        added++
        while (events.size > max) events.removeAt(0)
        if (file == null) return
        try {
            file.parentFile?.mkdirs()
            sinceRewrite++
            if (sinceRewrite >= max / 4) {                  // now and then, write the file again so it never grows past about max lines
                file.writeText(events.joinToString("") { line(it) + "\n" })
                sinceRewrite = 0
            } else {
                file.appendText(line(ev) + "\n")
            }
        } catch (e: Exception) { /* a full or unwritable disk must never break the mirror */ }
    }

    @Synchronized fun all(): List<Event> = ArrayList(events)

    /** How many events have been added since this run began (used to find the ones not yet sent to Home Assistant). */
    @Synchronized fun addedCount(): Int = added

    /** The events added after the first [seen] of this run's additions, oldest first (at most as many as are still kept). */
    @Synchronized fun addedSince(seen: Int): List<Event> {
        val n = (added - seen).coerceIn(0, events.size)
        return events.takeLast(n)
    }

    /** The latest boot number in the diary (0 if it is empty). */
    @Synchronized fun lastBoot(): Int = events.maxOfOrNull { it.boot } ?: 0

    /** JSON for /log. [boot] limits it to one boot (null = every boot kept); [afterIndex] skips the first N matching events. */
    @Synchronized fun json(boot: Int?, afterIndex: Int = 0): String {
        val list = events.filter { boot == null || it.boot == boot }
        val shown = list.drop(afterIndex.coerceAtLeast(0))
        val sb = StringBuilder("{\"ok\":true,\"count\":").append(list.size).append(",\"events\":[")
        shown.forEachIndexed { i, e ->
            if (i > 0) sb.append(',')
            sb.append("{\"n\":").append(afterIndex.coerceAtLeast(0) + i)
                .append(",\"boot\":").append(e.boot)
                .append(",\"t\":").append(e.atS)
                .append(",\"ms\":").append(e.wallMs)
                .append(",\"kind\":\"").append(esc(e.kind))
                .append("\",\"detail\":\"").append(esc(e.detail)).append("\"}")
        }
        return sb.append("]}").toString()
    }

    private fun line(e: Event) = "${e.boot}|${e.atS}|${e.wallMs}|${e.kind}|${e.detail}"

    private fun parse(line: String): Event? {
        val p = line.split('|', limit = 5)
        if (p.size < 4) return null
        val boot = p[0].toIntOrNull() ?: return null
        val at = p[1].toLongOrNull() ?: return null
        val wall = p[2].toLongOrNull() ?: return null
        return Event(boot, at, wall, p[3], p.getOrElse(4) { "" })
    }

    companion object {
        /** Secrets look like "#t=..." (the login token on the page address) or "key=" / "token=" / "webhook=" in a query. */
        private val secret = Regex("(#t=|(?:^|[?&;\\s])(?:key|token|webhook|t)=)[^&\\s#]*", RegexOption.IGNORE_CASE)

        /** One line of plain text: no line breaks, no "|", secrets blanked, shortened to [limit] characters. */
        fun clean(text: String, limit: Int): String {
            var s = secret.replace(text) { it.groupValues[1] + "<hidden>" }
            s = s.replace('\n', ' ').replace('\r', ' ').replace('|', '/')
            return if (s.length > limit) s.substring(0, limit - 1) + "…" else s
        }

        fun esc(s: String): String {
            val sb = StringBuilder()
            for (c in s) {
                when {
                    c == '"' -> sb.append("\\\"")
                    c == '\\' -> sb.append("\\\\")
                    c.code < 0x20 -> sb.append(' ')
                    else -> sb.append(c)
                }
            }
            return sb.toString()
        }
    }
}
