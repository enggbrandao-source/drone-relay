package com.dronemonitor.collector.data

import org.json.JSONObject
import java.util.regex.Pattern

/**
 * Parser de telemetria do DJI Agras (com.dji.agras) via AccessibilityService.
 *
 * FORMATO DESCOBERTO POR ENGENHARIA REVERSA DA TELA:
 * O DJI Agras usa pares label-valor CONSECUTIVOS na hierarquia de views.
 * Exemplo: [Altitude(m)] [0.0]  [Velocidade(km/h)] [0.0]  [Fluxo(L/Min)] [0.0]
 *
 * Tambem captura valores standalone:
 * - "40%" sozinho = bateria do drone
 * - "0.00l", "35.4l" = volume do tanque em litros
 *
 * NAO USA SDK DJI. Apenas leitura passiva da tela.
 */
class TelemetryParser {

    data class ParsedField<T>(
        val value: T?,
        val source: TelemetrySource
    )

    fun parseFromTexts(texts: List<String>): TelemetryData {
        // 1. Tenta parser DJI Agras (par label-valor)
        val djiResult = parseDjiAgras(texts)
        if (djiResult.hasAnyData()) return djiResult

        // 2. Fallback: parser por concat + regex (apps em outros formatos)
        val block = texts.joinToString(" ")
        return parseTelemetry(block, texts)
    }

