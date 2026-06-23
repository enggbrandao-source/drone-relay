package com.dronemonitor.collector.util

import android.content.Context
import android.content.SharedPreferences
import android.os.PowerManager
import kotlinx.coroutines.*

/**
 * Modo de baixa energia para operacao em campo prolongada (8+ horas).
 * Reduz frequencia de coleta e transmissao quando bateria do RC esta baixa
 * ou quando app esta em segundo plano.
 */
class LowPowerMode(private val context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("power_mode", Context.MODE_PRIVATE)
    private val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var monitorJob: Job? = null

    private var isLowPower = false
    private var isBackground = false

    var onPowerModeChanged: ((Boolean, Long) -> Unit)? = null // lowPower, collectIntervalMs

    fun startMonitoring() {
        monitorJob?.cancel()
        monitorJob = scope.launch {
            while (isActive) {
                checkPowerState()
                delay(CHECK_INTERVAL_MS)
            }
        }
    }

    fun stopMonitoring() {
        monitorJob?.cancel()
    }

    fun setBackgroundMode(background: Boolean) {
        isBackground = background
        checkPowerState()
    }

    private fun checkPowerState() {
        val batteryLevel = getBatteryLevel()
        val isDeviceIdle = pm?.isDeviceIdleMode == true
        val shouldLowPower = batteryLevel < LOW_BATTERY_THRESHOLD || isBackground || isDeviceIdle

        if (shouldLowPower != isLowPower) {
            isLowPower = shouldLowPower
            val interval = if (isLowPower) LOW_POWER_INTERVAL_MS else NORMAL_INTERVAL_MS
            prefs.edit().putBoolean(KEY_LOW_POWER, isLowPower).apply()
            onPowerModeChanged?.invoke(isLowPower, interval)
            FileLogger.i(TAG, "Power mode: lowPower=$isLowPower, interval=${interval}ms, battery=$batteryLevel%")
        }
    }

    fun getCollectIntervalMs(): Long {
        return if (isLowPower) LOW_POWER_INTERVAL_MS else NORMAL_INTERVAL_MS
    }

    fun isLowPowerActive(): Boolean = isLowPower

    private fun getBatteryLevel(): Int {
        val intent = context.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: -1
        return if (level >= 0 && scale > 0) (level * 100 / scale) else 100
    }

    companion object {
        private const val TAG = "LowPowerMode"
        private const val PREFS_NAME = "power_mode"
        private const val KEY_LOW_POWER = "low_power"
        private const val CHECK_INTERVAL_MS = 60000L // 1 minuto
        private const val LOW_BATTERY_THRESHOLD = 30
        private const val NORMAL_INTERVAL_MS = 500L
        private const val LOW_POWER_INTERVAL_MS = 2000L
    }
}
