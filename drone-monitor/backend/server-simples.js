const http = require('http');
const url = require('url');

/**
 * Drone Relay - Versao HTTP + WebSocket hibrida
 * 
 * HTTP POST para drones (mais confiavel no Render Free)
 * WebSocket para dashboards (tempo real)
 */

const PORT = process.env.PORT || 8080;
const DRONE_TIMEOUT = 90000;

const drones = new Map();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsed = url.parse(req.url, true);

  // POST /telemetria - drones enviam dados via HTTP
  if (parsed.pathname === '/telemetria' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const droneId = data._id || data.id || 'unknown';
        
        drones.set(droneId, {
          data: body,
          time: Date.now()
        });
        
        console.log(`[DRONE] ${droneId} telemetria recebida`);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: true, droneId}));
      } catch(e) {
        res.writeHead(400);
        res.end('Invalid JSON');
      }
    });
    return;
  }

  // GET /telemetria?id=AGRAS001
  if (parsed.pathname === '/telemetria') {
    const id = parsed.query.id || parsed.query.droneId;
    const drone = drones.get(id);
    if (drone && Date.now() - drone.time < DRONE_TIMEOUT) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(drone.data);
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({error: 'Drone offline'}));
    }
    return;
  }

  // GET /drones
  if (parsed.pathname === '/drones') {
    const list = [];
    for (const [id, d] of drones) {
      if (Date.now() - d.time < DRONE_TIMEOUT) {
        list.push({id, lastSeen: d.time});
      }
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(list));
    return;
  }

  // Health
  if (parsed.pathname === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: true, drones: drones.size, up: process.uptime()}));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[RELAY] Porta ${PORT}`);
  console.log(`[RELAY] Health: http://localhost:${PORT}/health`);
  console.log(`[RELAY] Drones: http://localhost:${PORT}/drones`);
});
