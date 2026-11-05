package com.nimrod.mirrorkiosk

import android.app.Activity
import android.app.WallpaperManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.AnimationDrawable
import android.net.Uri
import android.util.TypedValue
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.VideoView
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import kotlin.concurrent.thread
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebRequestError

/**
 * The mirror's whole screen: Firefox's engine (GeckoView) filling the display with no
 * toolbar, kept in immersive fullscreen, loading the mirror page from Home Assistant.
 *
 * While the page is loading (and while Wi-Fi or Home Assistant is not reachable yet) a black launch screen with the
 * Glass Panes boot animation covers the browser, so the mirror never shows white or an error page.
 *
 * Configure from a computer with (only the extras you give are changed; see docs/mirror-app/flashing.md):
 *   adb shell am start -n com.nimrod.mirrorkiosk/.MainActivity --es url "<page url>" --es token "<ha token>"
 *       --es key "<optional api key>" --es webhook "<presence webhook id>"
 *       --es rotation "<auto|portrait|portrait_reverse|landscape|landscape_reverse>"
 */
class MainActivity : Activity() {

    private lateinit var view: GeckoView
    private lateinit var root: FrameLayout
    private lateinit var splash: LinearLayout
    private lateinit var splashText: TextView
    private lateinit var splashPic: ImageView
    private var splashAnim: AnimationDrawable? = null          // only exists while the launch screen is showing
    private var errorPageShown = false          // the black "can't reach it" page is what just finished loading
    private var videoView: VideoView? = null
    private var videoUrl: String? = null
    private lateinit var session: GeckoSession
    private val retryLoad = Runnable { loadPage() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Stay awake, show over any lock screen, and turn the screen on when we start.
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )

        Kiosk.activity = this
        Kiosk.brightnessPct = Kiosk.prefs(this).getInt("brightness", -1)
        Kiosk.orientation = Kiosk.prefs(this).getString("orientation", "auto") ?: "auto"
        applyOrientation()

        view = GeckoView(this)
        view.setBackgroundColor(Color.BLACK)   // never flash white on a mirror
        // A plain frame holds the browser; a native video layer is added on top of it when needed.
        root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        root.addView(view, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        buildSplash()
        root.addView(splash, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        showSplash(getString(R.string.splash_starting))

        newSession()
        handleIntent(intent, startup = true)
        applyBrightness()

        startService(Intent(this, ControlService::class.java))

        // Turn off Qualcomm's display post-processing (the cause of the striped, grainy text), and
        // do it again once boot has settled, because the system can re-enable it a little later.
        DisplayPostProc.ensureOff(this)
        Kiosk.main.postDelayed({ DisplayPostProc.ensureOff(this) }, 25_000)

        blackWallpaperOnce()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent, startup = false)
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        applyBrightness()
        // Coming back (e.g. after the screen slept): make sure the display fix is still in place.
        if (System.currentTimeMillis() - DisplayPostProc.lastRunMs > 60_000) {
            DisplayPostProc.ensureOff(this)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()          // re-apply fullscreen every time we come back
    }

    override fun onDestroy() {
        Kiosk.main.removeCallbacks(retryLoad)
        if (Kiosk.activity === this) Kiosk.activity = null
        super.onDestroy()
    }

    // ---------------------------------------------------------------- page / session

    private fun newSession() {
        val s = GeckoSession()

        s.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStop(session: GeckoSession, success: Boolean) {
                if (!success) {                      // this load did not finish: try again shortly
                    Kiosk.pageOk = false
                    scheduleRetry()
                } else if (errorPageShown) {         // only the black "can't reach it" page loaded: the retry is already queued
                    errorPageShown = false
                    Kiosk.pageOk = false
                } else {                             // the real page loaded: nothing left to retry
                    Kiosk.pageOk = true
                    Kiosk.lastLoadMs = System.currentTimeMillis()
                    Kiosk.main.removeCallbacks(retryLoad)
                    hideSplash()
                }
            }
        }

        // If the engine's process dies, build a fresh session and load the page again.
        s.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onCrash(session: GeckoSession) { restartSession() }
            override fun onKill(session: GeckoSession) { restartSession() }
        }

