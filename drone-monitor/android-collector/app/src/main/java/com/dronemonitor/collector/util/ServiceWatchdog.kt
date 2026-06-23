package com.dronemonitor.collector.util

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.dronemonitor.collector.service.DroneCollectorService

/**
 * Watchdog que monitora se o servico de coleta esta respondendo.
 * Se nao receber ping por mais de WATCHDOG_TIMEOUT_MS, considera o servico travado
 * e pode acionar reinicio.
 */
class ServiceWatchdog(private val context: Context) {

    private val handler = Handler(Looper.getMainLooper())
    private var lastPingTime = SystemClock.elapsedRealtime()
    private var isRunning = false

    private val watchdogRunnable: Runnable = object : Runnable {
        override fun run() {
            val elapsed = SystemClock.elapsedRealtime() - lastPingTime
            if (elapsed > WATCHDOG_TIMEOUT_MS) {
                FileLogger.e(TAG, "WATCHDOG: Servico nao respondeu por ${elapsed}ms")
            } else {
                if (isRunning) {
                    handler.postDelayed(this, WATCHDOG_INTERVAL_MS)
                }
            }
        }
    }

    fun start() {
        if (isRunning) return
        isRunning = true
        lastPingTime = SystemClock.elapsedRealtime()
        handler.postDelayed(watchdogRunnable, WATCHDOG_INTERVAL_MS)
        FileLogger.i(TAG, "Watchdog iniciado")
    }

    fun stop() {
        isRunning = false
        handler.removeCallbacks(watchdogRunnable)
        FileLogger.i(TAG, "Watchdog parado")
    }

    fun ping() {
        lastPingTime = SystemClock.elapsedRealtime()
    }

    companion object {
        private const val TAG = "ServiceWatchdog"
        private const val WATCHDOG_TIMEOUT_MS = 30000L // 30s
        private const val WATCHDOG_INTERVAL_MS = 10000L // 10s
    }
}
