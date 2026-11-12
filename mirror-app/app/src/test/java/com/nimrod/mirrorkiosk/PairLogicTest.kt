package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pairing is protected by a six-digit code, so the code rules have to hold: one use, five tries, then a lock. */
class PairLogicTest {
    private fun logic(vararg codes: String): PairLogic {
        val queue = ArrayDeque(codes.toList())
        return PairLogic(newCode = { queue.removeFirst() }, maxTries = 5, lockMs = 60_000L)
    }

    @Test fun theRightCodeWorksOnceAndThenChanges() {
        val p = logic("482913", "111222")
        assertEquals("482913", p.code)
        assertEquals(PairLogic.Result.OK, p.check("482913", 0))
        assertEquals("111222", p.code)
        assertEquals(PairLogic.Result.WRONG, p.check("482913", 1))              // the used code is dead
    }

    @Test fun theCheckStepDoesNotUseTheCodeUp() {
        val p = logic("482913", "111222")
        assertEquals(PairLogic.Result.OK, p.check("482913", 0, consume = false))
        assertEquals("482913", p.code)
        assertEquals(PairLogic.Result.OK, p.check("482913", 1))                 // the real step still works
    }

    @Test fun spacesAndDashesDoNotMatter() {
        val p = logic("482913", "111222", "333444")
        assertEquals(PairLogic.Result.OK, p.check("482 913", 0))
        assertEquals(PairLogic.Result.OK, p.check("111-222", 0))
    }

    @Test fun fiveWrongTriesLockForAMinuteAndChangeTheCode() {
        val p = logic("482913", "999000", "555666")
        repeat(4) { assertEquals(PairLogic.Result.WRONG, p.check("000000", it.toLong())) }
        assertEquals(PairLogic.Result.WRONG, p.check("000000", 5))              // the fifth wrong try triggers the lock
        assertTrue(p.locked(6))
        assertEquals("999000", p.code)                                          // a guesser who got lucky on the old code gains nothing
        assertEquals(PairLogic.Result.LOCKED, p.check("999000", 30_000))        // even the right code is refused while locked
        assertFalse(p.locked(70_000))
        assertEquals(PairLogic.Result.OK, p.check("999000", 70_000))
    }

    @Test fun aRightCodeBetweenWrongOnesResetsTheCount() {
        val p = logic("482913", "111222", "333444")
        repeat(4) { p.check("000000", it.toLong()) }
        assertEquals(PairLogic.Result.OK, p.check("482913", 10, consume = false))
        repeat(4) { assertEquals(PairLogic.Result.WRONG, p.check("000000", 20L + it)) }
        assertFalse(p.locked(30))
    }

    @Test fun anEmptyOrShortGuessIsJustWrong() {
        val p = logic("482913")
        assertEquals(PairLogic.Result.WRONG, p.check("", 0))
        assertEquals(PairLogic.Result.WRONG, p.check("4829", 0))
    }

    @Test fun randomCodesAreSixDigits() {
        repeat(200) { assertTrue(Regex("^\\d{6}$").matches(PairLogic.randomCode())) }
        assertNotEquals(PairLogic.randomCode(), PairLogic.randomCode() + "x")
        assertEquals("482 913", PairLogic.pretty("482913"))
    }

    private val goodUrl = "http://homeassistant.local:8123/glass_panes/player/index.html?display=hall_mirror&kiosk=1&tokenkey=glass_panes_token"
    private val goodToken = "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJhYmMifQ.c2lnbmF0dXJlc2lnbmF0dXJl"
    private val goodKey = "Zm9vYmFyYmF6cXV4Zm9vYmFy"

    @Test fun whatHomeAssistantNormallySendsIsAccepted() {
        assertNull(PairLogic.payloadProblem(goodUrl, goodToken, goodKey))
        assertNull(PairLogic.payloadProblem(goodUrl.replace("http://homeassistant.local:8123", "https://ha.example.com"), goodToken, goodKey))
    }

    @Test fun anythingElseIsRefusedBeforeItIsStored() {
        val others = listOf(
            "http://evil.example/other/page.html?x=1",
            "http://homeassistant.local:8123/glass_panes/player/index.html",                    // no query: not a player address
            "file:///sdcard/x?y=1", "javascript:alert(1)",
            "http://homeassistant.local:8123/glass_panes/player/index.html?display='x'",
            "http://a b/glass_panes/player/index.html?display=x",
        )
        others.forEach { assertNotNull(it, PairLogic.payloadProblem(it, goodToken, goodKey)) }
        assertNotNull(PairLogic.payloadProblem(goodUrl, "short", goodKey))
        assertNotNull(PairLogic.payloadProblem(goodUrl, "has space in it xxxxxxxxxxxxxxxxx", goodKey))
        assertNotNull(PairLogic.payloadProblem(goodUrl, goodToken, "tiny"))
        assertNotNull(PairLogic.payloadProblem(goodUrl, goodToken, "key with spaces 1234567890"))
    }
}
