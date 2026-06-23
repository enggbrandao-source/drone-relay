package com.dronemonitor.collector.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.dronemonitor.collector.util.FileLogger
import kotlinx.coroutines.*

/**
 * Watchdog que monitora o DroneCollectorService.
 * Reinicia o servico se detectar que parou de responder ou foi morto pelo sistema.
 */
class ServiceWatchdog(private val context: Context) {

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var isRunning = false
    private var lastPingTime = System.currentTimeMillis()
    private var checkRunnable: Runnable? = null

    fun start() {
        if (isRunning) return
        isRunning = true
        FileLogger.i(TAG, "Watchdog started")
        scheduleCheck()
    }

    fun stop() {
        isRunning = false
        checkRunnable?.let { handler.removeCallbacks(it) }
        scope.cancel()
    }

    fun ping() {
        lastPingTime = System.currentTimeMillis()
    }

    private fun scheduleCheck() {
        checkRunnable = Runnable {
            if (!isRunning) return@Runnable
            checkServiceHealth()
            handler.postDelayed(checkRunnable!!, CHECK_INTERVAL_MS)
        }
        handler.postDelayed(checkRunnable!!, CHECK_INTERVAL_MS)
    }

    private fun checkServiceHealth() {
        val elapsed = System.currentTimeMillis() - lastPingTime
        if (elapsed > WATCHDOG_TIMEOUT_MS) {
            FileLogger.w(TAG, "Service unresponsive for ${elapsed}ms. Restarting...")
            restartService()
        }
    }

    private fun restartService() {
        try {
            val intent = Intent(context, DroneCollectorService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            lastPingTime = System.currentTimeMillis()
            FileLogger.i(TAG, "Service restarted by watchdog")
        } catch (e: Exception) {
            FileLogger.e(TAG, "Failed to restart service", e)
        }
    }

    companion object {
        private const val TAG = "ServiceWatchdog"
        private const val CHECK_INTERVAL_MS = 30000L // 30s
        private const val WATCHDOG_TIMEOUT_MS = 120000L // 2 minutos
    }
}
