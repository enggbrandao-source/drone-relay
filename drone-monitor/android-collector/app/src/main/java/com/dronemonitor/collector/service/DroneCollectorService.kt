package com.dronemonitor.collector.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.dronemonitor.collector.BuildConfig
import com.dronemonitor.collector.CollectorApp
import com.dronemonitor.collector.MainActivity
import com.dronemonitor.collector.R
import com.dronemonitor.collector.data.DeltaEncoder
import com.dronemonitor.collector.data.LocalBuffer
import com.dronemonitor.collector.data.TelemetryData
import com.dronemonitor.collector.data.TelemetrySource
import com.dronemonitor.collector.data.TelemetrySourceMap
import com.dronemonitor.collector.network.HttpRelayManager
import com.dronemonitor.collector.network.TelemetryRedundancyManager
import com.dronemonitor.collector.network.TelemetryWebSocketServer
import com.dronemonitor.collector.ocr.OcrProcessor
import com.dronemonitor.collector.util.AgriculturalTelemetryManager
import com.dronemonitor.collector.util.CrashRecoveryManager
import com.dronemonitor.collector.util.FieldMetricsCollector
import com.dronemonitor.collector.util.FileLogger
import com.dronemonitor.collector.util.GpsLocationHelper
import com.dronemonitor.collector.util.HeartbeatManager
import com.dronemonitor.collector.util.LowPowerMode
import com.dronemonitor.collector.util.MemoryLeakPrevention
import com.dronemonitor.collector.util.PerformanceMonitor
import com.dronemonitor.collector.util.SafeReconnector
import com.dronemonitor.collector.util.ServiceWatchdog
import com.dronemonitor.collector.util.TelemetrySourceValidator
import com.dronemonitor.collector.view.FloatingButtonService
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * Foreground Service principal que orquestra coleta, OCR fallback, transmissao redundante
 * e monitoramento de performance. Otimizado para operacao em campo no DJI RC Plus.
 *
 * METODO DE COLETA (sem SDK DJI):
 * 1. DroneAccessibilityService le textos da hierarquia de views do SmartFarm
 * 2. TelemetryParser extrai valores via regex
 * 3. Se dados insuficientes, OcrProcessor captura screenshot e faz OCR
 * 4. TelemetrySourceValidator audita e prova a fonte de cada campo
 * 5. NENHUM SDK DJI e utilizado em nenhum momento
 */
