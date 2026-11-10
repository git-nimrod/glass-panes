package com.nimrod.mirrorkiosk

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Bluetooth test must say plainly which of the possible situations the mirror is in. */
class BtLogicTest {
    @Test fun noAdapterAtAll() {
        assertTrue(BtLogic.verdict(false, false, false, false, 0).contains("no Bluetooth adapter"))
    }

    @Test fun anAdapterThatWillNotTurnOnMeansNoWorkingRadio() {
        val v = BtLogic.verdict(true, true, false, true, 0)
        assertTrue(v.contains("would not turn on"))
        assertTrue(v.contains("not wired up"))
    }

    @Test fun lowEnergyIsRequiredForAProxy() {
        assertTrue(BtLogic.verdict(true, false, true, true, 5).contains("Low Energy"))
    }

    @Test fun withoutTheLocationPermissionTheTestSaysHowToGrantIt() {
        val v = BtLogic.verdict(true, true, true, false, 0)
        assertTrue(v.contains("pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION"))
    }

    @Test fun nothingHeardIsNotTheSameAsNotWorking() {
        val v = BtLogic.verdict(true, true, true, true, 0)
        assertTrue(v.contains("nothing was heard"))
        assertFalse(v.contains("would not turn on"))
    }

    @Test fun hearingDevicesMeansItCanBeAProxy() {
        assertTrue(BtLogic.verdict(true, true, true, true, 12).contains("can act as a Bluetooth proxy"))
    }

    @Test fun stateNumbersAreInWords() {
        assertEquals("off", BtLogic.stateName(10)); assertEquals("turning on", BtLogic.stateName(11))
        assertEquals("on", BtLogic.stateName(12)); assertEquals("turning off", BtLogic.stateName(13))
        assertTrue(BtLogic.stateName(99).contains("99"))
    }

    @Test fun secondsMustBeOneToFifteen() {
        assertNull(BtLogic.checkSeconds(1)); assertNull(BtLogic.checkSeconds(15)); assertNull(BtLogic.checkSeconds(5))
        assertNotNull(BtLogic.checkSeconds(0)); assertNotNull(BtLogic.checkSeconds(16)); assertNotNull(BtLogic.checkSeconds(null))
    }

    @Test fun theAnswerHasCountsOnlyAndNoAddresses() {
        val json = BtLogic.json(null, true, true, "off", true, 3, true, 5, 42, 7, -48, true)
        assertTrue(json.contains("\"advertisements\":42"))
        assertTrue(json.contains("\"devices_heard\":7"))
        assertTrue(json.contains("\"strongest_rssi\":-48"))
        assertTrue(json.contains("\"restored_off\":true"))
        assertFalse(json.contains("address"))
        assertTrue(BtLogic.json(null, true, true, "off", false, 0, true, 5, 0, 0, null, true).contains("\"strongest_rssi\":null"))
        assertEquals("{\"ok\":false,\"error\":\"nope\"}", BtLogic.json("nope", false, false, "", false, 0, false, 0, 0, 0, null, false))
    }
}
