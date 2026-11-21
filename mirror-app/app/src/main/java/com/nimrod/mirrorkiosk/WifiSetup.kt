package com.nimrod.mirrorkiosk

import android.content.Context
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager

/**
 * Joins a Wi-Fi network handed over by the installer on a fresh mirror:
 *   adb shell am start -n com.nimrod.mirrorkiosk/.MainActivity --es wifi_ssid "<name>" --es wifi_pass "<password>"
 * (no wifi_pass, or an empty one, for an open network; --es wifi_hidden 1 for a network that does not show its name).
 *
 * Android keeps the network in its own Wi-Fi settings, as if it had been typed in Settings. The app stores neither the name nor the
 * password, and the diary only says that a network was added. Works on any image (an ordinary app may add Wi-Fi networks on Android 6).
 */
object WifiSetup {
    /** Adds the network and connects to it. Returns null when Android took it, otherwise a reason (never containing the password). */
    @Suppress("DEPRECATION")          // WifiConfiguration and saveConfiguration are the Android 6 way
    fun join(ctx: Context, ssid: String?, password: String?, hidden: Boolean): String? {
        WifiLogic.problem(ssid, password)?.let { Kiosk.log("wifi_refused", it); return it }
        return try {
            val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            if (!wm.isWifiEnabled) wm.isWifiEnabled = true
            val quoted = WifiLogic.quotedSsid(ssid!!)
            // a network of the same name added earlier (by us) is replaced, so a corrected password takes effect
            wm.configuredNetworks?.filter { it.SSID == quoted }?.forEach { wm.removeNetwork(it.networkId) }
            val conf = WifiConfiguration().apply {
                SSID = quoted
                hiddenSSID = hidden
                val pass = password ?: ""
                if (pass.isEmpty()) {
                    allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
                } else {
                    allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK)
                    preSharedKey = WifiLogic.quotedPsk(pass)
                }
            }
            val id = wm.addNetwork(conf)
            if (id < 0) { Kiosk.log("wifi_refused", "Android did not take the network"); return "Android did not take the network" }
            wm.enableNetwork(id, true)
            wm.saveConfiguration()
            Kiosk.log("wifi_added", if (password.isNullOrEmpty()) "open network" else "password network")
            null
        } catch (e: Exception) {
            Kiosk.log("wifi_refused", e.javaClass.simpleName)
            "could not add the network (" + e.javaClass.simpleName + ")"
        }
    }
}
