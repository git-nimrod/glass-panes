package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Wi-Fi details the installer hands over on a fresh mirror (WifiLogic). */
class WifiLogicTest {
    @Test fun ordinaryNetworksAreAccepted() {
        assertNull(WifiLogic.problem("Home Wi-Fi", "correct horse battery"))
        assertNull("open network", WifiLogic.problem("Cafe", ""))
        assertNull("open network, no password given", WifiLogic.problem("Cafe", null))
        assertNull("raw hex key", WifiLogic.problem("Home", "0123456789abcdef".repeat(4)))
        assertNull("emoji name within 32 bytes", WifiLogic.problem("Pi 🍰", "12345678"))
    }

    @Test fun badDetailsAreRefusedWithoutRepeatingThePassword() {
        assertNotNull(WifiLogic.problem("", "12345678"))
        assertNotNull(WifiLogic.problem(null, "12345678"))
        assertNotNull("33 bytes", WifiLogic.problem("x".repeat(33), "12345678"))
        assertNotNull("control character", WifiLogic.problem("a\nb", "12345678"))
        val short = WifiLogic.problem("Home", "secret7")
        assertNotNull(short)
        assertFalse(short!!.contains("secret7"))
        assertNotNull("64 characters but not hex", WifiLogic.problem("Home", "z".repeat(64)))
        assertNotNull("not a keyboard character", WifiLogic.problem("Home", "passéword"))
    }

    @Test fun quotingFollowsWifiConfiguration() {
        assertEquals("\"Home\"", WifiLogic.quotedSsid("Home"))
        assertEquals("\"pass word\"", WifiLogic.quotedPsk("pass word"))
        val hex = "ab".repeat(32)
        assertTrue(WifiLogic.isHexKey(hex))
        assertEquals(hex, WifiLogic.quotedPsk(hex))
    }
}
