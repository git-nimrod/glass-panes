package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** The diary has to survive a power cycle, stay small, and never write a token. */
class EventLogTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun savesAndReadsBackAfterARestart() {
        val f = tmp.newFile("events.log")
        val a = EventLog(f)
        a.add(3, 12, 1000, "load_error", "code=2152398856 category=5")
        a.add(3, 40, 2000, "retry", "in 10 s")
        val b = EventLog(f)                                // a new run reading the same file
        assertEquals(2, b.all().size)
        assertEquals("load_error", b.all()[0].kind)
        assertEquals(3, b.lastBoot())
    }

    @Test fun keepsOnlyTheNewestEvents() {
        val f = tmp.newFile("events.log")
        val a = EventLog(f, max = 20)
        for (i in 1..70) a.add(1, i.toLong(), i.toLong(), "tick", "n=$i")
        assertEquals(20, a.all().size)
        assertEquals("n=70", a.all().last().detail)
        assertEquals("n=51", a.all().first().detail)
        val b = EventLog(f, max = 20)
        assertEquals(20, b.all().size)                     // and the file did not keep growing without limit
        assertEquals("n=70", b.all().last().detail)
        assertTrue(f.readLines().size <= 25)
    }

    @Test fun tokensNeverGetIn() {
        val f = tmp.newFile("events.log")
        val a = EventLog(f)
        a.add(1, 1, 1, "load", "http://ha.local:8123/glass_panes/player/index.html?display=x&key=hunter2&token=abc123#t=SECRETTOKEN")
        a.add(1, 2, 2, "hook", "webhook=my-secret-id sent")
        val text = f.readText()
        assertFalse(text.contains("hunter2"))
        assertFalse(text.contains("abc123"))
        assertFalse(text.contains("SECRETTOKEN"))
        assertFalse(text.contains("my-secret-id"))
        assertTrue(a.all()[0].detail.contains("display=x"))     // the harmless part stays
    }

    @Test fun oneLineEachNoMatterWhatIsInThem() {
        val f = tmp.newFile("events.log")
        val a = EventLog(f)
        a.add(1, 1, 1, "weird", "line one\nline two | with a bar \"and quotes\"")
        assertEquals(1, f.readLines().size)
        assertEquals(1, EventLog(f).all().size)
        assertTrue(a.json(null).contains("\\\"and quotes\\\""))
    }

    @Test fun aDamagedFileIsIgnored() {
        val f = tmp.newFile("events.log")
        f.writeText("garbage\n\n1|x|y|z\n2|5|6|ok|fine\n")
        val a = EventLog(f)
        assertEquals(1, a.all().size)
        assertEquals("ok", a.all()[0].kind)
    }

    @Test fun jsonCanBeLimitedToOneBootAndPaged() {
        val a = EventLog(null)
        a.add(1, 1, 1, "a"); a.add(1, 2, 2, "b"); a.add(2, 1, 3, "c"); a.add(2, 2, 4, "d")
        val prev = a.json(1)
        assertTrue(prev.contains("\"count\":2"))
        assertTrue(prev.contains("\"kind\":\"a\"") && prev.contains("\"kind\":\"b\""))
        assertFalse(prev.contains("\"kind\":\"c\""))
        val paged = a.json(2, 1)
        assertTrue(paged.contains("\"kind\":\"d\""))
        assertFalse(paged.contains("\"kind\":\"c\""))
        assertEquals(0, EventLog(null).lastBoot())
    }

    @Test fun anUnwritablePlaceDoesNotBreakAnything() {
        val dir = tmp.newFolder("blocked")
        val a = EventLog(dir)                              // a folder where the file should be
        a.add(1, 1, 1, "x", "still works in memory")
        assertEquals(1, a.all().size)
    }
}
