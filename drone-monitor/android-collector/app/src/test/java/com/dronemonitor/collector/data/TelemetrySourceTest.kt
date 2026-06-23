package com.dronemonitor.collector.data

import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Test

class TelemetrySourceTest {

    @Test
    fun `parse speed from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("Velocidade: 5.2 m/s", "Bateria: 80%")
        val result = parser.parseFromTexts(texts)

        assertThat(result.speed).isWithin(0.001).of(5.2)
        assertThat(result.sourceMap.speed).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `parse battery from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("Bateria: 72%", "Tanque: 45%")
        val result = parser.parseFromTexts(texts)

        assertThat(result.batteryPercent).isEqualTo(72)
        assertThat(result.sourceMap.batteryPercent).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(result.tankLevel).isEqualTo(45)
        assertThat(result.sourceMap.tankLevel).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `parse altitude from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("Alt: 15.5 m")
        val result = parser.parseFromTexts(texts)

        assertThat(result.altitude).isWithin(0.001).of(15.5)
        assertThat(result.sourceMap.altitude).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `parse rtk from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("RTK: Fix")
        val result = parser.parseFromTexts(texts)

        assertThat(result.rtkStatus).isEqualTo("Fix")
        assertThat(result.sourceMap.rtkStatus).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `signal strength estimated from dBm`() {
        val parser = TelemetryParser()
        val texts = listOf("Sinal: -70 dBm")
        val result = parser.parseFromTexts(texts)

        assertThat(result.signalStrength).isEqualTo(50)
        assertThat(result.sourceMap.signalStrength).isEqualTo(TelemetrySource.ESTIMATED)
    }

