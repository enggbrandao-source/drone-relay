/**
 * Servidor principal Agryon Control — API Express + WebSocket + SQLite
 * Use este arquivo como "Start Command" no Render: node server.js
 */

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'agryon-default-secret';
const PORT = process.env.PORT || 10000;

// === BANCO DE DADOS EM MEMÓRIA (para compatibilidade com Render Free) ===
const db = {
  users: [],
  companies: [],
  drones: [],
  farms: [],
  telemetry: []
};

// Seede inicial
async function seed() {
  const company = { id: '1', name: 'AgroDrone Demo', plan: 'pro', active: true, createdAt: new Date() };
  db.companies.push(company);
  
  const adminPass = await bcrypt.hash('admin123', 10);
  db.users.push({ id: '1', email: 'admin@agryon.com', password: adminPass, name: 'Administrador', role: 'admin', companyId: '1', createdAt: new Date() });
  
  const clientPass = await bcrypt.hash('cliente123', 10);
  db.users.push({ id: '2', email: 'cliente@demo.com', password: clientPass, name: 'Cliente Demo', role: 'cliente', companyId: '1', createdAt: new Date() });
  
  db.farms.push({ id: '1', name: 'Fazenda São João', location: 'Ribeirão Preto - SP', companyId: '1', createdAt: new Date() });
  db.farms.push({ id: '2', name: 'Fazenda Boa Vista', location: 'Sertãozinho - SP', companyId: '1', createdAt: new Date() });
  
  db.drones.push({ id: '1', code: 'AGRAS001', model: 'DJI Agras T40', companyId: '1', active: true, createdAt: new Date(), lastData: null, lastSeen: null });
  db.drones.push({ id: '2', code: 'AGRAS002', model: 'DJI Agras T30', companyId: '1', active: true, createdAt: new Date(), lastData: null, lastSeen: null });
  
  console.log('[SEED] Dados iniciais criados');
}

// === MIDDLEWARES ===
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// === AUTH ===
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name, companyName } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const company = { id: String(db.companies.length + 1), name: companyName || name + ' Ltda', plan: 'free', active: true, createdAt: new Date() };
    db.companies.push(company);
    const user = { id: String(db.users.length + 1), email, password: hashed, name, role: 'cliente', companyId: company.id, createdAt: new Date() };
    db.users.push(user);
    const token = jwt.sign({ id: user.id, email, role: user.role, companyId: company.id }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name, email, role: user.role, companyId: company.id } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.users.find(u => u.email === email);
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    const token = jwt.sign({ id: user.id, email, role: user.role, companyId: user.companyId }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email, role: user.role, companyId: user.companyId } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// === DRONES ===
app.get('/drones', authMiddleware, (req, res) => {
  const where = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
  const drones = db.drones.filter(d => !where.companyId || d.companyId === where.companyId);
  res.json(drones.map(d => ({
    ...d,
    pilot: db.users.find(u => u.id === d.pilotId)?.name || null,
    farm: db.farms.find(f => f.id === d.farmId)?.name || null
  })));
});

app.post('/drones', authMiddleware, (req, res) => {
  const { code, model, pilotId, farmId } = req.body;
  const companyId = req.user.role === 'admin' ? req.body.companyId : req.user.companyId;
  const drone = { id: String(db.drones.length + 1), code, model, companyId, pilotId, farmId, active: true, createdAt: new Date(), lastData: null, lastSeen: null };
  db.drones.push(drone);
  res.json(drone);
});

// === FARMS ===
app.get('/farms', authMiddleware, (req, res) => {
  const where = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
  const farms = db.farms.filter(f => !where.companyId || f.companyId === where.companyId);
  res.json(farms);
});

app.post('/farms', authMiddleware, (req, res) => {
  const { name, location } = req.body;
  const companyId = req.user.role === 'admin' ? req.body.companyId : req.user.companyId;
  const farm = { id: String(db.farms.length + 1), name, location, companyId, active: true, createdAt: new Date() };
  db.farms.push(farm);
  res.json(farm);
});

// === TELEMETRIA (recebe do RC Plus) ===
app.post('/drone', (req, res) => {
  try {
    const j = req.body;
    const code = j._id || j.id || 'A001';
    
    // Busca ou cria drone
    let drone = db.drones.find(d => d.code === code);
    if (!drone) {
      const defaultCompany = db.companies[0];
      drone = { id: String(db.drones.length + 1), code, model: 'DJI Agras', companyId: defaultCompany?.id || '1', active: true, createdAt: new Date(), lastData: null, lastSeen: null };
      db.drones.push(drone);
    }
    
    drone.lastData = JSON.stringify(j);
    drone.lastSeen = new Date();
    drone.lastLat = j.latitude || j.lat || null;
    drone.lastLon = j.longitude || j.lon || null;
    
    // Salva snapshot
    db.telemetry.push({
      id: db.telemetry.length + 1,
      droneId: drone.id,
      timestamp: new Date(),
      speed: j.speedKmh || j.speed || null,
      altitude: j.altitude || j.alt || null,
      batteryPercent: j.batteryPercent || j.bat || null,
      tankLiters: j.tankLiters || j.tkl || null,
      flowRate: j.flowRate || j.fr || null,
      hectaresApplied: j.hectaresApplied || j.ha || null,
      signalStrength: j.signalStrength || j.sig || null,
      rtkStatus: j.rtkStatus || j.rtk || null,
      operationalStatus: j.operationalStatus || j.st || null,
      latitude: j.latitude || j.lat || null,
      longitude: j.longitude || j.lon || null,
      rawJson: JSON.stringify(j)
    });
    
    // Broadcast WebSocket
    const payload = JSON.stringify({ type: 'telemetry', code, data: j });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
    
    res.json({ ok: true, code });
  } catch (e) {
    console.error('Erro telemetry:', e);
    res.status(400).json({ error: e.message });
  }
});

// === DASHBOARD PÚBLICO ===
app.get('/dash-all', (req, res) => {
  const result = {};
  const now = Date.now();
  const OFFLINE_MS = 120000;
  
  for (const d of db.drones) {
    const isOffline = !d.lastSeen || (now - new Date(d.lastSeen).getTime() > OFFLINE_MS);
    let data = {};
    try { data = d.lastData ? JSON.parse(d.lastData) : {}; } catch {}
    
    result[d.code] = {
      ...data,
      offline: isOffline,
      _pilot: db.users.find(u => u.id === d.pilotId)?.name || '—',
      _farm: db.farms.find(f => f.id === d.farmId)?.name || '—'
    };
  }
  
  res.json(result);
});

// === HEALTH ===
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0' });
});

// === WEBSOCKET ===
wss.on('connection', (ws) => {
  console.log('Cliente WebSocket conectado');
  ws.on('close', () => console.log('Cliente WebSocket desconectado'));
});

// Inicia servidor
server.listen(PORT, async () => {
  await seed();
  console.log('[AGRYON] API rodando na porta', PORT);
});
