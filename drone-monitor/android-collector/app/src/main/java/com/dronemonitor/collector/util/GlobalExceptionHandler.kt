package com.dronemonitor.collector.util

import android.content.Context
import android.content.Intent
import android.os.Process
import android.util.Log
import com.dronemonitor.collector.service.DroneCollectorService
import kotlin.system.exitProcess

/**
 * Handler global de excecoes nao capturadas.
 * Garante que o servico seja reiniciado apos crash e que logs sejam salvos.
 */
class GlobalExceptionHandler(private val context: Context) : Thread.UncaughtExceptionHandler {

    private val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()

    fun register() {
        Thread.setDefaultUncaughtExceptionHandler(this)
    }

    override fun uncaughtException(thread: Thread, throwable: Throwable) {
        try {
            FileLogger.e("CRASH", "Uncaught exception on thread ${thread.name}", throwable)
            CrashRecoveryManager.markCrashed(context)

            // Tenta reiniciar o servico antes de morrer
            val intent = Intent(context, DroneCollectorService::class.java)
            context.startForegroundService(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Exception handler failed", e)
        } finally {
            defaultHandler?.uncaughtException(thread, throwable)
            Process.killProcess(Process.myPid())
            exitProcess(1)
        }
    }

    companion object {
        private const val TAG = "GlobalExceptionHandler"
    }
}
