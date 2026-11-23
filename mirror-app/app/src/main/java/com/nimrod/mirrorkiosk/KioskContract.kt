package com.nimrod.mirrorkiosk

/**
 * What this app tells Home Assistant about itself in /status, so the integration, the player and the builder work the same with any
 * kiosk (this Android app, or a Linux kiosk on another board): which kiosk API it speaks, the platform and board, and the optional
 * calls it has. The contract is `custom_components/glass_panes/schema/kiosk_api.json` (and docs/mirror-app/api.md); a capability
 * named here must be one of its names. Pure Kotlin, so it is unit-tested without a device.
 */
object KioskContract {
    const val API = 1
    const val PLATFORM = "android"

    /** Every call this app answers (required ones included), in the contract's names. */
    val CAPABILITIES = listOf(
        "status", "reload", "log", "pair", "brightness",
        "screen", "presence", "video", "audio", "recovery", "display_fix", "rotation", "mic_test", "bluetooth_test", "engine",
        "esphome", "bluetooth_proxy", "voice", "wake_word", "front",
    )

    /** Calls that exist only on some mirrors, added to the list at run time: "app_update" when the app may install its own updates. */
    val OPTIONAL_AT_RUNTIME = listOf("app_update")

    /** Android's board name, made safe for JSON and short ("msm8916" on the tested mirror), or "unknown". */
    fun board(raw: String?): String {
        val clean = (raw ?: "").lowercase().filter { it.isLetterOrDigit() || it == '_' || it == '-' || it == '.' }.take(40)
        return clean.ifEmpty { "unknown" }
    }

    /** The /status fields, without the outer braces: `"platform":"android","board":"msm8916","kiosk_api":1,"capabilities":[...]`. */
    fun statusFields(boardRaw: String?, extra: List<String> = emptyList()): String =
        "\"platform\":\"" + PLATFORM + "\",\"board\":\"" + board(boardRaw) + "\",\"kiosk_api\":" + API +
            ",\"capabilities\":[" + (CAPABILITIES + extra.filter { it in OPTIONAL_AT_RUNTIME }).joinToString(",") { "\"" + it + "\"" } + "]"
}