    /**
     * NOVO: Parser a partir de Resource IDs diretos do DJI Agras.
     * Muito mais rapido e preciso que parse por textos.
     */
    fun parseFromResourceIds(idValues: Map<String, String>): TelemetryData {
        var altitude: Double? = null
        var speedKmh: Double? = null
        var distance: Double? = null
        var flowRate: Double? = null
        var hectares: Double? = null
        var battery: Int? = null
        var tankLiters: Double? = null
        var signalStrength: Int? = null
        var rtkStatus: String? = null
        var operationalStatus: String? = null
        var latitude: Double? = null
        var longitude: Double? = null
        val alerts = mutableListOf<String>()

        // Mapeamento direto de IDs para campos
        for ((id, value) in idValues) {
            when (id) {
                // Altitude
                "altitude", "heightValue", "height_value" -> {
                    altitude = value.replace(",", ".").toDoubleOrNull()
                }
                // Velocidade
                "speed", "speedValue", "speed_value" -> {
                    speedKmh = value.replace(",", ".").toDoubleOrNull()
                }
                // Distancia
                "distance_iv" -> {
                    distance = value.replace(",", ".").toDoubleOrNull()
                }
                // Fluxo
                "flowValue", "flow_speed" -> {
                    flowRate = value.replace(",", ".").toDoubleOrNull()
                }
                // Bateria
                "batteryRemain", "battery_volume" -> {
                    // Pode vir como "80%" ou "80"
                    battery = value.replace("%", "").trim().toIntOrNull()
                }
                // Sinal / Satelites
                "satellites", "signal_level_num", "signal" -> {
                    signalStrength = value.toIntOrNull()
                }
                // Tanque / Spray
                "flowRemain", "spray_2_remain_capacity" -> {
                    // Pode vir como "4.90l" ou "4.90"
                    tankLiters = value.replace("l", "").replace("L", "")
                        .replace(",", ".").trim().toDoubleOrNull()
                }
                "sprayedPesticide" -> {
                    hectares = value.replace(",", ".").toDoubleOrNull()
                }
                // Coordenadas GPS
                "latitude" -> {
                    latitude = value.replace(",", ".").toDoubleOrNull()
                }
                "longitude" -> {
                    longitude = value.replace(",", ".").toDoubleOrNull()
                }
                // Status do drone
                "droneState" -> {
                    operationalStatus = when {
                        value.contains("flying", ignoreCase = true) -> "LIGADO"
                        value.contains("hover", ignoreCase = true) -> "LIGADO"
                        value.contains("spray", ignoreCase = true) -> "LIGADO"
                        value.contains("mission", ignoreCase = true) -> "LIGADO"
                        value.contains("takeoff", ignoreCase = true) -> "LIGADO"
                        value.contains("land", ignoreCase = true) -> "DESLIGADO"
                        value.contains("standby", ignoreCase = true) -> "DESLIGADO"
                        value.contains("idle", ignoreCase = true) -> "DESLIGADO"
                        value.contains("disconnected", ignoreCase = true) -> "DESLIGADO"
                        value.contains("offline", ignoreCase = true) -> "DESLIGADO"
                        value.contains("preflight", ignoreCase = true) -> "LIGADO"
                        else -> value
                    }
                }
                // RTK
                "rtk_diagnose_type", "rtk_plan_state", "rtk_signal_num", "statusRtk" -> {
                    rtkStatus = when {
                        value.contains("fix", ignoreCase = true) -> "Fix"
                        value.contains("float", ignoreCase = true) -> "Float"
                        value.contains("single", ignoreCase = true) -> "Single"
                        value.contains("none", ignoreCase = true) -> "None"
                        value.contains("ready", ignoreCase = true) -> "RTKs prontas"
                        value.contains("not", ignoreCase = true) -> "Not Ready"
                        else -> value
                    }
                }
                // Status GPS
                "statusGps", "aircraft_gps_status" -> {
                    // Usado para confirmar que GPS esta ativo
                }
                // Genericos (tentar inferir)
                "viewTextValue", "textValue", "status_value", "status_text" -> {
                    // Tentar inferir o que e pelo valor
                    when {
                        value.matches(Regex("^\\d{1,3}%$")) -> {
                            battery = value.removeSuffix("%").toIntOrNull()
                        }
                        value.matches(Regex("^\\d+[\\.,]\\d+l?$", RegexOption.IGNORE_CASE)) -> {
                            tankLiters = value.replace("l", "", ignoreCase = true)
                                .replace(",", ".").trim().toDoubleOrNull()
                        }
                        value.matches(Regex("^\\d{1,2}$")) -> {
                            val n = value.toIntOrNull()
                            if (n != null && n in 5..50) signalStrength = n
                        }
                    }
                }
            }
        }

        // Se tem bateria e nao tem status, assume LIGADO
        if (operationalStatus == null && battery != null) {
            operationalStatus = "LIGADO"
        }

        // Se esta LIGADO e nao tem RTK status, assume prontas (a menos que tenha alerta)
        if (operationalStatus == "LIGADO" && rtkStatus == null) {
            rtkStatus = "RTKs prontas"
        }

        val speedMs = speedKmh?.let { it / 3.6 }
        val srcAcc = TelemetrySource.ACCESSIBILITY
        val srcUnav = TelemetrySource.UNAVAILABLE

        return TelemetryData(
            speed = speedMs,
            altitude = altitude,
            sprayWidth = null,
            flowRate = flowRate,
            hectaresApplied = hectares,
            flightTime = null,
            rtkStatus = rtkStatus,
            signalStrength = signalStrength,
            batteryPercent = battery,
            tankLevel = tankLiters?.let { ((it / 35.5) * 100).toInt().coerceIn(0, 100) },
            tankLiters = tankLiters,
            speedKmh = speedKmh,
            latitude = latitude,
            longitude = longitude,
            operationalStatus = operationalStatus,
            systemAlerts = alerts.distinct(),
            sourceMap = TelemetrySourceMap(
                speed = if (speedMs != null) srcAcc else srcUnav,
                altitude = if (altitude != null) srcAcc else srcUnav,
                sprayWidth = srcUnav,
                flowRate = if (flowRate != null) srcAcc else srcUnav,
                hectaresApplied = if (hectares != null) srcAcc else srcUnav,
                flightTime = srcUnav,
                rtkStatus = if (rtkStatus != null) srcAcc else srcUnav,
                signalStrength = if (signalStrength != null) srcAcc else srcUnav,
                batteryPercent = if (battery != null) srcAcc else srcUnav,
                tankLevel = if (tankLiters != null) srcAcc else srcUnav,
                latitude = if (latitude != null) srcAcc else srcUnav,
                longitude = if (longitude != null) srcAcc else srcUnav,
                operationalStatus = if (operationalStatus != null) srcAcc else srcUnav,
                systemAlerts = if (alerts.isNotEmpty()) srcAcc else srcUnav
            )
        )
    }

