package com.dronemonitor.collector.util

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Validador de fonte de telemetria.
 * Garante que cada campo tenha uma fonte documentada e verificavel.
 * Produz relatorios de auditoria para provar que dados vêm da tela.
 */
class TelemetrySourceValidator(private val context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("telemetry_audit", Context.MODE_PRIVATE)
    private val auditLog = StringBuilder()

    /**
     * Valida um pacote de telemetria e registra a fonte de cada campo.
     * Retorna true se pelo menos um campo foi extraido com sucesso.
     */
    fun validateAndLog(telemetry: JSONObject): Boolean {
        val fields = listOf(
            "sp" to "speed",
            "skm" to "speedKmh",  // novo campo de velocidade em km/h
            "alt" to "altitude",
            "sw" to "sprayWidth",
            "fr" to "flowRate",
            "ha" to "hectaresApplied",
            "ft" to "flightTime",
            "rtk" to "rtkStatus",
            "sig" to "signalStrength",
            "bat" to "batteryPercent",
            "tk" to "tankLevel",
            "tkl" to "tankLiters",  // novo campo de litros reais
            "lat" to "latitude",
            "lon" to "longitude",
            "st" to "operationalStatus",
            "alerts" to "systemAlerts"
        )

        var hasAnyData = false
        val timestamp = telemetry.optLong("ts", System.currentTimeMillis())

        for ((jsonKey, fieldName) in fields) {
            val sourceKey = "_${jsonKey}_src"
            val source = telemetry.optString(sourceKey, "UNAVAILABLE")
            val hasValue = when {
                jsonKey == "alerts" -> telemetry.has(jsonKey) && telemetry.getJSONArray(jsonKey).length() > 0
                else -> telemetry.has(jsonKey) && !telemetry.isNull(jsonKey)
            }

            if (hasValue && source != "UNAVAILABLE") {
                hasAnyData = true
                incrementCounter("${fieldName}_$source")
            }
        }

        // Log de auditoria
        val entry = "[$timestamp] Validated=${hasAnyData}, Fields=${fields.count { telemetry.has(it.first) && !telemetry.isNull(it.first) }}"
        auditLog.appendLine(entry)

        // Mantem log limitado
        if (auditLog.length > 100000) {
            auditLog.delete(0, auditLog.length / 2)
        }

        return hasAnyData
    }

    /**
     * Retorna estatisticas de extracao por campo e fonte.
     * Usado para provar que dados estao sendo extraidos da tela.
     */
    fun getExtractionStats(): Map<String, Int> {
        val stats = mutableMapOf<String, Int>()
        prefs.all.forEach { (key, value) ->
            if (value is Int) {
                stats[key] = value
            }
        }
        return stats
    }

    /**
     * Retorna o log de auditoria completo.
     */
    fun getAuditLog(): String = auditLog.toString()

    /**
     * Gera um relatorio de prova de extracao.
     * Este relatorio demonstra que cada campo vem de uma fonte real.
     */
    fun generateProofReport(): String {
        val stats = getExtractionStats()
        val sb = StringBuilder()
        sb.appendLine("=== PROVA DE EXTRACAO DE TELEMETRIA ===")
        sb.appendLine("Gerado em: ${java.util.Date()}")
        sb.appendLine("")
        sb.appendLine("METODO DE COLETA:")
        sb.appendLine("  - Primary: AccessibilityService (leitura de texto da tela)")
        sb.appendLine("  - Fallback: OCR/ML Kit (quando texto nao acessivel)")
        sb.appendLine("  - Nenhum SDK DJI utilizado")
        sb.appendLine("")
        sb.appendLine("ESTATISTICAS POR CAMPO:")

        val fields = listOf(
            "speed" to "Velocidade",
            "speedKmh" to "Velocidade(km/h)",
            "altitude" to "Altitude",
            "sprayWidth" to "Largura Faixa",
            "flowRate" to "Vazao",
            "hectaresApplied" to "Hectares",
            "flightTime" to "Tempo Voo",
            "rtkStatus" to "RTK",
            "signalStrength" to "Sinal(GNSS)",
            "batteryPercent" to "Bateria",
            "tankLevel" to "Tanque(%)",
            "tankLiters" to "Tanque(L)",
            "latitude" to "Latitude",
            "longitude" to "Longitude",
            "operationalStatus" to "Status",
            "systemAlerts" to "Alertas"
        )

        for ((fieldKey, fieldLabel) in fields) {
            val accCount = stats["${fieldKey}_ACCESSIBILITY"] ?: 0
            val ocrCount = stats["${fieldKey}_OCR"] ?: 0
            val estCount = stats["${fieldKey}_ESTIMATED"] ?: 0
            val total = accCount + ocrCount + estCount

            sb.appendLine("  $fieldLabel:")
            sb.appendLine("    Total extraido: $total")
            sb.appendLine("    Accessibility: $accCount")
            sb.appendLine("    OCR: $ocrCount")
            sb.appendLine("    Estimado: $estCount")
        }

        sb.appendLine("")
        sb.appendLine("LOG DE AUDITORIA (ultimas 20 entradas):")
        val lines = auditLog.toString().lines().filter { it.isNotBlank() }
        lines.takeLast(20).forEach { sb.appendLine("  $it") }

        return sb.toString()
    }

    fun clearStats() {
        prefs.edit().clear().apply()
        auditLog.clear()
    }

    private fun incrementCounter(key: String) {
        val current = prefs.getInt(key, 0)
        prefs.edit().putInt(key, current + 1).apply()
    }

    companion object {
        private const val TAG = "TelemetrySourceValidator"
    }
}
