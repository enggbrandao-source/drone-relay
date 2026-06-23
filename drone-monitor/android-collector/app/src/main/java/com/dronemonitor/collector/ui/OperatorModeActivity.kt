package com.dronemonitor.collector.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.dronemonitor.collector.R
import com.dronemonitor.collector.service.DroneCollectorService
import com.dronemonitor.collector.util.FileLogger
import com.dronemonitor.collector.util.ThemeManager
import kotlinx.coroutines.*

/**
 * Modo Operador - Interface ultra-simplificada para uso em campo com luvas.
 * Exibe apenas dados essenciais em fontes grandes com codigos de cor.
 */
class OperatorModeActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private lateinit var tvBattery: TextView
    private lateinit var tvTank: TextView
    private lateinit var tvSpeed: TextView
    private lateinit var tvAltitude: TextView
    private lateinit var tvHectares: TextView
    private lateinit var tvTimer: TextView
    private lateinit var tvRtk: TextView
    private lateinit var tvSignal: TextView
    private lateinit var tvSprayStatus: TextView
    private lateinit var tvGpsQuality: TextView
    private lateinit var tvConnQuality: TextView
    private lateinit var tvAlertBanner: TextView
    private lateinit var btnEmergencyStop: Button
    private lateinit var btnToggleTheme: ImageButton
    private lateinit var btnToggleSize: ImageButton
    private lateinit var layoutRoot: LinearLayout

    private var lastTelemetryUpdate = 0L
    private var emergencyActive = false
    private var largeFontMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ThemeManager.applyTheme(this)
        enableImmersiveMode()
        keepScreenOn()
        setContentView(R.layout.activity_operator_mode)

        bindViews()
        setupListeners()
        startTelemetryUpdateLoop()
        FileLogger.i("OperatorMode", "Modo operador iniciado")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableImmersiveMode()
    }

    override fun onResume() {
        super.onResume()
        ThemeManager.applyTheme(this)
    }

    override fun onDestroy() {
        super.onDestroy()
        uiScope.cancel()
        handler.removeCallbacksAndMessages(null)
    }

    private fun enableImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
    }

    private fun keepScreenOn() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun bindViews() {
        layoutRoot = findViewById(R.id.layoutOperatorRoot)
        tvBattery = findViewById(R.id.tvOpBattery)
        tvTank = findViewById(R.id.tvOpTank)
        tvSpeed = findViewById(R.id.tvOpSpeed)
        tvAltitude = findViewById(R.id.tvOpAltitude)
        tvHectares = findViewById(R.id.tvOpHectares)
        tvTimer = findViewById(R.id.tvOpTimer)
        tvRtk = findViewById(R.id.tvOpRtk)
        tvSignal = findViewById(R.id.tvOpSignal)
        tvSprayStatus = findViewById(R.id.tvOpSprayStatus)
        tvGpsQuality = findViewById(R.id.tvOpGpsQuality)
        tvConnQuality = findViewById(R.id.tvOpConnQuality)
        tvAlertBanner = findViewById(R.id.tvOpAlertBanner)
        btnEmergencyStop = findViewById(R.id.btnEmergencyStop)
        btnToggleTheme = findViewById(R.id.btnToggleTheme)
        btnToggleSize = findViewById(R.id.btnToggleSize)
    }

    private fun setupListeners() {
        btnEmergencyStop.setOnClickListener {
            if (!emergencyActive) {
                showEmergencyDialog()
            } else {
                resumeOperations()
            }
        }

        btnToggleTheme.setOnClickListener {
            ThemeManager.toggleDayNight(this)
            ThemeManager.applyTheme(this)
        }

        btnToggleSize.setOnClickListener {
            largeFontMode = !largeFontMode
            applyFontSize()
        }
    }

    private fun showEmergencyDialog() {
        AlertDialog.Builder(this)
            .setTitle("PARADA DE EMERGENCIA")
            .setMessage("Desconectar transmissao de telemetria?")
            .setPositiveButton("PARAR AGORA") { _, _ ->
                emergencyStop()
            }
            .setNegativeButton("CANCELAR", null)
            .show()
    }

    private fun emergencyStop() {
        emergencyActive = true
        stopService(Intent(this, DroneCollectorService::class.java))
        btnEmergencyStop.text = "RESUMIR OPERACAO"
        btnEmergencyStop.setBackgroundColor(ContextCompat.getColor(this, android.R.color.holo_red_dark))
        tvAlertBanner.text = "EMERGENCIA: Transmissao parada"
        tvAlertBanner.setBackgroundColor(ContextCompat.getColor(this, android.R.color.holo_red_dark))
        tvAlertBanner.visibility = View.VISIBLE
        FileLogger.w("OperatorMode", "Parada de emergencia ativada")
    }

    private fun resumeOperations() {
        emergencyActive = false
        val intent = Intent(this, DroneCollectorService::class.java)
        startForegroundService(intent)
        btnEmergencyStop.text = "PARADA DE EMERGENCIA"
        btnEmergencyStop.setBackgroundColor(ContextCompat.getColor(this, android.R.color.holo_red_light))
        tvAlertBanner.visibility = View.GONE
        FileLogger.i("OperatorMode", "Operacao retomada")
    }

    private fun applyFontSize() {
        val sizeNormal = if (largeFontMode) 28f else 20f
        val sizeLarge = if (largeFontMode) 40f else 28f
        val sizeValue = if (largeFontMode) 36f else 26f

        tvBattery.textSize = sizeValue
        tvTank.textSize = sizeValue
        tvSpeed.textSize = sizeValue
        tvAltitude.textSize = sizeValue
        tvHectares.textSize = sizeValue
        tvTimer.textSize = sizeValue
        tvRtk.textSize = sizeNormal
        tvSignal.textSize = sizeNormal
        tvSprayStatus.textSize = sizeLarge
        tvGpsQuality.textSize = sizeNormal
        tvConnQuality.textSize = sizeNormal
        btnEmergencyStop.textSize = if (largeFontMode) 22f else 16f
    }

    private fun startTelemetryUpdateLoop() {
        uiScope.launch {
            while (isActive) {
                updateTelemetryDisplay()
                delay(500)
            }
        }
    }

    private fun updateTelemetryDisplay() {
        val prefs = getSharedPreferences("operator_telemetry", Context.MODE_PRIVATE)

        val battery = prefs.getInt("bat", -1)
        val tank = prefs.getInt("tk", -1)
        val speed = prefs.getFloat("sp", -1f)
        val altitude = prefs.getFloat("alt", -1f)
        val hectares = prefs.getFloat("ha", -1f)
        val timerSec = prefs.getInt("timer_sec", 0)
        val rtk = prefs.getString("rtk", "--")
        val signal = prefs.getInt("sig", -1)
        val sprayStatus = prefs.getString("spray_status", "Aguardando")
        val gpsQuality = prefs.getString("gps_quality", "--")
        val connQuality = prefs.getString("conn_quality", "--")
        val alerts = prefs.getString("alerts", "") ?: ""

        tvBattery.text = if (battery >= 0) "$battery%" else "--"
        tvTank.text = if (tank >= 0) "$tank%" else "--"
        tvSpeed.text = if (speed >= 0) "%.1f".format(speed) else "--"
        tvAltitude.text = if (altitude >= 0) "%.1f".format(altitude) else "--"
        tvHectares.text = if (hectares >= 0) "%.2f ha".format(hectares) else "-- ha"
        tvTimer.text = formatMissionTimer(timerSec)
        tvRtk.text = rtk
        tvSignal.text = if (signal >= 0) "$signal%" else "--"
        tvSprayStatus.text = sprayStatus
        tvGpsQuality.text = gpsQuality
        tvConnQuality.text = connQuality

        applyColorCodes(battery, tank, signal, rtk ?: "", gpsQuality ?: "", connQuality ?: "", alerts)

        if (alerts.isNotBlank()) {
            tvAlertBanner.text = alerts
            tvAlertBanner.visibility = View.VISIBLE
        } else {
            tvAlertBanner.visibility = View.GONE
        }
    }

    private fun applyColorCodes(
        battery: Int, tank: Int, signal: Int,
        rtk: String, gpsQuality: String, connQuality: String, alerts: String
    ) {
        val ctx = this

        // Battery
        tvBattery.setTextColor(when {
            battery < 20 -> ContextCompat.getColor(ctx, android.R.color.holo_red_light)
            battery < 35 -> ContextCompat.getColor(ctx, android.R.color.holo_orange_light)
            else -> ContextCompat.getColor(ctx, android.R.color.holo_green_light)
        })

        // Tank
        tvTank.setTextColor(when {
            tank < 10 -> ContextCompat.getColor(ctx, android.R.color.holo_red_light)
            tank < 25 -> ContextCompat.getColor(ctx, android.R.color.holo_orange_light)
            else -> ContextCompat.getColor(ctx, android.R.color.holo_green_light)
        })

        // Signal
        tvSignal.setTextColor(when {
            signal < 20 -> ContextCompat.getColor(ctx, android.R.color.holo_red_light)
            signal < 40 -> ContextCompat.getColor(ctx, android.R.color.holo_orange_light)
            else -> ContextCompat.getColor(ctx, android.R.color.holo_green_light)
        })

        // RTK
        tvRtk.setTextColor(when {
            rtk.equals("Fix", ignoreCase = true) -> ContextCompat.getColor(ctx, android.R.color.holo_green_light)
            rtk.equals("Float", ignoreCase = true) -> ContextCompat.getColor(ctx, android.R.color.holo_orange_light)
            else -> ContextCompat.getColor(ctx, android.R.color.holo_red_light)
        })

        // Spray status
        val sprayText = tvSprayStatus.text.toString()
        tvSprayStatus.setTextColor(when {
            sprayText.contains("Aplicando", ignoreCase = true) -> ContextCompat.getColor(ctx, android.R.color.holo_green_light)
            sprayText.contains("Pausado", ignoreCase = true) -> ContextCompat.getColor(ctx, android.R.color.holo_orange_light)
            else -> ContextCompat.getColor(ctx, android.R.color.white)
        })

        // GPS
        tvGpsQuality.setTextColor(when {
            gpsQuality.contains("Bom", ignoreCase = true) || gpsQuality.contains("Excelente", ignoreCase = true) ->
                ContextCompat.getColor(ctx, android.R.color.holo_green_light)
            gpsQuality.contains("Fraco", ignoreCase = true) || gpsQuality.contains("Ruim", ignoreCase = true) ->
                ContextCompat.getColor(ctx, android.R.color.holo_red_light)
            else -> ContextCompat.getColor(ctx, android.R.color.holo_orange_light)
        })

        // Connection
        tvConnQuality.setTextColor(when {
            connQuality.contains("Otimo", ignoreCase = true) || connQuality.contains("Bom", ignoreCase = true) ->
                ContextCompat.getColor(ctx, android.R.color.holo_green_light)
            connQuality.contains("Ruim", ignoreCase = true) || connQuality.contains("Offline", ignoreCase = true) ->
                ContextCompat.getColor(ctx, android.R.color.holo_red_light)
            else -> ContextCompat.getColor(ctx, android.R.color.holo_orange_light)
        })

        // Alerts banner
        if (alerts.contains("critica", ignoreCase = true) || alerts.contains("critico", ignoreCase = true)) {
            tvAlertBanner.setBackgroundColor(ContextCompat.getColor(ctx, android.R.color.holo_red_dark))
        } else if (alerts.contains("aviso", ignoreCase = true) || alerts.contains("warning", ignoreCase = true)) {
            tvAlertBanner.setBackgroundColor(ContextCompat.getColor(ctx, android.R.color.holo_orange_dark))
        }
    }

    private fun formatMissionTimer(totalSeconds: Int): String {
        val h = totalSeconds / 3600
        val m = (totalSeconds % 3600) / 60
        val s = totalSeconds % 60
        return "%02d:%02d:%02d".format(h, m, s)
    }

    companion object {
        fun launch(context: Context) {
            context.startActivity(Intent(context, OperatorModeActivity::class.java))
        }
    }
}
