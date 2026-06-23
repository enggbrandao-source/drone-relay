package com.dronemonitor.collector.util

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.dronemonitor.collector.service.DroneCollectorService

/**
 * Receiver que escuta broadcast interno para recuperacao de crash.
 */
class CrashRecoveryReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == ACTION_RECOVER) {
            FileLogger.i("CrashRecovery", "Received recovery broadcast")
            if (CrashRecoveryManager.shouldAutoRecover(context)) {
                CrashRecoveryManager.clearCrashFlag(context)
                val serviceIntent = Intent(context, DroneCollectorService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                FileLogger.i("CrashRecovery", "Service restarted after crash")
            }
        }
    }

    companion object {
        const val ACTION_RECOVER = "com.dronemonitor.collector.ACTION_RECOVER_SERVICE"
    }
}
