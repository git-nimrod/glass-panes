package com.nimrod.mirrorkiosk

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The on-screen sign that the microphone is in use (a rule: the mic is never open without a visible sign). Drawn by the app above the page, so
 * no pane can hide it, and it needs nothing from Home Assistant.
 *
 *   MIC_OPEN   a small soft dot in the top-right corner while the mic is open for the wake word (the audio stays on the mirror)
 *   LISTENING  a pill at the top centre, "Listening…", with a pulsing dot, while what is said goes to Home Assistant
 *   THINKING   the same pill, "Thinking…", steady, after Home Assistant heard the end of speech
 *   OFF        nothing: the mic is closed
 *
 * A native video plays on its own surface above everything, so while one plays the app also shows a short system note.
 */
class ListenSign(context: Context) : FrameLayout(context) {
    enum class State { OFF, MIC_OPEN, LISTENING, THINKING }

    private val dp = context.resources.displayMetrics.density
    private val cornerDot = View(context)
    private val pill = LinearLayout(context)
    private val pillDot = View(context)
    private val pillText = TextView(context)
    private var pulse: ObjectAnimator? = null
    var state = State.OFF; private set

    init {
        isClickable = false
        isFocusable = false
        cornerDot.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.argb(150, 255, 140, 60)) }
        addView(cornerDot, LayoutParams((10 * dp).toInt(), (10 * dp).toInt(), Gravity.TOP or Gravity.END).apply {
            topMargin = (14 * dp).toInt(); rightMargin = (14 * dp).toInt()
        })
        pill.orientation = LinearLayout.HORIZONTAL
        pill.gravity = Gravity.CENTER_VERTICAL
        pill.background = GradientDrawable().apply { cornerRadius = 40 * dp; setColor(Color.argb(200, 20, 20, 24)) }
        pill.setPadding((18 * dp).toInt(), (10 * dp).toInt(), (22 * dp).toInt(), (10 * dp).toInt())
        pillDot.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.rgb(255, 140, 60)) }
        pill.addView(pillDot, LinearLayout.LayoutParams((14 * dp).toInt(), (14 * dp).toInt()).apply { rightMargin = (12 * dp).toInt() })
        pillText.setTextColor(Color.WHITE)
        pillText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        pill.addView(pillText)
        addView(pill, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
            topMargin = (28 * dp).toInt()
        })
        show(State.OFF)
    }

    /** Main thread only. */
    fun show(s: State) {
        state = s
        cornerDot.visibility = if (s == State.MIC_OPEN) View.VISIBLE else View.GONE
        pill.visibility = if (s == State.LISTENING || s == State.THINKING) View.VISIBLE else View.GONE
        pillText.text = context.getString(if (s == State.THINKING) R.string.voice_thinking else R.string.voice_listening)
        pulse?.cancel(); pulse = null
        pillDot.alpha = 1f
        if (s == State.LISTENING) {
            pulse = ObjectAnimator.ofFloat(pillDot, "alpha", 1f, 0.25f).apply {
                duration = 600; repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE; start()
            }
        }
        visibility = if (s == State.OFF) View.GONE else View.VISIBLE
        if (s != State.OFF) bringToFront()
    }
}