    /**
     * Parser especifico do DJI Agras (com.dji.agras).
     * Procura por labels conhecidos e pega o proximo texto da lista como valor.
     */
    private fun parseDjiAgras(texts: List<String>): TelemetryData {
        var altitude: Double? = null
        var speedKmh: Double? = null
        var distance: Double? = null
        var flowRate: Double? = null
        var hectares: Double? = null
        var battery: Int? = null
        var tankLiters: Double? = null  // volume real em litros (4.90)
        var signalStrength: Int? = null  // numero de satelites
        var rtkStatus: String? = null     // RTK Fix/Float/None
        var operationalStatus: String? = null
        val alerts = mutableListOf<String>()

        for (i in texts.indices) {
            val text = texts[i].trim()
            val nextText = texts.getOrNull(i + 1)?.trim() ?: ""

            // === LABELS DJI AGRAS (par label-valor) ===
            when {
                text.contains("Altitude(m)", ignoreCase = true) ||
                text.contains("Altura(m)", ignoreCase = true) -> {
                    altitude = nextText.replace(",", ".").toDoubleOrNull()
                }
                text.contains("Velocidade(km/h)", ignoreCase = true) ||
                text.contains("Speed(km/h)", ignoreCase = true) -> {
                    speedKmh = nextText.replace(",", ".").toDoubleOrNull()
                }
                text.contains("Velocidade(m/s)", ignoreCase = true) ||
                text.contains("Speed(m/s)", ignoreCase = true) -> {
                    val ms = nextText.replace(",", ".").toDoubleOrNull()
                    if (ms != null) speedKmh = ms * 3.6
                }
                text.contains("Distância(m)", ignoreCase = true) ||
                text.contains("Distancia(m)", ignoreCase = true) ||
                text.contains("Distance(m)", ignoreCase = true) -> {
                    distance = nextText.replace(",", ".").toDoubleOrNull()
                }
                text.contains("Fluxo(L/Min)", ignoreCase = true) ||
                text.contains("Vazão(L/Min)", ignoreCase = true) ||
                text.contains("Vazao(L/Min)", ignoreCase = true) ||
                text.contains("Flow(L/Min)", ignoreCase = true) -> {
                    flowRate = nextText.replace(",", ".").toDoubleOrNull()
                }
                text.contains("Área", ignoreCase = true) && text.contains("(Ha)", ignoreCase = true) -> {
                    hectares = nextText.replace(",", ".").toDoubleOrNull()
                }
                text.contains("Area", ignoreCase = true) && text.contains("(Ha)", ignoreCase = true) -> {
                    hectares = nextText.replace(",", ".").toDoubleOrNull()
                }
            }

            // Sinal: numero de satelites (numero sozinho entre 5-50, nao labelado)
            if (text.matches(Regex("^\\d{1,2}$"))) {
                val n = text.toIntOrNull()
                if (n != null && n in 5..50 && n != speedKmh?.toInt()) {
                    signalStrength = n  // satelites como "forca de sinal"
                }
            }

            // === SATELITES EXPLICITOS ===
            if (text.contains("satelite", ignoreCase = true) ||
                text.contains("GNSS", ignoreCase = true) ||
                text.contains("GPS", ignoreCase = true)) {
                val next = texts.getOrNull(i + 1)?.trim()
                signalStrength = next?.toIntOrNull() ?: signalStrength
            }

            // Bateria: "80%" sozinho → pega o maior valor encontrado (evita pegar % errado)
            if (text.matches(Regex("^\\d{1,3}%$"))) {
                val pct = text.removeSuffix("%").toIntOrNull()
                if (pct != null && pct in 0..100 && (battery == null || pct > battery)) {
                    battery = pct
                }
            }

            // Tanque: "4.90l", "4.94l" → extrai litros reais
            if (text.matches(Regex("^\\d+[\\.,]\\d+l$", RegexOption.IGNORE_CASE))) {
                val volume = text.removeSuffix("l").removeSuffix("L")
                    .replace(",", ".").toDoubleOrNull()
                if (volume != null && volume < 50) {  // valida: <50L é volume real, >30 é capacidade
                    tankLiters = volume
                }
            }

            // === RTK STATUS ===
            if (text.contains("RTK", ignoreCase = true)) {
                when {
                    text.contains("Fix", ignoreCase = true) -> rtkStatus = "Fix"
                    text.contains("Float", ignoreCase = true) -> rtkStatus = "Float"
                    text.contains("None", ignoreCase = true) -> rtkStatus = "None"
                    text.contains("Single", ignoreCase = true) -> rtkStatus = "Single"
                    text.contains("não", ignoreCase = true) || text.contains("not", ignoreCase = true) -> {
                        rtkStatus = "Not Ready"
                        if (!alerts.any { it.contains("RTK", ignoreCase = true) }) {
                            alerts.add(text)
                        }
                    }
                }
            }

            // === STATUS / ALERTAS ===
            // Alertas de seguranca NAO significam que o drone esta desligado
            // Apenas adiciona aos alertas, mas nao muda o status
            if (text.contains("Incapaz de decolar", ignoreCase = true) ||
                text.contains("Cannot take off", ignoreCase = true)) {
                alerts.add(text)
            }
            if (text.contains("Capacidade de carga", ignoreCase = true) ||
                text.contains("payload exceeded", ignoreCase = true)) {
                if (!alerts.any { it.contains("carga", ignoreCase = true) }) {
                    alerts.add(text)
                }
            }
            if (text.contains("RTK", ignoreCase = true) &&
                (text.contains("não", ignoreCase = true) || text.contains("not", ignoreCase = true))) {
                if (!alerts.any { it.contains("RTK", ignoreCase = true) }) {
                    alerts.add(text)
                }
            }
            if (text.contains("Bateria baixa", ignoreCase = true) ||
                text.contains("Low battery", ignoreCase = true) ||
                text.contains("Critical battery", ignoreCase = true)) {
                alerts.add(text)
            }
            if (text.contains("Pulverizando", ignoreCase = true) ||
                text.contains("Aplicando", ignoreCase = true) ||
                text.contains("Spraying", ignoreCase = true)) {
                operationalStatus = "LIGADO"
            }
            if (text.contains("Voando", ignoreCase = true) ||
                text.contains("Flying", ignoreCase = true)) {
                if (operationalStatus == null) operationalStatus = "LIGADO"
            }
        }

        // Converte velocidade km/h -> m/s para compatibilidade
        val speedMs = speedKmh?.let { it / 3.6 }

        // Se tem dados de bateria e o status ainda é null, assume LIGADO
        // (drone conectado ao RC, mesmo parado na pista)
        if (operationalStatus == null && battery != null) {
            operationalStatus = "LIGADO"
        }

        // Source map
        val srcAcc = TelemetrySource.ACCESSIBILITY
        val srcUnav = TelemetrySource.UNAVAILABLE

        return TelemetryData(
            speed = speedMs,
            altitude = altitude,
            sprayWidth = null,
            flowRate = flowRate,
            hectaresApplied = hectares,
            flightTime = null,
            // Se drone está operando (LIGADO) e não há alertas RTK, assume RTKs prontas
            rtkStatus = when {
                alerts.any { it.contains("RTK", ignoreCase = true) } -> "Not Ready"
                operationalStatus == "LIGADO" && rtkStatus == null -> "RTKs prontas"
                rtkStatus != null -> rtkStatus
                else -> null
            },
            signalStrength = signalStrength,
            batteryPercent = battery,
            tankLevel = tankLiters?.let { ((it / 35.5) * 100).toInt().coerceIn(0, 100) }, // % baseado na capacidade total
            tankLiters = tankLiters,           // volume real em litros (4.90)
            speedKmh = speedKmh,                    // velocidade original em km/h
            latitude = null,
            longitude = null,
            operationalStatus = operationalStatus,
            systemAlerts = alerts.distinct(),
            sourceMap = TelemetrySourceMap(
                speed = if (speedMs != null) srcAcc else srcUnav,
                altitude = if (altitude != null) srcAcc else srcUnav,
                sprayWidth = srcUnav,
                flowRate = if (flowRate != null) srcAcc else srcUnav,
                hectaresApplied = if (hectares != null) srcAcc else srcUnav,
                flightTime = srcUnav,
                rtkStatus = if (alerts.any { it.contains("RTK", ignoreCase = true) }) srcAcc else srcUnav,
                signalStrength = srcUnav,
                batteryPercent = if (battery != null) srcAcc else srcUnav,
                tankLevel = if (tankLiters != null) srcAcc else srcUnav,
                latitude = srcUnav,
                longitude = srcUnav,
                operationalStatus = if (operationalStatus != null) srcAcc else srcUnav,
                systemAlerts = if (alerts.isNotEmpty()) srcAcc else srcUnav
            )
        )
    }

