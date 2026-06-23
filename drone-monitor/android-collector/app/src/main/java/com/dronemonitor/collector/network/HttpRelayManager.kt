package com.dronemonitor.collector.network

import android.content.Context
import com.dronemonitor.collector.BuildConfig
import com.dronemonitor.collector.util.FileLogger
import com.dronemonitor.collector.util.GpsLocationHelper
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * CloudRelay via HTTP POST (sem coroutines - compativel ProGuard/R8)
 * Heartbeat a cada 5s para manter servidor Render acordado
 */
class HttpRelayManager(private val context: Context) {

    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var droneId = "AGRAS001"
    private var relayUrl = DEFAULT_RELAY
    @Volatile
    private var running = false
    private var heartbeatTask: java.util.concurrent.ScheduledFuture<*>? = null
    @Volatile
    private var lastData: JSONObject? = null

    fun configure(url: String, id: String) {
        relayUrl = url
        droneId = id
    }

    fun start() {
        if (running) return
        running = true
        FileLogger.i(TAG, "Cloud HTTP iniciado: $relayUrl")
        heartbeatTask = executor.scheduleWithFixedDelay({
            sendHeartbeat()
        }, 5, 5, TimeUnit.SECONDS)
    }

    fun stop() {
        running = false
        heartbeatTask?.cancel(false)
        heartbeatTask = null
        try { executor.shutdownNow() } catch (_: Exception) {}
    }

    fun updateLastData(data: JSONObject) {
        lastData = data
    }

    private fun sendHeartbeat() {
        try {
            val url = URL(relayUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 15000
            conn.readTimeout = 15000

            val payload = JSONObject().apply {
                put("_id", droneId)
                put("_ts", System.currentTimeMillis())
                put("_heartbeat", true)
                put("_version", BuildConfig.VERSION_NAME)
                // Inclui os ultimos dados conhecidos para manter dashboard atualizado
                lastData?.let { last ->
                    val keys = last.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        if (!has(key)) put(key, last.get(key))
                    }
                }
            }

            OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
            val code = conn.responseCode
            conn.disconnect()

            if (code == 200) {
                FileLogger.d(TAG, "Heartbeat OK")
            } else {
                FileLogger.w(TAG, "Heartbeat HTTP $code")
            }
        } catch (e: Exception) {
            FileLogger.w(TAG, "Heartbeat falhou: ${e.message}")
        }
    }

    fun send(data: JSONObject) {
        if (!running) {
            FileLogger.d(TAG, "Nao enviado - nao iniciado")
            return
        }
        lastData = data
        executor.execute {
            try {
                // Le dados do piloto/fazenda das preferencias
                val prefs = context.getSharedPreferences("collector_prefs", Context.MODE_PRIVATE)
                val pilotName = prefs.getString("pilot_name", "") ?: ""
                val farmName = prefs.getString("farm_name", "") ?: ""

                val url = URL(relayUrl)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 15000
                conn.readTimeout = 15000

                data.put("_id", droneId)
                data.put("_ts", System.currentTimeMillis())
                data.put("_version", BuildConfig.VERSION_NAME)
                if (pilotName.isNotEmpty()) data.put("_pilot", pilotName)
                if (farmName.isNotEmpty()) data.put("_farm", farmName)

                // GPS do RC Plus
                GpsLocationHelper.fill(context, data)
                
                // Fallback 1: coordenadas do proprio drone (DJI Agras) se exibidas na tela
                if (!data.has("latitude") || !data.has("longitude")) {
                    val telemetryLat = data.optDouble("latitude", Double.NaN)
                    val telemetryLon = data.optDouble("longitude", Double.NaN)
                    if (!telemetryLat.isNaN() && !telemetryLon.isNaN()) {
                        FileLogger.i(TAG, "Usando coordenadas do DJI Agras: $telemetryLat,$telemetryLon")
                    }
                }
                
                // Fallback 2: localizacao manual digitada pelo piloto
                if (!data.has("latitude") || !data.has("longitude")) {
                    val prefs = context.getSharedPreferences("collector_prefs", Context.MODE_PRIVATE)
                    val manualLoc = prefs.getString("manual_location", "") ?: ""
                    if (manualLoc.isNotEmpty()) {
                        // Tenta parse "lat,lon" ou usa geocoding simples para cidades conhecidas
                        val coords = parseManualLocation(manualLoc)
                        if (coords != null) {
                            data.put("latitude", coords.first)
                            data.put("longitude", coords.second)
                            data.put("_locationSource", "manual")
                            FileLogger.i(TAG, "Usando localizacao manual: ${coords.first},${coords.second}")
                        }
                    }
                }
                
                // Log final das coordenadas
                if (data.has("latitude") && data.has("longitude")) {
                    val lat = data.optDouble("latitude", 0.0)
                    val lon = data.optDouble("longitude", 0.0)
                    val source = data.optString("_locationSource", "gps")
                    FileLogger.i(TAG, "Coordenadas enviadas ($source): $lat,$lon")
                } else {
                    FileLogger.w(TAG, "GPS indisponivel - sem coordenadas de nenhuma fonte")
                }

                OutputStreamWriter(conn.outputStream).use { it.write(data.toString()) }
                val code = conn.responseCode
                conn.disconnect()

                if (code == 200) {
                    FileLogger.i(TAG, "Enviado OK: " + data.toString().take(200))
                } else {
                    FileLogger.w(TAG, "HTTP $code")
                }
            } catch (e: Exception) {
                FileLogger.w(TAG, "Falha: ${e.message}")
            }
        }
    }

