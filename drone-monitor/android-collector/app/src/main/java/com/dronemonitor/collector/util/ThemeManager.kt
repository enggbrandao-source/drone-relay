package com.dronemonitor.collector.util

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import androidx.appcompat.app.AppCompatDelegate

/**
 * Gerenciador de tema: alterna automaticamente entre modo dia/noite
 * baseado no sensor de luz ambiente. Tambem controla brilho da tela.
 */
object ThemeManager : SensorEventListener {

    private const val PREFS_NAME = "theme_prefs"
    private const val KEY_NIGHT_MODE = "night_mode"
    private const val KEY_AUTO_THEME = "auto_theme"
    private const val LIGHT_THRESHOLD = 50f // lux

    private var sensorManager: SensorManager? = null
    private var lightSensor: Sensor? = null
    private var currentActivity: Activity? = null
    private val handler = Handler(Looper.getMainLooper())

    fun init(context: Context) {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        lightSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LIGHT)
        if (lightSensor != null) {
            sensorManager?.registerListener(this, lightSensor, SensorManager.SENSOR_DELAY_NORMAL)
        }
    }

    fun applyTheme(activity: Activity) {
        currentActivity = activity
        val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val isNight = prefs.getBoolean(KEY_NIGHT_MODE, true)

        if (isNight) {
            activity.window.attributes = activity.window.attributes.apply {
                screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            }
        } else {
            // Modo dia: aumenta brilho para sol
            activity.window.attributes = activity.window.attributes.apply {
                screenBrightness = 1.0f
            }
        }
    }

    fun toggleDayNight(activity: Activity) {
        val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val isNight = prefs.getBoolean(KEY_NIGHT_MODE, true)
        prefs.edit().putBoolean(KEY_NIGHT_MODE, !isNight).apply()
        FileLogger.i("ThemeManager", "Theme toggled: night=${!isNight}")
    }

    fun setAutoTheme(enabled: Boolean) {
        currentActivity?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.edit()?.putBoolean(KEY_AUTO_THEME, enabled)?.apply()
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_LIGHT) return
        val lux = event.values[0]
        val activity = currentActivity ?: return
        val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_AUTO_THEME, true)) return

        val isBright = lux > LIGHT_THRESHOLD
        val isNight = prefs.getBoolean(KEY_NIGHT_MODE, true)

        if (isBright && isNight) {
            prefs.edit().putBoolean(KEY_NIGHT_MODE, false).apply()
            handler.post { applyTheme(activity) }
        } else if (!isBright && !isNight) {
            prefs.edit().putBoolean(KEY_NIGHT_MODE, true).apply()
            handler.post { applyTheme(activity) }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    fun release() {
        sensorManager?.unregisterListener(this)
        currentActivity = null
    }
}
