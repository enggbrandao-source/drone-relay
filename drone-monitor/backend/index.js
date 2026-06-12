const http = require('http');
const url = require('url');

/**
 * Servidor HTTP para Render Free - Drone Relay Cloud
 * Recebe POST do RC, serve dashboard com múltiplos drones
 */

const PORT = process.env.PORT || 8080;
const drones = new Map(); // { id: { data: {}, time: Date.now() } }
const OFFLINE_THRESHOLD_MS = 120000; // 2 minutos

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Agryon Control — Monitoramento de Drones</title>
<style>
* { margin:0; box-sizing:border-box }
body { font-family:'Segoe UI',sans-serif; background:#0b0f19; color:#e0e0e0; padding:10px; }
h2 { text-align:center; color:#00FF88; margin-bottom:6px; font-size:20px }
.subtitle { text-align:center; color:#9aa0a6; font-size:12px; margin-bottom:12px }

/* Filtros */
.filters { display:flex; justify-content:center; gap:8px; margin-bottom:12px; flex-wrap:wrap }
.filters button { padding:6px 14px; border-radius:6px; border:1px solid rgba(0,255,136,0.3); background:#111112; color:#9aa0a6; font-size:12px; cursor:pointer }
.filters button.active { background:rgba(0,255,136,0.15); color:#00FF88; border-color:#00FF88 }

/* Grid de drones */
.drone-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:10px; max-width:1400px; margin:auto }

/* Card do drone */
.drone-card { background:rgba(255,255,255,0.05); border-radius:12px; padding:12px; border:1px solid rgba(255,255,255,0.08); transition:border-color 0.3s }
.drone-card.online { border-color:rgba(0,255,136,0.3) }
.drone-card.offline { border-color:rgba(255,107,44,0.3); opacity:0.7 }

.drone-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px }
.drone-id { font-size:16px; font-weight:700; color:#fff }
.drone-status { font-size:11px; padding:3px 8px; border-radius:4px; font-weight:600 }
.drone-status.online { background:rgba(0,255,136,0.15); color:#00FF88 }
.drone-status.offline { background:rgba(255,107,44,0.15); color:#FF6B2C }

/* Cards internos */
.cards { display:grid; grid-template-columns:repeat(3,1fr); gap:6px }
.card { background:rgba(255,255,255,0.04); border-radius:8px; padding:10px 6px; text-align:center }
.card .label { color:#9aa0a6; font-size:10px; text-transform:uppercase; letter-spacing:0.5px }
.card .value { font-size:18px; font-weight:700; color:#fff; margin-top:3px }
.card .unit { color:#9aa0a6; font-size:10px }

/* Alertas */
.alert { margin-top:8px; padding:6px 8px; background:rgba(255,68,68,0.1); border-radius:6px; color:#ff4444; font-size:11px }

/* Timer */
.timer { text-align:center; margin-top:12px; font-size:12px; color:#666 }

/* Versão */
.version { text-align:center; margin-top:4px; font-size:10px; color:#444 }

/* Info extra */
.drone-info { display:flex; gap:10px; margin-top:8px; font-size:11px; color:#9aa0a6 }
.drone-info span { display:flex; align-items:center; gap:4px }
</style>
</head>
<body>
<h2>AGRYON CONTROL</h2>
<div class="subtitle">Monitoramento de Frota de Drones</div>

<div class="filters">
  <button class="active" onclick="setFilter('all')">Todos</button>
  <button onclick="setFilter('online')">Online</button>
  <button onclick="setFilter('offline')">Offline</button>
</div>

<div class="drone-grid" id="droneGrid"></div>

<div class="timer" id="timer">Ultima atualizacao: --</div>
<div class="version" id="versionInfo"></div>

<script>
const fields=[
  {k:'speedKmh',l:'Velocidade',u:'km/h',round:1},
  {k:'altitude',l:'Altitude',u:'m',round:1},
  {k:'batteryPercent',l:'Bateria',u:'%',round:0},
  {k:'tankLiters',l:'Tanque',u:'L',round:2},
  {k:'flowRate',l:'Vazao',u:'L/min',round:1},
  {k:'hectaresApplied',l:'Hectares',u:'ha',round:2},
  {k:'signalStrength',l:'Satelites',u:'sats',round:0},
  {k:'rtkStatus',l:'RTK',u:'',round:0},
  {k:'operationalStatus',l:'Status',u:'',round:0}
];

let currentFilter = 'all';
let droneData = {};

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  render();
}

function fmt(v, rnd) {
  if (v == null) return '--';
  if (typeof v === 'number') return v.toFixed(rnd);
  return v;
}

function isOnline(d) {
  return d && !d.offline;
}

function render() {
  const grid = document.getElementById('droneGrid');
  grid.innerHTML = '';
  
  const ids = Object.keys(droneData).sort();
  let visibleCount = 0;
  
  ids.forEach(id => {
    const d = droneData[id];
    const online = isOnline(d);
    
    if (currentFilter === 'online' && !online) return;
    if (currentFilter === 'offline' && online) return;
    visibleCount++;
    
    const card = document.createElement('div');
    card.className = 'drone-card ' + (online ? 'online' : 'offline');
    
    // Header
    const statusText = online ? 'ONLINE' : 'OFFLINE';
    const pilotName = d._pilot || '—';
    const farmName = d._farm || '—';
    
    let html = \`
      <div class="drone-header">
        <div class="drone-id">\${id}</div>
        <div class="drone-status \${online?'online':'offline'}">\${statusText}</div>
      </div>
      <div class="drone-info">
        <span>Piloto: \${pilotName}</span>
        <span>Fazenda: \${farmName}</span>
      </div>
      <div class="cards">
    \`;
    
    // Campos
    fields.forEach(f => {
      html += \`
        <div class="card">
          <div class="label">\${f.l}</div>
          <div class="value">\${fmt(d[f.k], f.round)}</div>
          <div class="unit">\${f.u}</div>
        </div>
      \`;
    });
    
    html += '</div>';
    
    // Alertas
    if (d.systemAlerts && d.systemAlerts.length) {
      html += \`<div class="alert">\${d.systemAlerts.join('; ')}</div>\`;
    }
    
    // Versão do APK
    if (d._version) {
      html += \`<div class="version">APK v\${d._version}</div>\`;
    }
    
    card.innerHTML = html;
    grid.appendChild(card);
  });
  
  if (visibleCount === 0) {
    grid.innerHTML = '<div style="text-align:center;color:#666;padding:40px">Nenhum drone encontrado</div>';
  }
}

async function poll(){
  try{
    const r = await fetch('/dash-all',{cache:'no-store'});
    if(!r.ok) throw new Error('offline');
    const data = await r.json();
    droneData = data;
    render();
    document.getElementById('timer').textContent = 'Ultima atualizacao: ' + new Date().toLocaleTimeString('pt-BR');
  }catch(e){
    document.getElementById('timer').textContent = 'Erro de conexao — ' + new Date().toLocaleTimeString('pt-BR');
  }
}

poll();
setInterval(poll, 3000);
</script>
</body></html>`;

// Mapeamento de nomes curtos -> longos
const FIELD_MAP = {
  sp: 'speed', alt: 'altitude', bat: 'batteryPercent',
  tk: 'tankLevel', tkl: 'tankLiters', skm: 'speedKmh',
  fr: 'flowRate', ha: 'hectaresApplied', sig: 'signalStrength',
  rtk: 'rtkStatus', st: 'operationalStatus', alerts: 'systemAlerts',
  speed: 'speed', altitude: 'altitude', batteryPercent: 'batteryPercent',
  tankLevel: 'tankLevel', tankLiters: 'tankLiters', speedKmh: 'speedKmh',
  flowRate: 'flowRate', hectaresApplied: 'hectaresApplied',
  signalStrength: 'signalStrength', rtkStatus: 'rtkStatus',
  operationalStatus: 'operationalStatus', systemAlerts: 'systemAlerts'
};

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const p = url.parse(req.url, true);

  // Dashboard HTML
  if (p.pathname === '/dashboard.html' || p.pathname === '/') {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(DASHBOARD_HTML);
    return;
  }

  // Drone envia telemetria (delta ou full frame)
  if (p.pathname === '/drone' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(b);
        const id = j._id || j.id || 'A001';

        const existing = drones.get(id);
        const existingData = existing ? existing.data : {};

        const merged = { ...existingData };
        for (const [key, value] of Object.entries(j)) {
          if (key.startsWith('_') && key !== '_pilot' && key !== '_farm') continue;
          const mappedKey = FIELD_MAP[key] || key;
          if (mappedKey) merged[mappedKey] = value;
        }

        // Arredonda valores
        if (merged.speedKmh != null) merged.speedKmh = Math.round(merged.speedKmh * 10) / 10;
        if (merged.altitude != null) merged.altitude = Math.round(merged.altitude * 10) / 10;
        if (merged.tankLiters != null) merged.tankLiters = Math.round(merged.tankLiters * 100) / 100;
        if (merged.flowRate != null) merged.flowRate = Math.round(merged.flowRate * 10) / 10;
        if (merged.hectaresApplied != null) merged.hectaresApplied = Math.round(merged.hectaresApplied * 100) / 100;

        drones.set(id, { data: merged, time: Date.now() });
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ ok: true, id }));
        console.log('DRONE', id, 'fields:', Object.keys(merged).join(','), new Date().toISOString());
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // Dashboard pega TODOS os drones
  if (p.pathname === '/dash-all') {
    const result = {};
    for (const [id, d] of drones) {
      const isOffline = Date.now() - d.time > OFFLINE_THRESHOLD_MS;
      result[id] = { ...d.data, offline: isOffline };
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(result));
    return;
  }

  // Dashboard pega dados de um drone específico (compatibilidade)
  if (p.pathname === '/dash') {
    const id = p.query.id || 'A001';
    const d = drones.get(id);
    if (d && Date.now() - d.time < OFFLINE_THRESHOLD_MS) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(d.data));
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ offline: true }));
    }
    return;
  }

  // Ping / Health
  if (p.pathname === '/ping' || p.pathname === '/health') {
    const now = Date.now();
    const droneList = Array.from(drones.entries()).map(([id, d]) => ({
      id,
      online: now - d.time < OFFLINE_THRESHOLD_MS,
      lastSeen: d.time
    }));
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ status: 'ok', drones: droneList }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, () => console.log('[SERVER] Agryon Control na porta', PORT));
