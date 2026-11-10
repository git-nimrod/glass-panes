package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the mirror tells Home Assistant: complete, valid-looking JSON, only the important diary lines, and sent at the right times. */
class AlivePayloadTest {
    private fun ev(kind: String, detail: String = "") = EventLog.Event(2, 5, 1000, kind, detail)

    @Test fun onlyImportantLinesAreCopiedAndNotTooMany() {
        val all = listOf(ev("load_start"), ev("app_start"), ev("page_loaded"), ev("fully_booted"), ev("network_up"))
        val out = AlivePayload.important(all)
        assertEquals(listOf("app_start", "fully_booted"), out.map { it.kind })
        val many = (1..30).map { ev("pane", "n=$it") }
        assertEquals(10, AlivePayload.important(many).size)
        assertEquals("n=30", AlivePayload.important(many).last().detail)       // the newest ten
    }

    @Test fun payloadHasEverythingAndEscapesText() {
        val j = AlivePayload.build("0.10.8", 4, false, -1, "page", true, "ho\"use", 321, false, listOf(ev("load_stalled", "no end \"after\" 90 s")))
        assertTrue(j.startsWith("{\"type\":\"alive\""))
        assertTrue(j.contains("\"boot_id\":4"))
        assertTrue(j.contains("\"fully_booted\":false"))
        assertTrue(j.contains("\"waiting_for\":\"page\""))
        assertTrue(j.contains("\"stuck\":true"))
        assertTrue(j.contains("\"pane\":\"ho\\\"use\""))
        assertTrue(j.contains("no end \\\"after\\\" 90 s"))
        assertTrue(j.endsWith("]}"))
        val done = AlivePayload.build("0.10.8", 4, true, 38, null, false, "house", 400, true, emptyList())
        assertTrue(done.contains("\"waiting_for\":null"))
        assertTrue(done.contains("\"events\":[]"))
    }

    @Test fun sentOnTimeOrSoonAfterSomethingImportant() {
        assertFalse(AlivePayload.due(0, 0, 999_999, true))                       // off means off, even for important news
        assertFalse(AlivePayload.due(60, 100_000, 130_000, false))               // 30 s since the last one, nothing new
        assertTrue(AlivePayload.due(60, 100_000, 160_000, false))                // a minute: the regular message
        assertFalse(AlivePayload.due(60, 100_000, 103_000, true))                // important, but one went out 3 s ago
        assertTrue(AlivePayload.due(60, 100_000, 106_000, true))                 // important, 6 s ago: send now
        assertTrue(AlivePayload.due(60, 0, 1_794_000_000_000, false))            // the very first one (nothing sent yet, a real clock)
    }

    @Test fun theLogCountsWhatIsNotSentYet() {
        val log = EventLog(null)
        log.add(1, 1, 1, "app_start"); log.add(1, 2, 2, "load_start")
        assertEquals(2, log.addedCount())
        assertEquals(listOf("app_start", "load_start"), log.addedSince(0).map { it.kind })
        assertEquals(listOf("load_start"), log.addedSince(1).map { it.kind })
        assertTrue(log.addedSince(2).isEmpty())
        assertTrue(log.addedSince(99).isEmpty())
    }
}