    @Test
    fun `signal strength from accessibility percentage`() {
        val parser = TelemetryParser()
        val texts = listOf("Sinal: 85%")
        val result = parser.parseFromTexts(texts)

        assertThat(result.signalStrength).isEqualTo(85)
        assertThat(result.sourceMap.signalStrength).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `unavailable fields have correct source`() {
        val parser = TelemetryParser()
        val texts = listOf("Bateria: 80%")
        val result = parser.parseFromTexts(texts)

        assertThat(result.batteryPercent).isEqualTo(80)
        assertThat(result.sourceMap.batteryPercent).isEqualTo(TelemetrySource.ACCESSIBILITY)

        assertThat(result.speed).isNull()
        assertThat(result.sourceMap.speed).isEqualTo(TelemetrySource.UNAVAILABLE)

        assertThat(result.altitude).isNull()
        assertThat(result.sourceMap.altitude).isEqualTo(TelemetrySource.UNAVAILABLE)
    }

    @Test
    fun `infer operational status from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("Aplicando defensivo")
        val result = parser.parseFromTexts(texts)

        assertThat(result.operationalStatus).isEqualTo("spraying")
        assertThat(result.sourceMap.operationalStatus).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `extract alerts from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("ALERTA: bateria baixa", "Tudo normal")
        val result = parser.parseFromTexts(texts)

        assertThat(result.systemAlerts).contains("ALERTA: bateria baixa")
        assertThat(result.sourceMap.systemAlerts).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `no alerts returns unavailable source`() {
        val parser = TelemetryParser()
        val texts = listOf("Tudo normal")
        val result = parser.parseFromTexts(texts)

        assertThat(result.systemAlerts).isEmpty()
        assertThat(result.sourceMap.systemAlerts).isEqualTo(TelemetrySource.UNAVAILABLE)
    }

    @Test
    fun `parse hectares from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("Area: 12.45 ha")
        val result = parser.parseFromTexts(texts)

        assertThat(result.hectaresApplied).isWithin(0.001).of(12.45)
        assertThat(result.sourceMap.hectaresApplied).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `parse gps coordinates from accessibility text`() {
        val parser = TelemetryParser()
        val texts = listOf("Lat: -15.123456", "Lon: -47.654321")
        val result = parser.parseFromTexts(texts)

        assertThat(result.latitude).isWithin(0.000001).of(-15.123456)
        assertThat(result.sourceMap.latitude).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(result.longitude).isWithin(0.000001).of(-47.654321)
        assertThat(result.sourceMap.longitude).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `telemetry data includes source metadata in json`() {
        val data = TelemetryData(
            speed = 5.2,
            batteryPercent = 72,
            sourceMap = TelemetrySourceMap(
                speed = TelemetrySource.ACCESSIBILITY,
                batteryPercent = TelemetrySource.ACCESSIBILITY
            )
        )

        val json = data.toJson()
        assertThat(json.getDouble("sp")).isWithin(0.001).of(5.2)
        assertThat(json.getString("_sp_src")).isEqualTo("ACCESSIBILITY")
        assertThat(json.getInt("bat")).isEqualTo(72)
        assertThat(json.getString("_bat_src")).isEqualTo("ACCESSIBILITY")
    }

    @Test
    fun `all fields default to unavailable source`() {
        val data = TelemetryData()
        val sourceMap = data.sourceMap

        assertThat(sourceMap.speed).isEqualTo(TelemetrySource.UNAVAILABLE)
        assertThat(sourceMap.altitude).isEqualTo(TelemetrySource.UNAVAILABLE)
        assertThat(sourceMap.batteryPercent).isEqualTo(TelemetrySource.UNAVAILABLE)
        assertThat(sourceMap.tankLevel).isEqualTo(TelemetrySource.UNAVAILABLE)
        assertThat(sourceMap.rtkStatus).isEqualTo(TelemetrySource.UNAVAILABLE)
        assertThat(sourceMap.operationalStatus).isEqualTo(TelemetrySource.UNAVAILABLE)
    }

    @Test
    fun `english interface patterns work`() {
        val parser = TelemetryParser()
        val texts = listOf(
            "Speed: 8.5 m/s",
            "Battery: 65%",
            "Tank: 30%",
            "RTK Fix",
            "Area Covered: 25.5 ha"
        )
        val result = parser.parseFromTexts(texts)

        assertThat(result.speed).isWithin(0.001).of(8.5)
        assertThat(result.sourceMap.speed).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(result.batteryPercent).isEqualTo(65)
        assertThat(result.sourceMap.batteryPercent).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(result.tankLevel).isEqualTo(30)
        assertThat(result.sourceMap.tankLevel).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(result.rtkStatus).isEqualTo("Fix")
        assertThat(result.sourceMap.rtkStatus).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(result.hectaresApplied).isWithin(0.001).of(25.5)
        assertThat(result.sourceMap.hectaresApplied).isEqualTo(TelemetrySource.ACCESSIBILITY)
    }

    @Test
    fun `source map survives json roundtrip`() {
        val original = TelemetryData(
            speed = 5.0,
            batteryPercent = 80,
            signalStrength = 50,
            sourceMap = TelemetrySourceMap(
                speed = TelemetrySource.ACCESSIBILITY,
                batteryPercent = TelemetrySource.ACCESSIBILITY,
                signalStrength = TelemetrySource.ESTIMATED
            )
        )

        val json = original.toJson()
        val restored = TelemetryData.fromJson(json)

        assertThat(restored.sourceMap.speed).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(restored.sourceMap.batteryPercent).isEqualTo(TelemetrySource.ACCESSIBILITY)
        assertThat(restored.sourceMap.signalStrength).isEqualTo(TelemetrySource.ESTIMATED)
        assertThat(restored.sourceMap.altitude).isEqualTo(TelemetrySource.UNAVAILABLE)
    }

    @Test
    fun `ocr source can be set manually`() {
        // Simula dados vindos de OCR
        val data = TelemetryData(
            speed = 4.5,
            batteryPercent = 70,
            sourceMap = TelemetrySourceMap(
                speed = TelemetrySource.OCR,
                batteryPercent = TelemetrySource.OCR
            )
        )
        assertThat(data.sourceMap.speed).isEqualTo(TelemetrySource.OCR)
        assertThat(data.sourceMap.batteryPercent).isEqualTo(TelemetrySource.OCR)
    }

    @Test
    fun `unavailable source when smartfarm text missing`() {
        val parser = TelemetryParser()
        val texts = listOf("Outro app qualquer", "Sem dados de voo")
        val result = parser.parseFromTexts(texts)

        assertThat(result.speed).isNull()
        assertThat(result.sourceMap.speed).isEqualTo(TelemetrySource.UNAVAILABLE)
        assertThat(result.batteryPercent).isNull()
        assertThat(result.sourceMap.batteryPercent).isEqualTo(TelemetrySource.UNAVAILABLE)
        assertThat(result.systemAlerts).isEmpty()
        assertThat(result.sourceMap.systemAlerts).isEqualTo(TelemetrySource.UNAVAILABLE)
    }
}
