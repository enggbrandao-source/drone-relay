package com.dronemonitor.collector.data

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocalBufferTest {

    private lateinit var context: Context
    private lateinit var buffer: LocalBuffer

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        buffer = LocalBuffer(context)
        buffer.clear()
    }

    @Test
    fun `enqueue adds items`() {
        buffer.enqueue(JSONObject().apply { put("key", "value1") })
        buffer.enqueue(JSONObject().apply { put("key", "value2") })

        assertThat(buffer.size()).isEqualTo(2)
    }

    @Test
    fun `dequeueAll returns all items and clears buffer`() {
        buffer.enqueue(JSONObject().apply { put("key", "value1") })
        buffer.enqueue(JSONObject().apply { put("key", "value2") })

        val items = buffer.dequeueAll()

        assertThat(items).hasSize(2)
        assertThat(buffer.size()).isEqualTo(0)
    }

    @Test
    fun `dequeueAll on empty buffer returns empty list`() {
        val items = buffer.dequeueAll()
        assertThat(items).isEmpty()
    }

    @Test
    fun `buffer respects max size limit`() {
        // Enqueue more than max size (500)
        repeat(510) { index ->
            buffer.enqueue(JSONObject().apply { put("index", index) })
        }

        assertThat(buffer.size()).isEqualTo(500)

        val items = buffer.dequeueAll()
        // Oldest items should have been removed
        assertThat(items[0].getInt("index")).isEqualTo(10)
    }

    @Test
    fun `clear removes all items`() {
        buffer.enqueue(JSONObject().apply { put("key", "value") })
        buffer.clear()
        assertThat(buffer.size()).isEqualTo(0)
    }

    @Test
    fun `buffer persists across instances`() {
        buffer.enqueue(JSONObject().apply { put("key", "persistent") })

        val newBuffer = LocalBuffer(context)
        val items = newBuffer.dequeueAll()

        assertThat(items).hasSize(1)
        assertThat(items[0].getString("key")).isEqualTo("persistent")
    }

    @Test
    fun `handles invalid JSON gracefully`() {
        // Directly corrupt the SharedPreferences
        val prefs = context.getSharedPreferences("drone_buffer", Context.MODE_PRIVATE)
        prefs.edit().putString("queue", "[invalid json").apply()

        val newBuffer = LocalBuffer(context)
        assertThat(newBuffer.size()).isEqualTo(0)
        assertThat(newBuffer.dequeueAll()).isEmpty()
    }
}
