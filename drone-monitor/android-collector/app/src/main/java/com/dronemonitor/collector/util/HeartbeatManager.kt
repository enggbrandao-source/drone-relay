package com.dronemonitor.collector.util

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Heartbeat watchdog entre RC Plus e backend.
 * Detecta silencio da conexao e emite heartbeat periodico.
 * Isola pacotes corrompidos.
 */
class HeartbeatManager(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var heartbeatJob: Job? = null
    private var timeoutJob: Job? = null
    private val handler = Handler(Looper.getMainLooper())

    private var lastHeartbeatReceived = System.currentTimeMillis()
    private var lastHeartbeatSent = System.currentTimeMillis()
    private var isRunning = false

    var onConnectionLost: (() -> Unit)? = null
    var onConnectionRestored: (() -> Unit)? = null
    var sendHeartbeat: ((JSONObject) -> Unit)? = null

    private val corruptedPacketLog = ConcurrentHashMap<String, Int>()

    fun start() {
        if (isRunning) return
        isRunning = true
        FileLogger.i(TAG, "Heartbeat manager started")

        heartbeatJob = scope.launch {
            while (isActive) {
                sendHeartbeatPacket()
                delay(HEARTBEAT_INTERVAL_MS)
            }
        }

        timeoutJob = scope.launch {
            while (isActive) {
                checkTimeout()
                delay(TIMEOUT_CHECK_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        isRunning = false
        heartbeatJob?.cancel()
        timeoutJob?.cancel()
        FileLogger.i(TAG, "Heartbeat manager stopped")
    }

    fun recordReceivedPacket(json: JSONObject): Boolean {
        val packetId = json.optString("_pid", "")
        if (packetId.isNotEmpty()) {
            // Verifica pacote duplicado
            if (corruptedPacketLog.containsKey(packetId)) {
                FileLogger.w(TAG, "Duplicate/corrupted packet detected: $packetId")
                return false
            }
            corruptedPacketLog[packetId] = 1
            cleanupOldPackets()
        }

        // Verifica integridade basica
        if (!json.has("ts") || !json.has("id")) {
            FileLogger.w(TAG, "Malformed packet received (missing ts/id)")
            return false
        }

        lastHeartbeatReceived = System.currentTimeMillis()
        return true
    }

    fun recordSentAck() {
        lastHeartbeatReceived = System.currentTimeMillis()
    }

    private fun sendHeartbeatPacket() {
        val heartbeat = JSONObject().apply {
            put("type", "heartbeat")
            put("ts", System.currentTimeMillis())
            put("id", "DJI-AGRAS")
            put("src", "rc_plus")
            put("_pid", "hb_${System.currentTimeMillis()}")
        }
        lastHeartbeatSent = System.currentTimeMillis()
        try {
            sendHeartbeat?.invoke(heartbeat)
        } catch (e: Exception) {
            FileLogger.e(TAG, "Failed to send heartbeat", e)
        }
    }

    private fun checkTimeout() {
        val elapsed = System.currentTimeMillis() - lastHeartbeatReceived
        if (elapsed > CONNECTION_TIMEOUT_MS) {
            FileLogger.w(TAG, "Connection timeout: ${elapsed}ms since last packet")
            handler.post {
                onConnectionLost?.invoke()
            }
        } else if (elapsed < CONNECTION_TIMEOUT_MS && elapsed > HEARTBEAT_INTERVAL_MS * 2) {
            // Conexao debilitada mas nao perdida
            FileLogger.w(TAG, "Connection degraded: ${elapsed}ms latency")
        }
    }

    private fun cleanupOldPackets() {
        if (corruptedPacketLog.size > MAX_TRACKED_PACKETS) {
            val toRemove = corruptedPacketLog.keys.sorted().take(corruptedPacketLog.size - MAX_TRACKED_PACKETS)
            toRemove.forEach { corruptedPacketLog.remove(it) }
        }
    }

    fun isHealthy(): Boolean {
        val elapsed = System.currentTimeMillis() - lastHeartbeatReceived
        return elapsed < CONNECTION_TIMEOUT_MS
    }

    fun getLatencyMs(): Long {
        return System.currentTimeMillis() - lastHeartbeatReceived
    }

    companion object {
        private const val TAG = "HeartbeatManager"
        private const val HEARTBEAT_INTERVAL_MS = 5000L
        private const val TIMEOUT_CHECK_INTERVAL_MS = 10000L
        private const val CONNECTION_TIMEOUT_MS = 30000L
        private const val MAX_TRACKED_PACKETS = 1000
    }
}