    companion object {
        const val TAG = "HttpRelayManager"
        const val DEFAULT_RELAY = "https://drone-cloud.onrender.com/drone"
        
        // Coordenadas aproximadas de cidades comuns (fallback manual)
        private val KNOWN_LOCATIONS = mapOf(
            "penápolis" to Pair(-21.4197, -50.0775),
            "penapolis" to Pair(-21.4197, -50.0775),
            "são paulo" to Pair(-23.5505, -46.6333),
            "sao paulo" to Pair(-23.5505, -46.6333),
            "campinas" to Pair(-22.9053, -47.0659),
            "ribeirão preto" to Pair(-21.1775, -47.8103),
            "ribeirao preto" to Pair(-21.1775, -47.8103),
            "brasília" to Pair(-15.7975, -47.8919),
            "brasilia" to Pair(-15.7975, -47.8919),
            "curitiba" to Pair(-25.4290, -49.2671),
            "porto alegre" to Pair(-30.0346, -51.2177),
            "belo horizonte" to Pair(-19.9167, -43.9345),
            "rio de janeiro" to Pair(-22.9068, -43.1729),
            "salvador" to Pair(-12.9714, -38.5014),
            "fortaleza" to Pair(-3.7327, -38.5270),
            "recife" to Pair(-8.0476, -34.8770),
            "goiânia" to Pair(-16.6869, -49.2648),
            "goiania" to Pair(-16.6869, -49.2648),
            "manaus" to Pair(-3.1190, -60.0217),
            "belém" to Pair(-1.4558, -48.4902),
            "belem" to Pair(-1.4558, -48.4902),
            "vitória" to Pair(-20.3155, -40.3128),
            "vitoria" to Pair(-20.3155, -40.3128),
            "florianópolis" to Pair(-27.5954, -48.5480),
            "florianopolis" to Pair(-27.5954, -48.5480)
        )
        
        /**
         * Tenta extrair coordenadas de uma string manual.
         * Formatos aceitos:
         * - "-21.4197, -50.0775" (lat,lon)
         * - "Penápolis, SP" (cidade conhecida)
         * - "penapolis" (cidade conhecida, sem acento)
         */
        fun parseManualLocation(input: String): Pair<Double, Double>? {
            val trimmed = input.trim().lowercase()
            
            // Tenta parse "lat,lon"
            val coordRegex = Regex("""(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)""")
            val match = coordRegex.find(trimmed)
            if (match != null) {
                val lat = match.groupValues[1].toDoubleOrNull()
                val lon = match.groupValues[2].toDoubleOrNull()
                if (lat != null && lon != null && lat in -90.0..90.0 && lon in -180.0..180.0) {
                    return Pair(lat, lon)
                }
            }
            
            // Tenta match em cidades conhecidas
            for ((city, coords) in KNOWN_LOCATIONS) {
                if (trimmed.contains(city)) {
                    return coords
                }
            }
            
            return null
        }
    }
}
