package com.dronemonitor.collector.ui

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
import com.dronemonitor.collector.util.ThemeManager
import java.io.File

/**
 * Tela de metricas operacionais em tempo real para validacao em campo.
 * Exibe todas as metricas solicitadas durante operacao de voo.
 */
class FieldMetricsActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            updateDisplay()
            handler.postDelayed(this, 2000)
        }
    }

    private lateinit var tvRuntime: TextView
    private lateinit var tvCpu: TextView
    private lateinit var tvRam: TextView
    private lateinit var tvBattery: TextView
    private lateinit var tvAccessibilityLatency: TextView
    private lateinit var tvOcrLatency: TextView
    private lateinit var tvUpdateFreq: TextView
    private lateinit var tvPacketLoss: TextView
    private lateinit var tvReconnectRate: TextView
    private lateinit var tvFalseExtraction: TextView
    private lateinit var tvOcrAccuracy: TextView
    private lateinit var tvFramesCollected: TextView
    private lateinit var btnExportJson: Button
    private lateinit var btnExportCsv: Button

    private var metricsCollector: FieldMetricsCollector? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ThemeManager.applyTheme(this)
        setContentView(R.layout.activity_field_metrics)

        bindViews()
        setupListeners()

        // Obtem referencia ao coletor do servico (via singleton ou intent)
        // Por enquanto cria uma nova instancia para exibicao
        metricsCollector = FieldMetricsCollector(this)
        metricsCollector?.start()

        FileLogger.i("FieldMetrics", "Metrics activity opened")
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
        metricsCollector?.stop()
    }

    private fun bindViews() {
        tvRuntime = findViewById(R.id.tvRuntime)
        tvCpu = findViewById(R.id.tvCpu)
        tvRam = findViewById(R.id.tvRam)
        tvBattery = findViewById(R.id.tvBattery)
        tvAccessibilityLatency = findViewById(R.id.tvAccessibilityLatency)
        tvOcrLatency = findViewById(R.id.tvOcrLatency)
        tvUpdateFreq = findViewById(R.id.tvUpdateFreq)
        tvPacketLoss = findViewById(R.id.tvPacketLoss)
        tvReconnectRate = findViewById(R.id.tvReconnectRate)
        tvFalseExtraction = findViewById(R.id.tvFalseExtraction)
        tvOcrAccuracy = findViewById(R.id.tvOcrAccuracy)
        tvFramesCollected = findViewById(R.id.tvFramesCollected)
        btnExportJson = findViewById(R.id.btnExportJson)
        btnExportCsv = findViewById(R.id.btnExportCsv)
    }

    private fun setupListeners() {
        btnExportJson.setOnClickListener {
            val report = metricsCollector?.exportMetricsReport()
            if (report != null) {
                saveToFile("metrics_${System.currentTimeMillis()}.json", report)
                Toast.makeText(this, "JSON exportado", Toast.LENGTH_SHORT).show()
            }
        }
        btnExportCsv.setOnClickListener {
            val csv = metricsCollector?.exportMetricsCsv()
            if (csv != null) {
                saveToFile("metrics_${System.currentTimeMillis()}.csv", csv)
                Toast.makeText(this, "CSV exportado", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateDisplay() {
        val mc = metricsCollector ?: return

        tvRuntime.text = "Runtime: %.1f h".format(mc.getRuntimeHours())
        tvCpu.text = "CPU: %.1f%% avg / %.1f%% max".format(mc.getCpuAverage(), mc.getCpuMax())
        tvRam.text = "RAM: ${mc.getRamAverageMb()} MB avg / ${mc.getRamMaxMb()} MB max"
        tvBattery.text = "Bateria RC: %.1f%%/h".format(mc.getBatteryDrainPerHour())
        tvAccessibilityLatency.text = "Acc Lat: ${mc.getAccessibilityLatencyAvgMs()}ms avg / ${mc.getAccessibilityLatencyMaxMs()}ms max"
        tvOcrLatency.text = "OCR Lat: ${mc.getOcrLatencyAvgMs()}ms avg / ${mc.getOcrLatencyMaxMs()}ms max"
        tvUpdateFreq.text = "Freq: %.1f Hz".format(mc.getUpdateFrequencyHz())
        tvPacketLoss.text = "Packet Loss: %.2f%%".format(mc.getPacketLossRate())
        tvReconnectRate.text = "Reconnect: %.1f%%".format(mc.getReconnectSuccessRate())
        tvFalseExtraction.text = "False Ext: %.2f%%".format(mc.getFalseExtractionRate())
        tvOcrAccuracy.text = "OCR Acc: %.1f%%".format(mc.getOcrAccuracyRate())
        val ok = mc.getAccessibilitySuccessRate().toLong()
        val fail = (mc.getFalseExtractionRate() * 10).toLong()
        tvFramesCollected.text = "Frames: ${ok} ok / ${fail} fail"
    }

    private fun saveToFile(filename: String, content: String) {
        try {
            val dir = getExternalFilesDir("metrics") ?: return
            dir.mkdirs()
            File(dir, filename).writeText(content)
        } catch (e: Exception) {
            FileLogger.e("FieldMetrics", "Failed to save metrics", e)
        }
    }
}
