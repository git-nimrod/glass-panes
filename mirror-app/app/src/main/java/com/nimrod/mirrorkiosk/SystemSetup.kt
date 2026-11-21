package com.nimrod.mirrorkiosk

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * What the app sets up for itself when it is built into the image as a privileged app (mirror-android-3 and later), so a fresh mirror
 * needs no adb step. On older images (the app installed with adb) Android does not allow any of it and nothing happens.
 *
 *  - The screen-off admin (Screen.kt): Android 6 lets a privileged app with MANAGE_DEVICE_ADMINS make its own device admin active.
 *    The call (DevicePolicyManager.setActiveAdmin) is not in the public SDK, so it is reached by name; Android 6 has no block on that.
 *    The admin can only lock the screen (res/xml/screen_admin.xml): no wiping, no passwords.
 *
 * Camera, microphone and location are granted by the image itself on the first boot (DefaultPermissionGrantPolicy), not here.
 */
object SystemSetup {
    fun privileged(ctx: Context): Boolean =
        ctx.checkSelfPermission("android.permission.MANAGE_DEVICE_ADMINS") == PackageManager.PERMISSION_GRANTED

    /** Makes the screen-off admin active if it is not yet and Android allows it. Safe to call at every start. */
    fun ensureScreenAdmin(ctx: Context) {
        if (Screen.offReady(ctx) || !privileged(ctx)) return
        try {
            val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val m = DevicePolicyManager::class.java.getMethod("setActiveAdmin", ComponentName::class.java, Boolean::class.javaPrimitiveType)
            m.invoke(dpm, ComponentName(ctx, ScreenAdmin::class.java), false)
            Kiosk.log("screen_admin", if (Screen.offReady(ctx)) "switched on by the app" else "asked, but Android did not switch it on")
        } catch (e: Exception) {
            Kiosk.log("screen_admin", "could not switch it on (" + (e.cause ?: e).javaClass.simpleName + ")")
        }
    }
}
