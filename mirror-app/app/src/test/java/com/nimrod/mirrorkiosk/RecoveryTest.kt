package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules for getting unstuck must not fire on a slow but normal boot, and must not loop forever. */
class RecoveryTest {
    @Test fun waitsGrowThenStop() {
        assertEquals(10_000, Recovery.waitMs(0))
        assertEquals(60_000, Recovery.waitMs(2))
        assertEquals(300_000, Recovery.waitMs(4))
        assertEquals(300_000, Recovery.waitMs(99))
        assertEquals(10_000, Recovery.waitMs(-3))
    }

    @Test fun aLoadIsStalledOnlyWhenNothingFinishedAndItTookTooLong() {
        val start = 100_000L
        assertFalse(Recovery.loadStalled(0, 0, 500_000, 90))                    // no load was started
        assertFalse(Recovery.loadStalled(start, 0, start + 89_000, 90))         // still within the time
        assertTrue(Recovery.loadStalled(start, 0, start + 91_000, 90))          // the gap this change closes: never finished, never failed
        assertFalse(Recovery.loadStalled(start, start + 5000, start + 500_000, 90))   // it finished (or failed), so the normal retry handles it
    }

    @Test fun restartsTheAppOnlyAfterTheLimitAndNotInALoop() {
        val now = 10_000_000_000L
        assertFalse(Recovery.shouldRestartApp(14 * 60L, 15, 0, now))            // not long enough yet
        assertTrue(Recovery.shouldRestartApp(15 * 60L, 15, 0, now))
        assertFalse(Recovery.shouldRestartApp(99 * 60L, 0, 0, now))             // 0 = never
        assertFalse(Recovery.shouldRestartApp(99 * 60L, 15, now - 10 * 60_000L, now))   // restarted 10 minutes ago: wait
        assertTrue(Recovery.shouldRestartApp(99 * 60L, 15, now - 31 * 60_000L, now))
    }

    @Test fun settingsAreCheckedAgainstTheirRanges() {
        assertNull(Recovery.check(90, 15, 0, 60))
        assertNull(Recovery.check(null, null, null, null))
        assertNotNull(Recovery.check(10, null, null, null))
        assertNotNull(Recovery.check(null, 241, null, null))
        assertNotNull(Recovery.check(null, null, 169, null))
        assertNotNull(Recovery.check(null, null, null, 3601))
        assertNull(Recovery.check(null, 0, 0, 0))                                // the "off" values are allowed
    }
}
