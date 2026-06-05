const WebSocket = require('ws');
const http = require('http');
const url = require('url');

/**
 * Drone Collector Cloud Relay
 * 
 * Funcao: Recebe telemetria do RC Plus em campo e retransmite
 * para dashboards conectados de qualquer lugar.
 * 
 * Arquitetura:
 *   RC Plus (campo) --ws--> Render Cloud <--ws-- Dashboard (gestor remoto)
 * 
 * O RC Plus envia dados com um "droneId" unico.
 * O gestor se conecta informando qual drone quer monitorar.
 */

const PORT = process.env.PORT || 8080;
const DRONE_TIMEOUT_MS = 60000; // 60s sem heartbeat = offline

// Mapa de drones ativos: droneId -> { socket, lastSeen, telemetry }
const drones = new Map();

// Mapa de dashboards: droneId -> Set de sockets
const dashboards = new Map();

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  
  // Health check
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      drones: drones.size,
      uptime: process.uptime()
    }));
    return;
  }

  // Lista de drones online
  if (parsed.pathname === '/drones') {
    const list = Array.from(drones.entries()).map(([id, data]) => ({
      id,
      online: Date.now() - data.lastSeen < DRONE_TIMEOUT_MS,
      lastSeen: data.lastSeen,
      clients: dashboards.get(id)?.size || 0
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const droneId = parsed.query.droneId;

  console.log(`[CONN] ${path} droneId=${droneId} from=${req.socket.remoteAddress}`);

  // === RC PLUS (coletor) se conectando ===
  if (path === '/drone') {
    if (!droneId) {
      ws.close(1008, 'droneId required');
      return;
    }

    // Remove conexao anterior do mesmo drone (se houver)
    const old = drones.get(droneId);
    if (old) {
      try { old.socket.close(); } catch (e) {}
      drones.delete(droneId);
      console.log(`[DRONE] ${droneId} reconectado`);
    }

    drones.set(droneId, {
      socket: ws,
      lastSeen: Date.now(),
      telemetry: null
    });

    ws.on('message', (data) => {
      try {
        const drone = drones.get(droneId);
        if (!drone) return;

        drone.lastSeen = Date.now();
        drone.telemetry = data.toString();

        // Retransmite para todos os dashboards deste drone
        const clients = dashboards.get(droneId);
        if (clients) {
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data);
            }
          });
        }
      } catch (e) {
        console.error(`[ERROR] ${droneId}:`, e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[DRONE] ${droneId} desconectado`);
      // Nao remove imediatamente - aguarda timeout para reconexao
    });

    ws.on('error', (err) => {
      console.error(`[DRONE ERROR] ${droneId}:`, err.message);
    });

    // Envia confirmacao
    ws.send(JSON.stringify({ type: 'connected', role: 'drone', droneId }));
    return;
  }

  // === DASHBOARD (gestor) se conectando ===
  if (path === '/dashboard') {
    if (!droneId) {
      ws.close(1008, 'droneId required');
      return;
    }

    if (!dashboards.has(droneId)) {
      dashboards.set(droneId, new Set());
    }
    dashboards.get(droneId).add(ws);

    // Envia ultima telemetria conhecida (se houver)
    const drone = drones.get(droneId);
    if (drone?.telemetry) {
      ws.send(drone.telemetry);
    }

    // Envia status de conexao
    ws.send(JSON.stringify({
      type: 'status',
      droneOnline: !!drone && (Date.now() - drone.lastSeen < DRONE_TIMEOUT_MS),
      droneId
    }));

    ws.on('close', () => {
      const clients = dashboards.get(droneId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) dashboards.delete(droneId);
      }
    });

    ws.on('error', (err) => {
      console.error(`[DASH ERROR] ${droneId}:`, err.message);
    });

    console.log(`[DASH] ${droneId} dashboard conectado`);
    return;
  }

  // Caminho invalido
  ws.close(1008, 'Invalid path. Use /drone?droneId=xxx or /dashboard?droneId=xxx');
});

// Cleanup de drones inativos
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of drones.entries()) {
    if (now - data.lastSeen > DRONE_TIMEOUT_MS) {
      console.log(`[CLEANUP] ${id} removido por inatividade`);
      try { data.socket.close(); } catch (e) {}
      drones.delete(id);
    }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`[SERVER] Drone Relay rodando na porta ${PORT}`);
  console.log(`[SERVER] Health: http://localhost:${PORT}/health`);
  console.log(`[SERVER] Drones: http://localhost:${PORT}/drones`);
});
