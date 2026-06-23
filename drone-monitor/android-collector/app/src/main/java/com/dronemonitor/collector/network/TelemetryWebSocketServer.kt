package com.dronemonitor.collector.network

import android.content.Context
import android.net.wifi.WifiManager
import com.dronemonitor.collector.util.FileLogger
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Servidor WebSocket embutido que roda no RC Plus (Android).
 *
 * FUNCAO:
 * - Recebe conexoes do dashboard Flutter/celular na rede local
 * - Serve os dados de telemetria coletados do DJI SmartFarm
 * - Funciona como GATEWAY: o RC Plus coleta via Accessibility/OCR e serve via WS
 *
 * POR QUE 0.0.0.0:
 * - "127.0.0.1" ou "localhost" so aceita conexoes do proprio dispositivo
 * - "0.0.0.0" escuta em TODAS as interfaces de rede (Wi-Fi, hotspot, USB tethering)
 * - Isso permite que o celular do operador se conecte pelo IP do RC Plus na rede local
 *
 * PORTA PADRAO: 8080
 * URL de conexao do cliente: ws://<IP_DO_RC_PLUS>:8080/ws
 */
class TelemetryWebSocketServer(
    private val context: Context,
    private val port: Int = DEFAULT_PORT
) {

    private var server: WebSocketServerImpl? = null
    private val connectedClients = CopyOnWriteArrayList<WebSocket>()
    private var isRunning = false

    var onClientConnected: ((String) -> Unit)? = null
    var onClientDisconnected: ((String) -> Unit)? = null

    /**
     * Inicia o servidor WebSocket em 0.0.0.0:<port>.
     * Se a porta estiver ocupada, tenta liberar a instancia anterior.
     */
    fun start() {
        if (isRunning && server != null) {
            FileLogger.w(TAG, "Servidor ja esta rodando, reutilizando")
            return
        }

        // Se houver servidor anterior preso, forca parada
        if (server != null) {
            try {
                FileLogger.w(TAG, "Liberando servidor anterior preso na porta $port")
                server?.stop()
                server = null
                Thread.sleep(500) // Aguarda liberacao do socket
            } catch (e: Exception) {
                FileLogger.w(TAG, "Erro ao parar servidor anterior: ${e.message}")
            }
        }

        try {
            val bindAddress = InetSocketAddress("0.0.0.0", port)
            server = WebSocketServerImpl(bindAddress)
            server?.start()
            isRunning = true

            val ip = getDeviceIpAddress()
            FileLogger.i(TAG, "Servidor WebSocket iniciado em ws://$ip:$port/ws")
            FileLogger.i(TAG, "Escutando em 0.0.0.0:$port (todas as interfaces)")
        } catch (e: Exception) {
            FileLogger.e(TAG, "Falha ao iniciar servidor WebSocket", e)
            isRunning = false
            server = null
        }
    }

    fun stop() {
        isRunning = false
        try {
            connectedClients.forEach { it.close() }
            connectedClients.clear()
            server?.stop()
            server = null
            FileLogger.i(TAG, "Servidor WebSocket parado")
        } catch (e: Exception) {
            FileLogger.e(TAG, "Erro ao parar servidor", e)
        }
    }

    fun isRunning(): Boolean = isRunning

    fun getConnectedClientCount(): Int = connectedClients.size

    /**
     * Envia telemetria para TODOS os clientes conectados.
     * Chamado pelo DroneCollectorService a cada ciclo de coleta.
     */
    fun broadcast(telemetry: JSONObject) {
        if (connectedClients.isEmpty()) return

        val payload = telemetry.toString()
        val deadClients = mutableListOf<WebSocket>()

        connectedClients.forEach { client ->
            try {
                if (client.isOpen) {
                    client.send(payload)
                } else {
                    deadClients.add(client)
                }
            } catch (e: Exception) {
                FileLogger.w(TAG, "Falha ao enviar para cliente ${client.remoteSocketAddress}", e)
                deadClients.add(client)
            }
        }

        // Remove clientes mortos
        deadClients.forEach { connectedClients.remove(it) }
    }

    /**
     * Envia heartbeat para manter conexoes ativas e informar status.
     */
    fun broadcastHeartbeat(status: JSONObject) {
        broadcast(status)
    }

    private inner class WebSocketServerImpl(address: InetSocketAddress) : WebSocketServer(address) {

        override fun onOpen(conn: WebSocket?, handshake: ClientHandshake?) {
            conn?.let {
                connectedClients.add(it)
                val clientIp = it.remoteSocketAddress?.address?.hostAddress ?: "unknown"
                FileLogger.i(TAG, "Cliente conectado: $clientIp (total: ${connectedClients.size})")
                onClientConnected?.invoke(clientIp)

                // Envia confirmacao de conexao
                val welcome = JSONObject().apply {
                    put("type", "connected")
                    put("message", "Drone Collector RC Plus - Telemetry Gateway")
                    put("clients", connectedClients.size)
                    put("ts", System.currentTimeMillis())
                }
                it.send(welcome.toString())
            }
        }

        override fun onClose(conn: WebSocket?, code: Int, reason: String?, remote: Boolean) {
            conn?.let {
                connectedClients.remove(it)
                val clientIp = it.remoteSocketAddress?.address?.hostAddress ?: "unknown"
                FileLogger.i(TAG, "Cliente desconectado: $clientIp (code=$code, reason=$reason)")
                onClientDisconnected?.invoke(clientIp)
            }
        }

        override fun onMessage(conn: WebSocket?, message: String?) {
            // O dashboard pode enviar comandos de configuracao aqui
            // Por enquanto apenas logamos
            FileLogger.d(TAG, "Mensagem recebida: $message")

            // Responde com ACK
            val ack = JSONObject().apply {
                put("type", "ack")
                put("ts", System.currentTimeMillis())
            }
            conn?.send(ack.toString())
        }

        override fun onError(conn: WebSocket?, ex: Exception?) {
            FileLogger.e(TAG, "Erro no servidor WebSocket: ${ex?.message}")
        }

        override fun onStart() {
            FileLogger.i(TAG, "Servidor WebSocket pronto para aceitar conexoes")
        }
    }

    /**
     * Obtem o IP do dispositivo na rede Wi-Fi para exibir ao usuario.
     */
    private fun getDeviceIpAddress(): String {
        return try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val ipInt = wifiManager?.connectionInfo?.ipAddress ?: 0
            if (ipInt == 0) {
                // Tenta obter via NetworkInterface
                java.net.NetworkInterface.getNetworkInterfaces().toList()
                    .flatMap { it.inetAddresses.toList() }
                    .firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains(".") == true }
                    ?.hostAddress ?: "0.0.0.0"
            } else {
                String.format(
                    "%d.%d.%d.%d",
                    ipInt and 0xFF,
                    ipInt shr 8 and 0xFF,
                    ipInt shr 16 and 0xFF,
                    ipInt shr 24 and 0xFF
                )
            }
        } catch (e: Exception) {
            FileLogger.e(TAG, "Erro ao obter IP", e)
            "0.0.0.0"
        }
    }

    companion object {
        private const val TAG = "TelemetryWSServer"
        const val DEFAULT_PORT = 8080
        const val WS_PATH = "/ws"
    }
}
