package com.dronemonitor.collector.util

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import org.json.JSONObject

/**
 * Captura localizacao do RC Plus via multiplas estrategias:
 * 1. GPS_PROVIDER nativo (melhor precisao)
 * 2. FusedLocationProvider (Google Play Services)
 * 3. lastKnownLocation de todos os providers
 * 4. PASSIVE_PROVIDER (escuta outros apps usando GPS)
 * 
 * O RC Plus tem GPS funcional, mas pode demorar a fixar quando ligado.
 * O DJI Agras tambem usa GPS, entao o PASSIVE_PROVIDER pode capturar isso.
 */
object GpsLocationHelper {
    private const val TAG = "GpsLocationHelper"

    @Volatile
    private var lastLatitude: Double? = null
    @Volatile
    private var lastLongitude: Double? = null
    @Volatile
    private var lastAccuracy: Float? = null
    @Volatile
    private var hasFix = false

    fun start(context: Context) {
        try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return

            // 1) Tenta obter lastKnownLocation imediatamente (mais rapido)
            try {
                val lastGps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                if (lastGps != null) {
                    save(lastGps)
                    FileLogger.i(TAG, "lastKnownLocation GPS: ${lastGps.latitude},${lastGps.longitude}")
                }
            } catch (_: SecurityException) {}

            // 2) PASSIVE_PROVIDER - escuta localizacoes de outros apps (DJI Agras!)
            try {
                val passiveCallback = object : android.location.LocationListener {
                    override fun onLocationChanged(location: Location) {
                        save(location)
                        FileLogger.i(TAG, "PASSIVE_PROVIDER recebeu: ${location.latitude},${location.longitude}")
                    }
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                }
                lm.requestLocationUpdates(
                    LocationManager.PASSIVE_PROVIDER, 1000L, 0f, passiveCallback, Looper.getMainLooper()
                )
                FileLogger.i(TAG, "PASSIVE_PROVIDER registrado (escuta DJI Agras)")
            } catch (e: SecurityException) {
                FileLogger.w(TAG, "Sem permissao para PASSIVE_PROVIDER", e)
            } catch (e: IllegalArgumentException) {
                FileLogger.w(TAG, "PASSIVE_PROVIDER nao disponivel", e)
            }

            // 3) Registra listener para GPS_PROVIDER (funciona no RC Plus)
            val gpsCallback = object : android.location.LocationListener {
                override fun onLocationChanged(location: Location) {
                    save(location)
                    hasFix = true
                    FileLogger.i(TAG, "GPS_PROVIDER atualizado: ${location.latitude},${location.longitude} (acc=${location.accuracy}m)")
                }
                override fun onProviderEnabled(provider: String) {
                    FileLogger.i(TAG, "GPS_PROVIDER habilitado")
                }
                override fun onProviderDisabled(provider: String) {
                    FileLogger.w(TAG, "GPS_PROVIDER desabilitado")
                }
            }
            try {
                lm.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 2000L, 1f, gpsCallback, Looper.getMainLooper()
                )
                FileLogger.i(TAG, "GPS_PROVIDER registrado com sucesso")
            } catch (e: SecurityException) {
                FileLogger.w(TAG, "Sem permissao para GPS_PROVIDER", e)
            } catch (e: IllegalArgumentException) {
                FileLogger.w(TAG, "GPS_PROVIDER nao disponivel", e)
            }

            // 4) NETWORK_PROVIDER como fallback (se existir)
            try {
                lm.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 5000L, 10f, gpsCallback, Looper.getMainLooper()
                )
                FileLogger.i(TAG, "NETWORK_PROVIDER registrado")
            } catch (_: Exception) {
                FileLogger.d(TAG, "NETWORK_PROVIDER nao disponivel (normal no RC Plus)")
            }

        } catch (e: Exception) {
            FileLogger.w(TAG, "Erro ao iniciar GPS", e)
        }
    }

    private fun save(location: Location) {
        lastLatitude = location.latitude
        lastLongitude = location.longitude
        lastAccuracy = location.accuracy
        FileLogger.i(TAG, "Localizacao salva: ${location.latitude},${location.longitude} (acc=${location.accuracy}m, provider=${location.provider})")
    }

    fun fill(context: Context, json: JSONObject) {
        // Se ja tem coordenadas em cache, usa
        if (lastLatitude != null && lastLongitude != null) {
            json.put("latitude", lastLatitude!!)
            json.put("longitude", lastLongitude!!)
            lastAccuracy?.let { json.put("locationAccuracy", it) }
            return
        }

        // Tenta lastKnownLocation de TODOS os providers (incluindo PASSIVE)
        try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
            var best: Location? = null
            for (provider in lm.getProviders(true)) {
                try {
                    val loc = lm.getLastKnownLocation(provider) ?: continue
                    FileLogger.d(TAG, "Provider '$provider': ${loc.latitude},${loc.longitude} (acc=${loc.accuracy})")
                    if (best == null || loc.accuracy < best.accuracy) best = loc
                } catch (_: SecurityException) {}
            }
            best?.let {
                save(it)
                json.put("latitude", it.latitude)
                json.put("longitude", it.longitude)
                json.put("locationAccuracy", it.accuracy)
                json.put("locationProvider", it.provider)
                FileLogger.i(TAG, "lastKnownLocation usado: ${it.latitude},${it.longitude} (provider=${it.provider})")
                return
            }
        } catch (_: SecurityException) {}

        FileLogger.w(TAG, "Nenhuma localizacao GPS disponivel (aguardando fix...)")
    }

    fun hasLocation(): Boolean = lastLatitude != null && lastLongitude != null

    fun getLocation(): Pair<Double, Double>? {
        return if (lastLatitude != null && lastLongitude != null) {
            Pair(lastLatitude!!, lastLongitude!!)
        } else null
    }

    fun stop(context: Context) {
        try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
            lm.removeUpdates(object : android.location.LocationListener {
                override fun onLocationChanged(location: Location) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
            })
        } catch (_: Exception) {}
    }
}