import { useState, useEffect } from 'react';

interface Props {
  apiUrl: string;
  token: string;
}

const fields = [
  { k: 'speedKmh', l: 'Velocidade', u: 'km/h', round: 1 },
  { k: 'altitude', l: 'Altitude', u: 'm', round: 1 },
  { k: 'batteryPercent', l: 'Bateria', u: '%', round: 0 },
  { k: 'tankLiters', l: 'Tanque', u: 'L', round: 2 },
  { k: 'flowRate', l: 'Vazão', u: 'L/min', round: 1 },
  { k: 'hectaresApplied', l: 'Hectares', u: 'ha', round: 2 },
  { k: 'signalStrength', l: 'Satélites', u: 'sats', round: 0 },
  { k: 'rtkStatus', l: 'RTK', u: '', round: 0 },
  { k: 'operationalStatus', l: 'Status', u: '', round: 0 },
];

function fmt(v: any, rnd: number) {
  if (v == null) return '--';
  if (typeof v === 'number') return v.toFixed(rnd);
  return v;
}

export default function Dashboard({ apiUrl }: Props) {
  const [drones, setDrones] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${apiUrl}/dash-all`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setDrones(data);
        }
      } catch (e) {
        console.error('Poll error:', e);
      } finally {
        setLoading(false);
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const ids = Object.keys(drones).sort();
  const filtered = ids.filter(id => {
    const d = drones[id];
    const online = !d.offline;
    if (filter === 'online') return online;
    if (filter === 'offline') return !online;
    return true;
  });

  if (loading) {
    return <div className="text-center py-20 text-gray-500">Carregando...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex gap-2">
          {['all', 'online', 'offline'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === f
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'online' ? 'Online' : 'Offline'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(id => {
          const d = drones[id];
          const online = !d.offline;
          
          return (
            <div
              key={id}
              className={`rounded-xl border p-4 transition ${
                online
                  ? 'bg-white/5 border-emerald-500/30'
                  : 'bg-white/3 border-white/10 opacity-70'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  <span className="font-bold text-lg">{id}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  online ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`}>
                  {online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
              
              <div className="flex gap-4 text-xs text-gray-400 mb-3">
                <span>Piloto: {d._pilot || '—'}</span>
                <span>Fazenda: {d._farm || '—'}</span>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                {fields.map(f => (
                  <div key={f.k} className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">{f.l}</div>
                    <div className="text-lg font-bold text-white">{fmt(d[f.k], f.round)}</div>
                    <div className="text-[10px] text-gray-500">{f.u}</div>
                  </div>
                ))}
              </div>
              
              {d.systemAlerts?.length > 0 && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                  {d.systemAlerts.join('; ')}
                </div>
              )}
              
              {d._version && (
                <div className="mt-2 text-[10px] text-gray-600">APK v{d._version}</div>
              )}
            </div>
          );
        })}
      </div>
      
      {filtered.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          Nenhum drone encontrado
        </div>
      )}
    </div>
  );
}
