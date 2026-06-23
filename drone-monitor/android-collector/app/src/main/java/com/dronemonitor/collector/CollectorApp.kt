package com.dronemonitor.collector

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.dronemonitor.collector.util.FileLogger
import com.dronemonitor.collector.util.GlobalExceptionHandler
import com.dronemonitor.collector.util.MemoryLeakPrevention
import com.dronemonitor.collector.util.ThemeManager

class CollectorApp : Application() {

    override fun onCreate() {
        super.onCreate()

        // Logger em arquivo para diagnostico em campo
        FileLogger.init(this)

        // Handler global de excecoes - garante recuperacao apos crash
        GlobalExceptionHandler(this).register()

        // Previne vazamentos de memoria em operacoes longas
        MemoryLeakPrevention.register(this)

        // Gerenciador de tema dia/noite
        ThemeManager.init(this)

        createNotificationChannels()

        FileLogger.i("CollectorApp", "Aplicacao inicializada v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        when (level) {
            TRIM_MEMORY_RUNNING_CRITICAL, TRIM_MEMORY_COMPLETE -> {
                FileLogger.w("CollectorApp", "Low memory trim level: $level")
                MemoryLeakPrevention.suggestGcIfNeeded(150)
                MemoryLeakPrevention.cleanupDeadReferences()
            }
        }
    }

    override fun onLowMemory() {
        super.onLowMemory()
        FileLogger.w("CollectorApp", "onLowMemory called by system")
        MemoryLeakPrevention.suggestGcIfNeeded(100)
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Drone Telemetry",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Canal de monitoramento de telemetria do drone"
                setShowBadge(false)
                enableVibration(false)
                enableLights(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "drone_collector_channel"
        const val NOTIFICATION_ID = 1001
    }
}
