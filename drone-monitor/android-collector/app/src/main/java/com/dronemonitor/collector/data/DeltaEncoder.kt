package com.dronemonitor.collector.data

import org.json.JSONObject
import kotlin.math.abs

/**
 * Codificador Delta para economia de banda.
 * Envia apenas campos que mudaram em relação ao último frame.
 */
class DeltaEncoder {

    private var lastTelemetry: TelemetryData? = null
    private var lastSentTimestamp: Long = 0

    /**
     * Retorna um JSONObject contendo apenas os deltas.
     * Se houver mudanca significativa ou timeout, envia frame completo.
     */
    fun encode(current: TelemetryData): JSONObject {
        val last = lastTelemetry
        val now = System.currentTimeMillis()
        val forceFull = last == null || (now - lastSentTimestamp > FULL_FRAME_INTERVAL_MS)

        val delta = JSONObject()
        delta.put("ts", current.timestamp)
        delta.put("id", current.droneId)
        delta.put("_d", true) // flag de delta

        if (forceFull) {
            lastTelemetry = current
            lastSentTimestamp = now
            return current.toJson().also { it.put("_f", true) }
        }

        // Compara campos e adiciona apenas os que mudaram
        if (changed(last?.speed, current.speed, SPEED_THRESHOLD)) {
            delta.put("sp", current.speed)
        }
        if (changed(last?.altitude, current.altitude, ALTITUDE_THRESHOLD)) {
            delta.put("alt", current.altitude)
        }
        if (changed(last?.sprayWidth, current.sprayWidth, WIDTH_THRESHOLD)) {
            delta.put("sw", current.sprayWidth)
        }
        if (changed(last?.flowRate, current.flowRate, FLOW_THRESHOLD)) {
            delta.put("fr", current.flowRate)
        }
        if (changed(last?.hectaresApplied, current.hectaresApplied, HECTARES_THRESHOLD)) {
            delta.put("ha", current.hectaresApplied)
        }
        if (last?.flightTime != current.flightTime) { 
            delta.put("ft", current.flightTime)
        }
        if (last?.rtkStatus != current.rtkStatus) {
            delta.put("rtk", current.rtkStatus)
        }
        if (changed(last?.signalStrength, current.signalStrength, 1)) {
            delta.put("sig", current.signalStrength)
        }
        if (changed(last?.batteryPercent, current.batteryPercent, 1)) {
            delta.put("bat", current.batteryPercent)
        }
        if (changed(last?.tankLevel, current.tankLevel, 1)) {
            delta.put("tk", current.tankLevel)
        }
        if (changed(last?.tankLiters, current.tankLiters, 0.1)) {
            delta.put("tkl", current.tankLiters)
        }
        if (changed(last?.speedKmh, current.speedKmh, 0.1)) {
            delta.put("skm", current.speedKmh)
        }
        if (changed(last?.latitude, current.latitude, GPS_THRESHOLD)) {
            delta.put("lat", current.latitude)
        }
        if (changed(last?.longitude, current.longitude, GPS_THRESHOLD)) {
            delta.put("lon", current.longitude)
        }
        if (last?.operationalStatus != current.operationalStatus) {
            delta.put("st", current.operationalStatus)
        }
        if (current.systemAlerts != last?.systemAlerts) {
            delta.put("alerts", org.json.JSONArray(current.systemAlerts))
        }

        lastTelemetry = current
        lastSentTimestamp = now
        return delta
    }

    private fun changed(old: Double?, new: Double?, threshold: Double): Boolean {
        if (old == null && new == null) return false
        if (old == null || new == null) return true
        return abs(old - new) >= threshold
    }

    private fun changed(old: Int?, new: Int?, threshold: Int): Boolean {
        if (old == null && new == null) return false
        if (old == null || new == null) return true
        return abs(old - new) >= threshold
    }

    companion object {
        private const val FULL_FRAME_INTERVAL_MS = 5000L
        private const val SPEED_THRESHOLD = 0.2
        private const val ALTITUDE_THRESHOLD = 0.3
        private const val WIDTH_THRESHOLD = 0.1
        private const val FLOW_THRESHOLD = 0.1
        private const val HECTARES_THRESHOLD = 0.01
        private const val GPS_THRESHOLD = 0.00001
    }
}