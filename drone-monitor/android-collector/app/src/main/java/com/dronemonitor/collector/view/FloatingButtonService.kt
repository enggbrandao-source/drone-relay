package com.dronemonitor.collector.view

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.*
import android.widget.*
import com.dronemonitor.collector.R
import com.dronemonitor.collector.service.DroneCollectorService
import com.dronemonitor.collector.util.FileLogger

/**
 * Botao flutuante sobreposto ao DJI SmartFarm.
 * Permite iniciar/parar monitoramento sem trocar de tela.
 */
class FloatingButtonService : Service() {

    private lateinit var windowManager: WindowManager
    private var floatingView: View? = null
    private var params: WindowManager.LayoutParams? = null

    private var isMonitoring = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        FileLogger.i(TAG, "FloatingButtonService onCreate")
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        showFloatingButton()
    }

    private fun showFloatingButton() {
        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        }

        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 16
            y = 200
        }

        floatingView = LayoutInflater.from(this).inflate(R.layout.floating_button, null)
        val btn = floatingView!!.findViewById<Button>(R.id.floatingBtn)
        val btnClose = floatingView!!.findViewById<ImageButton>(R.id.floatingClose)

        updateButtonState(btn)

        btn.setOnClickListener {
            if (isMonitoring) {
                stopService(Intent(this, DroneCollectorService::class.java))
                isMonitoring = false
                Toast.makeText(this, "Monitoramento parado", Toast.LENGTH_SHORT).show()
            } else {
                startForegroundService(Intent(this, DroneCollectorService::class.java))
                isMonitoring = true
                Toast.makeText(this, "Monitoramento iniciado!", Toast.LENGTH_SHORT).show()
            }
            updateButtonState(btn)
        }

        btnClose.setOnClickListener {
            stopSelf()
        }

        // Arrastar o botão
        var initialX = 0
        var initialY = 0
        var touchX = 0f
        var touchY = 0f

        floatingView!!.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params!!.x
                    initialY = params!!.y
                    touchX = event.rawX
                    touchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params!!.x = initialX + (event.rawX - touchX).toInt()
                    params!!.y = initialY + (event.rawY - touchY).toInt()
                    windowManager.updateViewLayout(floatingView, params)
                    true
                }
                else -> false
            }
        }

        windowManager.addView(floatingView, params)
    }

    private fun updateButtonState(btn: Button) {
        if (isMonitoring) {
            btn.text = "PARAR"
            btn.setBackgroundColor(0xFFFF6B2C.toInt()) // laranja
        } else {
            btn.text = "INICIAR"
            btn.setBackgroundColor(0xFF00FF88.toInt()) // verde
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        floatingView?.let { windowManager.removeView(it) }
    }

    companion object {
        private const val TAG = "FloatingBtn"

        fun canDrawOverlays(context: Context): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(context)
            } else true
        }

        fun requestOverlayPermission(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}")
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
        }
    }
}
