import { Link, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  user: any;
  onLogout: () => void;
}

export default function Layout({ children, user, onLogout }: Props) {
  const location = useLocation();

  const nav = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/operations', label: 'Operações', icon: '🧾' },
    { path: '/drones', label: 'Drones', icon: '🚁' },
    { path: '/farms', label: 'Fazendas', icon: '🌾' },
    { path: '/mapa', label: 'Mapa', icon: '🗺️' },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-black/30 border-r border-white/10 flex flex-col">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-2xl font-bold text-emerald-400">AGRYON</h1>
          <p className="text-xs text-gray-500 mt-1">Control</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                location.pathname === item.path
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="text-sm text-gray-400 mb-2">{user.user?.name}</div>
          <button
            onClick={onLogout}
            className="w-full text-left text-red-400 hover:text-red-300 text-sm"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}