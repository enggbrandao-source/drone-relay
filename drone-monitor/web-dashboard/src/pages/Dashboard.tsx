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

function fmtDuration(value?: string | null) {
  return value || '--';
}

export default function Dashboard({ apiUrl, token }: Props) {
  const [drones, setDrones] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedDay, setSelectedDay] = useState<any | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(true);

  useEffect(() => {
    async function poll() {
      try {
        const [dashRes, daysRes] = await Promise.all([
          fetch(`${apiUrl}/dash-all`, { cache: 'no-store' }),
          fetch(`${apiUrl}/operations`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);

        if (dashRes.ok) {
          const data = await dashRes.json();
          setDrones(data);
        }
        if (daysRes.ok) {
          const operationsData = await daysRes.json();
          const nextDays = operationsData.days || [];
          setDays(nextDays);
          setSelectedDate((current) => current || nextDays[0]?.date || '');
        }
      } catch (e) {
        console.error('Poll error:', e);
      } finally {
        setLoading(false);
        setOperationsLoading(false);
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [apiUrl, token]);

  useEffect(() => {
    if (!selectedDate) {
      setSelectedDay(null);
      return;
    }
    async function loadDay() {
      try {
        const res = await fetch(`${apiUrl}/operations/${selectedDate}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          setSelectedDay(await res.json());
        }
      } catch (e) {
        console.error('Operations error:', e);
      }
    }
    loadDay();
  }, [apiUrl, selectedDate, token]);

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

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">Resumo Operacional</h3>
          <div className="text-sm text-gray-500">
            Fechamento automático após 30 minutos sem novo voo
          </div>
        </div>

        {operationsLoading ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-gray-500">
            Carregando resumo operacional...
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-gray-500">
            Ainda não há operações finalizadas ou em andamento registradas.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              {days.map((day) => (
                <button
                  key={day.date}
                  onClick={() => setSelectedDate(day.date)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selectedDate === day.date
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-lg font-bold">{day.dateLabel}</div>
                    <div className="text-xs text-gray-400">{day.summary.operationsCount} operações</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500">Voos</div>
                      <div className="font-semibold">{day.summary.totalFlights}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Tempo</div>
                      <div className="font-semibold">{day.summary.totalOperationLabel}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Hectares</div>
                      <div className="font-semibold">{fmt(day.summary.totalHectares, 2)} ha</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Tempo pausado</div>
                      <div className="font-semibold text-xs">{fmtDuration(day.summary.totalPausedLabel)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Tempo médio de pausa</div>
                      <div className="font-semibold text-xs">{fmtDuration(day.summary.averagePauseLabel)}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-gray-500">Última operação</div>
                      <div className="font-semibold text-xs">{day.summary.lastOperationLabel || '—'}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {selectedDay && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h4 className="text-lg font-bold">{selectedDay.dateLabel}</h4>
                    <div className="text-sm text-gray-400">
                      {selectedDay.summary.operationsCount} operações | {selectedDay.summary.totalFlights} voos | Operação: {selectedDay.summary.totalOperationLabel} | Voo efetivo: {selectedDay.summary.totalEffectiveFlightLabel} | Pausa: {selectedDay.summary.totalPausedLabel} | Média pausa: {selectedDay.summary.averagePauseLabel} | {fmt(selectedDay.summary.totalHectares, 2)} ha
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedDay.operations.map((operation: any, index: number) => (
                    <div key={operation.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="font-bold">
                          Operação {index + 1} · {operation.droneCode}
                        </div>
                        <div className={`rounded-full px-3 py-1 text-xs font-semibold ${operation.status === 'OPEN' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-400'}`}>
                          {operation.status === 'OPEN' ? 'EM ANDAMENTO' : 'ENCERRADA'}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3 xl:grid-cols-8">
                        <div>
                          <div className="text-gray-500">Início</div>
                          <div>{new Date(operation.startedAt).toLocaleTimeString('pt-BR')}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Fim</div>
                          <div>{operation.endedAt ? new Date(operation.endedAt).toLocaleTimeString('pt-BR') : '—'}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Tempo total</div>
                          <div>{operation.totalOperationLabel}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Voo efetivo</div>
                          <div>{operation.totalEffectiveFlightLabel}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Tempo pausado</div>
                          <div>{operation.totalPausedLabel}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Média pausa</div>
                          <div>{operation.averagePauseLabel}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Voos</div>
                          <div>{operation.totalFlights}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Hectares</div>
                          <div>{fmt(operation.hectaresWorked, 2)} ha</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Piloto / Fazenda</div>
                          <div>{operation.pilotName || '—'} / {operation.farmName || '—'}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
