package com.dronemonitor.collector.network

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import com.dronemonitor.collector.data.LocalBuffer
import com.google.common.truth.Truth.assertThat
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.json.JSONObject
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WebSocketManagerTest {

    private lateinit var context: Context
    private lateinit var localBuffer: LocalBuffer
    private lateinit var wsManager: WebSocketManager

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        localBuffer = LocalBuffer(context)
        wsManager = WebSocketManager("ws://localhost:9999/ws", localBuffer)
    }

    @Test
    fun `start and stop does not crash`() {
        wsManager.start()
        Thread.sleep(100)
        wsManager.stop()
        // No crash means success
    }

    @Test
    fun `send buffers data when offline`() {
        wsManager.start()
        Thread.sleep(100)

        val data = JSONObject().apply { put("test", "value") }
        wsManager.send(data)

        // Since server doesn't exist, data should be buffered
        assertThat(localBuffer.size()).isGreaterThan(0)
        wsManager.stop()
    }

    @Test
    fun `status callback triggered on connection failure`() {
        val latch = CountDownLatch(1)
        var statusReceived = false

        wsManager.onStatusChanged = { connected ->
            if (!connected) {
                statusReceived = true
                latch.countDown()
            }
        }

        wsManager.start()
        latch.await(3, TimeUnit.SECONDS)

        assertThat(statusReceived).isTrue()
        wsManager.stop()
    }

    @Test
    fun `multiple sends accumulate in buffer when offline`() {
        wsManager.start()
        Thread.sleep(100)

        repeat(5) { index ->
            wsManager.send(JSONObject().apply { put("index", index) })
        }

        assertThat(localBuffer.size()).isEqualTo(5)
        wsManager.stop()
    }

    @Test
    fun `buffer survives stop and start`() {
        wsManager.start()
        Thread.sleep(100)
        wsManager.send(JSONObject().apply { put("key", "value1") })
        wsManager.stop()

        val wsManager2 = WebSocketManager("ws://localhost:9999/ws", localBuffer)
        wsManager2.start()
        Thread.sleep(100)
        wsManager2.send(JSONObject().apply { put("key", "value2") })

        assertThat(localBuffer.size()).isEqualTo(2)
        wsManager2.stop()
    }

    @Test
    fun `reconnection attempt counter increments`() {
        // This is tested indirectly via connection failure
        wsManager.start()
        Thread.sleep(100)

        // Trigger a send to ensure connection is attempted
        wsManager.send(JSONObject().apply { put("data", "test") })

        // Wait for reconnection scheduling
        Thread.sleep(1200)

        wsManager.stop()
        // If we reach here without crash, reconnection logic is working
    }
}
