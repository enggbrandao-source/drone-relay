const http = require('http');
const url = require('url');
const https = require('https');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'agryon-default-secret';
const drones = new Map();
const OFFLINE_THRESHOLD_MS = 120000;

// Banco em memória para autenticação
const db = {
  users: [],
  companies: [],
  drones: [],
  farms: []
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
  
  console.log('[SEED] Dados iniciais criados');
}

const FIELD_MAP = {
  sp: 'speed', alt: 'altitude', bat: 'batteryPercent',
  tk: 'tankLevel', tkl: 'tankLiters', skm: 'speedKmh',
  fr: 'flowRate', ha: 'hectaresApplied', sig: 'signalStrength',
  rtk: 'rtkStatus', st: 'operationalStatus'
};

// Cache de geolocalizacao por IP
const ipGeoCache = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first && first !== '127.0.0.1') return first;
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp && realIp !== '127.0.0.1') return realIp;
  return req.connection.remoteAddress || req.socket.remoteAddress;
}

function fetchIpLocation(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      resolve(null); return;
    }
    if (ipGeoCache.has(ip)) { resolve(ipGeoCache.get(ip)); return; }
    const apiUrl = `https://ipinfo.io/${ip}/json`;
    https.get(apiUrl, { timeout: 8000 }, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.loc) {
            const [lat, lon] = j.loc.split(',').map(Number);
            const loc = { lat, lon, city: j.city, region: j.region };
            ipGeoCache.set(ip, loc);
            resolve(loc);
          } else { resolve(null); }
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
  });
}

// Middleware de autenticação
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.writeHead(401); res.end(JSON.stringify({ error: 'Token não fornecido' })); return; }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.writeHead(401); res.end(JSON.stringify({ error: 'Token inválido' }));
  }
}

