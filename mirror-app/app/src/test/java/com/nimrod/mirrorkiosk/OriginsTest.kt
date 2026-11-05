package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The navigation lock lets the mirror load only its own Home Assistant address. These are the cases it must get right. */
class OriginsTest {
    private val page = "http://homeassistant.local:8123/glass_panes/player/index.html?display=mirror#t=secret"

    @Test fun samePlaceIsAllowed() {
        assertTrue(Origins.same("http://homeassistant.local:8123/glass_panes/player/index.html", page))
        assertTrue(Origins.same("http://HomeAssistant.LOCAL:8123/auth", page))       // host case does not matter
        assertTrue(Origins.same("https://ha.example:443/x", "https://ha.example/y"))   // the usual port, written or not
    }

    @Test fun anywhereElseIsRefused() {
        assertFalse(Origins.same("http://homeassistant.local:8124/", page))            // another port
        assertFalse(Origins.same("https://homeassistant.local:8123/", page))           // another scheme
        assertFalse(Origins.same("http://evil.example/", page))
        assertFalse(Origins.same("http://homeassistant.local.evil.example:8123/", page))
        assertFalse(Origins.same("http://evil.example/?http://homeassistant.local:8123/", page))
        assertFalse(Origins.same("file:///sdcard/x.html", page))
        assertFalse(Origins.same("javascript:alert(1)", page))
        assertFalse(Origins.same("data:text/html,hi", page))
    }

    @Test fun nothingParsesToNothing() {
        assertNull(Origins.of(""))
        assertNull(Origins.of("not a url"))
        assertFalse(Origins.same("", ""))                                            // no page set: nothing is allowed
        assertEquals("http://a:80", Origins.of("http://A/"))
    }
}
