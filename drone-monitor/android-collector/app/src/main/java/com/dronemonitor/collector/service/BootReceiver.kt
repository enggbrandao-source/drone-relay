package com.dronemonitor.collector.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.dronemonitor.collector.util.CrashRecoveryManager
import com.dronemonitor.collector.util.FileLogger

/**
 * Inicializa o servico automaticamente apos boot do RC Plus.
 * Tambem verifica recuperacao de crash.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED -> {
                FileLogger.i(TAG, "Boot completo. Iniciando servico...")
                startService(context)
            }
        }
    }

    private fun startService(context: Context) {
        val serviceIntent = Intent(context, DroneCollectorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
