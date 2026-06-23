package com.dronemonitor.collector.util

import android.content.Context
import android.os.Environment
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Logger persistente em arquivo para diagnostico em campo.
 * Rotaciona logs automaticamente e limita tamanho total.
 */
object FileLogger {

    private const val MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024L // 5MB
    private const val MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024L // 20MB
    private const val TAG = "FileLogger"

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    private val logQueue = ConcurrentLinkedQueue<String>()
    private val executor = Executors.newSingleThreadExecutor()
    private val scheduledExecutor = ScheduledThreadPoolExecutor(1)
    private var logDir: File? = null
    private var currentLogFile: File? = null
    private var isInitialized = false

    @JvmStatic
    fun init(context: Context) {
        if (isInitialized) return
        logDir = File(context.getExternalFilesDir(null), "logs").apply { mkdirs() }
        currentLogFile = File(logDir, "collector_${System.currentTimeMillis()}.log")
        isInitialized = true

        // Flush periodico
        scheduledExecutor.scheduleWithFixedDelay({ flush() }, 5, 5, TimeUnit.SECONDS)

        i(TAG, "FileLogger initialized at ${logDir?.absolutePath}")
    }

    @JvmStatic
    fun d(tag: String, message: String) {
        Log.d(tag, message)
        enqueue("D", tag, message)
    }

    @JvmStatic
    fun i(tag: String, message: String) {
        Log.i(tag, message)
        enqueue("I", tag, message)
    }

    @JvmStatic
    fun w(tag: String, message: String, throwable: Throwable? = null) {
        Log.w(tag, message, throwable)
        enqueue("W", tag, "$message ${throwable?.message ?: ""}")
    }

    @JvmStatic
    fun e(tag: String, message: String, throwable: Throwable? = null) {
        Log.e(tag, message, throwable)
        enqueue("E", tag, "$message ${throwable?.stackTraceToString() ?: ""}")
    }

    private fun enqueue(level: String, tag: String, message: String) {
        if (!isInitialized) return
        val timestamp = dateFormat.format(Date())
        logQueue.offer("$timestamp [$level] $tag: $message")
    }

    @Synchronized
    private fun flush() {
        if (!isInitialized || currentLogFile == null) return
        try {
            val logs = mutableListOf<String>()
            while (true) {
                val log = logQueue.poll() ?: break
                logs.add(log)
            }
            if (logs.isEmpty()) return

            currentLogFile?.appendText(logs.joinToString("\n") + "\n")

            // Rotacao se ultrapassar limite
            if ((currentLogFile?.length() ?: 0) > MAX_LOG_SIZE_BYTES) {
                rotateLog()
            }

            cleanupOldLogs()
        } catch (e: Exception) {
            Log.e(TAG, "Flush failed", e)
        }
    }

    private fun rotateLog() {
        currentLogFile = File(logDir, "collector_${System.currentTimeMillis()}.log")
    }

    private fun cleanupOldLogs() {
        val dir = logDir ?: return
        val files = dir.listFiles()?.sortedBy { it.lastModified() } ?: return
        var totalSize = files.sumOf { it.length() }

        for (file in files) {
            if (totalSize <= MAX_TOTAL_SIZE_BYTES) break
            if (file != currentLogFile) {
                totalSize -= file.length()
                file.delete()
            }
        }
    }

    @JvmStatic
    fun exportLogs(): File? {
        flush()
        val dir = logDir ?: return null
        val exportFile = File(dir.parentFile, "drone_collector_logs_${System.currentTimeMillis()}.txt")
        try {
            dir.listFiles()?.sortedBy { it.lastModified() }?.forEach { file ->
                exportFile.appendText("=== ${file.name} ===\n")
                exportFile.appendText(file.readText())
                exportFile.appendText("\n\n")
            }
            return exportFile
        } catch (e: Exception) {
            Log.e(TAG, "Export failed", e)
            return null
        }
    }

    @JvmStatic
    fun clearLogs() {
        logDir?.listFiles()?.forEach { it.delete() }
        rotateLog()
    }

    @JvmStatic
    fun getLogsDirectory(): File? = logDir
}
