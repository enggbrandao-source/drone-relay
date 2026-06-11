require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const http = require('http');
const WebSocket = require('ws');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'agryon-default-secret';
const PORT = process.env.PORT || 10000;

// === MIDDLEWARES ===
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token nao fornecido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
  next();
}

// === AUTH ===
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name, companyName } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    
    const company = await prisma.company.create({
      data: { name: companyName || name + ' Ltda' }
    });
    
    const user = await prisma.user.create({
      data: { email, password: hashed, name, role: 'cliente', companyId: company.id }
    });
    
    const token = jwt.sign({ id: user.id, email, role: user.role, companyId: company.id }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name, email, role: user.role, companyId: company.id } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Credenciais invalidas' });
    }
    const token = jwt.sign({ id: user.id, email, role: user.role, companyId: user.companyId }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email, role: user.role, companyId: user.companyId } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// === DRONES ===
app.get('/drones', authMiddleware, async (req, res) => {
  try {
    const where = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
    const drones = await prisma.drone.findMany({
      where,
      include: { pilot: { select: { name: true } }, farm: { select: { name: true } } }
    });
    res.json(drones);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/drones', authMiddleware, async (req, res) => {
  try {
    const { code, model, pilotId, farmId } = req.body;
    const companyId = req.user.role === 'admin' ? req.body.companyId : req.user.companyId;
    const drone = await prisma.drone.create({
      data: { code, model, companyId, pilotId, farmId }
    });
    res.json(drone);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// === FARMS ===
app.get('/farms', authMiddleware, async (req, res) => {
  try {
    const where = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
    const farms = await prisma.farm.findMany({ where });
    res.json(farms);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/farms', authMiddleware, async (req, res) => {
  try {
    const { name, location } = req.body;
    const companyId = req.user.role === 'admin' ? req.body.companyId : req.user.companyId;
    const farm = await prisma.farm.create({
      data: { name, location, companyId }
    });
    res.json(farm);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// === TELEMETRIA (recebe do RC Plus) ===
app.post('/drone', async (req, res) => {
  try {
    const j = req.body;
    const code = j._id || j.id || 'A001';
    
    let drone = await prisma.drone.findUnique({ where: { code } });
    
    if (!drone) {
      const defaultCompany = await prisma.company.findFirst();
      if (defaultCompany) {
        drone = await prisma.drone.create({
          data: { code, companyId: defaultCompany.id }
        });
      }
    }
    
    if (drone) {
      await prisma.drone.update({
        where: { id: drone.id },
        data: {
          lastData: JSON.stringify(j),
          lastSeen: new Date(),
          lastLat: j.latitude || j.lat || null,
          lastLon: j.longitude || j.lon || null
        }
      });
      
      await prisma.telemetrySnapshot.create({
        data: {
          droneId: drone.id,
          speed: j.speedKmh || j.speed || null,
          altitude: j.altitude || j.alt || null,
          flowRate: j.flowRate || j.fr || null,
          hectaresApplied: j.hectaresApplied || j.ha || null,
          rtkStatus: j.rtkStatus || j.rtk || null,
          signalStrength: j.signalStrength || j.sig || null,
          batteryPercent: j.batteryPercent || j.bat || null,
          tankLiters: j.tankLiters || j.tkl || null,
          latitude: j.latitude || j.lat || null,
          longitude: j.longitude || j.lon || null,
          operationalStatus: j.operationalStatus || j.st || null,
          alerts: j.systemAlerts ? JSON.stringify(j.systemAlerts) : null,
          rawJson: JSON.stringify(j)
        }
      });
    }
    
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

// === DASHBOARD PUBLICO (sem auth) ===
app.get('/dash-all', async (req, res) => {
  try {
    const drones = await prisma.drone.findMany({
      include: { pilot: { select: { name: true } }, farm: { select: { name: true } } }
    });
    
    const result = {};
    const now = Date.now();
    const OFFLINE_MS = 120000;
    
    for (const d of drones) {
      const isOffline = !d.lastSeen || (now - new Date(d.lastSeen).getTime() > OFFLINE_MS);
      let data = {};
      try { data = d.lastData ? JSON.parse(d.lastData) : {}; } catch {}
      
      result[d.code] = {
        ...data,
        offline: isOffline,
        _pilot: d.pilot?.name || '—',
        _farm: d.farm?.name || '—'
      };
    }
    
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

server.listen(PORT, () => {
  console.log('[AGRYON] API rodando na porta', PORT);
});