    fun parseTelemetry(block: String, texts: List<String>): TelemetryData {
        val speed = extractDouble(block, SPEED_PATTERNS)
        val altitude = extractDouble(block, ALTITUDE_PATTERNS)
        val sprayWidth = extractDouble(block, WIDTH_PATTERNS)
        val flowRate = extractDouble(block, FLOW_PATTERNS)
        val hectaresApplied = extractDouble(block, HECTARES_PATTERNS)
        val flightTime = extractInt(block, FLIGHT_TIME_PATTERNS)
        val rtkStatus = extractString(block, RTK_PATTERNS)
        val signalStrength = extractSignalStrength(block)
        val batteryPercent = extractInt(block, BATTERY_PATTERNS)
        val tankLevel = extractInt(block, TANK_PATTERNS)
        val latitude = extractCoordinate(block, LAT_PATTERNS)
        val longitude = extractCoordinate(block, LON_PATTERNS)
        val operationalStatus = inferStatus(block)
        val alerts = extractAlerts(texts)

        return TelemetryData(
            speed = speed.value,
            altitude = altitude.value,
            sprayWidth = sprayWidth.value,
            flowRate = flowRate.value,
            hectaresApplied = hectaresApplied.value,
            flightTime = flightTime.value,
            rtkStatus = rtkStatus.value,
            signalStrength = signalStrength.value,
            batteryPercent = batteryPercent.value,
            tankLevel = tankLevel.value,
            latitude = latitude.value,
            longitude = longitude.value,
            operationalStatus = operationalStatus.value,
            systemAlerts = alerts.value ?: emptyList(),
            sourceMap = TelemetrySourceMap(
                speed = speed.source,
                altitude = altitude.source,
                sprayWidth = sprayWidth.source,
                flowRate = flowRate.source,
                hectaresApplied = hectaresApplied.source,
                flightTime = flightTime.source,
                rtkStatus = rtkStatus.source,
                signalStrength = signalStrength.source,
                batteryPercent = batteryPercent.source,
                tankLevel = tankLevel.source,
                latitude = latitude.source,
                longitude = longitude.source,
                operationalStatus = operationalStatus.source,
                systemAlerts = alerts.source
            )
        )
    }

