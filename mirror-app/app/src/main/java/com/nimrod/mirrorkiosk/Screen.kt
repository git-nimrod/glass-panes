package com.nimrod.mirrorkiosk

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.PowerManager

/**
 * Lets the app turn the screen off. Android only allows an ordinary app to do that as a "device administrator" with the force-lock
 * policy (nothing else: no wiping, no passwords). Turn it on once from a computer:
 *   adb shell dpm set-active-admin com.nimrod.mirrorkiosk/.ScreenAdmin
 * (On mirror-android-2 and later, Android's sleep turns the panel fully black, not just dim.)
 * To uninstall the app later, switch it off first in Settings > Security > Device administrators.
 */
class ScreenAdmin : DeviceAdminReceiver()

/** The screen on and off, for /screen/on and /screen/off (Home Assistant's Screen switch). */
object Screen {

    const val SETUP = "adb shell dpm set-active-admin com.nimrod.mirrorkiosk/.ScreenAdmin"

    private fun admin(ctx: Context) = ComponentName(ctx, ScreenAdmin::class.java)
    private fun dpm(ctx: Context) = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun power(ctx: Context) = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager

    /** Whether the screen can be switched off (the device-admin step above was done). */
    fun offReady(ctx: Context): Boolean = try { dpm(ctx).isAdminActive(admin(ctx)) } catch (e: Exception) { false }

    /** True while the screen is on (Android's "interactive"). */
    fun isOn(ctx: Context): Boolean = power(ctx).isInteractive

    /** Turns the screen off. Returns null when done, or a reason in plain words. */
    fun off(ctx: Context): String? {
        if (!offReady(ctx)) return "screen off is not set up on this mirror yet: run " + SETUP
        return try {
            dpm(ctx).lockNow()
            Kiosk.log("screen_off", "asked")
            null
        } catch (e: SecurityException) {
            "Android refused to switch the screen off: run " + SETUP
        }
    }

    /** Turns the screen on. The page's keep-screen-on flag holds it on afterwards. */
    @Suppress("DEPRECATION")          // SCREEN_BRIGHT_WAKE_LOCK + ACQUIRE_CAUSES_WAKEUP is still the way to wake the screen on Android 6
    fun on(ctx: Context) {
        if (isOn(ctx)) return
        val lock = power(ctx).newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
            "mirrorkiosk:screen")
        lock.acquire(3000)          // released by itself; ON_AFTER_RELEASE gives the page time to take over
        Kiosk.log("screen_on", "asked")
    }

    fun json(ctx: Context): String =
        "{\"on\":" + isOn(ctx) + ",\"off_ready\":" + offReady(ctx) + "}"
}
