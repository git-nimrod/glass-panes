package com.nimrod.mirrorkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The audio rules: what may be played, how loud, what each state allows, and what is safe to write down. */
class AudioLogicTest {
    @Test fun onlyWebAddressesMayBePlayed() {
        assertNull(AudioLogic.checkUrl("http://192.0.2.5:8095/stream/abc.mp3"))
        assertNull(AudioLogic.checkUrl("HTTPS://music.example/a.flac"))
        assertNotNull(AudioLogic.checkUrl(null))
        assertNotNull(AudioLogic.checkUrl(""))
        assertNotNull(AudioLogic.checkUrl("file:///sdcard/secret.mp3"))      // never files on the device
        assertNotNull(AudioLogic.checkUrl("content://media/external/audio/1"))
        assertNotNull(AudioLogic.checkUrl("ftp://example/a.mp3"))
        assertNotNull(AudioLogic.checkUrl("http://x/\nInjected: header"))     // control characters
        assertNotNull(AudioLogic.checkUrl("http://x/" + "a".repeat(AudioLogic.MAX_URL)))
    }

    @Test fun volumeMustBeZeroToOneHundred() {
        assertNull(AudioLogic.checkVolume(0)); assertNull(AudioLogic.checkVolume(100))
        assertNotNull(AudioLogic.checkVolume(-1)); assertNotNull(AudioLogic.checkVolume(101)); assertNotNull(AudioLogic.checkVolume(null))
    }

    @Test fun gainFollowsAGentleCurveAndStaysInRange() {
        assertEquals(0f, AudioLogic.gain(0), 0.0001f)
        assertEquals(1f, AudioLogic.gain(100), 0.0001f)
        assertEquals(0.25f, AudioLogic.gain(50), 0.0001f)
        assertEquals(1f, AudioLogic.gain(500), 0.0001f)
        assertEquals(0f, AudioLogic.gain(-5), 0.0001f)
    }

    @Test fun eachStateAllowsOnlyTheRightControls() {
        val s = AudioLogic.State.values()
        val idle = AudioLogic.State.IDLE; val buffering = AudioLogic.State.BUFFERING; val playing = AudioLogic.State.PLAYING
        val paused = AudioLogic.State.PAUSED; val error = AudioLogic.State.ERROR
        assertEquals(5, s.size)
        assertTrue(AudioLogic.canPause(playing)); assertTrue(AudioLogic.canPause(buffering))
        assertFalse(AudioLogic.canPause(paused)); assertFalse(AudioLogic.canPause(idle)); assertFalse(AudioLogic.canPause(error))
        assertTrue(AudioLogic.canResume(paused)); assertFalse(AudioLogic.canResume(playing)); assertFalse(AudioLogic.canResume(idle))
        assertTrue(AudioLogic.canSeek(playing)); assertTrue(AudioLogic.canSeek(paused))
        assertFalse(AudioLogic.canSeek(idle)); assertFalse(AudioLogic.canSeek(buffering)); assertFalse(AudioLogic.canSeek(error))
    }

    @Test fun seekStaysInsideTheTrack() {
        assertEquals(30_000, AudioLogic.seekTargetMs(30.0, 200_000))
        assertEquals(200_000, AudioLogic.seekTargetMs(9999.0, 200_000))     // past the end: the end
        assertEquals(0, AudioLogic.seekTargetMs(-5.0, 200_000))
        assertEquals(500, AudioLogic.seekTargetMs(0.5, 0))                  // length not known yet: allowed as is
    }

    @Test fun theDiaryNeverSeesTokensOrPasswords() {
        assertEquals("http://192.0.2.5:8095/stream/abc.mp3", AudioLogic.safeLabel("http://192.0.2.5:8095/stream/abc.mp3?token=SECRET&x=1#frag"))
        assertEquals("https://music.example/a.flac", AudioLogic.safeLabel("https://user:hunter2@music.example/a.flac?authSig=SECRET"))
        assertEquals("(address)", AudioLogic.safeLabel("not an address"))
        assertFalse(AudioLogic.safeLabel("http://h/p?authSig=SECRET").contains("SECRET"))
    }

    @Test fun errorsAreInPlainWords() {
        assertTrue(AudioLogic.errorText(1, -1010).contains("not supported"))
        assertTrue(AudioLogic.errorText(1, -1004).contains("network"))
        assertTrue(AudioLogic.errorText(100, 0).contains("restarted"))
        assertTrue(AudioLogic.errorText(1, 0).contains("1/0"))
    }

    @Test fun statusJsonEscapesWhatComesFromOutside() {
        val json = AudioLogic.statusJson(AudioLogic.State.PLAYING, 40, "Say \"hi\"\n", "A\\B", 65_000, 200_000, "", "http://h/x")
        assertTrue(json.contains("\"state\":\"playing\""))
        assertTrue(json.contains("\"volume\":40"))
        assertTrue(json.contains("\"title\":\"Say \\\"hi\\\"\\n\""))
        assertTrue(json.contains("\"artist\":\"A\\\\B\""))
        assertTrue(json.contains("\"position_s\":65"))
        assertTrue(json.contains("\"duration_s\":200"))
        val idle = AudioLogic.statusJson(AudioLogic.State.IDLE, 50, "", "", -1, 0, "", "")
        assertTrue(idle.contains("\"position_s\":-1") && idle.contains("\"duration_s\":-1"))
    }

    @Test fun textFromOutsideIsCleaned() {
        assertEquals("Hello", AudioLogic.cleanText("  Hello\u0007\n "))
        assertEquals(10, AudioLogic.cleanText("x".repeat(500), 10).length)
        assertEquals("", AudioLogic.cleanText(null))
    }
}
