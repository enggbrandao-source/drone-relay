package com.dronemonitor.collector.network

import android.content.Context
import com.dronemonitor.collector.data.TelemetryData
import com.dronemonitor.collector.util.FileLogger
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Fallback UDP para transmissao de telemetria quando WebSocket nao esta disponivel.
 * Util para comunicacao direta em hotspot local ou rede mesh.
 */
class UdpTelemetryFallback(
    private val context: Context,
    private val defaultPort: Int = 9999
) {

    private var socket: DatagramSocket? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var isRunning = false
    private var targetHost = "192.168.43.255" // Hotspot broadcast default

    var onStatusChanged: ((Boolean) -> Unit)? = null

    fun configure(host: String, port: Int = defaultPort) {
        this.targetHost = host
    }

    fun start() {
        if (isRunning) return
        isRunning = true
        try {
            socket = DatagramSocket()
            socket?.broadcast = true
            onStatusChanged?.invoke(true)
            FileLogger.i(TAG, "UDP fallback started on port $defaultPort")
        } catch (e: Exception) {
            FileLogger.e(TAG, "Failed to start UDP", e)
            onStatusChanged?.invoke(false)
        }
    }

    fun stop() {
        isRunning = false
        socket?.close()
        socket = null
        onStatusChanged?.invoke(false)
        scope.cancel()
    }

    fun send(data: JSONObject) {
        if (!isRunning) return
        scope.launch {
            try {
                val bytes = data.toString().toByteArray(Charsets.UTF_8)
                if (bytes.size > MAX_PACKET_SIZE) {
                    FileLogger.w(TAG, "Packet too large: ${bytes.size} bytes")
                    return@launch
                }
                val packet = DatagramPacket(
                    bytes, bytes.size,
                    InetAddress.getByName(targetHost), defaultPort
                )
                socket?.send(packet)
            } catch (e: Exception) {
                FileLogger.e(TAG, "UDP send failed", e)
            }
        }
    }

    fun isActive(): Boolean = isRunning

    companion object {
        private const val TAG = "UdpFallback"
        private const val MAX_PACKET_SIZE = 65507
    }
}
