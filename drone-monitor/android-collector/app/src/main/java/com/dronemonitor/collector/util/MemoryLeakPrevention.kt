package com.dronemonitor.collector.util

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.lang.ref.WeakReference

/**
 * Previne vazamentos de memoria em operacoes longas (8+ horas).
 * Registra ciclo de vida de activities e limpa referencias.
 */
object MemoryLeakPrevention : Application.ActivityLifecycleCallbacks {

    private val activities = mutableListOf<WeakReference<Activity>>()

    fun register(app: Application) {
        app.registerActivityLifecycleCallbacks(this)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        activities.add(WeakReference(activity))
        cleanupDeadReferences()
    }

    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

    override fun onActivityDestroyed(activity: Activity) {
        activities.removeAll { it.get() == activity || it.get() == null }
    }

    fun cleanupDeadReferences() {
        val before = activities.size
        activities.removeAll { it.get() == null }
        val removed = before - activities.size
        if (removed > 0) {
            FileLogger.d("MemoryLeakPrev", "Cleaned up $removed dead activity references")
        }
    }

    fun getActiveActivityCount(): Int {
        cleanupDeadReferences()
        return activities.count { it.get() != null }
    }

    fun suggestGcIfNeeded(memoryThresholdMb: Long = 200) {
        val runtime = Runtime.getRuntime()
        val usedMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
        val maxMb = runtime.maxMemory() / (1024 * 1024)
        if (usedMb > maxMb - memoryThresholdMb) {
            FileLogger.w("MemoryLeakPrev", "Memory pressure detected: $usedMb MB / $maxMb MB. Suggesting GC.")
            System.gc()
        }
    }
}
