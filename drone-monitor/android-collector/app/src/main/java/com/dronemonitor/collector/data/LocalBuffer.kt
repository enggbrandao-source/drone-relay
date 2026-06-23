package com.dronemonitor.collector.data

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Buffer local para persistir dados quando offline.
 * Utiliza SharedPreferences como fila circular simples.
 */
class LocalBuffer(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val maxSize = MAX_BUFFER_SIZE

    @Synchronized
    fun enqueue(data: JSONObject) {
        val list = getQueue().toMutableList()
        list.add(data.toString())
        if (list.size > maxSize) {
            list.removeAt(0)
        }
        saveQueue(list)
    }

    @Synchronized
    fun dequeueAll(): List<JSONObject> {
        val list = getQueue()
        clear()
        return list.mapNotNull {
            try {
                JSONObject(it)
            } catch (_: Exception) {
                null
            }
        }
    }

    @Synchronized
    fun size(): Int = getQueue().size

    @Synchronized
    fun clear() {
        prefs.edit().remove(KEY_QUEUE).apply()
    }

    private fun getQueue(): List<String> {
        val json = prefs.getString(KEY_QUEUE, "[]") ?: "[]"
        return try {
            val arr = JSONArray(json)
            List(arr.length()) { arr.getString(it) }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun saveQueue(list: List<String>) {
        val arr = JSONArray(list)
        prefs.edit().putString(KEY_QUEUE, arr.toString()).apply()
    }

    companion object {
        private const val PREFS_NAME = "drone_buffer"
        private const val KEY_QUEUE = "queue"
        private const val MAX_BUFFER_SIZE = 500
    }
}
