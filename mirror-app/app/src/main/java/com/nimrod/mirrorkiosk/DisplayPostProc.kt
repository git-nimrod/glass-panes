package com.nimrod.mirrorkiosk

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.Parcel
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Turns off Qualcomm's display post-processing (CABL = content-adaptive backlight, and PP).
 *
 * Why: generic Qualcomm msm8916 builds start CABL at boot. On a mostly-black screen it hits its
 * minimum-backlight floor and stretches anti-aliased letter edges into visible stripes (and keeps
 * the backlight from ever reaching zero). Switching it off gives a plain 1:1 picture.
 *
 * How: the approach was worked out and documented by repairman29 in
 * TimStewartJ/lululemon-mirror-repurpose (PR #7, Apache-2.0). CABLService and PPService are Qualcomm
 * system services with open Binder interfaces. Each starts talking to the display daemon a moment
 * after it is bound, and only accepts "stop" once it has synced, so we send "start" until it answers
 * and then immediately "stop". This is our own small implementation of that idea.
 */
object DisplayPostProc {
    private const val TAG = "MirrorDisplayPP"

    private const val CABL_PKG = "com.qualcomm.cabl"
    private const val CABL_CLS = "com.qualcomm.cabl.CABLService"
    private const val CABL_ACTION = "org.codeaurora.cabl.ICABLService"
    private const val CABL_DESC = "com.android.cabl.ICABLService"

    private const val PP_PKG = "com.qualcomm.display"
    private const val PP_CLS = "com.qualcomm.display.PPService"
    private const val PP_ACTION = "com.android.display.IPPService"
    private const val PP_DESC = "com.android.display.IPPService"

    private const val FIRST = IBinder.FIRST_CALL_TRANSACTION   // = 1
    private const val CABL_CONTROL = FIRST                     // arg 1 = start, 0 = stop
    private const val PP_START = FIRST
    private const val PP_STOP = FIRST + 1
    private const val PP_STATUS = FIRST + 3

    private const val BIND_TIMEOUT_MS = 3000L
    private const val SOCKET_RETRY_MS = 120L
    private const val SOCKET_ATTEMPTS = 22

    @Volatile var state = "pending"      // pending | disabled | absent | error
    @Volatile var detail = ""
    @Volatile var lastRunMs = 0L
    private val busy = AtomicBoolean(false)

    /** Runs in the background. Safe to call often; a run already in progress is not doubled. */
    fun ensureOff(ctx: Context) {
        if (!busy.compareAndSet(false, true)) return
        val app = ctx.applicationContext
        thread(name = "display-pp", isDaemon = true) {
            try {
                run(app)
            } catch (e: Exception) {
                state = "error"
                detail = e.javaClass.simpleName
                Log.w(TAG, "display post-proc failed", e)
            } finally {
                lastRunMs = Kiosk.mono()
                busy.set(false)
            }
        }
    }

    private fun run(ctx: Context) {
        val hasCabl = hasService(ctx, CABL_PKG, CABL_CLS)
        val hasPp = hasService(ctx, PP_PKG, PP_CLS)
        if (!hasCabl && !hasPp) {
            state = "absent"
            detail = "no Qualcomm CABL/PP services on this system"
            return
        }
        val notes = StringBuilder()
        // Stop PP first: starting PP re-arms CABL inside the daemon, so CABL has to be stopped last.
        val pp = if (hasPp) disablePp(ctx, notes) else "absent"
        val cabl = if (hasCabl) disableCabl(ctx, notes) else "absent"
        detail = notes.toString()
        state = if (pp == "error" || cabl == "error") "error" else "disabled"
        Log.i(TAG, "display post-proc: cabl=$cabl pp=$pp state=$state $detail")
    }

    private fun hasService(ctx: Context, pkg: String, cls: String): Boolean {
        val intent = Intent().setClassName(pkg, cls)
        return ctx.packageManager.resolveService(intent, 0) != null
    }

    /** Bound connection to one of the Qualcomm services. */
    private class Session(val binder: IBinder, val conn: ServiceConnection, val ctx: Context) {
        fun close() {
            try { ctx.unbindService(conn) } catch (e: RuntimeException) { /* already unbound */ }
        }

        /** One call: interface name, optional int argument, expects a boolean-like reply. */
        fun call(descriptor: String, code: Int, arg: Int?): Boolean {
            val data = Parcel.obtain()
            val reply = Parcel.obtain()
            try {
                data.writeInterfaceToken(descriptor)
                if (arg != null) data.writeInt(arg)
                if (!binder.transact(code, data, reply, 0)) return false
                reply.readException()
                return reply.readInt() != 0
            } finally {
                reply.recycle()
                data.recycle()
            }
        }
    }

    private fun bind(ctx: Context, action: String, pkg: String, cls: String): Session? {
        val latch = CountDownLatch(1)
        val holder = arrayOfNulls<IBinder>(1)
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                holder[0] = service
                latch.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) {}
        }
        val intent = Intent(action).setClassName(pkg, cls)
        val bound = ctx.bindService(intent, conn, Context.BIND_AUTO_CREATE)
        if (!bound) {
            try { ctx.unbindService(conn) } catch (e: RuntimeException) { /* nothing to unbind */ }
            return null
        }
        if (!latch.await(BIND_TIMEOUT_MS, TimeUnit.MILLISECONDS) || holder[0] == null) {
            try { ctx.unbindService(conn) } catch (e: RuntimeException) { /* ignore */ }
            return null
        }
        return Session(holder[0]!!, conn, ctx)
    }

    private fun disableCabl(ctx: Context, notes: StringBuilder): String {
        val s = bind(ctx, CABL_ACTION, CABL_PKG, CABL_CLS)
        if (s == null) { notes.append("cabl: bind failed; "); return "error" }
        try {
            var synced = false
            for (i in 0 until SOCKET_ATTEMPTS) {
                if (s.call(CABL_DESC, CABL_CONTROL, 1)) { synced = true; break }   // start
                Thread.sleep(SOCKET_RETRY_MS)
            }
            if (!synced) { notes.append("cabl: daemon never answered; "); return "error" }
            if (!s.call(CABL_DESC, CABL_CONTROL, 0)) {                                // stop
                notes.append("cabl: stop refused; "); return "error"
            }
            return "disabled"
        } catch (e: Exception) {
            notes.append("cabl: ${e.javaClass.simpleName}; ")
            return "error"
        } finally {
            s.close()
        }
    }

    private fun disablePp(ctx: Context, notes: StringBuilder): String {
        val s = bind(ctx, PP_ACTION, PP_PKG, PP_CLS)
        if (s == null) { notes.append("pp: bind failed; "); return "error" }
        try {
            var synced = false
            for (i in 0 until SOCKET_ATTEMPTS) {
                if (s.call(PP_DESC, PP_START, null)) { synced = true; break }
                Thread.sleep(SOCKET_RETRY_MS)
            }
            if (!synced) { notes.append("pp: daemon never answered; "); return "error" }
            if (!s.call(PP_DESC, PP_STOP, null)) { notes.append("pp: stop refused; "); return "error" }
            if (s.call(PP_DESC, PP_STATUS, null)) { notes.append("pp: still running; "); return "error" }
            return "disabled"
        } catch (e: Exception) {
            notes.append("pp: ${e.javaClass.simpleName}; ")
            return "error"
        } finally {
            s.close()
        }
    }
}
