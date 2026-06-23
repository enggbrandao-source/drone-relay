package com.dronemonitor.collector.util

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import android.os.SystemClock
import kotlinx.coroutines.*

/**
 * Monitor de performance: FPS de coleta e uso de memoria.
 * Alerta quando memoria esta critica para evitar OOM.
 */
class PerformanceMonitor(private val context: Context) {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var isRunning = false
    private var frameCount = 0
    private var lastFpsTime = SystemClock.elapsedRealtime()

    var onLowMemory: (() -> Unit)? = null
    var onStatsUpdated: ((fps: Int, memoryMb: Long) -> Unit)? = null

    fun start() {
        if (isRunning) return
        isRunning = true
        scope.launch {
            while (isActive) {
                checkMemory()
                delay(MEMORY_CHECK_INTERVAL_MS)
            }
        }
        scope.launch {
            while (isActive) {
                delay(FPS_INTERVAL_MS)
                val now = SystemClock.elapsedRealtime()
                val elapsed = now - lastFpsTime
                val fps = if (elapsed > 0) (frameCount * 1000 / elapsed).toInt() else 0
                frameCount = 0
                lastFpsTime = now
                val mem = getMemoryUsageMb()
                onStatsUpdated?.invoke(fps, mem)
            }
        }
    }

    fun stop() {
        isRunning = false
        scope.cancel()
    }

    fun recordFrame() {
        frameCount++
    }

    private fun checkMemory() {
        val memInfo = getMemoryUsageMb()
        val runtime = Runtime.getRuntime()
        val maxMem = runtime.maxMemory() / (1024 * 1024)
        val usedPercent = (memInfo * 100 / maxMem)

        if (usedPercent > LOW_MEMORY_THRESHOLD_PERCENT) {
            FileLogger.w(TAG, "Low memory warning: $usedPercent% used ($memInfo MB / $maxMem MB)")
            onLowMemory?.invoke()
        }
    }

    fun getMemoryUsageMb(): Long {
        val runtime = Runtime.getRuntime()
        return (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
    }

    fun getNativeHeapMb(): Long {
        return Debug.getNativeHeapAllocatedSize() / (1024 * 1024)
    }

    companion object {
        private const val TAG = "PerformanceMonitor"
        private const val MEMORY_CHECK_INTERVAL_MS = 10000L
        private const val FPS_INTERVAL_MS = 5000L
        private const val LOW_MEMORY_THRESHOLD_PERCENT = 85
    }
}
