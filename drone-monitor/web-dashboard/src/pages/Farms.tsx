import { useState, useEffect } from 'react';

interface Props {
  apiUrl: string;
  token: string;
}

export default function Farms({ apiUrl, token }: Props) {
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', location: '' });

  async function loadFarms() {
    try {
      const res = await fetch(`${apiUrl}/api/farms`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFarms(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFarms(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch(`${apiUrl}/api/farms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowForm(false);
        setFormData({ name: '', location: '' });
        loadFarms();
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) return <div className="text-center py-20 text-gray-500">Carregando...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Fazendas</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold px-4 py-2 rounded-lg transition"
        >
          {showForm ? 'Cancelar' : '+ Nova Fazenda'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Nome</label>
              <input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
                placeholder="Fazenda São João"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Localização</label>
              <input
                value={formData.location}
                onChange={e => setFormData({ ...formData, location: e.target.value })}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white"
                placeholder="Ribeirão Preto - SP"
              />
            </div>
          </div>
          <button type="submit" className="mt-4 bg-emerald-500 hover:bg-emerald-600 text-black font-bold px-6 py-2 rounded-lg">
            Salvar
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {farms.map((f: any) => (
          <div key={f.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
            <div className="font-bold text-lg">{f.name}</div>
            <div className="text-sm text-gray-400 mt-1">{f.location || 'Sem localização'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
