package com.dronemonitor.collector.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.dronemonitor.collector.R
import com.dronemonitor.collector.util.FieldMetricsCollector
import com.dronemonitor.collector.util.FileLogger
import com.dronemonitor.collector.util.PerformanceMonitor
import java.io.File

/**
 * Tela de diagnostico para campo.
 * Exibe latencia, buffer, memoria, FPS e permite exportar logs.
 * AGORA COM METRICAS DE CAMPO EM TEMPO REAL.
 */
class DiagnosticsActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            updateStats()
            handler.postDelayed(this, UPDATE_INTERVAL_MS)
        }
    }

    private lateinit var tvConnStatus: TextView
    private lateinit var tvLatency: TextView
    private lateinit var tvPacketsSent: TextView
    private lateinit var tvPacketsFailed: TextView
    private lateinit var tvBufferSize: TextView
    private lateinit var tvLastPacket: TextView
    private lateinit var tvMemory: TextView
    private lateinit var tvFps: TextView
    private lateinit var tvCpu: TextView
    private lateinit var tvRuntime: TextView
    private lateinit var tvAccLatency: TextView
    private lateinit var tvOcrLatency: TextView
    private lateinit var tvUpdateFreq: TextView
    private lateinit var tvPacketLoss: TextView
    private lateinit var tvReconnectRate: TextView
    private lateinit var tvFalseExtraction: TextView
    private lateinit var tvOcrAccuracy: TextView
    private lateinit var btnExportLogs: Button
    private lateinit var btnClearLogs: Button
    private lateinit var btnExportMetrics: Button
    private lateinit var btnExportCsv: Button

    private val perfMonitor = PerformanceMonitor(this)
    private lateinit var fieldMetrics: FieldMetricsCollector

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_diagnostics)

        fieldMetrics = FieldMetricsCollector(this)
        fieldMetrics.start()

        bindViews()
        setupListeners()
        perfMonitor.start()
    }

    private fun bindViews() {
        tvConnStatus = findViewById(R.id.tvConnStatus)
        tvLatency = findViewById(R.id.tvLatency)
        tvPacketsSent = findViewById(R.id.tvPacketsSent)
        tvPacketsFailed = findViewById(R.id.tvPacketsFailed)
        tvBufferSize = findViewById(R.id.tvBufferSize)
        tvLastPacket = findViewById(R.id.tvLastPacket)
        tvMemory = findViewById(R.id.tvMemory)
        tvFps = findViewById(R.id.tvFps)
        tvCpu = findViewById(R.id.tvCpu)
        tvRuntime = findViewById(R.id.tvRuntime)
        tvAccLatency = findViewById(R.id.tvAccLatency)
        tvOcrLatency = findViewById(R.id.tvOcrLatency)
        tvUpdateFreq = findViewById(R.id.tvUpdateFreq)
        tvPacketLoss = findViewById(R.id.tvPacketLoss)
        tvReconnectRate = findViewById(R.id.tvReconnectRate)
        tvFalseExtraction = findViewById(R.id.tvFalseExtraction)
        tvOcrAccuracy = findViewById(R.id.tvOcrAccuracy)
        btnExportLogs = findViewById(R.id.btnExportLogs)
        btnClearLogs = findViewById(R.id.btnClearLogs)
        btnExportMetrics = findViewById(R.id.btnExportMetrics)
        btnExportCsv = findViewById(R.id.btnExportCsv)
    }

    private fun setupListeners() {
        btnExportLogs.setOnClickListener { exportLogs() }
        btnClearLogs.setOnClickListener { clearLogs() }
        btnExportMetrics.setOnClickListener { exportMetricsJson() }
        btnExportCsv.setOnClickListener { exportMetricsCsv() }
    }

    override fun onResume() {
        super.onResume()
        handler.post(updateRunnable)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(updateRunnable)
    }

    override fun onDestroy() {
        super.onDestroy()
        perfMonitor.stop()
        fieldMetrics.stop()
    }

    private fun updateStats() {
        val prefs = getSharedPreferences("collector_prefs", Context.MODE_PRIVATE)
        val bufferSize = prefs.getInt("buffer_size", 0)

        tvBufferSize.text = "Buffer local: $bufferSize"
        tvMemory.text = "Memoria: ${perfMonitor.getMemoryUsageMb()} MB"
        tvFps.text = "FPS: --"

        // Placeholder para latencia real (integrar com LatencyMonitor)
        tvLatency.text = "Latencia: -- ms"
        tvConnStatus.text = "Verificando..."
        tvConnStatus.setTextColor(getColor(android.R.color.holo_orange_light))

        // Metricas de campo em tempo real
        tvCpu.text = "CPU: %.1f%% (max %.1f%%)".format(fieldMetrics.getCpuAverage(), fieldMetrics.getCpuMax())
        tvRuntime.text = "Runtime: %.2f h".format(fieldMetrics.getRuntimeHours())
        tvAccLatency.text = "Acc Lat: %d ms (max %d ms)".format(
            fieldMetrics.getAccessibilityLatencyAvgMs(),
            fieldMetrics.getAccessibilityLatencyMaxMs()
        )
        tvOcrLatency.text = "OCR Lat: %d ms (max %d ms)".format(
            fieldMetrics.getOcrLatencyAvgMs(),
            fieldMetrics.getOcrLatencyMaxMs()
        )
        tvUpdateFreq.text = "Freq: %.2f Hz".format(fieldMetrics.getUpdateFrequencyHz())
        tvPacketLoss.text = "Pkt Loss: %.2f%%".format(fieldMetrics.getPacketLossRate())
        tvReconnectRate.text = "Reconnect: %.1f%%".format(fieldMetrics.getReconnectSuccessRate())
        tvFalseExtraction.text = "False Ext: %.2f%%".format(fieldMetrics.getFalseExtractionRate())
        tvOcrAccuracy.text = "OCR Acc: %.1f%%".format(fieldMetrics.getOcrAccuracyRate())
    }

    private fun exportLogs() {
        val file = FileLogger.exportLogs()
        if (file != null) {
            Toast.makeText(this, "Logs exportados: ${file.name}", Toast.LENGTH_LONG).show()
        } else {
            Toast.makeText(this, "Falha ao exportar logs", Toast.LENGTH_SHORT).show()
        }
    }

    private fun clearLogs() {
        FileLogger.clearLogs()
        Toast.makeText(this, "Logs limpos", Toast.LENGTH_SHORT).show()
    }

    private fun exportMetricsJson() {
        val json = fieldMetrics.exportMetricsReport()
        val dir = File(filesDir, "metrics")
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, "field_metrics_${System.currentTimeMillis()}.json")
        file.writeText(json)
        Toast.makeText(this, "Metricas JSON: ${file.name}", Toast.LENGTH_LONG).show()
    }

    private fun exportMetricsCsv() {
        val csv = fieldMetrics.exportMetricsCsv()
        val dir = File(filesDir, "metrics")
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, "field_metrics_${System.currentTimeMillis()}.csv")
        file.writeText(csv)
        Toast.makeText(this, "Metricas CSV: ${file.name}", Toast.LENGTH_LONG).show()
    }

    companion object {
        private const val UPDATE_INTERVAL_MS = 2000L
    }
}
