import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, LayerGroup, MapContainer, Marker, Polygon, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Props {
  apiUrl: string;
  token: string;
}

import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const FALLBACK_CENTER: [number, number] = [-15.7975, -47.8919];

declare global {
  interface Window {
    google?: any;
    __agryonGoogleMapsReady?: () => void;
  }
}

function fmt(value: any, digits: number) {
  if (value == null || value === '') return '--';
  if (typeof value === 'number') return value.toFixed(digits);
  return value;
}

function createWorkAreaCoordinates(lat: number, lon: number, hectares?: number | null): [number, number][] {
  const size = hectares ? Math.sqrt(hectares) * 0.00045 : 0.0009;
  return [
    [lat - size, lon - size],
    [lat - size, lon + size],
    [lat + size, lon + size],
    [lat + size, lon - size]
  ];
}

function loadScriptOnce(src: string, marker: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[data-agryon-script="${marker}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.agryonScript = marker;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar script: ${marker}`));
    document.head.appendChild(script);
  });
}

function loadGoogleMapsApi(apiKey: string) {
  return new Promise<boolean>((resolve) => {
    if (!apiKey) {
      resolve(false);
      return;
    }
    if (window.google?.maps) {
      resolve(true);
      return;
    }
    const existing = document.querySelector('script[data-agryon-script="google-maps-api"]');
    if (existing) {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        if (window.google?.maps) {
          window.clearInterval(interval);
          resolve(true);
        } else if (Date.now() - startedAt > 12000) {
          window.clearInterval(interval);
          resolve(false);
        }
      }, 150);
      return;
    }
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    window.__agryonGoogleMapsReady = () => {
      finish(Boolean(window.google?.maps));
      delete window.__agryonGoogleMapsReady;
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&callback=__agryonGoogleMapsReady`;
    script.async = true;
    script.defer = true;
    script.dataset.agryonScript = 'google-maps-api';
    script.onerror = () => {
      finish(false);
      delete window.__agryonGoogleMapsReady;
    };
    document.head.appendChild(script);
    window.setTimeout(() => {
      finish(Boolean(window.google?.maps));
      delete window.__agryonGoogleMapsReady;
    }, 12000);
  });
}

async function ensureGoogleMapLayers(apiKey: string) {
  if (!apiKey) return false;
  if (window.google?.maps && typeof (L.gridLayer as any).googleMutant === 'function') return true;
  try {
    await loadScriptOnce('https://unpkg.com/leaflet.gridlayer.googlemutant@0.13.6/Leaflet.GoogleMutant.js', 'google-mutant');
    return await loadGoogleMapsApi(apiKey);
  } catch {
    return false;
  }
}

function createEsriWorldImageryLayer() {
  return L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    })
  ]);
}

function createOpenStreetMapLayer() {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });
}

function MapBaseLayers({ apiKey, onGoogleReady }: { apiKey: string; onGoogleReady: (value: boolean) => void }) {
  const map = useMap();
  const controlRef = useRef<L.Control.Layers | null>(null);

  useEffect(() => {
    let cancelled = false;
    let allLayers: L.Layer[] = [];

    async function setupLayers() {
      const googleReady = await ensureGoogleMapLayers(apiKey);
      if (cancelled) return;

      const baseLayers: Record<string, L.Layer> = {};
      if (googleReady && typeof (L.gridLayer as any).googleMutant === 'function') {
        baseLayers['Google Hybrid'] = (L.gridLayer as any).googleMutant({ type: 'hybrid', maxZoom: 21 });
        baseLayers['Google Satellite'] = (L.gridLayer as any).googleMutant({ type: 'satellite', maxZoom: 21 });
      }
      baseLayers['OpenStreetMap'] = createOpenStreetMapLayer();
      baseLayers['Esri World Imagery'] = createEsriWorldImageryLayer();
      allLayers = Object.values(baseLayers);

      const activeLayer = baseLayers['Google Hybrid'] || baseLayers['Esri World Imagery'];
      activeLayer.addTo(map);
      controlRef.current = L.control.layers(baseLayers, {}, { collapsed: true, position: 'topright' }).addTo(map);
      const container = controlRef.current.getContainer();
      if (container) {
        container.setAttribute('title', 'Camadas');
        if (!container.querySelector('.agryon-layers-title')) {
          const title = document.createElement('div');
          title.className = 'agryon-layers-title';
          title.textContent = 'Camadas';
          const list = container.querySelector('.leaflet-control-layers-list');
          container.insertBefore(title, list || null);
        }
      }
      onGoogleReady(Boolean(baseLayers['Google Hybrid']));
    }

    setupLayers();

    return () => {
      cancelled = true;
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
      allLayers.forEach((layer) => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      });
    };
  }, [apiKey, map, onGoogleReady]);

  return null;
}

function MapAutoCenter({ drones }: { drones: Array<[string, any]> }) {
  const map = useMap();
  const viewSetRef = useRef(false);

  useEffect(() => {
    const firstValid = drones.find(([, drone]) => drone.latitude != null && drone.longitude != null);
    if (firstValid && !viewSetRef.current) {
      map.setView([firstValid[1].latitude, firstValid[1].longitude], 15);
      viewSetRef.current = true;
    }
  }, [drones, map]);

  return null;
}

export default function MapPage({ apiUrl, token }: Props) {
  void token;
  const [drones, setDrones] = useState<Record<string, any>>({});
  const [googleReady, setGoogleReady] = useState(false);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${apiUrl}/dash-all`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setDrones(data);
        }
      } catch (error) {
        console.error(error);
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const droneList = useMemo(
    () => Object.entries(drones).filter(([, drone]) => drone.latitude != null && drone.longitude != null),
    [drones]
  );

  const handleGoogleReady = useCallback((value: boolean) => {
    setGoogleReady(value);
  }, []);

  return (
    <div className="h-full">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">Mapa de LocalizaÃ§Ã£o</h2>
        <div className="text-right">
          <div className="text-sm text-gray-400">
            {droneList.length} drone{droneList.length !== 1 ? 's' : ''} no mapa
          </div>
          <div className="text-xs text-gray-500">
            {googleReady ? 'Camada padrão: Google Hybrid' : 'Camada padrão: Esri World Imagery'}
          </div>
        </div>
      </div>

      {!GOOGLE_MAPS_API_KEY && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Google Hybrid será habilitado automaticamente quando a API Key oficial do Google Maps for configurada.
        </div>
      )}

      <div className="h-[calc(100vh-180px)] overflow-hidden rounded-xl border border-white/10">
        <MapContainer center={FALLBACK_CENTER} zoom={4} className="h-full w-full" preferCanvas>
          <MapBaseLayers apiKey={GOOGLE_MAPS_API_KEY} onGoogleReady={handleGoogleReady} />
          <MapAutoCenter drones={droneList} />

          <LayerGroup>
            {droneList
              .filter(([, drone]) => !drone.offline && Number(drone.hectaresApplied) > 0)
              .map(([id, drone]) => (
                <Polygon
                  key={`area-${id}`}
                  positions={createWorkAreaCoordinates(drone.latitude, drone.longitude, drone.hectaresApplied)}
                  pathOptions={{
                    color: '#00FF88',
                    fillColor: '#00FF88',
                    fillOpacity: 0.1,
                    weight: 1,
                    dashArray: '5, 5'
                  }}
                />
              ))}
          </LayerGroup>

          <LayerGroup>
            {droneList.map(([id, drone]) => (
              <LayerGroup key={id}>
                <CircleMarker
                  center={[drone.latitude, drone.longitude]}
                  radius={8}
                  pathOptions={{
                    color: drone.offline ? '#FF6B2C' : '#00FF88',
                    fillColor: drone.offline ? '#FF6B2C' : '#00FF88',
                    fillOpacity: 0.6,
                    weight: 2
                  }}
                />
                <Marker position={[drone.latitude, drone.longitude]} icon={defaultIcon}>
                  <Popup>
                    <div className="min-w-[180px] text-black">
                      <div className="mb-2 text-sm font-bold text-emerald-700">{id}</div>
                      <div className="mb-2 text-xs">{drone.offline ? 'OFFLINE' : 'ONLINE'}</div>
                      <div className="text-xs">
                        Piloto: <strong>{drone._pilot || 'â€”'}</strong><br />
                        Fazenda: <strong>{drone._farm || 'â€”'}</strong>
                      </div>
                      <hr className="my-2" />
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div>Bateria: <strong>{drone.batteryPercent ?? '--'}%</strong></div>
                        <div>Tanque: <strong>{fmt(drone.tankLiters, 2)} L</strong></div>
                        <div>Vel.: <strong>{fmt(drone.speedKmh, 1)} km/h</strong></div>
                        <div>Alt.: <strong>{fmt(drone.altitude, 1)} m</strong></div>
                        <div>Sat.: <strong>{drone.signalStrength ?? '--'}</strong></div>
                        <div>RTK: <strong>{drone.rtkStatus || 'â€”'}</strong></div>
                      </div>
                      <div className="mt-2 text-xs">
                        Status: <strong>{drone.operationalStatus || 'â€”'}</strong>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              </LayerGroup>
            ))}
          </LayerGroup>
        </MapContainer>
      </div>
    </div>
  );
}