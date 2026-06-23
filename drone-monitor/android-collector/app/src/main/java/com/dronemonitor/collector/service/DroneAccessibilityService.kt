package com.dronemonitor.collector.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.dronemonitor.collector.data.TelemetryData
import com.dronemonitor.collector.data.TelemetryParser
import com.dronemonitor.collector.data.TelemetrySource
import com.dronemonitor.collector.util.FileLogger
import kotlinx.coroutines.*

/**
 * Servico de Acessibilidade para capturar dados exibidos na tela do DJI SmartFarm.
 * Este e o METODO PRIMARIO de coleta de telemetria.
 *
 * COMO FUNCIONA:
 * 1. O DJI SmartFarm exibe dados de voo na tela do RC Plus (velocidade, bateria, etc.)
 * 2. Este servico usa a API AccessibilityService do Android para ler os textos visiveis
 * 3. Os textos sao parseados via regex para extrair valores numericos
 * 4. NENHUM SDK DJI e utilizado - apenas leitura passiva da tela
 *
 * PRIVILEGIOS NECESSARIOS:
 * - android.permission.BIND_ACCESSIBILITY_SERVICE
 * - Ativacao manual em Configuracoes > Acessibilidade
 *
 * LIMITACOES:
 * - So funciona quando o DJI SmartFarm esta na tela ativa
 * - Depende do formato de texto exibido pelo SmartFarm
 * - Pode falhar se o SmartFarm usar imagens em vez de textos
 */
