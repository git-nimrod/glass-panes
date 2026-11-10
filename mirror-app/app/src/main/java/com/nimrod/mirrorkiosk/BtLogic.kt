package com.nimrod.mirrorkiosk

/**
 * The reading of the Bluetooth test (GET /bluetooth/test), with no Android in it so it is tested on its own in src/test.
 * The test only reports COUNTS about what was heard. Addresses and names of nearby devices (other people's phones, watches,
 * earbuds) are never stored, logged or sent: each one is counted and forgotten.
 */
object BtLogic {
    val SECONDS = 1..15
    const val DEFAULT_SECONDS = 5
    const val TURN_ON_WAIT_S = 12

    fun checkSeconds(s: Int?): String? = if (s == null || s !in SECONDS) "use seconds from ${SECONDS.first} to ${SECONDS.last}" else null

    /** android.bluetooth.BluetoothAdapter STATE_* numbers in words. */
    fun stateName(state: Int): String = when (state) {
        10 -> "off"
        11 -> "turning on"
        12 -> "on"
        13 -> "turning off"
        else -> "unknown ($state)"
    }

    /**
     * What the numbers mean for "can this mirror be a Bluetooth proxy?".
     * @param hasAdapter the system gave an adapter at all
     * @param leSupported the board declares Bluetooth Low Energy
     * @param becameOn the adapter reached "on" (by itself or after being asked)
     * @param scanAllowed the app may see scan results (Android 6 needs the location permission for that)
     * @param advertisements how many Bluetooth advertisements were heard during the scan
     */
    fun verdict(hasAdapter: Boolean, leSupported: Boolean, becameOn: Boolean, scanAllowed: Boolean, advertisements: Int): String = when {
        !hasAdapter -> "this device has no Bluetooth adapter"
        !becameOn -> "the adapter exists but would not turn on: the radio is probably not wired up on this board, or its driver cannot start"
        !leSupported -> "Bluetooth turns on, but Low Energy (what a Bluetooth proxy needs) is not supported"
        !scanAllowed -> "Bluetooth turns on, but the app may not see scan results yet. Grant the location permission once: adb shell pm grant com.nimrod.mirrorkiosk android.permission.ACCESS_COARSE_LOCATION"
        advertisements == 0 -> "Bluetooth turns on and scanning ran, but nothing was heard. Normal if no Bluetooth devices are within range (try again near a phone with Bluetooth on or a Bluetooth sensor). On Android 6 the Location setting must also be switched on in Android's settings for scan results to arrive"
        else -> "Bluetooth works and scanning hears nearby devices: this mirror can act as a Bluetooth proxy"
    }

    fun json(error: String?, hasAdapter: Boolean, leSupported: Boolean, stateBefore: String, becameOn: Boolean, onAfterS: Int,
             scanAllowed: Boolean, seconds: Int, advertisements: Int, devices: Int, strongestRssi: Int?, restored: Boolean): String {
        if (error != null) return "{\"ok\":false,\"error\":\"" + AudioLogic.jsonEscape(error) + "\"}"
        return "{\"ok\":true,\"adapter\":" + hasAdapter + ",\"le_supported\":" + leSupported +
            ",\"state_before\":\"" + AudioLogic.jsonEscape(stateBefore) + "\",\"turned_on\":" + becameOn +
            ",\"seconds_to_turn_on\":" + onAfterS + ",\"scan_allowed\":" + scanAllowed + ",\"scan_seconds\":" + seconds +
            ",\"advertisements\":" + advertisements + ",\"devices_heard\":" + devices +
            ",\"strongest_rssi\":" + (strongestRssi?.toString() ?: "null") + ",\"restored_off\":" + restored +
            ",\"verdict\":\"" + AudioLogic.jsonEscape(verdict(hasAdapter, leSupported, becameOn, scanAllowed, advertisements)) + "\"}"
    }
}
