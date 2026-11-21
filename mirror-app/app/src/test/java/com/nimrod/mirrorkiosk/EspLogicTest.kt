package com.nimrod.mirrorkiosk

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EspLogicTest {
    private fun sw(bt: Boolean = false, voice: Boolean = false, wake: Boolean = false, key: Boolean = false) = EspLogic.Switches(bt, voice, wake, key)
    private val enc = EspLogic.Link.ENCRYPTED
    private val plain = EspLogic.Link.PLAIN
    private val handover = EspLogic.Link.PROVISIONING

    @Test fun nothingRunsUntilSwitchedOn() {
        assertFalse(EspLogic.serverRuns(sw()))
        assertFalse(EspLogic.serverRuns(sw(wake = true, key = true)))          // the wake word alone does nothing
        assertTrue(EspLogic.serverRuns(sw(bt = true))); assertTrue(EspLogic.serverRuns(sw(voice = true)))
        assertFalse(EspLogic.micListens(sw(), true, false, true))
        assertFalse(EspLogic.micListens(sw(voice = true, key = true), true, false, true))   // voice without the wake word: no listening
    }

    @Test fun voiceOnlyOnTheEncryptedConnection() {
        assertEquals(0, EspLogic.voiceFlags(sw(voice = true), plain))
        assertEquals(0, EspLogic.voiceFlags(sw(voice = true, key = true), plain))
        assertEquals(0, EspLogic.voiceFlags(sw(voice = true, key = true), handover))
        assertEquals(EspProto.VA_FLAGS, EspLogic.voiceFlags(sw(voice = true, key = true), enc))
        assertEquals(0, EspLogic.voiceFlags(sw(voice = false, key = true), enc))
        assertEquals(53, EspProto.VA_FLAGS)
    }

    @Test fun bluetoothWorksOnAnyRealConnection() {
        assertEquals(33, EspLogic.bluetoothFlags(sw(bt = true), plain))
        assertEquals(33, EspLogic.bluetoothFlags(sw(bt = true, key = true), enc))
        assertEquals(0, EspLogic.bluetoothFlags(sw(bt = true), handover))
        assertEquals(0, EspLogic.bluetoothFlags(sw(), enc))
    }

    @Test fun plaintextEndsWithTheKey() {
        assertTrue(EspLogic.acceptsPlaintext(sw(bt = true)))
        assertFalse(EspLogic.acceptsPlaintext(sw(bt = true, key = true)))
    }

    @Test fun wakeWordNeedsVoiceKeyHaAndNoTurn() {
        val s = sw(voice = true, wake = true, key = true)
        assertTrue(EspLogic.micListens(s, haVoiceSubscribed = true, turnActive = false, micPermission = true))
        assertFalse(EspLogic.micListens(s, haVoiceSubscribed = false, turnActive = false, micPermission = true))
        assertFalse(EspLogic.micListens(s, haVoiceSubscribed = true, turnActive = true, micPermission = true))
        assertFalse(EspLogic.micListens(s, haVoiceSubscribed = true, turnActive = false, micPermission = false))
        assertFalse(EspLogic.micListens(sw(voice = true, wake = true), true, false, true))     // no key yet
    }

    @Test fun voiceStateSaysWhatIsMissing() {
        assertEquals("off", EspLogic.voiceState(sw(), true, true))
        assertEquals("waiting_for_key", EspLogic.voiceState(sw(voice = true), true, true))
        assertEquals("waiting_for_home_assistant", EspLogic.voiceState(sw(voice = true, key = true), false, false))
        assertEquals("waiting_for_assist", EspLogic.voiceState(sw(voice = true, key = true), true, false))
        assertEquals("ready", EspLogic.voiceState(sw(voice = true, key = true), true, true))
    }

    @Test fun keysAreBase64Of32BytesAndNeverOverPlaintext() {
        val raw = ByteArray(32) { (it + 1).toByte() }
        assertArrayEquals(raw, EspLogic.decodeKey(EspProto.base64(raw).toByteArray()))
        assertNull(EspLogic.decodeKey(EspProto.base64(ByteArray(32)).toByteArray()))      // the zero key is never a real key
        assertNull(EspLogic.decodeKey(EspProto.base64(ByteArray(16) { 1 }).toByteArray()))
        assertNull(EspLogic.decodeKey("not base64!".toByteArray()))
        assertNull(EspLogic.decodeKey(ByteArray(0)))
        assertFalse(EspLogic.maySetKey(plain, sw()))
        assertTrue(EspLogic.maySetKey(handover, sw()))
        assertFalse(EspLogic.maySetKey(handover, sw(key = true)))
        assertTrue(EspLogic.maySetKey(enc, sw(key = true)))
    }

    @Test fun bluetoothMacIsTheNextAddressLikeHomeAssistantExpects() {
        assertEquals("FE:01:02:03:04:06", EspLogic.bluetoothMac("FE:01:02:03:04:05"))
        assertEquals("FE:01:02:03:05:00", EspLogic.bluetoothMac("FE:01:02:03:04:FF"))
    }

    @Test fun aTurnTimerOnlyEverActsOnItsOwnTurn() {

        // a timer left from an earlier turn leaves the new turn alone, even when its own 15 s are up (the Nov 21 mirror bug)
        assertEquals(EspLogic.TurnTimer.LEAVE, EspLogic.turnTimer(myTurn = false, thinking = false, elapsedMs = 15_000, listenMs = 15_000, answerMs = 30_000))
        assertEquals(EspLogic.TurnTimer.WAIT, EspLogic.turnTimer(true, false, 14_500, 15_000, 30_000))
        assertEquals(EspLogic.TurnTimer.GIVE_UP, EspLogic.turnTimer(true, false, 15_000, 15_000, 30_000))          // nobody stopped talking: give up
        // once Home Assistant has the speech, it gets time to answer
        assertEquals(EspLogic.TurnTimer.WAIT, EspLogic.turnTimer(true, true, 20_000, 15_000, 30_000))
        assertEquals(EspLogic.TurnTimer.GIVE_UP, EspLogic.turnTimer(true, true, 45_000, 15_000, 30_000))
    }
}
