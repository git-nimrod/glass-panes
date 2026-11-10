package com.nimrod.mirrorkiosk

import android.content.Context
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.PowerManager

/**
 * Plays one audio stream at a time through the mirror's own speaker, for Home Assistant (and so for Music Assistant and anything
 * else that can play to a Home Assistant media player). The rules live in AudioLogic.kt; this file is the part that talks to
 * Android's MediaPlayer.
 *
 * Every MediaPlayer call happens on the main thread (Kiosk.main). The web server only posts requests and reads the @Volatile fields.
 * The player holds Wi-Fi/CPU awake while it plays (setWakeMode), and the control service already holds a CPU wake lock.
 */
object AudioPlayer {
    @Volatile var state = AudioLogic.State.IDLE
    @Volatile var volume = AudioLogic.DEFAULT_VOLUME
    @Volatile var title = ""
    @Volatile var artist = ""
    @Volatile var error = ""
    @Volatile private var source = ""            // the address with the query removed (never a token)
    @Volatile private var durationMs = 0
    @Volatile private var player: MediaPlayer? = null
    private var generation = 0                    // bumped for every new track, so a late callback from an old one is ignored
    @Volatile private var prepared = false        // the stream has opened (MediaPlayer is past "preparing"); only then may it pause or seek
    private var pauseWhenReady = false            // pause was pressed while the stream was still opening

    /** Once per run: remember the volume the owner last set. */
    fun init(ctx: Context) {
        volume = Kiosk.prefs(ctx).getInt("audio_volume", AudioLogic.DEFAULT_VOLUME).coerceIn(0, 100)
    }

    /** Position in milliseconds, or -1 when nothing is loaded. Safe to call from any thread. */
    private fun positionMs(): Int {
        val p = player ?: return -1
        return try { if (state == AudioLogic.State.PLAYING || state == AudioLogic.State.PAUSED) p.currentPosition else -1 } catch (e: Exception) { -1 }
    }

    fun json(): String = AudioLogic.statusJson(state, volume, title, artist, positionMs(), durationMs, error, source)

    /** Start a new stream (replacing whatever was playing). `startMs` > 0 begins part-way in. The address must already be checked. */
    @Suppress("DEPRECATION")
    fun play(ctx: Context, url: String, newTitle: String, newArtist: String, newVolume: Int?, startMs: Int) {
        val app = ctx.applicationContext
        Kiosk.main.post {
            if (newVolume != null) applyVolume(app, newVolume)
            release()
            val gen = ++generation
            title = newTitle; artist = newArtist; error = ""; durationMs = 0
            prepared = false; pauseWhenReady = false
            source = AudioLogic.safeLabel(url)
            state = AudioLogic.State.BUFFERING
            Kiosk.log("audio", "play " + source)
            try {
                val mp = MediaPlayer()
                player = mp
                mp.setAudioStreamType(AudioManager.STREAM_MUSIC)
                mp.setWakeMode(app, PowerManager.PARTIAL_WAKE_LOCK)
                mp.setDataSource(url)
                val g = AudioLogic.gain(volume)
                mp.setVolume(g, g)
                mp.setOnPreparedListener {
                    if (gen != generation) return@setOnPreparedListener
                    durationMs = try { it.duration.coerceAtLeast(0) } catch (e: Exception) { 0 }
                    prepared = true
                    if (startMs > 0) try { it.seekTo(AudioLogic.seekTargetMs(startMs / 1000.0, durationMs)) } catch (e: Exception) { }
                    if (pauseWhenReady) {
                        state = AudioLogic.State.PAUSED          // opened, but stays paused until resume
                    } else {
                        it.start()
                        state = AudioLogic.State.PLAYING
                    }
                }
                mp.setOnCompletionListener {
                    if (gen != generation) return@setOnCompletionListener
                    Kiosk.log("audio", "ended")
                    release()
                    state = AudioLogic.State.IDLE
                }
                mp.setOnInfoListener { _, what, _ ->
                    if (gen == generation) {
                        if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START && state == AudioLogic.State.PLAYING) state = AudioLogic.State.BUFFERING
                        if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END && state == AudioLogic.State.BUFFERING) state = AudioLogic.State.PLAYING
                    }
                    false
                }
                mp.setOnErrorListener { _, what, extra ->
                    if (gen == generation) fail(AudioLogic.errorText(what, extra))
                    true
                }
                mp.prepareAsync()
                // a stream that never starts (wrong address, a server that never answers) must not leave the player "buffering" forever
                Kiosk.main.postDelayed({
                    if (gen == generation && !prepared && player != null) fail("the stream did not start in time")     // a live stream re-buffering later is not this
                }, AudioLogic.PREPARE_TIMEOUT_S * 1000L)
            } catch (e: Exception) {
                fail("could not start playing (" + e.javaClass.simpleName + ")")
            }
        }
    }

    fun pause() = Kiosk.main.post {
        if (!AudioLogic.canPause(state)) return@post
        if (!prepared) { pauseWhenReady = true; state = AudioLogic.State.PAUSED; return@post }      // still opening: pause once it has opened
        try { player?.pause(); state = AudioLogic.State.PAUSED } catch (e: Exception) { fail("could not pause") }
    }

    fun resume() = Kiosk.main.post {
        if (!AudioLogic.canResume(state)) return@post
        if (!prepared) { pauseWhenReady = false; state = AudioLogic.State.BUFFERING; return@post }  // still opening: it will start by itself
        try { player?.start(); state = AudioLogic.State.PLAYING } catch (e: Exception) { fail("could not resume") }
    }

    fun stop() = Kiosk.main.post {
        if (state != AudioLogic.State.IDLE) Kiosk.log("audio", "stop")
        release()
        state = AudioLogic.State.IDLE
        error = ""
    }

    fun seek(seconds: Double) = Kiosk.main.post {
        if (prepared && AudioLogic.canSeek(state)) try { player?.seekTo(AudioLogic.seekTargetMs(seconds, durationMs)) } catch (e: Exception) { }
    }

    /** 0..100. Remembered across restarts. Takes effect at once, also while playing. */
    fun setVolume(ctx: Context, pct: Int) {
        val app = ctx.applicationContext
        Kiosk.main.post { applyVolume(app, pct) }
    }

    private fun applyVolume(ctx: Context, pct: Int) {
        volume = pct.coerceIn(0, 100)
        Kiosk.prefs(ctx).edit().putInt("audio_volume", volume).apply()
        val g = AudioLogic.gain(volume)
        try { player?.setVolume(g, g) } catch (e: Exception) { }
    }

    private fun fail(text: String) {
        Kiosk.log("audio", "error: " + text)
        release()
        error = text
        state = AudioLogic.State.ERROR
    }

    /** Let go of the current MediaPlayer (the track information stays, so an ended or failed track can still be shown). */
    private fun release() {
        val p = player
        player = null
        prepared = false
        if (p != null) try { p.reset() } catch (e: Exception) { }
        if (p != null) try { p.release() } catch (e: Exception) { }
    }
}
