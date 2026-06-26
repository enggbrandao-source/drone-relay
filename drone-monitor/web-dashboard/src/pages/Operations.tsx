import { useEffect, useMemo, useState } from 'react';

interface Props {
  apiUrl: string;
  token: string;
}

function fmt(value: any, digits = 0) {
  if (value == null || value === '') return '--';
  if (typeof value === 'number') return value.toFixed(digits);
  return String(value);
}

function fmtDuration(value?: string | null) {
  return value || '--';
}

export default function Operations({ apiUrl, token }: Props) {
  const [days, setDays] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDay, setSelectedDay] = useState<any | null>(null);
  const [droneId, setDroneId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    async function loadDays() {
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        const response = await fetch(`${apiUrl}/operations${params.toString() ? `?${params.toString()}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        const nextDays = data.days || [];
        setDays(nextDays);
        setSelectedDate((current) => {
          if (current && nextDays.some((day: any) => day.date === current)) return current;
          return nextDays[0]?.date || '';
        });
      } finally {
        setLoading(false);
      }
    }
    loadDays();
  }, [apiUrl, token, dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedDate) {
      setSelectedDay(null);
      return;
    }
    async function loadDetail() {
      setDetailLoading(true);
      try {
        const suffix = droneId.trim()
          ? `/operations/${encodeURIComponent(selectedDate)}/${encodeURIComponent(droneId.trim())}`
          : `/operations/${encodeURIComponent(selectedDate)}`;
        const response = await fetch(`${apiUrl}${suffix}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          setSelectedDay(await response.json());
        }
      } finally {
        setDetailLoading(false);
      }
    }
    loadDetail();
  }, [apiUrl, selectedDate, droneId, token]);

  const canExport = useMemo(() => Boolean(selectedDate || dateFrom || dateTo), [selectedDate, dateFrom, dateTo]);

  async function exportCsv() {
    if (!selectedDate && !dateFrom && !dateTo) return;
    const params = new URLSearchParams();
    if (selectedDate) params.set('date', selectedDate);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (droneId.trim()) params.set('droneId', droneId.trim());
    const response = await fetch(`${apiUrl}/operations/export.csv?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error('Falha ao exportar CSV');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `operations-${selectedDate || dateFrom || 'all'}${dateTo ? `-${dateTo}` : ''}${droneId.trim() ? `-${droneId.trim()}` : ''}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-500">Carregando operações...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Relatório de Operações</h2>
          <p className="text-sm text-gray-400">Visualize as operações do dia, use intervalo de datas e exporte os dados em CSV.</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={!canExport}
          className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold px-4 py-2 rounded-lg transition"
        >
          Exportar CSV
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Data inicial</label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
              list="operation-days"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Data final</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              list="operation-days"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Dia detalhado</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              list="operation-days"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Código do drone</label>
            <input
              value={droneId}
              onChange={(event) => setDroneId(event.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
              placeholder="Opcional"
            />
          </div>
        </div>
        <datalist id="operation-days">
          {days.map((day) => (
            <option key={day.date} value={day.date} />
          ))}
        </datalist>
      </div>

      {detailLoading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-gray-500">
          Carregando detalhamento...
        </div>
      ) : selectedDay ? (
        <>
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-lg font-bold">{selectedDay.rangeLabel || selectedDay.dateLabel}</h3>
            <div className="mt-2 text-sm text-gray-400">
              Operações: {selectedDay.summary.operationsCount} | Voos: {selectedDay.summary.totalFlights} | Tempo total: {fmtDuration(selectedDay.summary.totalOperationLabel)} | Voo efetivo: {fmtDuration(selectedDay.summary.totalEffectiveFlightLabel)} | Pausa: {fmtDuration(selectedDay.summary.totalPausedLabel)} | Média pausa: {fmtDuration(selectedDay.summary.averagePauseLabel)} | Hectares: {fmt(selectedDay.summary.totalHectares, 2)} ha
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-white/10 bg-white/5">
            <table className="min-w-full text-sm">
              <thead className="bg-black/20 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Drone</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Início</th>
                  <th className="px-4 py-3 text-left">Fim</th>
                  <th className="px-4 py-3 text-left">Tempo total</th>
                  <th className="px-4 py-3 text-left">Voo efetivo</th>
                  <th className="px-4 py-3 text-left">Tempo pausado</th>
                  <th className="px-4 py-3 text-left">Média pausa</th>
                  <th className="px-4 py-3 text-left">Voos</th>
                  <th className="px-4 py-3 text-left">Hectares</th>
                  <th className="px-4 py-3 text-left">Piloto</th>
                  <th className="px-4 py-3 text-left">Fazenda</th>
                  <th className="px-4 py-3 text-left">Fechamento</th>
                </tr>
              </thead>
              <tbody>
                {selectedDay.operations.length ? selectedDay.operations.map((operation: any) => (
                  <tr key={operation.id} className="border-t border-white/10">
                    <td className="px-4 py-3">{operation.droneCode}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${operation.status === 'OPEN' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-400'}`}>
                        {operation.status === 'OPEN' ? 'EM ANDAMENTO' : 'ENCERRADA'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{new Date(operation.startedAt).toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3">{operation.endedAt ? new Date(operation.endedAt).toLocaleString('pt-BR') : '--'}</td>
                    <td className="px-4 py-3">{fmtDuration(operation.totalOperationLabel)}</td>
                    <td className="px-4 py-3">{fmtDuration(operation.totalEffectiveFlightLabel)}</td>
                    <td className="px-4 py-3">{fmtDuration(operation.totalPausedLabel)}</td>
                    <td className="px-4 py-3">{fmtDuration(operation.averagePauseLabel)}</td>
                    <td className="px-4 py-3">{operation.totalFlights}</td>
                    <td className="px-4 py-3">{fmt(operation.hectaresWorked, 2)} ha</td>
                    <td className="px-4 py-3">{operation.pilotName || '--'}</td>
                    <td className="px-4 py-3">{operation.farmName || '--'}</td>
                    <td className="px-4 py-3">{operation.closeReason || '--'}</td>
                  </tr>
                )) : (
                  <tr>
                    <td className="px-4 py-6 text-gray-500" colSpan={14}>
                      Nenhuma operação encontrada para os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-gray-500">
          Nenhuma operação disponível.
        </div>
      )}
    </div>
  );
}