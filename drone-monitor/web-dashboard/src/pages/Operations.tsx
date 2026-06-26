import { useEffect, useState } from 'react';

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

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function Operations({ apiUrl, token }: Props) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [droneId, setDroneId] = useState('');
  const [reportData, setReportData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadReport(true);
  }, [apiUrl, token]);

  function openNativePicker(event: React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
    input.showPicker?.();
  }

  function preventManualDateInput(
    event: React.KeyboardEvent<HTMLInputElement> | React.ClipboardEvent<HTMLInputElement> | React.DragEvent<HTMLInputElement>
  ) {
    event.preventDefault();
  }

  async function loadReport(isInitialLoad = false) {
    if (!isInitialLoad) setDetailLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (droneId.trim()) params.set('droneId', droneId.trim());
      const response = await fetch(`${apiUrl}/operations/report${params.toString() ? `?${params.toString()}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setReportData(await response.json());
      }
    } finally {
      setLoading(false);
      setDetailLoading(false);
    }
  }

  const hasDateRangeError = Boolean(dateFrom && dateTo && dateTo < dateFrom);
  const canExport = !hasDateRangeError && Boolean(dateFrom || dateTo || droneId.trim() || reportData?.operations?.length);

  function applyQuickRange(range: 'today' | 'yesterday' | 'last7' | 'last30') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let start = new Date(today);
    let end = new Date(today);

    if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end = new Date(start);
    }

    if (range === 'last7') {
      start.setDate(start.getDate() - 6);
    }

    if (range === 'last30') {
      start.setDate(start.getDate() - 29);
    }

    setDateFrom(toLocalDateInputValue(start));
    setDateTo(toLocalDateInputValue(end));
  }

  async function clearFilters() {
    setDateFrom('');
    setDateTo('');
    setDroneId('');
    setDetailLoading(true);
    try {
      const response = await fetch(`${apiUrl}/operations/report`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setReportData(await response.json());
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function exportCsv() {
    if (!canExport) return;
    const params = new URLSearchParams();
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
    link.download = `operations-${dateFrom || 'all'}${dateTo ? `-${dateTo}` : ''}${droneId.trim() ? `-${droneId.trim()}` : ''}.csv`;
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
          <p className="text-sm text-gray-400">Filtre por intervalo de datas usando apenas o calendário nativo e exporte os dados em CSV.</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={!canExport}
          className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold px-4 py-2 rounded-lg transition"
        >
          Exportar CSV
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (hasDateRangeError) return;
          void loadReport();
        }}
        className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4"
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyQuickRange('today')}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => applyQuickRange('yesterday')}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10"
          >
            Ontem
          </button>
          <button
            type="button"
            onClick={() => applyQuickRange('last7')}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10"
          >
            Últimos 7 dias
          </button>
          <button
            type="button"
            onClick={() => applyQuickRange('last30')}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10"
          >
            Últimos 30 dias
          </button>
          <button
            type="button"
            onClick={() => void clearFilters()}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/20"
          >
            Limpar filtros
          </button>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Data inicial</label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
              onClick={openNativePicker}
              onFocus={openNativePicker}
              onKeyDown={preventManualDateInput}
              onPaste={preventManualDateInput}
              onDrop={preventManualDateInput}
              inputMode="none"
              className={`w-full bg-black/30 rounded-lg px-3 py-2 text-white ${hasDateRangeError ? 'border border-red-500/70 ring-1 ring-red-500/40' : 'border border-white/10'}`}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Data final</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              onClick={openNativePicker}
              onFocus={openNativePicker}
              onKeyDown={preventManualDateInput}
              onPaste={preventManualDateInput}
              onDrop={preventManualDateInput}
              inputMode="none"
              className={`w-full bg-black/30 rounded-lg px-3 py-2 text-white ${hasDateRangeError ? 'border border-red-500/70 ring-1 ring-red-500/40' : 'border border-white/10'}`}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2 opacity-0">Exportar CSV</label>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!canExport}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold px-4 py-2 rounded-lg transition"
            >
              Exportar CSV
            </button>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[2fr_auto]">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Código do drone</label>
            <input
              value={droneId}
              onChange={(event) => setDroneId(event.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
              placeholder="Opcional"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2 opacity-0">Aplicar filtros</label>
            <button
              type="submit"
              disabled={hasDateRangeError}
              className="w-full bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg transition"
            >
              Aplicar filtros
            </button>
          </div>
        </div>
        {hasDateRangeError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            A data final não pode ser anterior à data inicial.
          </div>
        )}
      </form>

      {detailLoading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-gray-500">
          Carregando detalhamento...
        </div>
      ) : reportData ? (
        <>
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-lg font-bold">{reportData.rangeLabel || 'Período selecionado'}</h3>
            <div className="mt-2 text-sm text-gray-400">
              Operações: {reportData.summary.operationsCount} | Voos: {reportData.summary.totalFlights} | Tempo total: {fmtDuration(reportData.summary.totalOperationLabel)} | Voo efetivo: {fmtDuration(reportData.summary.totalEffectiveFlightLabel)} | Pausa: {fmtDuration(reportData.summary.totalPausedLabel)} | Média pausa: {fmtDuration(reportData.summary.averagePauseLabel)} | Hectares: {fmt(reportData.summary.totalHectares, 2)} ha
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
                {reportData.operations.length ? reportData.operations.map((operation: any) => (
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