class DroneCollectorService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var redundancyManager: TelemetryRedundancyManager
    private lateinit var wsServer: TelemetryWebSocketServer
    private lateinit var cloudRelayManager: HttpRelayManager
    private lateinit var localBuffer: LocalBuffer
    private lateinit var deltaEncoder: DeltaEncoder
    private lateinit var ocrProcessor: OcrProcessor
    private lateinit var performanceMonitor: PerformanceMonitor
    private lateinit var watchdog: ServiceWatchdog
    private lateinit var heartbeatManager: HeartbeatManager
    private lateinit var safeReconnector: SafeReconnector
    private lateinit var agriculturalManager: AgriculturalTelemetryManager
    private lateinit var lowPowerMode: LowPowerMode
    private lateinit var sourceValidator: TelemetrySourceValidator
    private lateinit var fieldMetrics: FieldMetricsCollector

    private var accessibilityService: DroneAccessibilityService? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private var isRunning = false
    private var lastAccessibilityData: TelemetryData? = null
    private var collectJob: Job? = null
    private var currentCollectIntervalMs = 500L
    private var serverPort = TelemetryWebSocketServer.DEFAULT_PORT

    override fun onCreate() {
        super.onCreate()
        activeInstance = this  // <--- torna acessivel ao AccessibilityService
        try {
            FileLogger.i(TAG, "Servico onCreate v${BuildConfig.VERSION_NAME}")
            localBuffer = LocalBuffer(this)
            deltaEncoder = DeltaEncoder()
            ocrProcessor = OcrProcessor()
            redundancyManager = TelemetryRedundancyManager(this)
            wsServer = TelemetryWebSocketServer(this, serverPort)
            cloudRelayManager = HttpRelayManager(this)
            // Configura droneId a partir das preferencias do usuario
            val prefs = getSharedPreferences("collector_prefs", Context.MODE_PRIVATE)
            val droneCode = prefs.getString("drone_code", "AGRAS001") ?: "AGRAS001"
            cloudRelayManager.configure(HttpRelayManager.DEFAULT_RELAY, droneCode)
            FileLogger.i(TAG, "CloudRelay configurado para drone: $droneCode")
            performanceMonitor = PerformanceMonitor(this)
            watchdog = ServiceWatchdog(this)
            heartbeatManager = HeartbeatManager(this)
            safeReconnector = SafeReconnector(this)
            agriculturalManager = AgriculturalTelemetryManager(this)
            lowPowerMode = LowPowerMode(this)
            sourceValidator = TelemetrySourceValidator(this)
            fieldMetrics = FieldMetricsCollector(this)
            FileLogger.i(TAG, "Subsistemas instanciados com sucesso")

            // GPS do RC Plus
            GpsLocationHelper.start(this)
            FileLogger.i(TAG, "GPS iniciado")
        } catch (e: Exception) {
            FileLogger.e(TAG, "ERRO CRITICO em onCreate", e)
            android.widget.Toast.makeText(
                this, "Erro ao criar servico: ${e.message}",
                android.widget.Toast.LENGTH_LONG
            ).show()
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        FileLogger.i(TAG, "Servico onStartCommand")

        // CRITICO: chama startForeground IMEDIATAMENTE para evitar ANR/crash em <5s
        try {
            startForeground(CollectorApp.NOTIFICATION_ID, buildNotification())
            FileLogger.i(TAG, "startForeground OK")
        } catch (e: Exception) {
            FileLogger.e(TAG, "FALHA em startForeground", e)
            android.widget.Toast.makeText(
                this, "Erro foreground: ${e.message}",
                android.widget.Toast.LENGTH_LONG
            ).show()
            stopSelf()
            return START_NOT_STICKY
        }

        // Inicializacao pesada vai para coroutine - nao bloqueia o startForeground
        serviceScope.launch {
            try {
                configureRedundancy()
                setupWebSocketServer()
                setupHeartbeat()
                setupLowPowerMode()
                setupAgriculturalAlerts()
                acquireWakeLock()

                performanceMonitor.start()
                fieldMetrics.start()
                watchdog.start()
                safeReconnector.register()
                lowPowerMode.startMonitoring()

                redundancyManager.start()
                heartbeatManager.start()
                cloudRelayManager.start()
                startCollectionLoop()
                isRunning = true
                CrashRecoveryManager.clearCrashFlag(this@DroneCollectorService)

                FileLogger.i(TAG, "Todos os subsistemas iniciados. Gateway WebSocket ativo.")

                // Atualiza notificacao com status real
                withContext(Dispatchers.Main) {
                    updateNotification()
                }
            } catch (e: Exception) {
                FileLogger.e(TAG, "ERRO ao iniciar subsistemas", e)
                withContext(Dispatchers.Main) {
                    android.widget.Toast.makeText(
                        this@DroneCollectorService,
                        "Erro: ${e.message}",
                        android.widget.Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        return START_STICKY
    }

    private fun updateNotification() {
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            manager.notify(CollectorApp.NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            FileLogger.w(TAG, "Falha ao atualizar notificacao", e)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        FileLogger.i(TAG, "Servico destruido")
        isRunning = false
        collectJob?.cancel()
        serviceScope.cancel()
        redundancyManager.stop()
        wsServer.stop()
        cloudRelayManager.stop()
        heartbeatManager.stop()
        performanceMonitor.stop()
        fieldMetrics.stop()
        watchdog.stop()
        safeReconnector.unregister()
        lowPowerMode.stopMonitoring()
        GpsLocationHelper.stop(this)
        wakeLock?.let { if (it.isHeld) it.release() }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        FileLogger.w(TAG, "Task removed by system. Scheduling restart.")
    }

    private fun configureRedundancy() {
        val prefs = getSharedPreferences("collector_prefs", Context.MODE_PRIVATE)
        val wsUrl = prefs.getString("server_url", "ws://192.168.1.100:8080/ws") ?: "ws://192.168.1.100:8080/ws"
        redundancyManager.configure(wsUrl)
        serverPort = prefs.getInt("server_port", TelemetryWebSocketServer.DEFAULT_PORT)
    }

    private fun setupWebSocketServer() {
        wsServer.onClientConnected = { ip ->
            FileLogger.i(TAG, "Dashboard conectado: $ip")
        }
        wsServer.onClientDisconnected = { ip ->
            FileLogger.w(TAG, "Dashboard desconectado: $ip")
        }
        wsServer.start()
    }

    private fun setupHeartbeat() {
        heartbeatManager.sendHeartbeat = { heartbeat ->
            try {
                redundancyManager.send(heartbeat)
            } catch (e: Exception) {
                FileLogger.e(TAG, "Heartbeat send failed", e)
            }
        }
        heartbeatManager.onConnectionLost = {
            FileLogger.w(TAG, "Connection lost detected by heartbeat")
        }
        heartbeatManager.onConnectionRestored = {
            FileLogger.i(TAG, "Connection restored")
        }
    }

    private fun setupLowPowerMode() {
        lowPowerMode.onPowerModeChanged = { isLowPower, intervalMs ->
            currentCollectIntervalMs = intervalMs
            FileLogger.i(TAG, "Power mode: lowPower=$isLowPower, interval=${intervalMs}ms")
            restartCollectionLoop()
        }
    }

    private fun setupAgriculturalAlerts() {
        agriculturalManager.onAlert = { severity, message ->
            FileLogger.w(TAG, "AgriAlert [$severity]: $message")
            val alertJson = JSONObject().apply {
                put("type", "alert")
                put("severity", severity)
                put("message", message)
                put("ts", System.currentTimeMillis())
            }
            try {
                redundancyManager.send(alertJson)
            } catch (e: Exception) {
                FileLogger.e(TAG, "Failed to send alert", e)
            }
        }
    }

    private fun startCollectionLoop() {
        collectJob?.cancel()
        var loopCount = 0
        collectJob = serviceScope.launch {
            while (isActive) {
                val loopStart = System.currentTimeMillis()
                try {
                    val telemetry = collectTelemetry()
                    val delta = deltaEncoder.encode(telemetry)

                    // Log periodico (a cada 10s) para diagnostico
                    if (loopCount % 20 == 0) {
                        val accActive = DroneAccessibilityService.isActive()
                        val clientCount = wsServer.getConnectedClientCount()
                        val hasData = telemetry.batteryPercent != null || telemetry.speed != null
                        FileLogger.i(TAG, "Loop=$loopCount AccActive=$accActive Clients=$clientCount HasData=$hasData")
                    }
                    loopCount++

                    // Isolamento de pacotes corrompidos
                    if (heartbeatManager.recordReceivedPacket(delta)) {
                        // Validacao de fonte: prova que dados vem da tela
                        val isValid = sourceValidator.validateAndLog(delta)
                        if (!isValid && loopCount % 20 == 0) {
                            FileLogger.w(TAG, "Telemetry validation failed - no fields with valid source")
                        }

                        // Envia para clientes conectados via servidor WebSocket local (RC Plus como gateway)
                        wsServer.broadcast(delta)

                        // Envia dados COMPLETOS para cloud relay (acesso remoto do gestor)
                        // Usa dados completos em vez de delta para garantir dashboard atualizado
                        val fullData = telemetry.toJson()
                        cloudRelayManager.updateLastData(fullData)
                        cloudRelayManager.send(fullData)

                        redundancyManager.send(delta)
                        agriculturalManager.processTelemetry(delta)

                        val latencyStats = redundancyManager.getLatencyStats()
                        agriculturalManager.saveToOperatorPrefs(
                            delta,
                            redundancyManager.isConnected(),
                            latencyStats.getAverageLatencyMs()
                        )
                    }

                    performanceMonitor.recordFrame()
                    watchdog.ping()
                    CrashRecoveryManager.saveMissionState(
                        this@DroneCollectorService,
                        telemetry.operationalStatus ?: "unknown"
                    )

                    if (performanceMonitor.getMemoryUsageMb() > 150) {
                        MemoryLeakPrevention.suggestGcIfNeeded(200)
                        MemoryLeakPrevention.cleanupDeadReferences()
                    }
                } catch (e: Exception) {
                    FileLogger.e(TAG, "Erro no loop de coleta", e)
                }
                val elapsed = System.currentTimeMillis() - loopStart
                fieldMetrics.recordCollectionCycle(elapsed)
                val remaining = currentCollectIntervalMs - elapsed
                if (remaining > 0) delay(remaining)
            }
        }
    }

    private fun restartCollectionLoop() {
        collectJob?.cancel()
        startCollectionLoop()
    }

    /**
     * Coleta telemetria SEM usar SDK DJI.
     * Metodos:
     * 1. AccessibilityService (primario) - le textos da tela
     * 2. OCR (fallback) - captura screenshot e faz OCR
     * 3. Merge dos resultados com metadados de fonte
     */
    private fun collectTelemetry(): TelemetryData {
        val accStart = System.currentTimeMillis()
        // Le do singleton da AccessibilityService - corrige conexao quebrada entre servicos
        val accData = DroneAccessibilityService.lastTelemetry ?: lastAccessibilityData
        lastAccessibilityData = accData
        val accElapsed = System.currentTimeMillis() - accStart

        val ocrStart = System.currentTimeMillis()
        val ocrData = if (needsFallback(accData)) {
            collectViaOcr()
        } else null
        val ocrElapsed = System.currentTimeMillis() - ocrStart

        fieldMetrics.recordAccessibilityLatency(accElapsed)
        if (ocrData != null) {
            fieldMetrics.recordOcrLatency(ocrElapsed)
        }

        return mergeTelemetry(accData, ocrData)
    }

    private fun needsFallback(data: TelemetryData?): Boolean {
        if (data == null) return true
        // Se campos criticos estao indisponiveis, ativa OCR
        return data.batteryPercent == null || data.speed == null || data.altitude == null
    }

    private fun collectViaOcr(): TelemetryData {
        FileLogger.i(TAG, "OCR fallback activated - accessibility returned insufficient data")
        val start = System.currentTimeMillis()
        val result = try {
            ocrProcessor.processScreen()
        } catch (e: Exception) {
            FileLogger.e(TAG, "OCR processing failed", e)
            TelemetryData(
                sourceMap = TelemetrySourceMap(
                    operationalStatus = TelemetrySource.OCR
                )
            )
        }
        val success = result.speed != null || result.batteryPercent != null || result.altitude != null
        fieldMetrics.recordOcrLatency(System.currentTimeMillis() - start, success)
        return result
    }

    private fun mergeTelemetry(acc: TelemetryData?, ocr: TelemetryData?): TelemetryData {
        val base = acc ?: ocr ?: TelemetryData()
        val fallback = ocr ?: acc ?: TelemetryData()
        val merged = base.copy(
            speed = base.speed ?: fallback.speed,
            altitude = base.altitude ?: fallback.altitude,
            sprayWidth = base.sprayWidth ?: fallback.sprayWidth,
            flowRate = base.flowRate ?: fallback.flowRate,
            hectaresApplied = base.hectaresApplied ?: fallback.hectaresApplied,
            flightTime = base.flightTime ?: fallback.flightTime,
            rtkStatus = base.rtkStatus ?: fallback.rtkStatus,
            signalStrength = base.signalStrength ?: fallback.signalStrength,
            batteryPercent = base.batteryPercent ?: fallback.batteryPercent,
            tankLevel = base.tankLevel ?: fallback.tankLevel,
            latitude = base.latitude ?: fallback.latitude,
            longitude = base.longitude ?: fallback.longitude,
            operationalStatus = base.operationalStatus ?: fallback.operationalStatus,
            systemAlerts = if (base.systemAlerts.isEmpty()) fallback.systemAlerts else base.systemAlerts,
            sourceMap = mergeSourceMaps(base.sourceMap, fallback.sourceMap)
        )
        fieldMetrics.recordExtractionResult(merged)
        return merged
    }

    private fun mergeSourceMaps(
        primary: TelemetrySourceMap,
        fallback: TelemetrySourceMap
    ): TelemetrySourceMap {
        return TelemetrySourceMap(
            speed = pickSource(primary.speed, fallback.speed),
            altitude = pickSource(primary.altitude, fallback.altitude),
            sprayWidth = pickSource(primary.sprayWidth, fallback.sprayWidth),
            flowRate = pickSource(primary.flowRate, fallback.flowRate),
            hectaresApplied = pickSource(primary.hectaresApplied, fallback.hectaresApplied),
            flightTime = pickSource(primary.flightTime, fallback.flightTime),
            rtkStatus = pickSource(primary.rtkStatus, fallback.rtkStatus),
            signalStrength = pickSource(primary.signalStrength, fallback.signalStrength),
            batteryPercent = pickSource(primary.batteryPercent, fallback.batteryPercent),
            tankLevel = pickSource(primary.tankLevel, fallback.tankLevel),
            latitude = pickSource(primary.latitude, fallback.latitude),
            longitude = pickSource(primary.longitude, fallback.longitude),
            operationalStatus = pickSource(primary.operationalStatus, fallback.operationalStatus),
            systemAlerts = pickSource(primary.systemAlerts, fallback.systemAlerts)
        )
    }

    private fun pickSource(primary: TelemetrySource, fallback: TelemetrySource): TelemetrySource {
        return if (primary != TelemetrySource.UNAVAILABLE) primary else fallback
    }

    fun setAccessibilityService(service: DroneAccessibilityService) {
        this.accessibilityService = service
        service.onTelemetryUpdate = { telemetry ->
            lastAccessibilityData = telemetry
            serviceScope.launch {
                try {
                    val delta = deltaEncoder.encode(telemetry)
                    if (heartbeatManager.recordReceivedPacket(delta)) {
                        // Broadcast via servidor WebSocket local (gateway RC Plus)
                        wsServer.broadcast(delta)
                        redundancyManager.send(delta)
                        agriculturalManager.processTelemetry(delta)
                    }
                    performanceMonitor.recordFrame()
                } catch (e: Exception) {
                    FileLogger.e(TAG, "Erro ao enviar telemetria", e)
                }
            }
        }
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val clients = if (::wsServer.isInitialized) wsServer.getConnectedClientCount() else 0
        return NotificationCompat.Builder(this, CollectorApp.CHANNEL_ID)
            .setContentTitle("Drone Collector v${BuildConfig.VERSION_NAME}")
            .setContentText("Gateway ativo | Clientes: $clients | Porta: $serverPort")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DroneCollector::WakeLock").apply {
            setReferenceCounted(false)
            acquire(10 * 60 * 1000L)
        }
    }

    companion object {
        private const val TAG = "DroneCollectorSvc"

        @Volatile
        var activeInstance: DroneCollectorService? = null
            private set
    }
}
