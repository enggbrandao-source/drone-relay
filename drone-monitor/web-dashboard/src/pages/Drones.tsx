import { useState, useEffect } from 'react';

interface Props {
  apiUrl: string;
  token: string;
}

export default function Drones({ apiUrl, token }: Props) {
  const [drones, setDrones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ code: '', model: 'DJI Agras' });

  async function loadDrones() {
    try {
      const res = await fetch(`${apiUrl}/drones`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDrones(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDrones(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/drones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowForm(false);
        setFormData({ code: '', model: 'DJI Agras' });
        loadDrones();
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) return <div className="text-center py-20 text-gray-500">Carregando...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Drones</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold px-4 py-2 rounded-lg transition"
        >
          {showForm ? 'Cancelar' : '+ Novo Drone'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Código</label>
              <input
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
                placeholder="AGRAS001"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Modelo</label>
              <input
                value={formData.model}
                onChange={e => setFormData({ ...formData, model: e.target.value })}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
                required
              />
            </div>
          </div>
          <button type="submit" className="mt-4 bg-emerald-500 hover:bg-emerald-600 text-black font-bold px-6 py-2 rounded-lg">
            Salvar
          </button>
        </form>
      )}

      <div className="space-y-2">
        {drones.map((d: any) => (
          <div key={d.id} className="bg-white/5 border border-white/10 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-3 h-3 rounded-full ${d.lastSeen && new Date().getTime() - new Date(d.lastSeen).getTime() < 120000 ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <div>
                <div className="font-bold">{d.code}</div>
                <div className="text-sm text-gray-400">{d.model}</div>
              </div>
            </div>
            <div className="text-sm text-gray-400">
              {d.farm?.name || 'Sem fazenda'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
