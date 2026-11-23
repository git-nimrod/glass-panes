package com.nimrod.mirrorkiosk

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The video layer's rules: when /video/start restarts, swaps or does nothing, the video's shape, and when the held frame comes down. */
class VideoLogicTest {
    private val a = "http://192.0.2.5:8123/local/ring/a.mp4"
    private val b = "http://192.0.2.5:8123/local/ring/b.mp4"

    @Test fun theSameAddressChangesNothingAndAnotherSwapsInPlace() {
        assertEquals(VideoLogic.Start.NEW_LAYER, VideoLogic.decide(false, null, "stopped", a))
        assertEquals(VideoLogic.Start.IGNORE, VideoLogic.decide(true, a, "playing", a))
        assertEquals(VideoLogic.Start.IGNORE, VideoLogic.decide(true, a, "starting", a))      // the page asking again while it opens
        assertEquals(VideoLogic.Start.SWAP, VideoLogic.decide(true, a, "playing", b))
        assertEquals(VideoLogic.Start.SWAP, VideoLogic.decide(true, a, "starting", b))        // a swap during a swap
        assertEquals(VideoLogic.Start.SWAP, VideoLogic.decide(true, a, "error 1/-1004", a))  // a failed address may be tried again
        assertEquals(VideoLogic.Start.NEW_LAYER, VideoLogic.decide(false, a, "error 1/-1004", a))
    }

    @Test fun theVideoKeepsItsShape() {
        assertArrayEquals(intArrayOf(1080, 1920), VideoLogic.fit(1080, 1920, 1080, 1920))     // the mirror's own shape fills it exactly
        assertArrayEquals(intArrayOf(1080, 1920), VideoLogic.fit(1080, 1920, 540, 960))       // same shape, smaller video
        assertArrayEquals(intArrayOf(1080, 607), VideoLogic.fit(1080, 1920, 1920, 1080))      // landscape on a portrait screen
        assertArrayEquals(intArrayOf(1080, 1080), VideoLogic.fit(1080, 1920, 500, 500))
        assertArrayEquals(intArrayOf(1080, 1920), VideoLogic.fit(1080, 1920, 0, 0))           // size not known yet: fill
        assertArrayEquals(intArrayOf(607, 1080), VideoLogic.fit(1920, 1080, 1080, 1920))      // portrait on a landscape screen
        assertArrayEquals(intArrayOf(0, 0), VideoLogic.fit(0, 0, 1080, 1920))                 // not laid out yet
    }

    @Test fun theHeldFrameComesDownOnlyForTheNewVideosOwnFrame() {
        val g = VideoLogic.Gate()
        val n = g.newPlayer()
        assertFalse(g.frameShown())                // a frame before the new player has even opened (an old decoder's blank frame)
        g.prepared(n)
        assertFalse(g.frameShown())                // opened, but no first-frame report yet
        assertFalse(g.onScreen)
        g.renderingStarted(n)
        assertTrue(g.frameShown())
        assertTrue(g.onScreen)
    }

    @Test fun lateCallbacksFromAnOldPlayerChangeNothing() {
        val g = VideoLogic.Gate()
        val old = g.newPlayer()
        val now = g.newPlayer()
        g.prepared(old)
        g.renderingStarted(old)
        assertFalse(g.frameShown())
        assertTrue(g.waiting(now))
        assertFalse(g.waiting(old))
        assertFalse(g.stillTimedOut(old))
        g.prepared(now)
        assertFalse(g.waiting(now))
    }

    @Test fun aFirstFrameReportBeforeOpeningIsIgnored() {
        val g = VideoLogic.Gate()
        val n = g.newPlayer()
        g.renderingStarted(n)                      // cannot really happen, but must not open the gate early
        g.prepared(n)
        assertFalse(g.frameShown())
    }

    @Test fun withoutAFirstFrameReportTheTimeoutStillTakesTheFrameDown() {
        val g = VideoLogic.Gate()
        val n = g.newPlayer()
        g.prepared(n)
        g.frameShown(); g.frameShown()             // frames arrive, but the device never says the first one rendered
        assertFalse(g.onScreen)
        assertTrue(g.stillTimedOut(n))
        assertTrue(g.onScreen)                     // so the next swap still has a picture to hold
    }

    @Test fun aTimeoutWithNoFramesDoesNotClaimAPictureIsShowing() {
        val g = VideoLogic.Gate()
        val n = g.newPlayer()
        g.prepared(n)
        assertTrue(g.stillTimedOut(n))
        assertFalse(g.onScreen)
    }

    @Test fun aNewPlayerStartsWithNothingOnScreen() {
        val g = VideoLogic.Gate()
        val n = g.newPlayer()
        g.prepared(n); g.renderingStarted(n); g.frameShown()
        assertTrue(g.onScreen)
        g.newPlayer()
        assertFalse(g.onScreen)
    }
}
