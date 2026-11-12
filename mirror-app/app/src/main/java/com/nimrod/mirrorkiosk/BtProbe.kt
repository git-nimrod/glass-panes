package com.nimrod.mirrorkiosk

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager

/**
 * GET /bluetooth/test?seconds=5: finds out whether this mirror has a working Bluetooth radio, and whether it hears nearby devices.
 *
 * It turns Bluetooth on if it was off, listens for a few seconds and reports COUNTS only (how many advertisements and distinct
 * devices were heard, and the strongest signal). The addresses and names of nearby devices are never kept, logged or sent: each is
 * counted and forgotten. If the test turned Bluetooth on, it turns it off again afterwards. Only one test runs at a time.
 */
object BtProbe {
    private val busy = java.util.concurrent.atomic.AtomicBoolean(false)

    @Suppress("DEPRECATION")
    fun run(ctx: Context, seconds: Int): String {
        val app = ctx.applicationContext
        val empty = { err: String -> BtLogic.json(err, false, false, "", false, 0, false, seconds, 0, 0, null, false) }
        if (!busy.compareAndSet(false, true)) return empty("a Bluetooth test is already running")
        var adapter: BluetoothAdapter? = null
        var weTurnedItOn = false
        try {
            adapter = BluetoothAdapter.getDefaultAdapter()
            val leSupported = app.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
            if (adapter == null) return BtLogic.json(null, false, leSupported, "none", false, 0, false, seconds, 0, 0, null, false)
            val before = BtLogic.stateName(adapter.state)

            // 1. make sure it is on (a few seconds at most)
            val started = Kiosk.mono()
            if (adapter.state != BluetoothAdapter.STATE_ON) {
                weTurnedItOn = true
                adapter.enable()
                while (adapter.state != BluetoothAdapter.STATE_ON && Kiosk.mono() - started < BtLogic.TURN_ON_WAIT_S * 1000L) Thread.sleep(250)
            }
            val becameOn = adapter.state == BluetoothAdapter.STATE_ON
            val onAfterS = ((Kiosk.mono() - started) / 1000).toInt()

            // 2. listen (counts only)
            val scanAllowed = app.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            var advertisements = 0
            val seen = HashSet<Int>()                    // hashes of addresses, only to count distinct devices; never shown or stored
            var strongest: Int? = null
            if (becameOn && leSupported) {
                val scanner = adapter.bluetoothLeScanner
                if (scanner != null) {
                    val callback = object : ScanCallback() {
                        override fun onScanResult(callbackType: Int, result: ScanResult) {
                            advertisements++
                            result.device?.address?.let { seen.add(it.hashCode()) }
                            val rssi = result.rssi
                            if (strongest == null || rssi > strongest!!) strongest = rssi
                        }
                    }
                    scanner.startScan(callback)
                    Thread.sleep(seconds * 1000L)
                    try { scanner.stopScan(callback) } catch (e: Exception) { }
                }
            }
            Kiosk.log("bluetooth_test", "turned_on=" + becameOn + " heard=" + advertisements)      // counts only
            return BtLogic.json(null, true, leSupported, before, becameOn, onAfterS, scanAllowed, seconds, advertisements, seen.size, strongest, weTurnedItOn)
        } catch (e: Exception) {
            return empty("the Bluetooth test failed (" + e.javaClass.simpleName + ")")
        } finally {
            // leave Bluetooth as it was found
            try { if (weTurnedItOn) adapter?.disable() } catch (e: Exception) { }
            busy.set(false)
        }
    }
}
