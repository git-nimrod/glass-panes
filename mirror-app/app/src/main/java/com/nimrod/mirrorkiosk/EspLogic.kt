package com.nimrod.mirrorkiosk

/**
 * The rules for the Bluetooth proxy, voice and wake word that need no Android, so they are unit-tested (EspLogicTest).
 *
 * The rules (Nov 19, 2026): everything is switched on in Home Assistant (one switch per mirror for
 * each), all three are OFF by default, and nothing runs on the mirror unless it is switched on. Voice needs the encrypted
 * connection: until Home Assistant has handed the mirror its encryption key, voice is not offered at all.
 */
object EspLogic {
    /** The three switches as saved on the mirror, plus whether the mirror has an encryption key. */
    data class Switches(val bluetooth: Boolean, val voice: Boolean, val wake: Boolean, val hasKey: Boolean)

    /** What one Home Assistant connection is: plaintext, encrypted with the real key, or the short zero-key one for the handover. */
    enum class Link { PLAIN, ENCRYPTED, PROVISIONING }

    /** The 6053 server runs only while Bluetooth or voice is switched on (the wake word alone does nothing without voice). */
    fun serverRuns(s: Switches): Boolean = s.bluetooth || s.voice

    enum class TurnTimer { LEAVE, WAIT, GIVE_UP }

    /**
     * The safety timer of one voice turn. It only ever acts on its OWN turn ([myTurn]: the turn it was started for is still the
     * current one), so a timer left over from an earlier turn can never cut off a new one. Listening is limited to [listenMs]; once
     * Home Assistant has the speech ([thinking]) it gets [answerMs] more to answer before the mirror gives up.
     */
    fun turnTimer(myTurn: Boolean, thinking: Boolean, elapsedMs: Long, listenMs: Long, answerMs: Long): TurnTimer = when {
        !myTurn -> TurnTimer.LEAVE
        thinking -> if (elapsedMs >= listenMs + answerMs) TurnTimer.GIVE_UP else TurnTimer.WAIT
        elapsedMs >= listenMs -> TurnTimer.GIVE_UP
        else -> TurnTimer.WAIT
    }

    /** Plaintext is accepted only while there is no key; after the handover only encrypted connections are. */
    fun acceptsPlaintext(s: Switches): Boolean = !s.hasKey

    /** Bluetooth proxy flags told to Home Assistant on this connection. */
    fun bluetoothFlags(s: Switches, link: Link): Int = if (s.bluetooth && link != Link.PROVISIONING) EspProto.BT_FLAGS else 0

    /** Voice flags: only with the switch on AND on a connection encrypted with the real key. */
    fun voiceFlags(s: Switches, link: Link): Int = if (s.voice && s.hasKey && link == Link.ENCRYPTED) EspProto.VA_FLAGS else 0

    /** Is the wake word in effect (switch on, voice on, key present)? The mic still opens only while HA is connected and subscribed. */
    fun wakeAllowed(s: Switches): Boolean = s.wake && s.voice && s.hasKey

    /** Should the mic be open to listen for the wake word right now? */
    fun micListens(s: Switches, haVoiceSubscribed: Boolean, turnActive: Boolean, micPermission: Boolean): Boolean =
        wakeAllowed(s) && haVoiceSubscribed && !turnActive && micPermission

    /** The one-line state for /status and the Home Assistant switch's attributes. */
    fun voiceState(s: Switches, haConnected: Boolean, haVoiceSubscribed: Boolean): String = when {
        !s.voice -> "off"
        !s.hasKey -> "waiting_for_key"           // add the mirror in HA's ESPHome integration; HA then hands over a key by itself
        !haConnected -> "waiting_for_home_assistant"
        !haVoiceSubscribed -> "waiting_for_assist"
        else -> "ready"
    }

    /** A key Home Assistant sent (NoiseEncryptionSetKeyRequest.key, base64 text of 32 bytes) -> the 32 bytes, or null if it is not one. */
    fun decodeKey(sent: ByteArray): ByteArray? {
        if (sent.isEmpty() || sent.size > 64) return null
        val text = try { String(sent, Charsets.US_ASCII) } catch (e: Exception) { return null }
        val raw = EspProto.unbase64(text) ?: return null
        return if (raw.size == 32 && raw.any { it.toInt() != 0 }) raw else null     // the all-zero key is the handover key, never a real one
    }

    /** May this connection change the key? Only an encrypted one: the zero-key handover (no key yet) or the real key (to replace it). */
    fun maySetKey(link: Link, s: Switches): Boolean = when (link) {
        Link.PROVISIONING -> !s.hasKey
        Link.ENCRYPTED -> true
        Link.PLAIN -> false                     // never over plaintext: anyone on the network could read it
    }

    /** The Bluetooth MAC Home Assistant expects: the device MAC + 1 (HA's wifi_mac_to_bluetooth_mac). */
    fun bluetoothMac(mac: String): String {
        val v = EspProto.macToLong(mac)
        return EspProto.longToMac((v + 1) and 0xFFFFFFFFFFFFL)
    }
}
