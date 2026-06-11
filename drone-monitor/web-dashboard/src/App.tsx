import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Drones from './pages/Drones';
import Farms from './pages/Farms';
import MapPage from './pages/MapPage';
import Layout from './components/Layout';

const API_URL = 'https://drone-cloud.onrender.com';

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('agryon_user');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (user) localStorage.setItem('agryon_user', JSON.stringify(user));
    else localStorage.removeItem('agryon_user');
  }, [user]);

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <Layout user={user} onLogout={() => setUser(null)}>
      <Routes>
        <Route path="/" element={<Dashboard apiUrl={API_URL} token={user.token} />} />
        <Route path="/drones" element={<Drones apiUrl={API_URL} token={user.token} />} />
        <Route path="/farms" element={<Farms apiUrl={API_URL} token={user.token} />} />
        <Route path="/mapa" element={<MapPage apiUrl={API_URL} token={user.token} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}

export default App;