        // Network not up yet (the mirror's Wi-Fi takes a couple of minutes after boot): show a
        // black page instead of Firefox's white error page, and keep retrying.
        s.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLoadError(
                session: GeckoSession,
                uri: String?,
                error: WebRequestError
            ): GeckoResult<String>? {
                Kiosk.pageOk = false
                errorPageShown = true
                showSplash(getString(R.string.splash_waiting))
                scheduleRetry()
                return GeckoResult.fromValue(BLACK_PAGE)
            }
        }

        s.open(runtime(this))
        view.setSession(s)
        session = s
    }

    private fun restartSession() {
        Kiosk.main.post {
            showSplash(getString(R.string.splash_starting))
            try { session.close() } catch (e: Exception) { /* already gone */ }
            newSession()
            loadPage()
        }
    }

    private fun scheduleRetry() {
        Kiosk.main.removeCallbacks(retryLoad)
        Kiosk.main.postDelayed(retryLoad, 10_000)
    }

    private fun loadPage() {
        val p = Kiosk.prefs(this)
        val url = p.getString("url", "") ?: ""
        if (url.isEmpty()) {                          // nothing to show yet: say so instead of staying blank
            Kiosk.pageOk = false
            showSplash(getString(R.string.splash_not_set_up))
            return
        }
        val token = p.getString("token", "") ?: ""
        // The mirror page reads "#t=<token>" once, stores it, and strips it from the address.
        // BYPASS_CACHE: always fetch the page fresh from Home Assistant, so a new index.html shows up
        // on the next reload instead of Firefox serving its stored copy.
        session.load(
            GeckoSession.Loader()
                .uri(if (token.isNotEmpty()) "$url#t=$token" else url)
                .flags(GeckoSession.LOAD_FLAGS_BYPASS_CACHE)
        )
    }

    fun reloadPage() {
        // A full load (rather than a plain reload) also re-supplies the token if storage was wiped.
        loadPage()
    }

    private fun handleIntent(intent: Intent?, startup: Boolean) {
        val e = intent?.extras
        var changed = false
        val ed = Kiosk.prefs(this).edit()
        e?.getString("url")?.let { ed.putString("url", it); changed = true }
        e?.getString("token")?.let { ed.putString("token", it); changed = true }
        e?.getString("key")?.let { ed.putString("key", it) }
        e?.getString("webhook")?.let { ed.putString("presence_webhook", it) }
        e?.getString("rotation")?.let {
            if (it in Kiosk.orientations) { ed.putString("orientation", it); Kiosk.orientation = it; applyOrientation() }
        }
        if (e != null && e.containsKey("brightness")) {
            val b = e.getInt("brightness", -1)
            ed.putInt("brightness", b)
            Kiosk.brightnessPct = b
            applyBrightness()
        }
        ed.apply()
        if (startup || changed) loadPage()
    }

    // ---------------------------------------------------------------- launch screen

    /** The black launch screen: the boot animation (see [loadSplashFrames]) and one line of text. */
    private fun buildSplash() {
        val dm = resources.displayMetrics
        val picW = minOf((dm.widthPixels * 0.7f).toInt(), 720)
        splashPic = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
        splashText = TextView(this).apply {
            setTextColor(Color.argb(190, 0x6b, 0xc3, 0x70))      // the brand's soft green
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
        }
        splash = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            addView(splashPic, LinearLayout.LayoutParams(picW, picW * 270 / 480))
            addView(splashText, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (24 * dm.density).toInt()
            })
        }
    }

    /**
     * Frames boot_00 .. boot_20 (res/drawable-nodpi), read when the launch screen is shown and dropped again when
     * it is hidden: all of them decoded take about 11 MB, which a mirror with ~950 MB should not hold for nothing.
     */
    private fun loadSplashFrames(): AnimationDrawable {
        val frames = ArrayList<android.graphics.drawable.Drawable>()
        while (true) {
            val id = resources.getIdentifier("boot_%02d".format(frames.size), "drawable", packageName)
            if (id == 0) break
            frames.add(resources.getDrawable(id, theme))
        }
        val anim = AnimationDrawable()
        for ((i, f) in frames.withIndex()) {
            // like the original animation: the first frame (empty) and the last (the finished logo) hold longer
            anim.addFrame(f, when (i) { 0 -> 1050; frames.size - 1 -> 1650; else -> 60 })
        }
        anim.isOneShot = false
        return anim
    }

    fun showSplash(message: String) {
        splashText.text = message
        splash.animate().cancel()
        splash.alpha = 1f
        if (splash.visibility != View.VISIBLE) splash.visibility = View.VISIBLE
        if (splashAnim == null) {
            splashAnim = loadSplashFrames().also { splashPic.setImageDrawable(it) }
        }
        splash.post { splashAnim?.let { if (!it.isRunning) it.start() } }
    }

    fun hideSplash() {
        if (splash.visibility != View.VISIBLE) return
        splash.animate().alpha(0f).setDuration(400).withEndAction {
            splash.visibility = View.GONE
            splashAnim?.stop()
            splashPic.setImageDrawable(null)           // let go of the frames
            splashAnim = null
        }
    }

    // ---------------------------------------------------------------- video

    /**
     * Plays a looping, silent video with Android's own player (the browser engine cannot start a video
     * decoder on this device). Safe to call again with the same address: nothing restarts.
     */
    fun playVideo(url: String) {
        if (videoView != null && url == videoUrl && Kiosk.videoState != "error") return
        stopVideo()
        val vv = VideoView(this)
        vv.setZOrderOnTop(true)                       // draw above the browser's own surface
        root.addView(vv, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        vv.setOnPreparedListener { mp ->
            mp.isLooping = true
            mp.setVolume(0f, 0f)
            Kiosk.videoState = "playing"
        }
        vv.setOnErrorListener { _, what, extra ->
            Kiosk.videoState = "error $what/$extra"
            stopVideo(keepState = true)
            true
        }
        Kiosk.videoState = "starting"
        videoView = vv
        videoUrl = url
        vv.setVideoURI(Uri.parse(url))
        vv.start()
        Presence.pause()                              // look less often while the video plays, so it stays smooth
    }

    fun stopVideo(keepState: Boolean = false) {
        videoView?.let {
            try { it.stopPlayback() } catch (e: Exception) { /* already stopped */ }
            root.removeView(it)
        }
        videoView = null
        videoUrl = null
        if (!keepState) Kiosk.videoState = "stopped"
        Presence.resume()
    }

    // ---------------------------------------------------------------- screen

    /** Make the (invisible-anyway) home wallpaper plain black, once, so no green leaf flashes at boot. */
    private fun blackWallpaperOnce() {
        val prefs = Kiosk.prefs(this)
        if (prefs.getBoolean("black_wallpaper", false)) return
        thread(name = "black-wallpaper", isDaemon = true) {
            try {
                val bmp = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)
                bmp.eraseColor(Color.BLACK)
                WallpaperManager.getInstance(applicationContext).setBitmap(bmp)
                prefs.edit().putBoolean("black_wallpaper", true).apply()
            } catch (e: Exception) {
                // Not worth failing over; the wallpaper stays as it was.
            }
        }
    }

    /** Turn the picture as the owner chose (Kiosk.orientation). The panel is landscape-native, so this is what makes a
     *  portrait mirror stand up without changing any Android system setting. "auto" leaves it to Android. */
    fun applyOrientation() {
        requestedOrientation = when (Kiosk.orientation) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "portrait_reverse" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "landscape_reverse" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
            else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    /** 0..100 percent window brightness, or -1 for the system default. */
    fun applyBrightness() {
        val lp = window.attributes
        lp.screenBrightness =
            if (Kiosk.brightnessPct < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            else Kiosk.brightnessPct.coerceIn(0, 100) / 100f
        window.attributes = lp
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

    companion object {
        private const val BLACK_PAGE =
            "data:text/html,<html><body style='background:%23000;margin:0'></body></html>"

        private var runtime: GeckoRuntime? = null

        /** The engine can only be created once per process, so keep it here. */
        fun runtime(ctx: Context): GeckoRuntime {
            runtime?.let { return it }
            // remote debugging and about:config only in debug builds: a release mirror should not expose the page to anyone with a cable
            val debuggable = (ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
            val settings = GeckoRuntimeSettings.Builder()
                .remoteDebuggingEnabled(debuggable)
                .aboutConfigEnabled(debuggable)
                .consoleOutput(true)
                .build()
            return GeckoRuntime.create(ctx.applicationContext, settings).also { runtime = it }
        }
    }
}
