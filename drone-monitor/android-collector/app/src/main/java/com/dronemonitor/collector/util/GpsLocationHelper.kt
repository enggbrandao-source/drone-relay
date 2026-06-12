package com.dronemonitor.collector.util

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import org.json.JSONObject

/**
 * Captura localizacao aproximada do RC Plus via GPS/Rede.
 * Sem dependencia do Google Play Services - usa LocationManager nativo.
 */
object GpsLocationHelper {
    private const val TAG = "GpsLocationHelper"

    @Volatile
    private var lastLatitude: Double? = null
    @Volatile
    private var lastLongitude: Double? = null

    fun start(context: Context) {
        try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
            val callback = android.location.LocationListener { location -> save(location) }
            try {
                lm.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 5000L, 10f, callback, Looper.getMainLooper()
                )
            } catch (_: SecurityException) {}
            try {
                lm.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 5000L, 10f, callback, Looper.getMainLooper()
                )
            } catch (_: SecurityException) {}
            FileLogger.i(TAG, "GPS listener iniciado")
        } catch (e: Exception) {
            FileLogger.w(TAG, "Erro ao iniciar GPS", e)
        }
    }

    private fun save(location: Location) {
        lastLatitude = location.latitude
        lastLongitude = location.longitude
        FileLogger.d(TAG, "Localizacao: ${location.latitude},${location.longitude}")
    }

    fun fill(context: Context, json: JSONObject) {
        if (lastLatitude == null) {
            try {
                val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
                var best: Location? = null
                for (provider in lm.getProviders(true)) {
                    val loc = lm.getLastKnownLocation(provider) ?: continue
                    if (best == null || loc.accuracy < best.accuracy) best = loc
                }
                best?.let { save(it) }
            } catch (_: SecurityException) {}
        }
        lastLatitude?.let { json.put("latitude", it) }
        lastLongitude?.let { json.put("longitude", it) }
    }

    fun stop(context: Context) {
        try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
            lm.removeUpdates(object : android.location.LocationListener {
                override fun onLocationChanged(location: Location) {}
            })
        } catch (_: Exception) {}
    }
}
