package com.dronemonitor.collector.data

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class TelemetryParserTest {

    private val parser = TelemetryParser()

    @Test
    fun `parse speed from various formats`() {
        val texts = listOf("Velocidade: 5.2 m/s")
        val result = parser.parseFromTexts(texts)
        assertThat(result.speed).isWithin(0.001).of(5.2)

        val texts2 = listOf("Speed: 12.5")
        val result2 = parser.parseFromTexts(texts2)
        assertThat(result2.speed).isWithin(0.001).of(12.5)

        val texts3 = listOf("8.0 m/s")
        val result3 = parser.parseFromTexts(texts3)
        assertThat(result3.speed).isWithin(0.001).of(8.0)
    }

    @Test
    fun `parse altitude from various formats`() {
        val texts = listOf("Altitude: 15.5 m")
        val result = parser.parseFromTexts(texts)
        assertThat(result.altitude).isWithin(0.001).of(15.5)

        val texts2 = listOf("Alt: 20")
        val result2 = parser.parseFromTexts(texts2)
        assertThat(result2.altitude).isWithin(0.001).of(20.0)

        val texts3 = listOf("12.3 m AGL")
        val result3 = parser.parseFromTexts(texts3)
        assertThat(result3.altitude).isWithin(0.001).of(12.3)
    }

    @Test
    fun `parse battery percentage`() {
        val texts = listOf("Bateria: 75%", "Tanque: 45%")
        val result = parser.parseFromTexts(texts)
        assertThat(result.batteryPercent).isEqualTo(75)
    }

    @Test
    fun `parse tank level`() {
        val texts = listOf("Tanque: 60%")
        val result = parser.parseFromTexts(texts)
        assertThat(result.tankLevel).isEqualTo(60)
    }

    @Test
    fun `parse RTK status`() {
        val texts = listOf("RTK: Fix")
        val result = parser.parseFromTexts(texts)
        assertThat(result.rtkStatus).isEqualTo("Fix")

        val texts2 = listOf("RTK Float")
        val result2 = parser.parseFromTexts(texts2)
        assertThat(result2.rtkStatus).isEqualTo("Float")
    }

    @Test
    fun `parse hectares applied`() {
        val texts = listOf("Hectares: 12.45", "Area: 8.5 ha")
        val result = parser.parseFromTexts(texts)
        assertThat(result.hectaresApplied).isWithin(0.001).of(12.45)
    }

    @Test
    fun `parse flow rate`() {
        val texts = listOf("Vazao: 3.5 L/min")
        val result = parser.parseFromTexts(texts)
        assertThat(result.flowRate).isWithin(0.001).of(3.5)
    }

    @Test
    fun `parse spray width`() {
        val texts = listOf("Largura: 8.0 m")
        val result = parser.parseFromTexts(texts)
        assertThat(result.sprayWidth).isWithin(0.001).of(8.0)
    }

    @Test
    fun `parse GPS coordinates`() {
        val texts = listOf("Lat: -15.123456", "Lon: -47.654321")
        val result = parser.parseFromTexts(texts)
        assertThat(result.latitude).isWithin(0.000001).of(-15.123456)
        assertThat(result.longitude).isWithin(0.000001).of(-47.654321)
    }

    @Test
    fun `parse signal strength from dBm`() {
        val texts = listOf("Sinal: -70 dBm")
        val result = parser.parseFromTexts(texts)
        assertThat(result.signalStrength).isEqualTo(50) // (-70+90)/40*100 = 50
    }

    @Test
    fun `parse signal strength from percentage`() {
        val texts = listOf("Sinal: 85%")
        val result = parser.parseFromTexts(texts)
        assertThat(result.signalStrength).isEqualTo(85)
    }

    @Test
    fun `infer operational status`() {
        assertThat(parser.inferStatus("Aplicando defensivo")).isEqualTo("spraying")
        assertThat(parser.inferStatus("Pulverizando")).isEqualTo("spraying")
        assertThat(parser.inferStatus("Voando para destino")).isEqualTo("flying")
        assertThat(parser.inferStatus("Planando no local")).isEqualTo("hovering")
        assertThat(parser.inferStatus("Pousando")).isEqualTo("landing")
        assertThat(parser.inferStatus("Decolando")).isEqualTo("taking_off")
        assertThat(parser.inferStatus("Retornando ao ponto")).isEqualTo("returning")
        assertThat(parser.inferStatus("Parado")).isEqualTo("idle")
        assertThat(parser.inferStatus("Standby")).isEqualTo("standby")
        assertThat(parser.inferStatus("Desconhecido")).isNull()
    }

    @Test
    fun `extract alerts from texts`() {
        val texts = listOf(
            "Tudo normal",
            "ALERTA: bateria baixa",
            "Warning: sinal fraco",
            "Erro de conexao",
            "Temperatura alta detectada"
        )
        val alerts = parser.extractAlerts(texts)

        assertThat(alerts).hasSize(4)
        assertThat(alerts).contains("ALERTA: bateria baixa")
        assertThat(alerts).contains("Warning: sinal fraco")
        assertThat(alerts).contains("Erro de conexao")
        assertThat(alerts).contains("Temperatura alta detectada")
        assertThat(alerts).doesNotContain("Tudo normal")
    }

    @Test
    fun `returns empty telemetry for empty input`() {
        val result = parser.parseFromTexts(emptyList())
        assertThat(result.speed).isNull()
        assertThat(result.altitude).isNull()
        assertThat(result.batteryPercent).isNull()
        assertThat(result.systemAlerts).isEmpty()
    }

    @Test
    fun `handles malformed numbers gracefully`() {
        val texts = listOf("Velocidade: abc m/s", "Bateria: xyz%")
        val result = parser.parseFromTexts(texts)
        assertThat(result.speed).isNull()
        assertThat(result.batteryPercent).isNull()
    }

    @Test
    fun `handles mixed valid and invalid data`() {
        val texts = listOf(
            "Velocidade: 5.2 m/s",
            "Bateria: abc%",
            "Alt: 10.0 m"
        )
        val result = parser.parseFromTexts(texts)
        assertThat(result.speed).isWithin(0.001).of(5.2)
        assertThat(result.altitude).isWithin(0.001).of(10.0)
        assertThat(result.batteryPercent).isNull()
    }

    @Test
    fun `case insensitive status matching`() {
        assertThat(parser.inferStatus("APLICANDO")).isEqualTo("spraying")
        assertThat(parser.inferStatus("voando")).isEqualTo("flying")
        assertThat(parser.inferStatus("Pousando")).isEqualTo("landing")
    }

    @Test
    fun `signal strength dBm clamped to 0-100`() {
        val texts1 = listOf("Sinal: -30 dBm")
        val result1 = parser.parseFromTexts(texts1)
        assertThat(result1.signalStrength).isEqualTo(100)

        val texts2 = listOf("Sinal: -100 dBm")
        val result2 = parser.parseFromTexts(texts2)
        assertThat(result2.signalStrength).isEqualTo(0)
    }
}
