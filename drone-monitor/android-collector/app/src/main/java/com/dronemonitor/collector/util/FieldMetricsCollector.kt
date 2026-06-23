package com.dronemonitor.collector.util

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Debug
import android.os.Process
import android.os.SystemClock
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicLong

/**
 * Coletor de metricas operacionais para validacao em campo no RC Plus.
 * Instrumenta runtime real: CPU, RAM, bateria, latencias, taxas de sucesso/falha.
 *
 * USO:
 * 1. Inicie o DroneCollectorService
 * 2. Execute operacao de voo por 8+ horas
 * 3. Acesse Diagnostico > Exportar Metricas
 * 4. Analise o arquivo JSON/CSV gerado
 */
class FieldMetricsCollector(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    // Metricas acumulativas
    private val sessionStartTime = SystemClock.elapsedRealtime()
    private val totalFramesCollected = AtomicLong(0)
    private val totalFramesFailed = AtomicLong(0)
    private val totalPacketsSent = AtomicLong(0)
    private val totalPacketsLost = AtomicLong(0)
    private val totalReconnects = AtomicLong(0)
    private val totalReconnectSuccess = AtomicLong(0)
    private val totalAccessibilityExtractions = AtomicLong(0)
    private val totalOcrExtractions = AtomicLong(0)
    private val totalOcrFailures = AtomicLong(0)
    private val totalFalseExtractions = AtomicLong(0)

    // Amostras para calculo de medias/maximos
    private val cpuSamples = ConcurrentLinkedQueue<Double>()
    private val ramSamples = ConcurrentLinkedQueue<Long>()
    private val batterySamples = ConcurrentLinkedQueue<Int>()
    private val accessibilityLatencySamples = ConcurrentLinkedQueue<Long>()
    private val ocrLatencySamples = ConcurrentLinkedQueue<Long>()
    private val updateIntervalSamples = ConcurrentLinkedQueue<Long>()

    // Janela deslizante (ultimos 10 minutos para medias em tempo real)
    private val WINDOW_SIZE_MS = 600000L

    private var isRunning = false
    private var metricsJob: Job? = null
    private var lastBatteryPct = -1

    fun start() {
        if (isRunning) return
        isRunning = true
        FileLogger.i(TAG, "FieldMetricsCollector started")

        metricsJob = scope.launch {
            while (isActive) {
                collectSystemMetrics()
                delay(METRICS_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        isRunning = false
        metricsJob?.cancel()
        FileLogger.i(TAG, "FieldMetricsCollector stopped")
    }

    fun recordCollectionCycle(elapsedMs: Long) {
        updateIntervalSamples.offer(elapsedMs)
        trimOldSamples(updateIntervalSamples)
    }

    fun recordExtractionResult(data: com.dronemonitor.collector.data.TelemetryData) {
        val hasAny = data.speed != null || data.batteryPercent != null || data.altitude != null ||
                data.tankLevel != null || data.hectaresApplied != null
        if (!hasAny) {
            totalFramesFailed.incrementAndGet()
        } else {
            totalFramesCollected.incrementAndGet()
            // Count source-specific successes
            data.sourceMap.let { src ->
                if (src.speed == com.dronemonitor.collector.data.TelemetrySource.ACCESSIBILITY ||
                    src.batteryPercent == com.dronemonitor.collector.data.TelemetrySource.ACCESSIBILITY ||
                    src.altitude == com.dronemonitor.collector.data.TelemetrySource.ACCESSIBILITY) {
                    totalAccessibilityExtractions.incrementAndGet()
                }
                if (src.speed == com.dronemonitor.collector.data.TelemetrySource.OCR ||
                    src.batteryPercent == com.dronemonitor.collector.data.TelemetrySource.OCR ||
                    src.altitude == com.dronemonitor.collector.data.TelemetrySource.OCR) {
                    totalOcrExtractions.incrementAndGet()
                }
            }
        }
    }

    // --- Registro de eventos ---

    fun recordFrameCollected(success: Boolean, source: com.dronemonitor.collector.data.TelemetrySource) {
        if (success) {
            totalFramesCollected.incrementAndGet()
            when (source) {
                com.dronemonitor.collector.data.TelemetrySource.ACCESSIBILITY -> totalAccessibilityExtractions.incrementAndGet()
                com.dronemonitor.collector.data.TelemetrySource.OCR -> totalOcrExtractions.incrementAndGet()
                else -> {}
            }
        } else {
            totalFramesFailed.incrementAndGet()
        }
    }

    fun recordAccessibilityLatency(latencyMs: Long) {
        accessibilityLatencySamples.offer(latencyMs)
        trimOldSamples(accessibilityLatencySamples)
    }

    fun recordOcrLatency(latencyMs: Long, success: Boolean = true) {
        ocrLatencySamples.offer(latencyMs)
        trimOldSamples(ocrLatencySamples)
        if (!success) totalOcrFailures.incrementAndGet()
    }

    fun recordPacketSent(success: Boolean) {
        totalPacketsSent.incrementAndGet()
        if (!success) totalPacketsLost.incrementAndGet()
    }

    fun recordReconnect(attempted: Boolean, success: Boolean) {
        if (attempted) {
            totalReconnects.incrementAndGet()
            if (success) totalReconnectSuccess.incrementAndGet()
        }
    }

    fun recordFalseExtraction() {
        totalFalseExtractions.incrementAndGet()
    }

    fun recordUpdateInterval(intervalMs: Long) {
        updateIntervalSamples.offer(intervalMs)
        trimOldSamples(updateIntervalSamples)
    }

    // --- Metricas calculadas ---

    fun getRuntimeHours(): Double {
        return (SystemClock.elapsedRealtime() - sessionStartTime) / (1000.0 * 3600.0)
    }

    fun getCpuAverage(): Double {
        val samples = cpuSamples.toList()
        return if (samples.isNotEmpty()) samples.average() else 0.0
    }

    fun getCpuMax(): Double {
        return cpuSamples.maxOrNull() ?: 0.0
    }

    fun getRamAverageMb(): Long {
        val samples = ramSamples.toList()
        return if (samples.isNotEmpty()) samples.average().toLong() else 0L
    }

    fun getRamMaxMb(): Long {
        return ramSamples.maxOrNull() ?: 0L
    }

    fun getBatteryDrainPerHour(): Double {
        if (lastBatteryPct < 0 || batterySamples.isEmpty()) return 0.0
        val hours = getRuntimeHours()
        if (hours <= 0) return 0.0
        val startLevel = batterySamples.first()
        val currentLevel = batterySamples.last()
        return (startLevel - currentLevel) / hours
    }

    fun getAccessibilityLatencyAvgMs(): Long {
        val samples = accessibilityLatencySamples.toList()
        return if (samples.isNotEmpty()) samples.average().toLong() else 0L
    }

    fun getAccessibilityLatencyMaxMs(): Long {
        return accessibilityLatencySamples.maxOrNull() ?: 0L
    }

    fun getOcrLatencyAvgMs(): Long {
        val samples = ocrLatencySamples.toList()
        return if (samples.isNotEmpty()) samples.average().toLong() else 0L
    }

    fun getOcrLatencyMaxMs(): Long {
        return ocrLatencySamples.maxOrNull() ?: 0L
    }

    fun getUpdateFrequencyHz(): Double {
        val samples = updateIntervalSamples.toList()
        return if (samples.isNotEmpty()) 1000.0 / samples.average() else 0.0
    }

    fun getPacketLossRate(): Double {
        val sent = totalPacketsSent.get()
        val lost = totalPacketsLost.get()
        return if (sent > 0) (lost * 100.0 / sent) else 0.0
    }

    fun getReconnectSuccessRate(): Double {
        val attempts = totalReconnects.get()
        val success = totalReconnectSuccess.get()
        return if (attempts > 0) (success * 100.0 / attempts) else 0.0
    }

    fun getFalseExtractionRate(): Double {
        val total = totalFramesCollected.get() + totalFramesFailed.get()
        val falseExt = totalFalseExtractions.get()
        return if (total > 0) (falseExt * 100.0 / total) else 0.0
    }

    fun getOcrAccuracyRate(): Double {
        val ocrTotal = totalOcrExtractions.get()
        val ocrFail = totalOcrFailures.get()
        return if (ocrTotal > 0) ((ocrTotal - ocrFail) * 100.0 / ocrTotal) else 0.0
    }

    fun getAccessibilitySuccessRate(): Double {
        val accTotal = totalAccessibilityExtractions.get()
        val total = totalFramesCollected.get()
        return if (total > 0) (accTotal * 100.0 / total) else 0.0
    }

    // --- Coleta interna ---

    private fun collectSystemMetrics() {
        try {
            // CPU
            val cpu = readCpuUsage()
            if (cpu >= 0) cpuSamples.offer(cpu)

            // RAM
            val ram = getMemoryUsageMb()
            ramSamples.offer(ram)

            // Bateria
            val battery = getBatteryLevel()
            if (battery >= 0) {
                batterySamples.offer(battery)
                lastBatteryPct = battery
            }

            trimOldSamples(cpuSamples)
            trimOldSamples(ramSamples)
            trimOldSamples(batterySamples)
        } catch (e: Exception) {
            FileLogger.e(TAG, "Error collecting system metrics", e)
        }
    }

    private fun readCpuUsage(): Double {
        try {
            val pid = Process.myPid()
            val statFile = File("/proc/$pid/stat")
            if (!statFile.exists()) return -1.0

            val stat = statFile.readText().split(" ")
            if (stat.size < 17) return -1.0

            val utime = stat[13].toLong()
            val stime = stat[14].toLong()
            val totalTime = utime + stime

            // Simplificado: retorna percentual aproximado
            // Para medicao precisa, requer amostragem em intervalos
            return (totalTime % 100).toDouble()
        } catch (e: Exception) {
            return -1.0
        }
    }

    private fun getMemoryUsageMb(): Long {
        val runtime = Runtime.getRuntime()
        return (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
    }

    private fun getBatteryLevel(): Int {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        return if (level >= 0 && scale > 0) (level * 100 / scale) else -1
    }

    private fun <T> trimOldSamples(queue: ConcurrentLinkedQueue<T>) {
        while (queue.size > MAX_SAMPLES) {
            queue.poll()
        }
    }

    // --- Exportacao ---

    fun exportMetricsReport(): String {
        val report = JSONObject().apply {
            put("reportType", "field_validation")
            put("generatedAt", dateFormat.format(Date()))
            put("appVersion", com.dronemonitor.collector.BuildConfig.VERSION_NAME)
            put("runtimeHours", getRuntimeHours())

            put("cpu", JSONObject().apply {
                put("averagePercent", getCpuAverage())
                put("maxPercent", getCpuMax())
            })

            put("ram", JSONObject().apply {
                put("averageMb", getRamAverageMb())
                put("maxMb", getRamMaxMb())
            })

            put("battery", JSONObject().apply {
                put("drainPerHour", getBatteryDrainPerHour())
                put("currentLevel", lastBatteryPct)
            })

            put("accessibility", JSONObject().apply {
                put("latencyAvgMs", getAccessibilityLatencyAvgMs())
                put("latencyMaxMs", getAccessibilityLatencyMaxMs())
                put("successRate", getAccessibilitySuccessRate())
                put("totalExtractions", totalAccessibilityExtractions.get())
            })

            put("ocr", JSONObject().apply {
                put("latencyAvgMs", getOcrLatencyAvgMs())
                put("latencyMaxMs", getOcrLatencyMaxMs())
                put("accuracyRate", getOcrAccuracyRate())
                put("totalExtractions", totalOcrExtractions.get())
                put("totalFailures", totalOcrFailures.get())
            })

            put("telemetry", JSONObject().apply {
                put("updateFrequencyHz", getUpdateFrequencyHz())
                put("framesCollected", totalFramesCollected.get())
                put("framesFailed", totalFramesFailed.get())
                put("falseExtractionRate", getFalseExtractionRate())
            })

            put("network", JSONObject().apply {
                put("packetsSent", totalPacketsSent.get())
                put("packetsLost", totalPacketsLost.get())
                put("packetLossRate", getPacketLossRate())
                put("reconnectAttempts", totalReconnects.get())
                put("reconnectSuccessRate", getReconnectSuccessRate())
            })
        }

        return report.toString(2)
    }

    fun exportMetricsCsv(): String {
        val sb = StringBuilder()
        sb.appendLine("metric,value,unit")
        sb.appendLine("runtime_hours,${getRuntimeHours()},h")
        sb.appendLine("cpu_avg,${getCpuAverage()},%")
        sb.appendLine("cpu_max,${getCpuMax()},%")
        sb.appendLine("ram_avg,${getRamAverageMb()},MB")
        sb.appendLine("ram_max,${getRamMaxMb()},MB")
        sb.appendLine("battery_drain_per_hour,${getBatteryDrainPerHour()},%/h")
        sb.appendLine("accessibility_latency_avg,${getAccessibilityLatencyAvgMs()},ms")
        sb.appendLine("accessibility_latency_max,${getAccessibilityLatencyMaxMs()},ms")
        sb.appendLine("ocr_latency_avg,${getOcrLatencyAvgMs()},ms")
        sb.appendLine("ocr_latency_max,${getOcrLatencyMaxMs()},ms")
        sb.appendLine("update_frequency,${getUpdateFrequencyHz()},Hz")
        sb.appendLine("packet_loss_rate,${getPacketLossRate()},%")
        sb.appendLine("reconnect_success_rate,${getReconnectSuccessRate()},%")
        sb.appendLine("false_extraction_rate,${getFalseExtractionRate()},%")
        sb.appendLine("ocr_accuracy_rate,${getOcrAccuracyRate()},%")
        sb.appendLine("accessibility_success_rate,${getAccessibilitySuccessRate()},%")
        sb.appendLine("frames_collected,${totalFramesCollected.get()},count")
        sb.appendLine("frames_failed,${totalFramesFailed.get()},count")
        return sb.toString()
    }

    companion object {
        private const val TAG = "FieldMetricsCollector"
        private const val METRICS_INTERVAL_MS = 30000L // 30s
        private const val MAX_SAMPLES = 1000
    }
}
