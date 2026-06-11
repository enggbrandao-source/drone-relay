import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Props {
  apiUrl: string;
  token: string;
}

// Fix Leaflet default marker
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

export default function MapPage({ apiUrl }: Props) {
  const [drones, setDrones] = useState<Record<string, any>>({});

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${apiUrl}/dash-all`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setDrones(data);
        }
      } catch (e) {
        console.error(e);
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  // Centro do Brasil
  const center: [number, number] = [-15.7975, -47.8919];

  const droneList = Object.entries(drones).filter(([, d]) => d.latitude && d.longitude);

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Mapa de Localização</h2>
        <div className="text-sm text-gray-400">
          {droneList.length} drone{droneList.length !== 1 ? 's' : ''} no mapa
        </div>
      </div>

      <div className="h-[calc(100vh-180px)] rounded-xl overflow-hidden border border-white/10">
        <MapContainer center={center} zoom={4} className="h-full w-full">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {droneList.map(([id, d]) => (
            <Marker
              key={id}
              position={[d.latitude, d.longitude]}
              icon={defaultIcon}
            >
              <Popup>
                <div className="text-black">
                  <strong>{id}</strong><br/>
                  Piloto: {d._pilot || '—'}<br/>
                  Bateria: {d.batteryPercent ?? '--'}%<br/>
                  Status: {d.operationalStatus || '—'}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