// Helper para parse JSON body
function parseBody(req, callback) {
  let b = '';
  req.on('data', c => b += c);
  req.on('end', () => {
    try { callback(JSON.parse(b)); } catch (e) { callback(null); }
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Agryon Control</title>
<style>
*{margin:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0b0f19;color:#e0e0e0;padding:10px}
h2{text-align:center;color:#00FF88;margin-bottom:6px;font-size:20px}
.subtitle{text-align:center;color:#9aa0a6;font-size:12px;margin-bottom:12px}
.filters{display:flex;justify-content:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.filters button{padding:6px 14px;border-radius:6px;border:1px solid rgba(0,255,136,0.3);background:#111112;color:#9aa0a6;font-size:12px;cursor:pointer}
.filters button.active{background:rgba(0,255,136,0.15);color:#00FF88;border-color:#00FF88}
.drone-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;max-width:1400px;margin:auto}
.drone-card{background:rgba(255,255,255,0.05);border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,0.08);transition:border-color 0.3s}
.drone-card.online{border-color:rgba(0,255,136,0.3)}
.drone-card.offline{border-color:rgba(255,107,44,0.3);opacity:0.7}
.drone-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.drone-id{font-size:16px;font-weight:700;color:#fff}
.drone-status{font-size:11px;padding:3px 8px;border-radius:4px;font-weight:600}
.online{background:rgba(0,255,136,0.15);color:#00FF88}
.offline{background:rgba(255,107,44,0.15);color:#FF6B2C}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.card{background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 6px;text-align:center}
.card .label{color:#9aa0a6;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
.card .value{font-size:18px;font-weight:700;color:#fff;margin-top:3px}
.card .unit{color:#9aa0a6;font-size:10px}
.alert{margin-top:8px;padding:6px 8px;background:rgba(255,68,68,0.1);border-radius:6px;color:#ff4444;font-size:11px}
.timer{text-align:center;margin-top:12px;font-size:12px;color:#666}
.version-info{text-align:center;margin-top:4px;font-size:10px;color:#444}
.drone-info{display:flex;gap:10px;margin-top:8px;font-size:11px;color:#9aa0a6}
</style>
</head>
<body>
<h2>AGRYON CONTROL</h2>
<div class="subtitle">Monitoramento de Frota de Drones</div>
<div style="text-align:center;margin-bottom:10px"><a href="/map" style="color:#00FF88;font-size:12px;text-decoration:none">📍 Ver Mapa de Localizacao</a></div>
<div class="filters">
  <button class="active" onclick="setFilter('all')">Todos</button>
  <button onclick="setFilter('online')">Online</button>
  <button onclick="setFilter('offline')">Offline</button>
</div>
<div class="drone-grid" id="droneGrid"></div>
<div class="timer" id="timer">Ultima atualizacao: --</div>
<div class="version-info" id="versionInfo"></div>
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
let currentFilter='all',droneData={};
function setFilter(f){currentFilter=f;document.querySelectorAll('.filters button').forEach(b=>b.classList.remove('active'));event.target.classList.add('active');render()}
function fmt(v,rnd){if(v==null)return'--';if(typeof v==='number')return v.toFixed(rnd);return v}
function render(){
  const grid=document.getElementById('droneGrid');grid.innerHTML='';
  const ids=Object.keys(droneData).sort();let visibleCount=0;
  ids.forEach(id=>{
    const d=droneData[id],online=!d.offline && !d._d;
    if(currentFilter==='online'&&!online)return;
    if(currentFilter==='offline'&&online)return;
    visibleCount++;
    const card=document.createElement('div');card.className='drone-card '+(online?'online':'offline');
    let html='<div class="drone-header"><div class="drone-id">'+id+'</div><div class="drone-status '+(online?'online':'offline')+'">'+(online?'ONLINE':'OFFLINE')+'</div></div>';
    html+='<div class="drone-info"><span>Piloto: '+(d._pilot||'—')+'</span><span>Fazenda: '+(d._farm||'—')+'</span></div><div class="cards">';
    fields.forEach(f=>{html+='<div class="card"><div class="label">'+f.l+'</div><div class="value">'+fmt(d[f.k],f.round)+'</div><div class="unit">'+f.u+'</div></div>'});
    html+='</div>';
    if(d.systemAlerts&&d.systemAlerts.length){html+='<div class="alert">'+d.systemAlerts.join('; ')+'</div>'}
    if(d._version){html+='<div class="version-info">APK v'+d._version+'</div>'}
    card.innerHTML=html;grid.appendChild(card);
  });
  if(visibleCount===0)grid.innerHTML='<div style="text-align:center;color:#666;padding:40px">Nenhum drone encontrado</div>';
}
async function poll(){
  try{const r=await fetch('/dash-all',{cache:'no-store'});if(!r.ok)throw new Error('offline');droneData=await r.json();render();document.getElementById('timer').textContent='Ultima atualizacao: '+new Date().toLocaleTimeString('pt-BR')}catch(e){document.getElementById('timer').textContent='Erro de conexao — '+new Date().toLocaleTimeString('pt-BR')}}
poll();setInterval(poll,3000);
</script>
</body></html>`;

const MAP_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agryon Control - Mapa</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
*{margin:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0b0f19;color:#e0e0e0}
#map{height:100vh;width:100vw}
.leaflet-popup-content-wrapper{background:#111;border:1px solid rgba(0,255,136,0.3);color:#fff}
.leaflet-popup-content{color:#fff;font-size:12px}
.leaflet-popup-tip{background:#111}
.overlay{position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(11,15,25,0.95);padding:6px 12px;border-radius:8px;border:1px solid rgba(0,255,136,0.2);font-size:12px;color:#9aa0a6;z-index:1000}
.overlay a{color:#00FF88;text-decoration:none;margin-left:8px}
.legend{position:fixed;bottom:8px;right:8px;background:rgba(11,15,25,0.95);padding:8px 12px;border-radius:8px;border:1px solid rgba(0,255,136,0.2);font-size:11px;color:#9aa0a6;z-index:1000}
.legend-item{display:flex;align-items:center;gap:6px;margin:2px 0}
.legend-color{width:12px;height:12px;border-radius:2px}
</style>
</head>
<body>
<div class="overlay">AGRYON GPS <a href="/dashboard.html">Voltar</a></div>
<div id="map"></div>
<div class="legend">
  <div class="legend-item"><div class="legend-color" style="background:#00FF88"></div>Drone Online</div>
  <div class="legend-item"><div class="legend-color" style="background:#FF6B2C"></div>Drone Offline</div>
  <div class="legend-item"><div class="legend-color" style="background:rgba(0,255,136,0.15);border:1px solid #00FF88"></div>Area de trabalho</div>
</div>
<script>
const map=L.map('map').setView([-14.2,-51.9],4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'OpenStreetMap'}).addTo(map);
let markers={}, workAreas={}, viewSet=false;
function fmt(v,r){if(v==null)return'--';if(typeof v==='number')return v.toFixed(r);return v}

function createWorkArea(lat, lon, hectares) {
  if (!lat || !lon) return null;
  const size = hectares ? Math.sqrt(hectares) * 0.00045 : 0.0009;
  const bounds = [
    [lat - size, lon - size],
    [lat - size, lon + size],
    [lat + size, lon + size],
    [lat + size, lon - size]
  ];
  return L.polygon(bounds, {color: '#00FF88', fillColor: '#00FF88', fillOpacity: 0.1, weight: 1, dashArray: '5, 5'});
}

async function refresh(){
  try{
    const r=await fetch('/dash-all',{cache:'no-store'});const data=await r.json();
    const ids=Object.keys(data).sort();let firstValid=null;
    for(const id of ids){
      const d=data[id];
      const lat=d.latitude!=null?d.latitude:null;
      const lon=d.longitude!=null?d.longitude:null;
      const hasCoords=lat!=null&&lon!=null;
      const online=hasCoords && d.offline!==true;
      if(hasCoords&&!firstValid)firstValid={lat,lon};
      const color=online?'#00FF88':'#FF6B2C';
      const popup='<div style="min-width:180px">'+
        '<div style="font-size:14px;font-weight:700;color:#00FF88;margin-bottom:6px">'+id+'</div>'+
        '<div style="font-size:11px;color:#aaa">'+(online?'<span style="color:#00FF88">● ONLINE</span>':'<span style="color:#FF6B2C">● OFFLINE</span>')+'</div>'+
        '<hr style="border:0;border-top:1px solid #333;margin:6px 0">'+
        '<div style="font-size:12px">Piloto: <b>'+(d._pilot||'-')+'</b><br>Fazenda: <b>'+(d._farm||'-')+'</b></div>'+
        '<hr style="border:0;border-top:1px solid #333;margin:6px 0">'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px">'+
        '<div>Bateria: <b>'+d.batteryPercent+'%</b></div>'+
        '<div>Tanque: <b>'+fmt(d.tankLiters,2)+'L</b></div>'+
        '<div>Vel: <b>'+fmt(d.speedKmh,1)+'km/h</b></div>'+
        '<div>Alt: <b>'+fmt(d.altitude,1)+'m</b></div>'+
        '<div>Sats: <b>'+(d.signalStrength||'-')+'</b></div>'+
        '<div>Status: <b>'+(d.operationalStatus||'-')+'</b></div>'+
        '<div>RTK: <b>'+(d.rtkStatus||'-')+'</b></div>'+
        '</div></div>';
      
      if(markers[id]){
        markers[id].marker.setLatLng([lat||-14.2,lon||-51.9]).setPopupContent(popup);
        if(markers[id].circle)markers[id].circle.setLatLng([lat||-14.2,lon||-51.9]);
      }else{
        const m=L.marker([lat||-14.2,lon||-51.9]).addTo(map).bindPopup(popup);
        const c=L.circleMarker([lat||-14.2,lon||-51.9],{radius:8,fillColor:color,color:color,weight:2,fillOpacity:0.6}).addTo(map);
        markers[id]={marker:m,circle:c};
      }
      
      if(markers[id].circle){
        markers[id].circle.setStyle({fillColor:color,color:color});
      }
      
      if(online && d.hectaresApplied > 0) {
        if(workAreas[id]) map.removeLayer(workAreas[id]);
        const area = createWorkArea(lat, lon, d.hectaresApplied);
        if(area) { area.addTo(map); workAreas[id] = area; }
      }
    }
    for(const id in markers){if(!data[id]){map.removeLayer(markers[id].marker);if(markers[id].circle)map.removeLayer(markers[id].circle);delete markers[id];}}
    for(const id in workAreas){if(!data[id] || data[id].offline){map.removeLayer(workAreas[id]);delete workAreas[id];}}
    if(firstValid&&!viewSet){map.setView([firstValid.lat,firstValid.lon],15);viewSet=true;}
  }catch(e){console.error(e)}
}
refresh();setInterval(refresh,5000);
</script>
</body></html>`;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const p = url.parse(req.url, true);

  // Dashboard publico
  if (p.pathname === '/' || p.pathname === '/dashboard.html') {
    res.writeHead(200, {'Content-Type': 'text/html'}); res.end(DASHBOARD_HTML); return;
  }

  // Mapa GPS
  if (p.pathname === '/map') {
    res.writeHead(200, {'Content-Type': 'text/html'}); res.end(MAP_HTML); return;
  }

  // === AUTH ===
  if (p.pathname === '/auth/login' && req.method === 'POST') {
    parseBody(req, async (body) => {
      if (!body) { res.writeHead(400); res.end(JSON.stringify({ error: 'Body inválido' })); return; }
      const { email, password } = body;
      const user = db.users.find(u => u.email === email);
      if (!user || !await bcrypt.compare(password, user.password)) {
        res.writeHead(401); res.end(JSON.stringify({ error: 'Credenciais inválidas' })); return;
      }
      const token = jwt.sign({ id: user.id, email, role: user.role, companyId: user.companyId }, JWT_SECRET);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ token, user: { id: user.id, name: user.name, email, role: user.role, companyId: user.companyId } }));
    });
    return;
  }

  if (p.pathname === '/auth/register' && req.method === 'POST') {
    parseBody(req, async (body) => {
      if (!body) { res.writeHead(400); res.end(JSON.stringify({ error: 'Body inválido' })); return; }
      const { email, password, name, companyName } = body;
      const hashed = await bcrypt.hash(password, 10);
      const company = { id: String(db.companies.length + 1), name: companyName || name + ' Ltda', plan: 'free', active: true, createdAt: new Date() };
      db.companies.push(company);
      const user = { id: String(db.users.length + 1), email, password: hashed, name, role: 'cliente', companyId: company.id, createdAt: new Date() };
      db.users.push(user);
      const token = jwt.sign({ id: user.id, email, role: user.role, companyId: company.id }, JWT_SECRET);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ token, user: { id: user.id, name, email, role: user.role, companyId: company.id } }));
    });
    return;
  }

  // === API PROTEGIDA - DRONES ===
  if (p.pathname === '/api/drones' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const where = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
      const drones = db.drones.filter(d => !where.companyId || d.companyId === where.companyId);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(drones.map(d => ({
        ...d,
        pilot: db.users.find(u => u.id === d.pilotId)?.name || null,
        farm: db.farms.find(f => f.id === d.farmId)?.name || null
      }))));
    });
    return;
  }

  if (p.pathname === '/api/drones' && req.method === 'POST') {
    authMiddleware(req, res, () => {
      parseBody(req, (body) => {
        const { code, model, pilotId, farmId } = body;
        const companyId = req.user.role === 'admin' ? body.companyId : req.user.companyId;
        const drone = { id: String(db.drones.length + 1), code, model, companyId, pilotId, farmId, active: true, createdAt: new Date(), lastData: null, lastSeen: null };
        db.drones.push(drone);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(drone));
      });
    });
    return;
  }

  // === API PROTEGIDA - FARMS ===
  if (p.pathname === '/api/farms' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const where = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
      const farms = db.farms.filter(f => !where.companyId || f.companyId === where.companyId);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(farms));
    });
    return;
  }

  if (p.pathname === '/api/farms' && req.method === 'POST') {
    authMiddleware(req, res, () => {
      parseBody(req, (body) => {
        const { name, location } = body;
        const companyId = req.user.role === 'admin' ? body.companyId : req.user.companyId;
        const farm = { id: String(db.farms.length + 1), name, location, companyId, active: true, createdAt: new Date() };
        db.farms.push(farm);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(farm));
      });
    });
    return;
  }

  // === API PROTEGIDA - USER PROFILE ===
  if (p.pathname === '/api/me' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const user = db.users.find(u => u.id === req.user.id);
      const company = db.companies.find(c => c.id === user.companyId);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: company ? { id: company.id, name: company.name, plan: company.plan } : null
      }));
    });
    return;
  }

  // App (redireciona para dashboard por enquanto)
  if (p.pathname === '/app' || p.pathname === '/app/' || p.pathname === '/app/login') {
    res.writeHead(302, {'Location': '/dashboard.html'}); res.end(); return;
  }

  // Debug - ver IP que chega
  if (p.pathname === '/debug') {
    const clientIp = getClientIp(req);
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      clientIp,
      headers: req.headers,
      remoteAddress: req.connection.remoteAddress,
      socketRemoteAddress: req.socket.remoteAddress
    }));
    return;
  }

  // Drone envia telemetria
  if (p.pathname === '/drone' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', async () => {
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
        // Preserva latitude/longitude se vieram do APK
        if (j.latitude != null) merged.latitude = j.latitude;
        if (j.longitude != null) merged.longitude = j.longitude;
        if (merged.speedKmh != null) merged.speedKmh = Math.round(merged.speedKmh * 10) / 10;
        if (merged.altitude != null) merged.altitude = Math.round(merged.altitude * 10) / 10;
        if (merged.tankLiters != null) merged.tankLiters = Math.round(merged.tankLiters * 100) / 100;
        if (merged.flowRate != null) merged.flowRate = Math.round(merged.flowRate * 10) / 10;
        if (merged.hectaresApplied != null) merged.hectaresApplied = Math.round(merged.hectaresApplied * 100) / 100;

        // Geolocalizacao por IP SO SE nao veio do APK
        if (merged.latitude == null || merged.longitude == null) {
          const clientIp = getClientIp(req);
          console.log('[GEO] Drone', id, 'IP detectado:', clientIp);
          const loc = await fetchIpLocation(clientIp);
          if (loc) {
            merged.latitude = loc.lat;
            merged.longitude = loc.lon;
            merged._geoCity = loc.city;
            merged._geoRegion = loc.region;
            console.log('[GEO] Drone', id, 'localizado em:', loc.city, loc.region);
          } else {
            console.log('[GEO] Drone', id, 'falha ao localizar IP:', clientIp);
          }
        } else {
          console.log('[GEO] Drone', id, 'usando coords do APK:', merged.latitude, merged.longitude);
        }

        drones.set(id, { data: merged, time: Date.now() });
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ ok: true, id }));
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // Dashboard all
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

  // Health
  if (p.pathname === '/health' || p.pathname === '/ping') {
    const now = Date.now();
    const droneList = Array.from(drones.entries()).map(([id, d]) => ({
      id, online: now - d.time < OFFLINE_THRESHOLD_MS, lastSeen: d.time,
      lat: d.data.latitude, lon: d.data.longitude, city: d.data._geoCity
    }));
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ status: 'ok', version: '2.4.0', drones: droneList }));
    return;
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, async () => {
  await seed();
  console.log('[AGRYON] v2.4.0 — Auth JWT + API — Porta', PORT);
});