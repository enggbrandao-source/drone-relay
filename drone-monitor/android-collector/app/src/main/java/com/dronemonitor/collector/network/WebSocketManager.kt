package com.dronemonitor.collector.network

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.dronemonitor.collector.data.LocalBuffer
import com.dronemonitor.collector.util.FileLogger
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Gerenciador de WebSocket com reconexao automatica, buffer offline,
 * timeout protection e handling seguro de excecoes.
 */
class WebSocketManager(
    private var serverUrl: String,
    private val localBuffer: LocalBuffer
) {

    private var client: WebSocketClient? = null
    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val isRunning = AtomicBoolean(false)
    private var reconnectAttempt = 0
    private var lastSuccessfulSend = 0L

    var onStatusChanged: ((Boolean) -> Unit)? = null

    fun configure(url: String) {
        this.serverUrl = url
    }

    fun start() {
        if (isRunning.getAndSet(true)) return
        connect()
    }

    fun stop() {
        isRunning.set(false)
        try {
            scheduler.shutdownNow()
        } catch (_: Exception) {}
        try {
            client?.close()
        } catch (_: Exception) {}
        client = null
    }

    fun isConnected(): Boolean = client?.isOpen == true

    fun send(data: JSONObject) {
        val ws = client
        if (ws != null && ws.isOpen) {
            try {
                val payload = data.toString()
                if (payload.length > MAX_PAYLOAD_SIZE) {
                    FileLogger.w(TAG, "Payload too large: ${payload.length} bytes")
                    localBuffer.enqueue(data)
                    return
                }
                ws.send(payload)
                lastSuccessfulSend = System.currentTimeMillis()
                flushBuffer()
            } catch (e: Exception) {
                FileLogger.w(TAG, "Falha ao enviar, bufferizando", e)
                safeClose()
                localBuffer.enqueue(data)
            }
        } else {
            localBuffer.enqueue(data)
            if (System.currentTimeMillis() - lastSuccessfulSend > OFFLINE_LOG_INTERVAL_MS) {
                FileLogger.d(TAG, "Offline: dado bufferizado. Tamanho: ${localBuffer.size()}")
                lastSuccessfulSend = System.currentTimeMillis()
            }
        }
    }

    private fun connect() {
        if (!isRunning.get()) return
        try {
            safeClose()
            val uri = URI(serverUrl)
            client = object : WebSocketClient(uri) {
                override fun onOpen(handshakedata: ServerHandshake?) {
                    FileLogger.i(TAG, "Conectado ao servidor: $serverUrl")
                    reconnectAttempt = 0
                    lastSuccessfulSend = System.currentTimeMillis()
                    onStatusChanged?.invoke(true)
                    flushBuffer()
                }

                override fun onMessage(message: String?) {
                    // ACK do servidor - pode ser usado para latencia
                }

                override fun onClose(code: Int, reason: String?, remote: Boolean) {
                    FileLogger.w(TAG, "Desconectado: code=$code reason=$reason")
                    onStatusChanged?.invoke(false)
                    if (isRunning.get()) scheduleReconnect()
                }

                override fun onError(ex: Exception?) {
                    FileLogger.e(TAG, "Erro WebSocket: ${ex?.message}")
                    onStatusChanged?.invoke(false)
                }
            }
            client?.connectionLostTimeout = CONNECTION_TIMEOUT_MS
            client?.connect()
        } catch (e: Exception) {
            FileLogger.e(TAG, "Erro ao criar conexao: ${e.message}")
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        if (!isRunning.get()) return
        reconnectAttempt++
        val delay = (RECONNECT_BASE_DELAY_MS * kotlin.math.min(reconnectAttempt, 10)).coerceAtMost(30000L)
        FileLogger.d(TAG, "Reconexao em ${delay}ms (tentativa $reconnectAttempt)")
        try {
            scheduler.schedule({
                mainHandler.post { connect() }
            }, delay, TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            FileLogger.e(TAG, "Falha ao agendar reconexao", e)
        }
    }

    private fun flushBuffer() {
        if (localBuffer.size() == 0) return
        val items = localBuffer.dequeueAll()
        var sent = 0
        items.forEach { item ->
            try {
                client?.send(item.toString())
                sent++
            } catch (e: Exception) {
                localBuffer.enqueue(item)
            }
        }
        FileLogger.i(TAG, "Buffer flush: $sent/${items.size} itens enviados")
    }

    private fun safeClose() {
        try {
            client?.close()
        } catch (_: Exception) {}
        client = null
    }

    companion object {
        private const val TAG = "WebSocketManager"
        private const val RECONNECT_BASE_DELAY_MS = 1000L
        private const val CONNECTION_TIMEOUT_MS = 10000
        private const val MAX_PAYLOAD_SIZE = 65536
        private const val OFFLINE_LOG_INTERVAL_MS = 30000L
    }
}
