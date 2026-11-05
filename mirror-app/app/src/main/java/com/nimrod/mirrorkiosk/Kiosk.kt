package com.nimrod.mirrorkiosk

import android.app.ActivityManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import java.io.File

/**
 * Small shared state between the screen (MainActivity) and the web server (ControlService).
 * Everything the server needs to read is @Volatile so it can be read from its own thread.
 */
object Kiosk {
    const val PORT = 8099

    /** Anything that touches the screen has to run on the main thread; post it here. */
    val main = Handler(Looper.getMainLooper())

    @Volatile var activity: MainActivity? = null
    @Volatile var pageOk = false
    @Volatile var lastLoadMs = 0L
    @Volatile var blockedLoads = 0         // page loads refused by the navigation lock (anything but the Home Assistant page)
    @Volatile var engineRestarts = 0       // times the browser engine crashed or was killed and was rebuilt
    @Volatile var lastAliveMs = 0L         // the last heartbeat from the player page (GET /alive from the mirror itself)
    @Volatile var videoState = "stopped"      // stopped | starting | playing | error <what>/<extra>
    @Volatile var brightnessPct = -1          // -1 = system default, otherwise 0..100

    /** How the picture is turned. The panel is landscape-native, so a portrait mirror needs "portrait" or "portrait_reverse"
     *  (they are the two ways up; one of them is upside down on a given mount). "auto" leaves it to Android. */
    val orientations = listOf("auto", "portrait", "portrait_reverse", "landscape", "landscape_reverse")
    @Volatile var orientation = "auto"
    val startedMs = System.currentTimeMillis()

    fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences("kiosk", Context.MODE_PRIVATE)

    /** The app's version as installed (versionName from build.gradle.kts, which follows the repo release). */
    fun versionName(ctx: Context): String =
        try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "unknown" }
        catch (e: Exception) { "unknown" }

    private fun mb(kb: Long): Long = if (kb < 0) -1 else (kb + 512) / 1024   // kB -> whole MB, rounded; -1 = unknown

    /** One value from /proc/meminfo in kB, or -1. */
    private fun procMemKb(name: String): Long =
        try {
            File("/proc/meminfo").useLines { lines ->
                lines.firstOrNull { it.startsWith("$name:") }
                    ?.substringAfter(':')?.trim()?.substringBefore(' ')?.toLongOrNull() ?: -1L
            }
        } catch (e: Exception) { -1L }

    /**
     * Real memory numbers measured on the device right now (nothing here is estimated), as JSON for /status:
     *   total_mb / available_mb / low_memory / threshold_mb   Android's own view of the whole device
     *   free_mb / cached_mb                                   straight from /proc/meminfo
     *   app_pss_mb          the app's main process
     *   engine_pss_mb       the browser engine's own processes (content, GPU, ...), all started by this app
     *   app_total_pss_mb    app_pss_mb + engine_pss_mb
     *   processes           each of this app's processes with its own pss_mb
     *   presence_enabled    whether camera presence is switched on, so readings can be compared with and without
     * "pss" is the memory a process really holds, with shared pages divided between the processes using them.
     */
    fun memoryJson(ctx: Context): String {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        val myPid = android.os.Process.myPid()
        val mine = ctx.packageName
        val procs = try {
            am.runningAppProcesses.orEmpty().filter { it.processName == mine || it.processName.startsWith("$mine:") }
        } catch (e: Exception) { emptyList() }
        val pids = (procs.map { it.pid } + myPid).distinct().toIntArray()
        val pss = try { am.getProcessMemoryInfo(pids) } catch (e: Exception) { null }
        var appKb = 0L; var engineKb = 0L
        val list = StringBuilder()
        if (pss != null) {
            for (i in pids.indices) {
                val kb = pss[i].totalPss.toLong()
                val name = procs.firstOrNull { it.pid == pids[i] }?.processName ?: mine
                if (pids[i] == myPid) appKb += kb else engineKb += kb
                if (list.isNotEmpty()) list.append(',')
                list.append("{\"name\":\"").append(name.replace("\"", "'")).append("\",\"pss_mb\":").append(mb(kb)).append('}')
            }
        }
        val presenceOn = prefs(ctx).getBoolean("presence", true)
        return "{\"total_mb\":${info.totalMem / 1048576}," +
            "\"available_mb\":${info.availMem / 1048576}," +
            "\"low_memory\":${info.lowMemory}," +
            "\"threshold_mb\":${info.threshold / 1048576}," +
            "\"free_mb\":${mb(procMemKb("MemFree"))}," +
            "\"cached_mb\":${mb(procMemKb("Cached"))}," +
            "\"app_pss_mb\":${mb(appKb)}," +
            "\"engine_pss_mb\":${mb(engineKb)}," +
            "\"app_total_pss_mb\":${mb(appKb + engineKb)}," +
            "\"processes\":[$list]," +
            "\"presence_enabled\":$presenceOn}"
    }
}
