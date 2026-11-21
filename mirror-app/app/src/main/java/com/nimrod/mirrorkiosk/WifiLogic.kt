package com.nimrod.mirrorkiosk

/**
 * The rules for the Wi-Fi network the installer hands to the app on a fresh mirror (adb ... --es wifi_ssid "..." --es wifi_pass "...",
 * see WifiSetup.kt), so nobody has to tap through Android's Wi-Fi screen with scrcpy. Pure Kotlin, unit-tested.
 *
 * Nothing here is stored by the app: Android's own Wi-Fi settings keep the network, exactly as if it had been typed in Settings.
 */
object WifiLogic {
    /** Null when the name and password can be used, otherwise a short reason (it never repeats the password). */
    fun problem(ssid: String?, password: String?): String? {
        if (ssid.isNullOrEmpty()) return "no network name"
        val bytes = ssid.toByteArray(Charsets.UTF_8).size
        if (bytes > 32) return "a network name is at most 32 bytes"
        if (ssid.any { it.code < 32 }) return "the network name has control characters"
        val pass = password ?: ""
        if (pass.isEmpty()) return null                                   // an open network
        if (isHexKey(pass)) return null                                   // a raw 64-hex-digit WPA key
        if (pass.length !in 8..63) return "a WPA password is 8 to 63 characters"
        if (pass.any { it.code < 32 || it.code > 126 }) return "a WPA password uses plain keyboard characters only"
        return null
    }

    fun isHexKey(pass: String): Boolean = pass.length == 64 && pass.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }

    /** How Android 6's WifiConfiguration wants the name: in double quotes. */
    fun quotedSsid(ssid: String): String = "\"" + ssid + "\""

    /** How WifiConfiguration wants the password: a 64-hex key bare, a passphrase in double quotes. */
    fun quotedPsk(pass: String): String = if (isHexKey(pass)) pass else "\"" + pass + "\""
}