    private fun extractDouble(text: String, patterns: List<Pattern>): ParsedField<Double> {
        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                val value = matcher.group(1)?.replace(",", ".")?.toDoubleOrNull()
                return if (value != null) {
                    ParsedField(value, TelemetrySource.ACCESSIBILITY)
                } else {
                    ParsedField(null, TelemetrySource.UNAVAILABLE)
                }
            }
        }
        return ParsedField(null, TelemetrySource.UNAVAILABLE)
    }

    private fun extractInt(text: String, patterns: List<Pattern>): ParsedField<Int> {
        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                val value = matcher.group(1)?.toIntOrNull()
                return if (value != null) {
                    ParsedField(value, TelemetrySource.ACCESSIBILITY)
                } else {
                    ParsedField(null, TelemetrySource.UNAVAILABLE)
                }
            }
        }
        return ParsedField(null, TelemetrySource.UNAVAILABLE)
    }

    private fun extractString(text: String, patterns: List<Pattern>): ParsedField<String> {
        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                val value = matcher.group(1)?.trim()
                return if (!value.isNullOrEmpty()) {
                    ParsedField(value, TelemetrySource.ACCESSIBILITY)
                } else {
                    ParsedField(null, TelemetrySource.UNAVAILABLE)
                }
            }
        }
        return ParsedField(null, TelemetrySource.UNAVAILABLE)
    }

    private fun extractCoordinate(text: String, patterns: List<Pattern>): ParsedField<Double> {
        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                val value = matcher.group(1)?.replace(",", ".")?.toDoubleOrNull()
                return if (value != null) {
                    ParsedField(value, TelemetrySource.ACCESSIBILITY)
                } else {
                    ParsedField(null, TelemetrySource.UNAVAILABLE)
                }
            }
        }
        return ParsedField(null, TelemetrySource.UNAVAILABLE)
    }

    private fun extractSignalStrength(text: String): ParsedField<Int> {
        val percentPattern = Pattern.compile("Sinal\\s*:?\\s*(\\d+)%")
        val percentMatcher = percentPattern.matcher(text)
        if (percentMatcher.find()) {
            val value = percentMatcher.group(1)?.toIntOrNull()
            if (value != null) return ParsedField(value, TelemetrySource.ACCESSIBILITY)
        }

        val dbmPattern = Pattern.compile("(-?\\d+)\\s*dBm")
        val dbmMatcher = dbmPattern.matcher(text)
        if (dbmMatcher.find()) {
            val dbm = dbmMatcher.group(1)?.toDoubleOrNull()
            if (dbm != null) {
                val percent = ((dbm + 90) / 40 * 100).toInt().coerceIn(0, 100)
                return ParsedField(percent, TelemetrySource.ESTIMATED)
            }
        }

        return ParsedField(null, TelemetrySource.UNAVAILABLE)
    }

    fun inferStatus(text: String): ParsedField<String> {
        val status = when {
            // Drone ligado e operando
            text.contains("Aplicando", ignoreCase = true) -> "LIGADO"
            text.contains("Pulverizando", ignoreCase = true) -> "LIGADO"
            text.contains("Voando", ignoreCase = true) -> "LIGADO"
            text.contains("Planando", ignoreCase = true) -> "LIGADO"
            text.contains("Decolando", ignoreCase = true) -> "LIGADO"
            text.contains("Retornando", ignoreCase = true) -> "LIGADO"
            text.contains("RTH", ignoreCase = true) -> "LIGADO"
            text.contains("Return to Home", ignoreCase = true) -> "LIGADO"
            text.contains("Mission", ignoreCase = true) -> "LIGADO"
            text.contains("Waypoint", ignoreCase = true) -> "LIGADO"
            text.contains("Em operação", ignoreCase = true) -> "LIGADO"
            text.contains("Em operacao", ignoreCase = true) -> "LIGADO"
            text.contains("Operando", ignoreCase = true) -> "LIGADO"
            text.contains("Em voo", ignoreCase = true) -> "LIGADO"
            text.contains("Voo em andamento", ignoreCase = true) -> "LIGADO"
            text.contains("Trabalhando", ignoreCase = true) -> "LIGADO"
            text.contains("Executando", ignoreCase = true) -> "LIGADO"
            text.contains("Em andamento", ignoreCase = true) -> "LIGADO"
            // Drone desligado/parado
            text.contains("Parado", ignoreCase = true) -> "DESLIGADO"
            text.contains("Standby", ignoreCase = true) -> "DESLIGADO"
            text.contains("Pousando", ignoreCase = true) -> "DESLIGADO"
            text.contains("Desligado", ignoreCase = true) -> "DESLIGADO"
            text.contains("Offline", ignoreCase = true) -> "DESLIGADO"
            else -> null
        }
        return if (status != null) {
            ParsedField(status, TelemetrySource.ACCESSIBILITY)
        } else {
            ParsedField(null, TelemetrySource.UNAVAILABLE)
        }
    }

    fun extractAlerts(texts: List<String>): ParsedField<List<String>> {
        val alerts = mutableListOf<String>()
        val alertKeywords = listOf(
            "alerta", "aviso", "erro", "falha",
            "bateria baixa", "bateria critica",
            "sinal fraco", "sinal perdido",
            "obstaculo", "obstaculo detectado",
            "vento forte", "vento excessivo",
            "sobrecarga", "sobrecarga motor",
            "rtk lost", "rtk perdido", "rtk fraco",
            "geo fence", "cerca virtual", "cerca geografica",
            "temperatura alta", "temperatura excessiva",
            "tanque vazio", "tanque baixo",
            "motor", "motor erro", "esc erro",
            "imu", "imu erro", "calibracao",
            "bussola", "bussola erro",
            "gps fraco", "gps perdido",
            "altura", "altura maxima", "altura minima",
            "velocidade", "velocidade excessiva",
            "incapaz de decolar", "capacidade de carga",
            "nao estao prontas",
            "warning", "error", "fail", "critical",
            "low battery", "critical battery",
            "weak signal", "signal lost",
            "obstacle", "obstacle detected",
            "strong wind", "high wind",
            "overload", "motor overload",
            "rtk lost", "rtk weak",
            "geofence", "geo fence",
            "high temperature", "overheat",
            "tank empty", "tank low",
            "motor error", "esc error",
            "imu error", "calibration",
            "compass error",
            "gps weak", "gps lost",
            "max altitude", "min altitude",
            "overspeed",
            "cannot take off", "payload exceeded"
        )
        for (text in texts) {
            val lower = text.lowercase()
            for (keyword in alertKeywords) {
                if (lower.contains(keyword)) {
                    alerts.add(text)
                    break
                }
            }
        }
        return if (alerts.isNotEmpty()) {
            ParsedField(alerts.distinct(), TelemetrySource.ACCESSIBILITY)
        } else {
            ParsedField(emptyList(), TelemetrySource.UNAVAILABLE)
        }
    }

    companion object {
        private val SPEED_PATTERNS = listOf(
            Pattern.compile("Vel(?:ocidade)?\\s*:?\\s*([0-9]+[.,]?[0-9]*)\\s*(?:m/s|km/h)"),
            Pattern.compile("Speed\\s*:?\\s*([0-9]+[.,]?[0-9]*)"),
            Pattern.compile("([0-9]+[.,]?[0-9]*)\\s*m/s"),
            Pattern.compile("([0-9]+[.,]?[0-9]*)\\s*km/h")
        )
        private val ALTITUDE_PATTERNS = listOf(
            Pattern.compile("Alt(?:itude)?\\s*:?\\s*([0-9]+[.,]?[0-9]*)\\s*m"),
            Pattern.compile("Alt\\s*:?\\s*([0-9]+[.,]?[0-9]*)"),
            Pattern.compile("([0-9]+[.,]?[0-9]*)\\s*m\\s*AGL"),
            Pattern.compile("([0-9]+[.,]?[0-9]*)\\s*m\\s*ALT")
        )
        private val WIDTH_PATTERNS = listOf(
            Pattern.compile("Larg(?:ura)?\\s*:?\\s*([0-9]+[.,]?[0-9]*)\\s*m"),
            Pattern.compile("Width\\s*:?\\s*([0-9]+[.,]?[0-9]*)"),
            Pattern.compile("Faixa\\s*:?\\s*([0-9]+[.,]?[0-9]*)"),
            Pattern.compile("Spray Width\\s*:?\\s*([0-9]+[.,]?[0-9]*)")
        )
        private val FLOW_PATTERNS = listOf(
            Pattern.compile("Vaz(?:ao)?\\s*:?\\s*([0-9]+[.,]?[0-9]*)\\s*(?:L/min|L/m)"),
            Pattern.compile("Flow\\s*:?\\s*([0-9]+[.,]?[0-9]*)"),
            Pattern.compile("([0-9]+[.,]?[0-9]*)\\s*L/min"),
            Pattern.compile("Flow Rate\\s*:?\\s*([0-9]+[.,]?[0-9]*)")
        )
        private val HECTARES_PATTERNS = listOf(
            Pattern.compile("Hect(?:ares)?\\s*:?\\s*([0-9]+[.,]?[0-9]*)"),
            Pattern.compile("Area\\s*:?\\s*([0-9]+[.,]?[0-9]*)\\s*(?:ha|hec)"),
            Pattern.compile("([0-9]+[.,]?[0-9]*)\\s*ha"),
            Pattern.compile("Area Covered\\s*:?\\s*([0-9]+[.,]?[0-9]*)")
        )
        private val FLIGHT_TIME_PATTERNS = listOf(
            Pattern.compile("Tempo\\s*:?\\s*(\\d+):?(\\d*):?(\\d*)"),
            Pattern.compile("Flight Time\\s*:?\\s*(\\d+):?(\\d*):?(\\d*)"),
            Pattern.compile("Flight\\s*:?\\s*(\\d+):?(\\d*):?(\\d*)")
        )
        private val BATTERY_PATTERNS = listOf(
            Pattern.compile("Bateria\\s*:?\\s*(\\d+)%?"),
            Pattern.compile("Bat\\s*:?\\s*(\\d+)%?"),
            Pattern.compile("Battery\\s*:?\\s*(\\d+)%?"),
            Pattern.compile("Bat\\s*([0-9]+)"),
            Pattern.compile("Battery\\s*([0-9]+)")
        )
        private val TANK_PATTERNS = listOf(
            Pattern.compile("Tanque\\s*:?\\s*(\\d+)%?"),
            Pattern.compile("Tank\\s*:?\\s*(\\d+)%?"),
            Pattern.compile("Tank Level\\s*:?\\s*(\\d+)%?"),
            Pattern.compile("Tank\\s*([0-9]+)")
        )
        private val RTK_PATTERNS = listOf(
            Pattern.compile("RTK\\s*:?\\s*(Fix|Float|None|Single|Desligado|Off)"),
            Pattern.compile("RTK\\s*(Fix|Float|None|Single)"),
            Pattern.compile("RTK\\s*Status\\s*:?\\s*(Fix|Float|None|Single)")
        )
        private val LAT_PATTERNS = listOf(
            Pattern.compile("Lat\\s*:?\\s*(-?\\d+\\.?\\d*)"),
            Pattern.compile("Latitude\\s*:?\\s*(-?\\d+\\.?\\d*)"),
            Pattern.compile("(-?\\d{2}\\.\\d+)\\s*[\u00b0NS]")
        )
        private val LON_PATTERNS = listOf(
            Pattern.compile("Lon\\s*:?\\s*(-?\\d+\\.?\\d*)"),
            Pattern.compile("Longitude\\s*:?\\s*(-?\\d+\\.?\\d*)"),
            Pattern.compile("(-?\\d{2,3}\\.\\d+)\\s*[\u00b0EW]")
        )
    }
}
