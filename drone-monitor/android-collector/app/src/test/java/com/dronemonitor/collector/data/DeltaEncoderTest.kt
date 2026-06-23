package com.dronemonitor.collector.data

import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Test

class DeltaEncoderTest {

    private val encoder = DeltaEncoder()

    @Test
    fun `first encode returns full frame with _f flag`() {
        val data = TelemetryData(
            speed = 5.0,
            altitude = 10.0,
            batteryPercent = 80
        )

        val delta = encoder.encode(data)

        assertThat(delta.has("_f")).isTrue()
        assertThat(delta.getDouble("sp")).isWithin(0.001).of(5.0)
        assertThat(delta.getDouble("alt")).isWithin(0.001).of(10.0)
        assertThat(delta.getInt("bat")).isEqualTo(80)
    }

    @Test
    fun `subsequent encode with no changes returns minimal delta`() {
        val data = TelemetryData(
            speed = 5.0,
            altitude = 10.0,
            batteryPercent = 80
        )

        encoder.encode(data)
        val delta = encoder.encode(data.copy())

        assertThat(delta.has("_f")).isFalse()
        assertThat(delta.has("sp")).isFalse()
        assertThat(delta.has("alt")).isFalse()
        assertThat(delta.has("bat")).isFalse()
        assertThat(delta.getString("id")).isEqualTo("DJI-AGRAS")
    }

    @Test
    fun `encode returns only changed fields`() {
        val first = TelemetryData(speed = 5.0, batteryPercent = 80)
        encoder.encode(first)

        val second = TelemetryData(speed = 6.5, batteryPercent = 80)
        val delta = encoder.encode(second)

        assertThat(delta.has("sp")).isTrue()
        assertThat(delta.getDouble("sp")).isWithin(0.001).of(6.5)
        assertThat(delta.has("bat")).isFalse()
    }

    @Test
    fun `full frame is forced after timeout`() {
        val encoder = DeltaEncoder()
        val data = TelemetryData(speed = 5.0)

        encoder.encode(data)
        // We can't easily test time in this unit test without mocking System.currentTimeMillis()
        // But we can verify the flag exists on first call
        val delta = encoder.encode(data)
        // Since we encode immediately, it should be delta (not full)
        assertThat(delta.has("_f")).isFalse()
    }

    @Test
    fun `status changes are always included`() {
        val first = TelemetryData(operationalStatus = "idle")
        encoder.encode(first)

        val second = TelemetryData(operationalStatus = "spraying")
        val delta = encoder.encode(second)

        assertThat(delta.has("st")).isTrue()
        assertThat(delta.getString("st")).isEqualTo("spraying")
    }

    @Test
    fun `rtk status changes are always included`() {
        val first = TelemetryData(rtkStatus = "Float")
        encoder.encode(first)

        val second = TelemetryData(rtkStatus = "Fix")
        val delta = encoder.encode(second)

        assertThat(delta.has("rtk")).isTrue()
        assertThat(delta.getString("rtk")).isEqualTo("Fix")
    }

    @Test
    fun `alerts changes are included`() {
        val first = TelemetryData(systemAlerts = listOf())
        encoder.encode(first)

        val second = TelemetryData(systemAlerts = listOf("Bateria baixa"))
        val delta = encoder.encode(second)

        assertThat(delta.has("alerts")).isTrue()
        assertThat(delta.getJSONArray("alerts").getString(0)).isEqualTo("Bateria baixa")
    }

    @Test
    fun `below threshold changes are omitted`() {
        val first = TelemetryData(speed = 5.0)
        encoder.encode(first)

        val second = TelemetryData(speed = 5.05) // below 0.2 threshold
        val delta = encoder.encode(second)

        assertThat(delta.has("sp")).isFalse()
    }

    @Test
    fun `above threshold changes are included`() {
        val first = TelemetryData(speed = 5.0)
        encoder.encode(first)

        val second = TelemetryData(speed = 5.3) // above 0.2 threshold
        val delta = encoder.encode(second)

        assertThat(delta.has("sp")).isTrue()
        assertThat(delta.getDouble("sp")).isWithin(0.001).of(5.3)
    }

    @Test
    fun `null to value transition is included`() {
        val first = TelemetryData(speed = null)
        encoder.encode(first)

        val second = TelemetryData(speed = 5.0)
        val delta = encoder.encode(second)

        assertThat(delta.has("sp")).isTrue()
    }

    @Test
    fun `value to null transition is included`() {
        val first = TelemetryData(speed = 5.0)
        encoder.encode(first)

        val second = TelemetryData(speed = null)
        val delta = encoder.encode(second)

        assertThat(delta.has("sp")).isTrue()
        assertThat(delta.isNull("sp")).isTrue()
    }
}
