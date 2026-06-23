package com.dronemonitor.collector

import android.Manifest
import android.app.ActivityManager
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.dronemonitor.collector.service.DroneCollectorService
import com.dronemonitor.collector.ui.DiagnosticsActivity
import com.dronemonitor.collector.ui.OperatorModeActivity
import com.dronemonitor.collector.util.CrashRecoveryManager
import com.dronemonitor.collector.util.FileLogger
import com.dronemonitor.collector.util.ThemeManager

/**
 * Atividade principal para configuracao e status do coletor.
 * Otimizada para DJI RC Plus: landscape, immersive, botoes grandes para luvas.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var etServerUrl: EditText
    private lateinit var etDroneCode: EditText
    private lateinit var etPilotName: EditText
    private lateinit var etFarmName: EditText
    private lateinit var etLocation: EditText
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button
    private lateinit var btnDiagnostics: Button
    private lateinit var btnOperatorMode: Button
    private lateinit var btnQuickExportLogs: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvGatewayInfo: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ThemeManager.applyTheme(this)
        enableImmersiveMode()
        keepScreenOn()
        setContentView(R.layout.activity_main)

        requestLocationPermission()

        bindViews()
        loadConfig()
        displayGatewayInfo()
        setupListeners()
        checkCrashRecovery()
        checkAccessibility()

        FileLogger.i("MainActivity", "Activity criada v${BuildConfig.VERSION_NAME}")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableImmersiveMode()
    }

    override fun onDestroy() {
        super.onDestroy()
        ThemeManager.release()
    }

    private fun enableImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
    }

    private fun keepScreenOn() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun bindViews() {
        etServerUrl = findViewById(R.id.etServerUrl)
        etDroneCode = findViewById(R.id.etDroneCode)
        etPilotName = findViewById(R.id.etPilotName)
        etFarmName = findViewById(R.id.etFarmName)
        etLocation = findViewById(R.id.etLocation)
        btnStart = findViewById(R.id.btnStart)
        btnStop = findViewById(R.id.btnStop)
        btnDiagnostics = findViewById(R.id.btnDiagnostics)
        btnOperatorMode = findViewById(R.id.btnOperatorMode)
        btnQuickExportLogs = findViewById(R.id.btnQuickExportLogs)
        tvStatus = findViewById(R.id.tvStatus)
        tvGatewayInfo = findViewById(R.id.tvGatewayInfo)
    }

    private fun displayGatewayInfo() {
        val ip = getDeviceIpAddress()
        val port = com.dronemonitor.collector.network.TelemetryWebSocketServer.DEFAULT_PORT
        tvGatewayInfo.text = "Gateway RC Plus: ws://$ip:$port/ws\nConecte o dashboard neste endereco"
    }

    private fun getDeviceIpAddress(): String {
        return try {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val ipInt = wifiManager?.connectionInfo?.ipAddress ?: 0
            if (ipInt == 0) {
                java.net.NetworkInterface.getNetworkInterfaces().toList()
                    .flatMap { it.inetAddresses.toList() }
                    .firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains(".") == true }
                    ?.hostAddress ?: "0.0.0.0"
            } else {
                String.format("%d.%d.%d.%d", ipInt and 0xFF, ipInt shr 8 and 0xFF, ipInt shr 16 and 0xFF, ipInt shr 24 and 0xFF)
            }
        } catch (e: Exception) {
            "0.0.0.0"
        }
    }

    private fun setupListeners() {
        btnStart.setOnClickListener {
            saveConfig()
            try {
                startCollectorService()
                updateStatus("Iniciando servico...")
                Toast.makeText(this, "Iniciando servico...", Toast.LENGTH_SHORT).show()
                FileLogger.i("MainActivity", "Monitoramento iniciado pelo usuario")

                // Verifica em 2s se o servico realmente iniciou
                Handler(Looper.getMainLooper()).postDelayed({
                    val running = isServiceRunning()
                    if (running) {
                        updateStatus("Gateway ATIVO em ws://${getDeviceIpAddress()}:8080/ws")
                        Toast.makeText(this, "Servico rodando! Conecte o dashboard ao IP exibido.", Toast.LENGTH_LONG).show()
                    } else {
                        updateStatus("FALHA ao iniciar - veja logs em DIAGNOSTICO")
                        Toast.makeText(this, "Servico nao iniciou. Verifique permissoes.", Toast.LENGTH_LONG).show()
                    }
                }, 2000)
            } catch (e: Exception) {
                FileLogger.e("MainActivity", "Erro ao iniciar servico", e)
                Toast.makeText(this, "Erro: ${e.message}", Toast.LENGTH_LONG).show()
                updateStatus("Erro: ${e.message}")
            }
        }

        btnStop.setOnClickListener {
            stopCollectorService()
            updateStatus("Servico parado")
            Toast.makeText(this, "Servico parado", Toast.LENGTH_SHORT).show()
            FileLogger.i("MainActivity", "Monitoramento parado pelo usuario")
        }

        btnDiagnostics.setOnClickListener {
            startActivity(Intent(this, DiagnosticsActivity::class.java))
        }

        btnOperatorMode?.setOnClickListener {
            OperatorModeActivity.launch(this)
        }

        btnQuickExportLogs.setOnClickListener {
            try {
                val file = com.dronemonitor.collector.util.FileLogger.exportLogs()
                if (file != null) {
                    val msg = "Logs salvos:\n${file.absolutePath}"
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                    updateStatus("Logs exportados: ${file.name}")
                    FileLogger.i("MainActivity", "Quick export: ${file.absolutePath}")
                } else {
                    Toast.makeText(this, "Falha ao exportar logs", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this, "Erro: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun isServiceRunning(): Boolean {
        return try {
            val manager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            manager.getRunningServices(Integer.MAX_VALUE).any {
                it.service.className == DroneCollectorService::class.java.name
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun checkCrashRecovery() {
        if (CrashRecoveryManager.shouldAutoRecover(this)) {
            Toast.makeText(this, "Recuperando apos falha...", Toast.LENGTH_LONG).show()
            CrashRecoveryManager.clearCrashFlag(this)
            startCollectorService()
            updateStatus("Recuperando apos falha")
        }
    }

    private fun checkAccessibility() {
        if (!isAccessibilityServiceEnabled()) {
            Toast.makeText(this, "Ative o servico de acessibilidade para coleta", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
    }

    private fun startCollectorService() {
        val intent = Intent(this, DroneCollectorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopCollectorService() {
        stopService(Intent(this, DroneCollectorService::class.java))
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val service = packageName + "/" + getString(R.string.accessibility_service_class)
        val enabledServices = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return enabledServices.contains(service)
    }

    private fun saveConfig() {
        getSharedPreferences("collector_prefs", Context.MODE_PRIVATE).edit()
            .putString("server_url", etServerUrl.text.toString())
            .putString("drone_code", etDroneCode.text.toString())
            .putString("pilot_name", etPilotName.text.toString())
            .putString("farm_name", etFarmName.text.toString())
            .putString("manual_location", etLocation.text.toString())
            .apply()
    }

    private fun loadConfig() {
        val prefs = getSharedPreferences("collector_prefs", Context.MODE_PRIVATE)
        etServerUrl.setText(prefs.getString("server_url", "ws://192.168.1.100:8080/ws"))
        etDroneCode.setText(prefs.getString("drone_code", "AGRAS001"))
        etPilotName.setText(prefs.getString("pilot_name", ""))
        etFarmName.setText(prefs.getString("farm_name", ""))
        etLocation.setText(prefs.getString("manual_location", ""))
    }

    private fun updateStatus(msg: String) {
        tvStatus.text = "Status: $msg"
    }

    private fun requestLocationPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), 1001)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1001) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                FileLogger.i("MainActivity", "Permissao de localizacao concedida")
                Toast.makeText(this, "GPS ativado! Localizacao sera enviada.", Toast.LENGTH_LONG).show()
            } else {
                FileLogger.w("MainActivity", "Permissao de localizacao negada")
                Toast.makeText(this, "Permissao de localizacao negada. O mapa nao funcionara.", Toast.LENGTH_LONG).show()
            }
        }
    }
}
