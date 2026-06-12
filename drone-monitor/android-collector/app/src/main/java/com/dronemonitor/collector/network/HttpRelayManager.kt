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
    }
}
