package com.nimrod.mirrorkiosk

/**
 * The rules for the mirror's audio player, with no Android in them so they are tested on their own in src/test.
 * The mirror plays one audio stream at a time from an http(s) address that Home Assistant (or anything else on the home network)
 * hands it. See AudioPlayer.kt for the part that talks to Android's MediaPlayer.
 */
object AudioLogic {
    const val MAX_URL = 2000
    const val DEFAULT_VOLUME = 50
    const val PREPARE_TIMEOUT_S = 25            // how long to wait for a stream to start before calling it an error

    enum class State(val label: String) { IDLE("idle"), BUFFERING("buffering"), PLAYING("playing"), PAUSED("paused"), ERROR("error") }

    /** null when the address may be played, otherwise the reason. Only web addresses: never files or other apps' content on the device. */
    fun checkUrl(url: String?): String? {
        if (url.isNullOrBlank()) return "need ?url="
        if (url.length > MAX_URL) return "the address is too long"
        if (url.any { it.code < 32 || it.code == 127 }) return "the address has characters that are not allowed"
        val scheme = url.substringBefore(':', "").lowercase()
        if (scheme != "http" && scheme != "https") return "only http and https addresses can be played"
        return null
    }

    fun checkVolume(v: Int?): String? = if (v == null || v !in 0..100) "use a volume from 0 to 100" else null

    /** Loudness for a volume percentage. Squared, so the lower half of the slider is usable (hearing is not linear). */
    fun gain(pct: Int): Float {
        val x = pct.coerceIn(0, 100) / 100f
        return x * x
    }

    fun canPause(s: State) = s == State.PLAYING || s == State.BUFFERING
    fun canResume(s: State) = s == State.PAUSED
    fun canSeek(s: State) = s == State.PLAYING || s == State.PAUSED

    /** A seek position in seconds as milliseconds, kept inside the track once its length is known (0 = length not known yet). */
    fun seekTargetMs(seconds: Double, durationMs: Int): Int {
        val ms = (seconds * 1000).toLong().coerceAtLeast(0)
        val cap = if (durationMs > 0) durationMs.toLong() else Int.MAX_VALUE.toLong()
        return ms.coerceAtMost(cap).toInt()
    }

    /** The address without its password, its user, its query (tokens live there) and its fragment, for the diary. */
    fun safeLabel(url: String): String {
        return try {
            val u = java.net.URI(url)
            val host = u.host ?: return "(address)"
            u.scheme + "://" + host + (if (u.port > 0) ":" + u.port else "") + (u.rawPath ?: "")
        } catch (e: Exception) {
            "(address)"
        }
    }

    /** MediaPlayer's error numbers in plain words (the MEDIA_ERROR_* values and the common "extra" codes). */
    fun errorText(what: Int, extra: Int): String {
        val why = when (extra) {
            -1004 -> "could not read the stream (network error)"
            -1007 -> "the stream is damaged or not audio"
            -1010 -> "this audio format is not supported by the mirror"
            -110 -> "the stream took too long to answer"
            else -> null
        }
        val base = when (what) {
            100 -> "the media engine stopped and was restarted"
            1 -> "the player failed"
            else -> "playback failed"
        }
        return why ?: (base + " (" + what + "/" + extra + ")")
    }

    fun jsonEscape(s: String): String {
        val sb = StringBuilder()
        for (c in s) {
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c.code < 32 -> sb.append(' ')
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    /** Limits a title or artist from outside to something safe to show and store. */
    fun cleanText(s: String?, max: Int = 120): String = (s ?: "").filter { it.code >= 32 && it.code != 127 }.trim().take(max)

    /** The answer for GET /audio (and the "audio" part of /status). Positions are in seconds; -1 = not known. */
    fun statusJson(state: State, volume: Int, title: String, artist: String, positionMs: Int, durationMs: Int, error: String, source: String): String =
        "{\"state\":\"" + state.label + "\"," +
            "\"volume\":" + volume + "," +
            "\"title\":\"" + jsonEscape(title) + "\"," +
            "\"artist\":\"" + jsonEscape(artist) + "\"," +
            "\"position_s\":" + (if (positionMs < 0) -1 else positionMs / 1000) + "," +
            "\"duration_s\":" + (if (durationMs <= 0) -1 else durationMs / 1000) + "," +
            "\"source\":\"" + jsonEscape(source) + "\"," +
            "\"error\":\"" + jsonEscape(error) + "\"}"
}
