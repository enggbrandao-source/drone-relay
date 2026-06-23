package com.dronemonitor.collector.network

import com.dronemonitor.collector.util.FileLogger
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Monitor de latencia de telemetria.
 * Rastreia tempo entre coleta e confirmacao de envio.
 */
class LatencyMonitor {

    data class Sample(val timestamp: Long, val latencyMs: Long)

    private val samples = ConcurrentLinkedQueue<Sample>()
    private val pendingTimestamps = HashMap<String, Long>()
    private var totalSent = 0L
    private var totalFailed = 0L

    fun recordSent(packetId: String) {
        pendingTimestamps[packetId] = System.currentTimeMillis()
        totalSent++
    }

    fun recordAcknowledged(packetId: String) {
        val sentTime = pendingTimestamps.remove(packetId) ?: return
        val latency = System.currentTimeMillis() - sentTime
        samples.offer(Sample(System.currentTimeMillis(), latency))
        trimOldSamples()
    }

    fun recordFailed(packetId: String) {
        pendingTimestamps.remove(packetId)
        totalFailed++
    }

    fun getAverageLatencyMs(): Long {
        val list = samples.toList()
        if (list.isEmpty()) return 0
        return list.map { it.latencyMs }.average().toLong()
    }

    fun getMaxLatencyMs(): Long {
        return samples.maxOfOrNull { it.latencyMs } ?: 0
    }

    fun getTotalSent(): Long = totalSent
    fun getTotalFailed(): Long = totalFailed

    fun getSuccessRate(): Float {
        val total = totalSent + totalFailed
        if (total == 0L) return 0f
        return ((totalSent - totalFailed) * 100f / totalSent).coerceIn(0f, 100f)
    }

    fun reset() {
        samples.clear()
        pendingTimestamps.clear()
        totalSent = 0
        totalFailed = 0
    }

    private fun trimOldSamples() {
        val cutoff = System.currentTimeMillis() - SAMPLE_WINDOW_MS
        while (samples.peek()?.timestamp?.let { it < cutoff } == true) {
            samples.poll()
        }
    }

    companion object {
        private const val SAMPLE_WINDOW_MS = 300000L // 5 minutos
        private const val TAG = "LatencyMonitor"
    }
}
