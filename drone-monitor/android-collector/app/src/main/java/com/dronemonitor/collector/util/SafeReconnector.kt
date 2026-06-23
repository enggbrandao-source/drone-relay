package com.dronemonitor.collector.util

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import com.dronemonitor.collector.service.DroneCollectorService
import kotlinx.coroutines.*

/**
 * Gerencia reconexao segura apos o RC Plus entrar em sleep/wake.
 * Detecta wake events e reinicia o servico de forma controlada.
 */
class SafeReconnector(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var isRegistered = false
    private var lastWakeTime = 0L

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_ON -> handleScreenOn()
                Intent.ACTION_SCREEN_OFF -> handleScreenOff()
                Intent.ACTION_USER_PRESENT -> handleUserPresent()
            }
        }
    }

    fun register() {
        if (isRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        context.registerReceiver(screenReceiver, filter)
        isRegistered = true
        FileLogger.i(TAG, "SafeReconnector registered")
    }

    fun unregister() {
        if (!isRegistered) return
        try {
            context.unregisterReceiver(screenReceiver)
        } catch (_: Exception) {}
        isRegistered = false
    }

    private fun handleScreenOn() {
        val now = System.currentTimeMillis()
        val elapsed = now - lastWakeTime
        if (elapsed < DEBOUNCE_MS) return
        lastWakeTime = now

        FileLogger.i(TAG, "Screen ON detected, checking service health")
        scope.launch {
            delay(2000) // Aguarda estabilizacao do sistema
            if (!isServiceRunning()) {
                FileLogger.w(TAG, "Service not running after wake, restarting...")
                restartService()
            }
        }
    }

    private fun handleScreenOff() {
        FileLogger.i(TAG, "Screen OFF detected")
        // Servico continua rodando em background (foreground service)
    }

    private fun handleUserPresent() {
        FileLogger.i(TAG, "User present detected")
    }

    private fun isServiceRunning(): Boolean {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? android.app.ActivityManager
        return manager?.getRunningServices(Integer.MAX_VALUE)?.any {
            it.service.className == DroneCollectorService::class.java.name
        } ?: false
    }

    private fun restartService() {
        try {
            val intent = Intent(context, DroneCollectorService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            FileLogger.i(TAG, "Service restarted after sleep/wake")
        } catch (e: Exception) {
            FileLogger.e(TAG, "Failed to restart service", e)
        }
    }

    companion object {
        private const val TAG = "SafeReconnector"
        private const val DEBOUNCE_MS = 5000L
    }
}
