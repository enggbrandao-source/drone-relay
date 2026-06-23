package com.dronemonitor.collector.util

import android.content.Context
import android.content.SharedPreferences

/**
 * Gerencia estado de crash e recuperacao do servico.
 * Persiste informacoes para reinicio automatico apos falhas.
 */
object CrashRecoveryManager {

    private const val PREFS_NAME = "crash_recovery"
    private const val KEY_CRASHED = "crashed"
    private const val KEY_CRASH_TIME = "crash_time"
    private const val KEY_CRASH_COUNT = "crash_count"
    private const val KEY_LAST_KNOWN_STATUS = "last_known_status"
    private const val MAX_CRASHES_BEFORE_BACKOFF = 5
    private const val BACKOFF_WINDOW_MS = 60000L // 1 minuto

    private fun prefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun markCrashed(context: Context) {
        val p = prefs(context)
        val now = System.currentTimeMillis()
        val lastCrash = p.getLong(KEY_CRASH_TIME, 0)
        val count = if (now - lastCrash < BACKOFF_WINDOW_MS) {
            p.getInt(KEY_CRASH_COUNT, 0) + 1
        } else {
            1
        }
        p.edit()
            .putBoolean(KEY_CRASHED, true)
            .putLong(KEY_CRASH_TIME, now)
            .putInt(KEY_CRASH_COUNT, count)
            .apply()
        FileLogger.e("CrashRecovery", "Crash recorded. Count=$count in last minute")
    }

    fun shouldAutoRecover(context: Context): Boolean {
        val p = prefs(context)
        if (!p.getBoolean(KEY_CRASHED, false)) return false
        val count = p.getInt(KEY_CRASH_COUNT, 0)
        return count < MAX_CRASHES_BEFORE_BACKOFF
    }

    fun clearCrashFlag(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_CRASHED, false)
            .putInt(KEY_CRASH_COUNT, 0)
            .apply()
    }

    fun saveMissionState(context: Context, state: String) {
        prefs(context).edit().putString(KEY_LAST_KNOWN_STATUS, state).apply()
    }

    fun getLastKnownStatus(context: Context): String? {
        return prefs(context).getString(KEY_LAST_KNOWN_STATUS, null)
    }

    fun getCrashCount(context: Context): Int {
        return prefs(context).getInt(KEY_CRASH_COUNT, 0)
    }
}
