package com.dronemonitor.collector.data

import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Test

class TelemetryDataTest {

    @Test
    fun `toJson serializes all fields correctly`() {
        val data = TelemetryData(
            timestamp = 1700000000000L,
            droneId = "DJI-T40",
            speed = 5.2,
            altitude = 12.5,
            sprayWidth = 8.0,
            flowRate = 2.4,
            hectaresApplied = 15.75,
            flightTime = 3600,
            rtkStatus = "Fix",
            signalStrength = 85,
            batteryPercent = 72,
            tankLevel = 45,
            latitude = -15.123456,
            longitude = -47.654321,
            operationalStatus = "spraying",
            systemAlerts = listOf("Bateria baixa")
        )

        val json = data.toJson()

        assertThat(json.getLong("ts")).isEqualTo(1700000000000L)
        assertThat(json.getString("id")).isEqualTo("DJI-T40")
        assertThat(json.getDouble("sp")).isWithin(0.001).of(5.2)
        assertThat(json.getDouble("alt")).isWithin(0.001).of(12.5)
        assertThat(json.getDouble("sw")).isWithin(0.001).of(8.0)
        assertThat(json.getDouble("fr")).isWithin(0.001).of(2.4)
        assertThat(json.getDouble("ha")).isWithin(0.001).of(15.75)
        assertThat(json.getInt("ft")).isEqualTo(3600)
        assertThat(json.getString("rtk")).isEqualTo("Fix")
        assertThat(json.getInt("sig")).isEqualTo(85)
        assertThat(json.getInt("bat")).isEqualTo(72)
        assertThat(json.getInt("tk")).isEqualTo(45)
        assertThat(json.getDouble("lat")).isWithin(0.000001).of(-15.123456)
        assertThat(json.getDouble("lon")).isWithin(0.000001).of(-47.654321)
        assertThat(json.getString("st")).isEqualTo("spraying")
        assertThat(json.getJSONArray("alerts").getString(0)).isEqualTo("Bateria baixa")
    }

    @Test
    fun `toJson omits null fields`() {
        val data = TelemetryData(
            timestamp = 1700000000000L,
            speed = 5.0
        )

        val json = data.toJson()

        assertThat(json.has("alt")).isFalse()
        assertThat(json.has("bat")).isFalse()
        assertThat(json.has("sp")).isTrue()
    }

    @Test
    fun `fromJson deserializes correctly`() {
        val json = JSONObject().apply {
            put("ts", 1700000000000L)
            put("id", "DJI-T50")
            put("sp", 6.3)
            put("alt", 20.0)
            put("bat", 50)
            put("tk", 30)
            put("st", "flying")
            put("alerts", org.json.JSONArray(listOf("Sinal fraco", "RTK perdido")))
        }

        val data = TelemetryData.fromJson(json)

        assertThat(data.timestamp).isEqualTo(1700000000000L)
        assertThat(data.droneId).isEqualTo("DJI-T50")
        assertThat(data.speed).isWithin(0.001).of(6.3)
        assertThat(data.altitude).isWithin(0.001).of(20.0)
        assertThat(data.batteryPercent).isEqualTo(50)
        assertThat(data.tankLevel).isEqualTo(30)
        assertThat(data.operationalStatus).isEqualTo("flying")
        assertThat(data.systemAlerts).containsExactly("Sinal fraco", "RTK perdido")
    }

    @Test
    fun `fromJson handles missing fields gracefully`() {
        val json = JSONObject().apply {
            put("ts", 1700000000000L)
            put("sp", 5.0)
        }

        val data = TelemetryData.fromJson(json)

        assertThat(data.speed).isWithin(0.001).of(5.0)
        assertThat(data.altitude).isNull()
        assertThat(data.batteryPercent).isNull()
        assertThat(data.systemAlerts).isEmpty()
    }

    @Test
    fun `fromJson handles NaN values as null`() {
        val json = JSONObject().apply {
            put("ts", 1700000000000L)
            put("sp", Double.NaN)
            put("alt", Double.NaN)
        }

        val data = TelemetryData.fromJson(json)

        assertThat(data.speed).isNull()
        assertThat(data.altitude).isNull()
    }

    @Test
    fun `fromJson handles empty string values as null`() {
        val json = JSONObject().apply {
            put("ts", 1700000000000L)
            put("rtk", "")
            put("st", "")
        }

        val data = TelemetryData.fromJson(json)

        assertThat(data.rtkStatus).isNull()
        assertThat(data.operationalStatus).isNull()
    }

    @Test
    fun `default values are set correctly`() {
        val data = TelemetryData()

        assertThat(data.droneId).isEqualTo("DJI-AGRAS")
        assertThat(data.systemAlerts).isEmpty()
        assertThat(data.timestamp).isGreaterThan(0L)
    }

    @Test
    fun `roundtrip serialization preserves data`() {
        val original = TelemetryData(
            speed = 7.5,
            altitude = 25.0,
            batteryPercent = 88,
            tankLevel = 60,
            operationalStatus = "spraying"
        )

        val json = original.toJson()
        val restored = TelemetryData.fromJson(json)

        assertThat(restored.speed).isWithin(0.001).of(original.speed!!)
        assertThat(restored.altitude).isWithin(0.001).of(original.altitude!!)
        assertThat(restored.batteryPercent).isEqualTo(original.batteryPercent)
        assertThat(restored.tankLevel).isEqualTo(original.tankLevel)
        assertThat(restored.operationalStatus).isEqualTo(original.operationalStatus)
    }
}
