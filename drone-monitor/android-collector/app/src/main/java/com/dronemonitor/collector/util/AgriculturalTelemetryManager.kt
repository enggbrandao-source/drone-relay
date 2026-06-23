package com.dronemonitor.collector.util

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * Gerenciador de operacoes agricolas.
 * Persiste contador de hectares, timer de missao, status de pulverizacao
 * e emite alertas de tanque/bateria.
 */
class AgriculturalTelemetryManager(private val context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var missionJob: Job? = null
    private var isMissionRunning = false
    private var missionStartTime = 0L
    private var totalMissionSeconds = 0L
    private var lastHectares = 0.0
    private var tankRefillAlerted = false
    private var batterySwapAlerted = false

    var onAlert: ((String, String) -> Unit)? = null // severity, message

    init {
        totalMissionSeconds = prefs.getLong(KEY_TOTAL_MISSION_SECONDS, 0)
        lastHectares = prefs.getFloat(KEY_LAST_HECTARES, 0f).toDouble()
    }

    fun startMissionTimer() {
        if (isMissionRunning) return
        isMissionRunning = true
        missionStartTime = System.currentTimeMillis() - (totalMissionSeconds * 1000)
        missionJob = scope.launch {
            while (isActive) {
                totalMissionSeconds = (System.currentTimeMillis() - missionStartTime) / 1000
                saveMissionState()
                delay(1000)
            }
        }
        FileLogger.i(TAG, "Mission timer started")
    }

    fun stopMissionTimer() {
        isMissionRunning = false
        missionJob?.cancel()
        saveMissionState()
        FileLogger.i(TAG, "Mission timer stopped. Total: ${formatTime(totalMissionSeconds)}")
    }

    fun resetMission() {
        stopMissionTimer()
        totalMissionSeconds = 0
        lastHectares = 0.0
        tankRefillAlerted = false
        batterySwapAlerted = false
        prefs.edit()
            .remove(KEY_TOTAL_MISSION_SECONDS)
            .remove(KEY_LAST_HECTARES)
            .remove(KEY_HECTARE_TOTAL)
            .apply()
        FileLogger.i(TAG, "Mission reset")
    }

    fun processTelemetry(telemetry: JSONObject) {
        val hectares = telemetry.optDouble("ha", -1.0).takeIf { !it.isNaN() && it >= 0 }
        val battery = telemetry.optInt("bat", -1).takeIf { it >= 0 }
        val tank = telemetry.optInt("tk", -1).takeIf { it >= 0 }
        val status = telemetry.optString("st", null)

        // Hectare counter persistence
        hectares?.let { ha ->
            if (ha > lastHectares) {
                lastHectares = ha
                prefs.edit().putFloat(KEY_LAST_HECTARES, ha.toFloat()).apply()
            }
        }

        // Mission timer auto-start on spray
        if (status.equals("spraying", ignoreCase = true) && !isMissionRunning) {
            startMissionTimer()
        }

        // Tank refill alert
        tank?.let { tk ->
            if (tk < 10 && !tankRefillAlerted) {
                tankRefillAlerted = true
                onAlert?.invoke("warning", "TANQUE CRITICO: $tk% - RECARREGAR")
                FileLogger.w(TAG, "Tank refill alert: $tk%")
            } else if (tk >= 30) {
                tankRefillAlerted = false
            }
        }

        // Battery swap alert
        battery?.let { bat ->
            if (bat < 20 && !batterySwapAlerted) {
                batterySwapAlerted = true
                onAlert?.invoke("critical", "BATERIA CRITICA: $bat% - TROCAR BATERIA")
                FileLogger.w(TAG, "Battery swap alert: $bat%")
            } else if (bat >= 40) {
                batterySwapAlerted = false
            }
        }
    }

    fun getMissionTimeSeconds(): Long = totalMissionSeconds

    fun getHectaresApplied(): Double = lastHectares

    fun getSprayStatusText(): String {
        return when {
            !isMissionRunning -> "Aguardando"
            tankRefillAlerted -> "Aplicando (Tanque Critico)"
            batterySwapAlerted -> "Aplicando (Bateria Critica)"
            else -> "Aplicando"
        }
    }

    fun getConnectionQualityText(isConnected: Boolean, latencyMs: Long): String {
        return when {
            !isConnected -> "Offline"
            latencyMs < 100 -> "Otimo"
            latencyMs < 300 -> "Bom"
            latencyMs < 1000 -> "Regular"
            else -> "Ruim"
        }
    }

    fun getGpsQualityText(latitude: Double?, longitude: Double?, rtkStatus: String?): String {
        if (latitude == null || longitude == null) return "Sem Sinal"
        return when {
            rtkStatus.equals("Fix", ignoreCase = true) -> "Excelente"
            rtkStatus.equals("Float", ignoreCase = true) -> "Bom"
            else -> "Regular"
        }
    }

    private fun saveMissionState() {
        prefs.edit()
            .putLong(KEY_TOTAL_MISSION_SECONDS, totalMissionSeconds)
            .putFloat(KEY_LAST_HECTARES, lastHectares.toFloat())
            .apply()
    }

    fun saveToOperatorPrefs(telemetry: JSONObject, isConnected: Boolean, latencyMs: Long) {
        val opPrefs = context.getSharedPreferences("operator_telemetry", Context.MODE_PRIVATE)
        val edit = opPrefs.edit()

        edit.putInt("bat", telemetry.optInt("bat", -1))
        edit.putInt("tk", telemetry.optInt("tk", -1))
        edit.putFloat("sp", telemetry.optDouble("sp", -1.0).toFloat())
        edit.putFloat("alt", telemetry.optDouble("alt", -1.0).toFloat())
        edit.putFloat("ha", telemetry.optDouble("ha", -1.0).toFloat())
        edit.putInt("timer_sec", totalMissionSeconds.toInt())
        edit.putString("rtk", telemetry.optString("rtk", "--"))
        edit.putInt("sig", telemetry.optInt("sig", -1))
        edit.putString("spray_status", getSprayStatusText())

        val lat = telemetry.optDouble("lat", Double.NaN).takeIf { !it.isNaN() }
        val lon = telemetry.optDouble("lon", Double.NaN).takeIf { !it.isNaN() }
        edit.putString("gps_quality", getGpsQualityText(lat, lon, telemetry.optString("rtk", null)))
        edit.putString("conn_quality", getConnectionQualityText(isConnected, latencyMs))

        val alerts = mutableListOf<String>()
        if (tankRefillAlerted) alerts.add("TANQUE CRITICO")
        if (batterySwapAlerted) alerts.add("BATERIA CRITICA")
        edit.putString("alerts", alerts.joinToString(" | "))

        edit.apply()
    }

    companion object {
        private const val TAG = "AgriTelemetryMgr"
        private const val PREFS_NAME = "agricultural_ops"
        private const val KEY_TOTAL_MISSION_SECONDS = "mission_seconds"
        private const val KEY_LAST_HECTARES = "last_hectares"
        private const val KEY_HECTARE_TOTAL = "hectare_total"

        fun formatTime(totalSeconds: Long): String {
            val h = totalSeconds / 3600
            val m = (totalSeconds % 3600) / 60
            val s = totalSeconds % 60
            return "%02d:%02d:%02d".format(h, m, s)
        }
    }
}
