package com.dronemonitor.collector.data

import org.json.JSONObject

/**
 * Modelo de dados de telemetria do drone com metadados de fonte.
 * Cada campo indica de onde foi extraido: ACCESSIBILITY, OCR, ESTIMATED, UNAVAILABLE.
 */
data class TelemetryData(
    val timestamp: Long = System.currentTimeMillis(),
    val droneId: String = "DJI-AGRAS",
    val speed: Double? = null,
    val altitude: Double? = null,
    val sprayWidth: Double? = null,
    val flowRate: Double? = null,
    val hectaresApplied: Double? = null,
    val flightTime: Int? = null,
    val rtkStatus: String? = null,
    val signalStrength: Int? = null,
    val batteryPercent: Int? = null,
    val tankLevel: Int? = null,
    val tankLiters: Double? = null,                // Volume real tanque (litros, ex: 4.90)
    val speedKmh: Double? = null,                  // Velocidade em km/h (para display)
    val latitude: Double? = null,
    val longitude: Double? = null,
    val operationalStatus: String? = null,
    val systemAlerts: List<String> = emptyList(),
    // Metadados de fonte para cada campo
    val sourceMap: TelemetrySourceMap = TelemetrySourceMap()
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("ts", timestamp)
            put("id", droneId)
            speed?.let { put("sp", it); put("_sp_src", sourceMap.speed.name) }
            altitude?.let { put("alt", it); put("_alt_src", sourceMap.altitude.name) }
            sprayWidth?.let { put("sprayWidth", it); put("_sw_src", sourceMap.sprayWidth.name) }
            flowRate?.let { put("fr", it); put("_fr_src", sourceMap.flowRate.name) }
            hectaresApplied?.let { put("ha", it); put("_ha_src", sourceMap.hectaresApplied.name) }
            flightTime?.let { put("flightTime", it); put("_ft_src", sourceMap.flightTime.name) }
            rtkStatus?.let { put("rtkStatus", it); put("_rtk_src", sourceMap.rtkStatus.name) }
            signalStrength?.let { put("signalStrength", it); put("_sig_src", sourceMap.signalStrength.name) }
            batteryPercent?.let { put("batteryPercent", it); put("_bat_src", sourceMap.batteryPercent.name) }
            tankLevel?.let { put("tankLevel", it); put("_tk_src", sourceMap.tankLevel.name) }
            tankLiters?.let { put("tankLiters", it); put("_tkl_src", sourceMap.tankLevel.name) }
            speedKmh?.let { put("speedKmh", it); put("_skm_src", sourceMap.speed.name) }
            latitude?.let { put("latitude", it); put("_lat_src", sourceMap.latitude.name) }
            longitude?.let { put("longitude", it); put("_lon_src", sourceMap.longitude.name) }
            operationalStatus?.let { put("operationalStatus", it); put("_st_src", sourceMap.operationalStatus.name) }
            if (systemAlerts.isNotEmpty()) {
                put("systemAlerts", org.json.JSONArray(systemAlerts))
                put("_alerts_src", sourceMap.systemAlerts.name)
            }
        }
    }

    /** Verifica se ha pelo menos um dado util neste frame */
    fun hasAnyData(): Boolean {
        return speed != null || altitude != null || batteryPercent != null ||
                tankLevel != null || flowRate != null || hectaresApplied != null ||
                systemAlerts.isNotEmpty() || operationalStatus != null ||
                latitude != null || longitude != null
    }

    companion object {
        fun fromJson(json: JSONObject): TelemetryData {
            return TelemetryData(
                timestamp = json.optLong("ts", System.currentTimeMillis()),
                droneId = json.optString("id", "DJI-AGRAS"),
                speed = json.optDouble("sp").takeIf { !it.isNaN() },
                altitude = json.optDouble("alt").takeIf { !it.isNaN() },
                sprayWidth = json.optDouble("sw").takeIf { !it.isNaN() },
                flowRate = json.optDouble("fr").takeIf { !it.isNaN() },
                hectaresApplied = json.optDouble("ha").takeIf { !it.isNaN() },
                flightTime = json.optInt("ft").takeIf { it != 0 },
                rtkStatus = json.optString("rtk").takeIf { it.isNotEmpty() },
                signalStrength = json.optInt("sig").takeIf { it != 0 },
                batteryPercent = json.optInt("bat").takeIf { it != 0 },
                tankLevel = json.optInt("tk").takeIf { it != 0 },
                tankLiters = json.optDouble("tkl").takeIf { !it.isNaN() },
                speedKmh = json.optDouble("skm").takeIf { !it.isNaN() },
                latitude = json.optDouble("lat").takeIf { !it.isNaN() },
                longitude = json.optDouble("lon").takeIf { !it.isNaN() },
                operationalStatus = json.optString("st").takeIf { it.isNotEmpty() },
                systemAlerts = json.optJSONArray("alerts")?.let { arr ->
                    List(arr.length()) { arr.getString(it) }
                } ?: emptyList(),
                sourceMap = TelemetrySourceMap(
                    speed = TelemetrySource.valueOf(json.optString("_sp_src", "UNAVAILABLE")),
                    altitude = TelemetrySource.valueOf(json.optString("_alt_src", "UNAVAILABLE")),
                    sprayWidth = TelemetrySource.valueOf(json.optString("_sw_src", "UNAVAILABLE")),
                    flowRate = TelemetrySource.valueOf(json.optString("_fr_src", "UNAVAILABLE")),
                    hectaresApplied = TelemetrySource.valueOf(json.optString("_ha_src", "UNAVAILABLE")),
                    flightTime = TelemetrySource.valueOf(json.optString("_ft_src", "UNAVAILABLE")),
                    rtkStatus = TelemetrySource.valueOf(json.optString("_rtk_src", "UNAVAILABLE")),
                    signalStrength = TelemetrySource.valueOf(json.optString("_sig_src", "UNAVAILABLE")),
                    batteryPercent = TelemetrySource.valueOf(json.optString("_bat_src", "UNAVAILABLE")),
                    tankLevel = TelemetrySource.valueOf(json.optString("_tk_src", "UNAVAILABLE")),
                    latitude = TelemetrySource.valueOf(json.optString("_lat_src", "UNAVAILABLE")),
                    longitude = TelemetrySource.valueOf(json.optString("_lon_src", "UNAVAILABLE")),
                    operationalStatus = TelemetrySource.valueOf(json.optString("_st_src", "UNAVAILABLE")),
                    systemAlerts = TelemetrySource.valueOf(json.optString("_alerts_src", "UNAVAILABLE"))
                )
            )
        }
    }
}

/**
 * Enumera as fontes possiveis de extracao de telemetria.
 */
enum class TelemetrySource {
    /** Extraido diretamente via AccessibilityService do texto na tela */
    ACCESSIBILITY,
    /** Extraido via OCR/ML Kit quando acessibilidade nao retorna o dado */
    OCR,
    /** Estimado ou derivado de outros campos */
    ESTIMATED,
    /** Nao disponivel neste frame */
    UNAVAILABLE
}

/**
 * Mapeia a fonte de cada campo de telemetria.
 * Permite auditoria e debug de onde cada dado veio.
 */
data class TelemetrySourceMap(
    val speed: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val altitude: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val sprayWidth: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val flowRate: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val hectaresApplied: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val flightTime: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val rtkStatus: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val signalStrength: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val batteryPercent: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val tankLevel: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val latitude: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val longitude: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val operationalStatus: TelemetrySource = TelemetrySource.UNAVAILABLE,
    val systemAlerts: TelemetrySource = TelemetrySource.UNAVAILABLE
)
