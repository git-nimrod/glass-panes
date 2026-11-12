package com.nimrod.mirrorkiosk

import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Pairing: a mirror that is not set up yet shows a six-digit code on its screen; the person types it (with the mirror's address) into
 * Glass Panes in Home Assistant, and Home Assistant then sends the mirror its page address, its login and its control key straight
 * over the home network (GET /pair, see ControlService). No token is ever typed or pasted by a person.
 *
 * This file is the rules only (no Android), so they are unit tested:
 *  - the code is the only credential, so it is checked in constant time, five wrong tries lock pairing for a minute, and the code
 *    changes after the lock and after every success (one use);
 *  - what Home Assistant sends is checked hard before it is stored (the page must be a Glass Panes player address, the token and key
 *    must be plain visible characters), so a mistake or a stranger who somehow knew the code cannot point the mirror anywhere else.
 */
class PairLogic(
    private val newCode: () -> String = { randomCode() },
    private val maxTries: Int = 5,
    private val lockMs: Long = 60_000L,
) {
    enum class Result { OK, WRONG, LOCKED }

    @Volatile var code: String = newCode()
        private set
    private var failures = 0
    private var lockedUntil = 0L

    /** Is this the code on the screen? A right code is used up (the next one is different) unless [consume] is false (the check step). */
    @Synchronized
    fun check(given: String, nowMs: Long, consume: Boolean = true): Result {
        if (nowMs < lockedUntil) return Result.LOCKED
        val ok = MessageDigest.isEqual(code.toByteArray(Charsets.UTF_8), digitsOnly(given).toByteArray(Charsets.UTF_8))
        if (ok) {
            failures = 0
            if (consume) code = newCode()
            return Result.OK
        }
        failures++
        if (failures >= maxTries) {
            failures = 0
            lockedUntil = nowMs + lockMs
            code = newCode()                      // whoever was guessing starts again from nothing
        }
        return Result.WRONG
    }

    /** True while pairing is locked after too many wrong tries. */
    @Synchronized
    fun locked(nowMs: Long): Boolean = nowMs < lockedUntil

    companion object {
        private val rng = SecureRandom()
        private val PLAYER = Regex("^https?://[A-Za-z0-9.\\-\\[\\]:]+/glass_panes/player/index\\.html\\?[A-Za-z0-9_=&%.\\-]{1,300}$")
        private val TOKEN = Regex("^[A-Za-z0-9._\\-]{20,4096}$")
        private val KEY = Regex("^[A-Za-z0-9._~\\-]{16,128}$")

        fun randomCode(): String = String.format("%06d", rng.nextInt(1_000_000))

        /** "482 913", "482-913" and "482913" are all the same code. */
        fun digitsOnly(s: String): String = s.filter { it.isDigit() }

        /** "482 913": the way the code is written on the screen. */
        fun pretty(code: String): String = if (code.length == 6) code.substring(0, 3) + " " + code.substring(3) else code

        /** Null when everything Home Assistant sent is acceptable; otherwise a short reason. */
        fun payloadProblem(url: String, token: String, key: String): String? {
            if (!PLAYER.matches(url)) return "the page address is not a Glass Panes player address"
            if (!TOKEN.matches(token)) return "the login is not in the expected form"
            if (!KEY.matches(key)) return "the control key is not in the expected form"
            return null
        }

        /** The mirror's own address on the home network (the first site-local IPv4 address), or "" when it cannot tell. */
        fun localAddress(): String {
            try {
                val all = NetworkInterface.getNetworkInterfaces() ?: return ""
                for (nif in all) {
                    if (!nif.isUp || nif.isLoopback) continue
                    for (addr in nif.inetAddresses) {
                        if (addr is Inet4Address && addr.isSiteLocalAddress) return addr.hostAddress ?: ""
                    }
                }
            } catch (e: Exception) { /* no network information: the screen just leaves the address out */ }
            return ""
        }
    }
}
