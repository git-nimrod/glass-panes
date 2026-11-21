package com.nimrod.mirrorkiosk

/**
 * Two memory switches for the browser engine (GeckoView), for the mirror's ~950 MB of RAM (plan v0.13, Phase 3 item 11). Both are OFF
 * by default, so nothing changes until someone turns them on (GET /engine/tune) and measures with /status:
 *
 *  - gpu_process=false: draw in the app's own process instead of a separate GPU process. On the tested mirror (image 2) that process
 *    took about 47 MB. Firefox's pref `layers.gpu-process.enabled`.
 *  - crash_helper=false: ask Firefox not to start its crash reporter (a small extra process, about 3 MB, that also restarts every
 *    minute). Environment variable `MOZ_CRASHREPORTER_DISABLE`. Whether GeckoView 143 honours it on Android is NOT verified: measure.
 *
 * GeckoView reads them from a small YAML file at start-up (GeckoRuntimeSettings.configFilePath), so a change applies at the next app
 * start. Pure Kotlin: the file text is unit-tested.
 */
object EngineConfig {
    /** The YAML text for the chosen switches, or null when both are left as Firefox has them (then no file is used at all). */
    fun yaml(gpuProcess: Boolean, crashHelper: Boolean): String? {
        if (gpuProcess && crashHelper) return null
        val sb = StringBuilder("# written by Mirror Kiosk (EngineConfig.kt); changed with GET /engine/tune\n")
        if (!gpuProcess) sb.append("prefs:\n  layers.gpu-process.enabled: false\n")
        if (!crashHelper) sb.append("env:\n  MOZ_CRASHREPORTER_DISABLE: 1\n")
        return sb.toString()
    }

    /** "0"/"1"/"false"/"true"/"off"/"on" as a switch, or null when it is none of those. */
    fun flag(value: String?): Boolean? = when (value?.lowercase()) {
        "1", "true", "on" -> true
        "0", "false", "off" -> false
        else -> null
    }

    fun json(gpuProcess: Boolean, crashHelper: Boolean, pending: Boolean): String =
        "{\"gpu_process\":" + gpuProcess + ",\"crash_helper\":" + crashHelper + ",\"restart_needed\":" + pending + "}"
}
