package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The loading bar and the "stuck" warning both come from this, so the order of steps and the timings must be right. */
class BootTimelineTest {
    private var t = 1_000_000L
    private fun timeline() = BootTimeline { t }

    @Test fun startsWithOnlyTheFirstStepDone() {
        val b = timeline()
        assertEquals(BootTimeline.Step.SERVER, b.waitingFor())
        assertFalse(b.fullyBooted())
        assertEquals(0, b.secondsTo(BootTimeline.Step.STARTED))
        assertEquals(-1, b.secondsTo(BootTimeline.Step.SERVER))
    }

    @Test fun progressFollowsTheSteps() {
        val b = timeline()          // pane not tracked: STARTED, SERVER, NETWORK, PAGE = 4 steps
        assertEquals(25, b.percent())
        t += 2000; b.reach(BootTimeline.Step.SERVER)
        assertEquals(50, b.percent())
        t += 60_000; b.reach(BootTimeline.Step.NETWORK)
        assertEquals(75, b.percent())
        t += 10_000; b.reach(BootTimeline.Step.PAGE)
        assertEquals(100, b.percent())
        assertTrue(b.fullyBooted())                       // an older player cannot report a pane, so the page loading is the finish
        assertEquals(72, b.secondsToReady())
    }

    @Test fun aPaneReportingPlayerNeedsTheLastStep() {
        val b = timeline()
        b.paneTracked = true
        b.reach(BootTimeline.Step.SERVER); b.reach(BootTimeline.Step.NETWORK); b.reach(BootTimeline.Step.PAGE)
        assertFalse(b.fullyBooted())
        assertEquals(BootTimeline.Step.PANE, b.waitingFor())
        assertEquals(80, b.percent())
        t += 5000; b.reach(BootTimeline.Step.PANE)
        assertTrue(b.fullyBooted())
        assertEquals(5, b.secondsToReady())
    }

    @Test fun onlyTheFirstTimeCounts() {
        val b = timeline()
        assertTrue(b.reach(BootTimeline.Step.SERVER))
        t += 9000
        assertFalse(b.reach(BootTimeline.Step.SERVER))
        assertEquals(0, b.secondsTo(BootTimeline.Step.SERVER))
    }

    @Test fun stuckOnlyAfterTheStepsAllowedTime() {
        val b = timeline()
        b.reach(BootTimeline.Step.SERVER)
        t += 179_000                                      // Wi-Fi may take 180 s
        assertFalse(b.stuck())
        t += 2000
        assertTrue(b.stuck())
        assertTrue(b.line().contains("Waiting for Wi-Fi"))
        assertTrue(b.line().contains("taking longer than usual"))
        b.reach(BootTimeline.Step.NETWORK)               // the clock for the next step starts when this one is done
        assertFalse(b.stuck())
    }

    @Test fun stepsCanFinishOutOfOrder() {
        val b = timeline()
        b.reach(BootTimeline.Step.NETWORK)                // seen before the server was marked
        assertEquals(BootTimeline.Step.SERVER, b.waitingFor())
        b.reach(BootTimeline.Step.SERVER)
        assertEquals(BootTimeline.Step.PAGE, b.waitingFor())
    }

    @Test fun jsonIsCompleteAndSaysWhatItWaitsFor() {
        val b = timeline()
        val j = b.json(7)
        assertTrue(j.contains("\"boot_id\":7"))
        assertTrue(j.contains("\"fully_booted\":false"))
        assertTrue(j.contains("\"waiting_for\":\"server\""))
        assertTrue(j.contains("\"steps\":{\"started\":0,\"server\":-1,\"network\":-1,\"page\":-1,\"pane\":-1}"))
        b.reach(BootTimeline.Step.SERVER); b.reach(BootTimeline.Step.NETWORK); b.reach(BootTimeline.Step.PAGE)
        assertTrue(b.json(7).contains("\"waiting_for\":null"))
        assertNull(b.waitingFor())
    }
}
