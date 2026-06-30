package com.dronemonitor.collector.data

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class TelemetryParserResourceIdsTest {

    private val parser = TelemetryParser()

    @Test
    fun `parse resource ids accepts values mixed with labels and units`() {
        val result = parser.parseFromResourceIds(
            mapOf(
                "speed" to "Velocidade(km/h) 36",
                "altitude" to "Altitude(m) 4.5",
                "flowValue" to "Fluxo(L/Min) 3.2",
                "sprayedPesticide" to "Área(Ha) 1.75",
                "batteryRemain" to "33%",
                "spray_2_remain_capacity" to "4.20L",
                "signal" to "28"
            )
        )

        assertThat(result.speedKmh).isWithin(0.001).of(36.0)
        assertThat(result.speed).isWithin(0.001).of(10.0)
        assertThat(result.altitude).isWithin(0.001).of(4.5)
        assertThat(result.flowRate).isWithin(0.001).of(3.2)
        assertThat(result.hectaresApplied).isWithin(0.001).of(1.75)
        assertThat(result.batteryPercent).isEqualTo(33)
        assertThat(result.tankLiters).isWithin(0.001).of(4.2)
        assertThat(result.signalStrength).isEqualTo(28)
    }

    @Test
    fun `parse generic dji text keeps speed in ms and kmh`() {
        val result = parser.parseFromTexts(
            listOf(
                "Velocidade(km/h) 36",
                "Altitude(m) 4.5",
                "Fluxo(L/Min) 3.2",
                "Área(Ha) 1.75"
            )
        )

        assertThat(result.speedKmh).isWithin(0.001).of(36.0)
        assertThat(result.speed).isWithin(0.001).of(10.0)
        assertThat(result.altitude).isWithin(0.001).of(4.5)
        assertThat(result.flowRate).isWithin(0.001).of(3.2)
        assertThat(result.hectaresApplied).isWithin(0.001).of(1.75)
    }
}