class DroneAccessibilityService : AccessibilityService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val updateIntervalMs = 500L
    private var isCollecting = false
    private var collectionJob: Job? = null
    private val parser = TelemetryParser()
    private var sampleCounter = 0
    private var lastDjiTextDumpMs = 0L
    private var lastTreeDumpMs = 0L
    private val treeDumpIntervalMs = 15000L // 15s entre dumps da arvore

    /** Callback chamado a cada frame de telemetria parseado */
    var onTelemetryUpdate: ((TelemetryData) -> Unit)? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        FileLogger.i(TAG, "Servico de acessibilidade CONECTADO")
        instance = this
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                    AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                    AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                    AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            notificationTimeout = 100
        }
        // Liga automaticamente ao DroneCollectorService ativo
        DroneCollectorService.activeInstance?.let {
            it.setAccessibilityService(this)
            FileLogger.i(TAG, "Ligado ao DroneCollectorService")
        }
        startCollection()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Coleta periodica e mais confiavel para apps complexos como SmartFarm
        // Eventos individuais geram muito ruido; usamos polling controlado
    }

    override fun onInterrupt() {
        FileLogger.w(TAG, "Servico interrompido")
        stopCollection()
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        stopCollection()
        serviceScope.cancel()
    }

    private fun startCollection() {
        if (isCollecting) return
        isCollecting = true
        collectionJob = serviceScope.launch {
            while (isActive) {
                try {
                    val telemetry = collectFromWindow()
                    lastTelemetry = telemetry
                    onTelemetryUpdate?.invoke(telemetry)
                } catch (e: Exception) {
                    FileLogger.e(TAG, "Erro na coleta via acessibilidade", e)
                }
                delay(updateIntervalMs)
            }
        }
    }

    private fun stopCollection() {
        isCollecting = false
        collectionJob?.cancel()
    }

    /**
     * Varre a janela atual procurando textos correspondentes aos indicadores do SmartFarm.
     * Este e o metodo principal de extracao - le diretamente a hierarquia de views.
     *
     * NOVO: Primeiro tenta ler por Resource ID (mais rapido/preciso),
     * depois faz fallback para varredura de textos.
     *
     * Fonte: ACCESSIBILITY - texto direto das views do SmartFarm.
     */
    private fun collectFromWindow(): TelemetryData {
        val root = rootInActiveWindow ?: run {
            return TelemetryData(
                sourceMap = com.dronemonitor.collector.data.TelemetrySourceMap(
                    operationalStatus = TelemetrySource.UNAVAILABLE
                )
            )
        }

        val pkgName = root.packageName?.toString() ?: "unknown"

        // IGNORA o proprio app - nao queremos ler nossa propria UI
        if (pkgName == "com.dronemonitor.collector" || pkgName == "com.android.systemui" ||
            pkgName == "com.android.launcher3" || pkgName.startsWith("com.android.")) {
            try { root.recycle() } catch (_: Exception) {}
            return TelemetryData(
                sourceMap = com.dronemonitor.collector.data.TelemetrySourceMap(
                    operationalStatus = TelemetrySource.UNAVAILABLE
                )
            )
        }

        // Identificar se e um app DJI conhecido
        val isDjiApp = pkgName.contains("dji", ignoreCase = true) ||
                pkgName.contains("smartfarm", ignoreCase = true) ||
                pkgName.contains("agras", ignoreCase = true)

        // === MODO 1: Leitura direta por Resource ID (mais rapido e preciso) ===
        if (isDjiApp) {
            val idValues = collectByResourceIds(root)
            if (idValues.isNotEmpty()) {
                FileLogger.i(TAG, "IDs DJI lidos: ${idValues.size} valores")
                idValues.forEach { (k, v) ->
                    FileLogger.d(TAG, "  $k = '$v'")
                }
                // Converte o mapa de IDs para TelemetryData
                val telemetryFromIds = parser.parseFromResourceIds(idValues)
                if (telemetryFromIds.hasAnyData()) {
                    try { root.recycle() } catch (_: Exception) {}
                    return telemetryFromIds
                }
            }
        }

        // === MODO 2: Varredura tradicional de textos (fallback) ===
        val allTexts = mutableListOf<String>()
        val treeBuilder = StringBuilder()
        traverseNodeWithTree(root, allTexts, treeBuilder, 0)
        try { root.recycle() } catch (_: Exception) {}

        // Log a cada 20 amostras (10s) para nao floodar
        sampleCounter++
        val now = System.currentTimeMillis()
        val shouldDumpDji = isDjiApp && (now - lastDjiTextDumpMs > 10000L) // 10s entre dumps completos
        val shouldDumpTree = isDjiApp && (now - lastTreeDumpMs > treeDumpIntervalMs) // 15s entre tree dumps
        val shouldLogPeriodic = sampleCounter % 20 == 0

        if (shouldLogPeriodic || shouldDumpDji || shouldDumpTree) {
            FileLogger.i(TAG, "Pacote ativo: $pkgName | textos coletados: ${allTexts.size} | isDji=$isDjiApp")
            if (allTexts.isNotEmpty()) {
                if (shouldDumpDji) {
                    FileLogger.i(TAG, "=== TODOS OS TEXTOS DJI (${allTexts.size}) ===")
                    allTexts.forEachIndexed { idx, text ->
                        FileLogger.i(TAG, "[$idx] '$text'")
                    }
                    FileLogger.i(TAG, "=== FIM DOS TEXTOS DJI ===")
                    lastDjiTextDumpMs = now
                } else if (shouldLogPeriodic) {
                    val preview = allTexts.take(10).joinToString(" | ")
                    FileLogger.i(TAG, "Amostra: $preview")
                }
            }
            // Dump da arvore de elementos
            if (shouldDumpTree && treeBuilder.isNotEmpty()) {
                Log.i("DroneTree", "=== ARVORE DJI AGRAS ===")
                Log.i("DroneTree", treeBuilder.toString())
                Log.i("DroneTree", "=== FIM ARVORE ===")
                lastTreeDumpMs = now
            }
        }

        // Se nao encontrou textos suficientes, retorna vazio para ativar OCR fallback
        if (allTexts.isEmpty()) {
            return TelemetryData(
                sourceMap = com.dronemonitor.collector.data.TelemetrySourceMap(
                    operationalStatus = TelemetrySource.UNAVAILABLE
                )
            )
        }

        return parser.parseFromTexts(allTexts)
    }

    /**
     * Percorre recursivamente a arvore de nodes de acessibilidade
     * extraindo todos os textos visiveis E construindo a arvore completa de elementos.
     * 
     * Caracteristicas:
     * - Sem limite de profundidade
     * - Percorre TODOS os filhos recursivamente
     * - Registra depth, bounds, packageName
     * - Registra todos os nos mesmo com text/desc null
     * - Protecao contra ciclos via HashSet
     * - Imprime caminho completo do no
     */
    private fun traverseNodeWithTree(
        node: AccessibilityNodeInfo,
        texts: MutableList<String>,
        treeBuilder: StringBuilder,
        level: Int,
        path: String = "root",
        visited: HashSet<AccessibilityNodeInfo> = HashSet()
    ) {
        // Protecao contra ciclos
        if (visited.contains(node)) return
        visited.add(node)

        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()
        val id = node.viewIdResourceName
        val className = node.className?.toString()
        val pkgName = node.packageName?.toString()
        val childCount = node.childCount
        
        // Bounds na tela
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        val boundsStr = "[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]"

        // Adiciona textos para o parser existente
        text?.let { if (it.isNotBlank()) texts.add(it) }
        desc?.let { if (it.isNotBlank()) texts.add(it) }

        // Registra TODOS os nos no treeBuilder (mesmo com text/desc null)
        treeBuilder.appendLine(
            "DEPTH=$level\n" +
            "PATH=$path\n" +
            "ID=${id ?: "null"}\n" +
            "TEXT=${text ?: "null"}\n" +
            "DESC=${desc ?: "null"}\n" +
            "CLASS=${className ?: "null"}\n" +
            "PACKAGE=${pkgName ?: "null"}\n" +
            "BOUNDS=$boundsStr\n" +
            "CHILDREN=$childCount\n" +
            "---"
        )

        // Percorre TODOS os filhos recursivamente (sem interromper em RecyclerView/FrameLayout)
        for (i in 0 until childCount) {
            node.getChild(i)?.let { child ->
                val childId = child.viewIdResourceName?.let { ":$it" } ?: ":child$i"
                traverseNodeWithTree(
                    child, texts, treeBuilder, level + 1,
                    "$path$childId", visited
                )
                child.recycle()
            }
        }
    }

    /**
     * IDs de Resource conhecidos do DJI Agras para leitura direta.
     * Extraidos via engenharia reversa do APK do DJI SmartFarm.
     */
    private val DJI_RESOURCE_IDS = listOf(
        // Status
        "com.dji.agras:id/droneState",
        "com.dji.agras:id/statusGps",
        "com.dji.agras:id/statusRtk",
        // Sinal / Satelites
        "com.dji.agras:id/airSignal",
        "com.dji.agras:id/aircraft_gps_status",
        "com.dji.agras:id/satellites",
        "com.dji.agras:id/signal_level_num",
        "com.dji.agras:id/signal",
        // Bateria
        "com.dji.agras:id/batteryRemain",
        "com.dji.agras:id/battery_volume",
        // Altura / Velocidade / Distancia
        "com.dji.agras:id/altitude",
        "com.dji.agras:id/heightValue",
        "com.dji.agras:id/height_value",
        "com.dji.agras:id/speed",
        "com.dji.agras:id/speedValue",
        "com.dji.agras:id/speed_value",
        "com.dji.agras:id/distance_iv",
        // Fluxo / Spray
        "com.dji.agras:id/flowRemain",
        "com.dji.agras:id/flowValue",
        "com.dji.agras:id/flow_speed",
        "com.dji.agras:id/sprayedPesticide",
        "com.dji.agras:id/spray_2_remain_capacity",
        "com.dji.agras:id/spray_system_status",
        // Coordenadas
        "com.dji.agras:id/latitude",
        "com.dji.agras:id/longitude",
        // RTK
        "com.dji.agras:id/rtk_diagnose_type",
        "com.dji.agras:id/rtk_diagnose_gps_num",
        "com.dji.agras:id/rtk_signal_num",
        "com.dji.agras:id/rtk_plan_state",
        // Genericos
        "com.dji.agras:id/viewTextValue",
        "com.dji.agras:id/textValue",
        "com.dji.agras:id/status_value",
        "com.dji.agras:id/status_text"
    )

    /**
     * Tenta ler valores diretamente dos Resource IDs conhecidos do DJI Agras.
     * Muito mais rapido e preciso que varrer toda a arvore de textos.
     */
    private fun collectByResourceIds(root: AccessibilityNodeInfo): Map<String, String> {
        val result = mutableMapOf<String, String>()
        for (resId in DJI_RESOURCE_IDS) {
            try {
                val nodes = root.findAccessibilityNodeInfosByViewId(resId)
                if (nodes != null && nodes.isNotEmpty()) {
                    val node = nodes[0]
                    val text = node.text?.toString()
                    val desc = node.contentDescription?.toString()
                    val value = text ?: desc
                    if (!value.isNullOrBlank()) {
                        // Extrai apenas o nome do ID (ultima parte)
                        val shortId = resId.substringAfterLast("/")
                        result[shortId] = value
                        FileLogger.d(TAG, "ID[$shortId] = '$value'")
                    }
                    node.recycle()
                }
                nodes?.forEach { it.recycle() }
            } catch (e: Exception) {
                // Ignora erros de ID nao encontrado
            }
        }
        return result
    }

    companion object {
        private const val TAG = "DroneAccessibilitySvc"

        /** Singleton para acesso pelo DroneCollectorService */
        @Volatile
        private var instance: DroneAccessibilityService? = null

        /** Ultimo frame coletado (acessivel sem necessidade de binding) */
        @Volatile
        var lastTelemetry: TelemetryData? = null
            private set

        /** Verifica se o servico de acessibilidade esta ativo */
        fun isActive(): Boolean = instance != null
    }
}
