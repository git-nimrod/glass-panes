package com.nimrod.mirrorkiosk

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.content.pm.Signature
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Installs a newer version of this app that Home Assistant sends (POST /update/install?sha256=..., the APK as the body; ControlService).
 *
 * Only possible when the app is a built-in privileged app (mirror-android-3 and later): Android 6 then gives it INSTALL_PACKAGES, and
 * PackageInstaller installs without anyone tapping. On older images (the app installed with adb) `can_install` is false and Home
 * Assistant says to install with adb instead.
 *
 * Steps: the file is written to the app's own cache while its SHA-256 is computed; then UpdateLogic decides (hash, same app, newer,
 * same signing key); then Home Assistant gets its answer; then Android installs it. Installing a new version of itself stops the app;
 * Android starts it again (it is the home app, persistent, and UpdateReceiver below also starts it), and the diary says "app_updated".
 */
object AppUpdate {
    @Volatile var state = "idle"           // idle | receiving | checking | installing | failed
    @Volatile var detail = ""
    @Volatile var received = 0L
    @Volatile var total = 0L
    private val busy = AtomicBoolean(false)
    const val ACTION_STATUS = "com.nimrod.mirrorkiosk.UPDATE_STATUS"

    fun canInstall(ctx: Context): Boolean =
        ctx.checkSelfPermission(android.Manifest.permission.INSTALL_PACKAGES) == PackageManager.PERMISSION_GRANTED

    private fun file(ctx: Context) = File(ctx.cacheDir, "update.apk")

    @Suppress("DEPRECATION")          // GET_SIGNATURES is the Android 6 way (GET_SIGNING_CERTIFICATES came in Android 9)
    fun signers(info: PackageInfo?): Set<String> =
        (info?.signatures ?: emptyArray<Signature>()).map { UpdateLogic.hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }.toSet()

    @Suppress("DEPRECATION")
    fun installedSigners(ctx: Context): Set<String> = try {
        signers(ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES))
    } catch (e: Exception) { emptySet() }

    @Suppress("DEPRECATION")
    fun versionCode(ctx: Context): Int = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode } catch (e: Exception) { -1 }

    fun json(ctx: Context): String =
        UpdateLogic.json(canInstall(ctx), state, detail, received, total, versionCode(ctx), installedSigners(ctx))

    /** At every start: drop a file left from an earlier try, and note in the diary when the app came back as a newer version. */
    fun onStart(ctx: Context) {
        try { file(ctx).delete() } catch (e: Exception) { }
        val p = Kiosk.prefs(ctx)
        val now = versionCode(ctx)
        val before = p.getInt("last_version_code", -1)
        if (before in 1 until now) Kiosk.log("app_updated", "from " + before + " to " + now + " (" + Kiosk.versionName(ctx) + ")")
        if (before != now) p.edit().putInt("last_version_code", now).apply()
    }

    /**
     * Reads [length] bytes of the upload from [input] and checks them. Returns null when the file is good and installing has been
     * scheduled (call [installLater] after answering), or the reason it was refused. Never throws.
     */
    fun receive(ctx: Context, input: InputStream, length: Long, sha256: String?): String? {
        if (!canInstall(ctx)) return "this mirror cannot install updates by itself (it needs the app built into mirror-android-3 or later); install it with adb"
        if (!busy.compareAndSet(false, true)) return "an update is already being received or installed"
        var ok = false
        try {
            val f = file(ctx)
            val problem = UpdateLogic.requestProblem(sha256, length, ctx.cacheDir.usableSpace)
            if (problem != null) return fail(problem)
            state = "receiving"; detail = ""; received = 0; total = length
            Kiosk.log("update_receiving", (length / 1_048_576).toString() + " MB")
            val digest = MessageDigest.getInstance("SHA-256")
            f.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (received < length) {
                    val n = input.read(buf, 0, minOf(buf.size.toLong(), length - received).toInt())
                    if (n < 0) return fail("the upload stopped after " + received + " of " + length + " bytes")
                    out.write(buf, 0, n)
                    digest.update(buf, 0, n)
                    received += n
                }
            }
            state = "checking"
            @Suppress("DEPRECATION")
            val info = ctx.packageManager.getPackageArchiveInfo(f.path, PackageManager.GET_SIGNATURES)
            @Suppress("DEPRECATION")
            val why = UpdateLogic.installProblem(
                UpdateLogic.hex(digest.digest()), sha256!!,
                info?.packageName, ctx.packageName,
                info?.versionCode ?: -1, versionCode(ctx),
                signers(info), installedSigners(ctx))
            if (why != null) return fail(why)
            state = "installing"
            detail = "version " + (info?.versionName ?: "?")
            ok = true
            return null
        } catch (e: Exception) {
            return fail("the update could not be saved (" + e.javaClass.simpleName + ")")
        } finally {
            if (!ok) { try { file(ctx).delete() } catch (e: Exception) { }; busy.set(false) }
        }
    }

    private fun fail(why: String): String {
        state = "failed"; detail = why
        Kiosk.log("update_refused", why)
        return why
    }

    /** Hands the checked file to Android's installer, a moment after Home Assistant has its answer (installing stops this app). */
    fun installLater(ctx: Context) {
        val app = ctx.applicationContext
        thread(name = "app-update", isDaemon = true) {
            try {
                Thread.sleep(1_500)
                val f = file(app)
                val installer = app.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                params.setAppPackageName(app.packageName)
                params.setSize(f.length())
                val id = installer.createSession(params)
                installer.openSession(id).use { session ->
                    session.openWrite("base.apk", 0, f.length()).use { out ->
                        f.inputStream().use { it.copyTo(out, 64 * 1024) }
                        session.fsync(out)
                    }
                    Kiosk.log("update_installing", detail)
                    val status = PendingIntent.getBroadcast(app, id, Intent(app, UpdateReceiver::class.java).setAction(ACTION_STATUS),
                        PendingIntent.FLAG_UPDATE_CURRENT)
                    session.commit(status.intentSender)
                }
                // if Android answers instead of replacing us, UpdateReceiver records why; the file is dropped at the next start
            } catch (e: Exception) {
                fail("Android's installer refused it (" + e.javaClass.simpleName + ")")
                try { file(app).delete() } catch (x: Exception) { }
                busy.set(false)
            }
        }
    }

    /** Called by UpdateReceiver with Android's answer, when the app is still running to hear it (a failure, usually). */
    fun installerSaid(ctx: Context, status: Int, message: String?) {
        if (status == PackageInstaller.STATUS_SUCCESS) {
            state = "idle"; detail = "installed"
            Kiosk.log("update_installed")
        } else {
            fail("Android's installer said no (status " + status + (if (message.isNullOrBlank()) "" else ": " + message) + ")")
        }
        try { file(ctx).delete() } catch (e: Exception) { }
        busy.set(false)
    }
}

/**
 * Two broadcasts for updates: Android's answer from the installer (ACTION_STATUS, from our own PendingIntent), and "this app was
 * replaced by a newer version" (MY_PACKAGE_REPLACED), which starts the screen again straight away.
 */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Kiosk.init(ctx)
        when (intent.action) {
            AppUpdate.ACTION_STATUS -> AppUpdate.installerSaid(ctx,
                intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE),
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                try {
                    ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: Exception) { /* the home screen comes back by itself anyway */ }
            }
        }
    }
}
