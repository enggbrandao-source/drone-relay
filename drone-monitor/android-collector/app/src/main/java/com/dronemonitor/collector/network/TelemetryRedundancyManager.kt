package com.dronemonitor.collector.network

import android.content.Context
import com.dronemonitor.collector.util.FileLogger
import org.json.JSONObject

/**
 * Gerencia redundancia de transmissao: WebSocket primario + UDP fallback.
 * Alterna automaticamente entre canais conforme disponibilidade.
 */
class TelemetryRedundancyManager(context: Context) {

    private val wsManager: WebSocketManager
    private val udpFallback: UdpTelemetryFallback
    private val latencyMonitor = LatencyMonitor()

    private var useUdpAsPrimary = false
    private var isRunning = false

    init {
        val localBuffer = com.dronemonitor.collector.data.LocalBuffer(context)
        wsManager = WebSocketManager("ws://192.168.1.100:8080/ws", localBuffer)
        udpFallback = UdpTelemetryFallback(context)
    }

    fun configure(wsUrl: String, udpHost: String = "192.168.43.255", udpPort: Int = 9999) {
        wsManager.configure(wsUrl)
        udpFallback.configure(udpHost, udpPort)
    }

    fun start() {
        if (isRunning) return
        isRunning = true
        wsManager.start()
        udpFallback.start()
        FileLogger.i(TAG, "Redundancy manager started")
    }

    fun stop() {
        isRunning = false
        wsManager.stop()
        udpFallback.stop()
    }

    fun send(data: JSONObject) {
        if (!isRunning) return
        val packetId = "${System.currentTimeMillis()}_${data.hashCode()}"
        latencyMonitor.recordSent(packetId)

        try {
            if (useUdpAsPrimary) {
                udpFallback.send(data)
                wsManager.send(data)
            } else {
                wsManager.send(data)
                if (!wsManager.isConnected()) {
                    udpFallback.send(data)
                }
            }
            latencyMonitor.recordAcknowledged(packetId)
        } catch (e: Exception) {
            latencyMonitor.recordFailed(packetId)
            FileLogger.e(TAG, "Send failed on both channels", e)
        }
    }

    fun getLatencyStats(): LatencyMonitor = latencyMonitor

    fun isConnected(): Boolean = wsManager.isConnected() || udpFallback.isActive()

    companion object {
        private const val TAG = "RedundancyManager"
    }
}
