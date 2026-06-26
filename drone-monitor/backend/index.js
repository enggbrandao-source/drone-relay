const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const https = require('https');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { loadStore, saveStore } = require('./store');
const {
  OPERATION_INACTIVITY_MS,
  buildOperationsResponse,
  closeInactiveOperations,
  listOperationDays,
  processTelemetryForOperations
} = require('./operations');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'agryon-default-secret';
const APP_VERSION = require('./package.json').version;
const OFFLINE_THRESHOLD_MS = 120000;
const STORE_FILE = path.join(__dirname, 'data', 'store.json');
const APP_HTML_FILE = path.join(__dirname, 'static', 'app.html');

const FIELD_MAP = {
  sp: 'speed',
  alt: 'altitude',
  bat: 'batteryPercent',
  tk: 'tankLevel',
  tkl: 'tankLiters',
  skm: 'speedKmh',
  fr: 'flowRate',
  ha: 'hectaresApplied',
  sig: 'signalStrength',
  rtk: 'rtkStatus',
  st: 'operationalStatus'
};

const persistedState = loadStore(STORE_FILE);
const drones = new Map();
const ipGeoCache = new Map();

const db = {
  users: persistedState.users,
  companies: persistedState.companies,
  drones: persistedState.drones,
  farms: persistedState.farms,
  operations: persistedState.operations,
  operationStates: persistedState.operationStates
};

let persistTimer = null;

function persistStoreNow() {
  saveStore(STORE_FILE, db);
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistStoreNow();
  }, 250);
}

function nextId(list) {
  return String(list.reduce((maxValue, item) => Math.max(maxValue, Number(item.id) || 0), 0) + 1);
}

function normalizeDateParam(dateValue) {
  const value = String(dateValue || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split('/');
    return `${year}-${month}-${day}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
    const [day, month, year] = value.split('-');
    return `${year}-${month}-${day}`;
  }
  return value;
}

function getScopedCompanyId(user, requestedCompanyId) {
  if (user.role === 'admin') {
    return requestedCompanyId || user.companyId || db.companies[0]?.id || '1';
  }
  return user.companyId;
}

function getOperationsCompanyFilter(user) {
  return user.role === 'admin' ? null : user.companyId;
}

function getRegisteredDrone(droneCode) {
  return db.drones.find((drone) => drone.code === droneCode) || null;
}

function getOperationCompanyId(droneCode) {
  return getRegisteredDrone(droneCode)?.companyId || db.companies[0]?.id || '1';
}

function getOperationDroneId(droneCode) {
  return getRegisteredDrone(droneCode)?.id || droneCode;
}

function touchRegisteredDrone(droneCode, mergedTelemetry, telemetryAtMs) {
  const registeredDrone = getRegisteredDrone(droneCode);
  if (!registeredDrone) return;
  registeredDrone.lastSeen = new Date(telemetryAtMs).toISOString();
  registeredDrone.lastData = JSON.stringify(mergedTelemetry);
  if (mergedTelemetry.latitude != null) registeredDrone.lastLat = mergedTelemetry.latitude;
  if (mergedTelemetry.longitude != null) registeredDrone.lastLon = mergedTelemetry.longitude;
  schedulePersist();
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function getAppHtml() {
  try {
    return fs.readFileSync(APP_HTML_FILE, 'utf8');
  } catch {
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Agryon Control</title></head><body style="font-family:Segoe UI,sans-serif;background:#0b0f19;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh"><div><h1 style="color:#34d399">AGRYON CONTROL</h1><p>Falha ao carregar a interface autenticada.</p><p><a href="/dashboard.html" style="color:#34d399">Abrir dashboard público</a></p></div></body></html>';
  }
}

function buildOperationsCsv(operations) {
  const headers = [
    'data',
    'droneId',
    'droneCode',
    'status',
    'closeReason',
    'startedAt',
    'endedAt',
    'totalOperation',
    'totalEffectiveFlight',
    'totalPaused',
    'averagePauseBetweenFlights',
    'totalFlights',
    'hectaresWorked',
    'pilotName',
    'farmName',
    'companyId'
  ];
  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = operations.map((operation) => [
    operation.dateLabel || operation.date,
    operation.droneId,
    operation.droneCode,
    operation.status,
    operation.closeReason || '',
    operation.startedAt,
    operation.endedAt || '',
    operation.totalOperationLabel || operation.durationLabel || '',
    operation.totalEffectiveFlightLabel || '',
    operation.totalPausedLabel || '',
    operation.averagePauseLabel || '',
    operation.totalFlights,
    operation.hectaresWorked,
    operation.pilotName || '',
    operation.farmName || '',
    operation.companyId || ''
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

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
      resolve(null);
      return;
    }
    if (ipGeoCache.has(ip)) {
      resolve(ipGeoCache.get(ip));
      return;
    }
    const apiUrl = `https://ipinfo.io/${ip}/json`;
    https.get(apiUrl, { timeout: 8000 }, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => data += chunk);
      apiRes.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (!payload.loc) {
            resolve(null);
            return;
          }
          const [lat, lon] = payload.loc.split(',').map(Number);
          const location = { lat, lon, city: payload.city, region: payload.region };
          ipGeoCache.set(ip, location);
          resolve(location);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
  });
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    sendJson(res, 401, { error: 'Token nao fornecido' });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    sendJson(res, 401, { error: 'Token invalido' });
  }
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', () => {
    try {
      callback(JSON.parse(body || '{}'));
    } catch {
      callback(null);
    }
  });
}

async function seed() {
  if (!db.companies.find((company) => company.id === '1')) {
    db.companies.push({
      id: '1',
      name: 'AgroDrone Demo',
      plan: 'pro',
      active: true,
      createdAt: new Date().toISOString()
    });
  }

  if (!db.users.find((user) => user.email === 'admin@agryon.com')) {
    db.users.push({
      id: '1',
      email: 'admin@agryon.com',
      password: await bcrypt.hash('admin123', 10),
      name: 'Administrador',
      role: 'admin',
      companyId: '1',
      createdAt: new Date().toISOString()
    });
  }

  if (!db.users.find((user) => user.email === 'cliente@demo.com')) {
    db.users.push({
      id: '2',
      email: 'cliente@demo.com',
      password: await bcrypt.hash('cliente123', 10),
      name: 'Cliente Demo',
      role: 'cliente',
      companyId: '1',
      createdAt: new Date().toISOString()
    });
  }

  if (!db.farms.find((farm) => farm.id === '1')) {
    db.farms.push({
      id: '1',
      name: 'Fazenda Sao Joao',
      location: 'Ribeirao Preto - SP',
      companyId: '1',
      createdAt: new Date().toISOString()
    });
  }

  if (!db.farms.find((farm) => farm.id === '2')) {
    db.farms.push({
      id: '2',
      name: 'Fazenda Boa Vista',
      location: 'Sertaozinho - SP',
      companyId: '1',
      createdAt: new Date().toISOString()
    });
  }

  persistStoreNow();
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Agryon Control</title>
<style>
*{margin:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0b0f19;color:#e0e0e0;padding:10px}
h2{text-align:center;color:#00FF88;margin-bottom:6px;font-size:20px}.subtitle{text-align:center;color:#9aa0a6;font-size:12px;margin-bottom:12px}
.filters{display:flex;justify-content:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}.filters button{padding:6px 14px;border-radius:6px;border:1px solid rgba(0,255,136,0.3);background:#111112;color:#9aa0a6;font-size:12px;cursor:pointer}
.filters button.active{background:rgba(0,255,136,0.15);color:#00FF88;border-color:#00FF88}.drone-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;max-width:1400px;margin:auto}
.drone-card{background:rgba(255,255,255,0.05);border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,0.08);transition:border-color 0.3s}.drone-card.online{border-color:rgba(0,255,136,0.3)}
.drone-card.offline{border-color:rgba(255,107,44,0.3);opacity:0.7}.drone-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.drone-id{font-size:16px;font-weight:700;color:#fff}
.drone-status{font-size:11px;padding:3px 8px;border-radius:4px;font-weight:600}.online{background:rgba(0,255,136,0.15);color:#00FF88}.offline{background:rgba(255,107,44,0.15);color:#FF6B2C}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.card{background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 6px;text-align:center}.card .label{color:#9aa0a6;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
.card .value{font-size:18px;font-weight:700;color:#fff;margin-top:3px}.card .unit{color:#9aa0a6;font-size:10px}.alert{margin-top:8px;padding:6px 8px;background:rgba(255,68,68,0.1);border-radius:6px;color:#ff4444;font-size:11px}
.timer{text-align:center;margin-top:12px;font-size:12px;color:#666}.version-info{text-align:center;margin-top:4px;font-size:10px;color:#444}.drone-info{display:flex;gap:10px;margin-top:8px;font-size:11px;color:#9aa0a6}
</style>
</head>
<body>
<h2>AGRYON CONTROL</h2>
<div class="subtitle">Monitoramento de Frota de Drones</div>
<div style="text-align:center;margin-bottom:10px"><a href="/map" style="color:#00FF88;font-size:12px;text-decoration:none">Ver mapa de localizacao</a></div>
<div class="filters">
  <button class="active" onclick="setFilter('all', event)">Todos</button>
  <button onclick="setFilter('online', event)">Online</button>
  <button onclick="setFilter('offline', event)">Offline</button>
</div>
<div class="drone-grid" id="droneGrid"></div>
<div class="timer" id="timer">Ultima atualizacao: --</div>
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
function setFilter(filter, event){currentFilter=filter;document.querySelectorAll('.filters button').forEach(function(button){button.classList.remove('active')});if(event)event.target.classList.add('active');render()}
function fmt(v,rnd){if(v==null)return'--';if(typeof v==='number')return v.toFixed(rnd);return v}
function render(){
  const grid=document.getElementById('droneGrid');grid.innerHTML='';
  const ids=Object.keys(droneData).sort();let visibleCount=0;
  ids.forEach(function(id){
    const d=droneData[id],online=!d.offline;
    if(currentFilter==='online'&&!online)return;
    if(currentFilter==='offline'&&online)return;
    visibleCount++;
    const card=document.createElement('div');card.className='drone-card '+(online?'online':'offline');
    let html='<div class="drone-header"><div class="drone-id">'+id+'</div><div class="drone-status '+(online?'online':'offline')+'">'+(online?'ONLINE':'OFFLINE')+'</div></div>';
    html+='<div class="drone-info"><span>Piloto: '+(d._pilot||'--')+'</span><span>Fazenda: '+(d._farm||'--')+'</span></div><div class="cards">';
    fields.forEach(function(field){html+='<div class="card"><div class="label">'+field.l+'</div><div class="value">'+fmt(d[field.k],field.round)+'</div><div class="unit">'+field.u+'</div></div>'});
    html+='</div>';
    if(d.systemAlerts&&d.systemAlerts.length){html+='<div class="alert">'+d.systemAlerts.join('; ')+'</div>'}
    if(d._version){html+='<div class="version-info">APK v'+d._version+'</div>'}
    card.innerHTML=html;grid.appendChild(card);
  });
  if(visibleCount===0)grid.innerHTML='<div style="text-align:center;color:#666;padding:40px">Nenhum drone encontrado</div>';
}
async function poll(){
  try{
    const res=await fetch('/dash-all',{cache:'no-store'});
    if(!res.ok)throw new Error('offline');
    droneData=await res.json();
    render();
    document.getElementById('timer').textContent='Ultima atualizacao: '+new Date().toLocaleTimeString('pt-BR');
  }catch(e){
    document.getElementById('timer').textContent='Erro de conexao - '+new Date().toLocaleTimeString('pt-BR');
  }
}
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
#map{height:100vh;width:100vw}.overlay{position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(11,15,25,0.95);padding:6px 12px;border-radius:8px;border:1px solid rgba(0,255,136,0.2);font-size:12px;color:#9aa0a6;z-index:1000}
.overlay a{color:#00FF88;text-decoration:none;margin-left:8px}.legend{position:fixed;bottom:8px;right:8px;background:rgba(11,15,25,0.95);padding:8px 12px;border-radius:8px;border:1px solid rgba(0,255,136,0.2);font-size:11px;color:#9aa0a6;z-index:1000}
.legend-item{display:flex;align-items:center;gap:6px;margin:2px 0}.legend-color{width:12px;height:12px;border-radius:2px}
</style>
</head>
<body>
<div class="overlay">AGRYON GPS <a href="/dashboard.html">Voltar</a></div>
<div id="map"></div>
<div class="legend">
  <div class="legend-item"><div class="legend-color" style="background:#00FF88"></div>Drone online</div>
  <div class="legend-item"><div class="legend-color" style="background:#FF6B2C"></div>Drone offline</div>
  <div class="legend-item"><div class="legend-color" style="background:rgba(0,255,136,0.15);border:1px solid #00FF88"></div>Area de trabalho</div>
</div>
<script>
const map=L.map('map').setView([-14.2,-51.9],4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'OpenStreetMap'}).addTo(map);
let markers={}, workAreas={}, viewSet=false;
function fmt(v,r){if(v==null)return'--';if(typeof v==='number')return v.toFixed(r);return v}
function createWorkArea(lat, lon, hectares){
  if(lat==null||lon==null)return null;
  const size = hectares ? Math.sqrt(hectares) * 0.00045 : 0.0009;
  return L.polygon([[lat-size,lon-size],[lat-size,lon+size],[lat+size,lon+size],[lat+size,lon-size]],{color:'#00FF88',fillColor:'#00FF88',fillOpacity:0.1,weight:1,dashArray:'5, 5'});
}
async function refresh(){
  try{
    const response=await fetch('/dash-all',{cache:'no-store'});
    const data=await response.json();
    const ids=Object.keys(data).sort();let firstValid=null;
    ids.forEach(function(id){
      const d=data[id];
      const lat=d.latitude!=null?d.latitude:null;
      const lon=d.longitude!=null?d.longitude:null;
      const hasCoords=lat!=null&&lon!=null;
      const online=hasCoords && d.offline!==true;
      if(hasCoords&&!firstValid)firstValid={lat:lat,lon:lon};
      const color=online?'#00FF88':'#FF6B2C';
      const popup='<div style="min-width:180px"><div style="font-size:14px;font-weight:700;color:#00FF88;margin-bottom:6px">'+id+'</div><div style="font-size:11px;color:#aaa">'+(online?'<span style="color:#00FF88">ONLINE</span>':'<span style="color:#FF6B2C">OFFLINE</span>')+'</div><hr style="border:0;border-top:1px solid #333;margin:6px 0"><div style="font-size:12px">Piloto: <b>'+(d._pilot||'-')+'</b><br>Fazenda: <b>'+(d._farm||'-')+'</b></div><hr style="border:0;border-top:1px solid #333;margin:6px 0"><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px"><div>Bateria: <b>'+(d.batteryPercent ?? '--')+'%</b></div><div>Tanque: <b>'+fmt(d.tankLiters,2)+'L</b></div><div>Vel: <b>'+fmt(d.speedKmh,1)+'km/h</b></div><div>Alt: <b>'+fmt(d.altitude,1)+'m</b></div><div>Sats: <b>'+(d.signalStrength||'-')+'</b></div><div>Status: <b>'+(d.operationalStatus||'-')+'</b></div><div>RTK: <b>'+(d.rtkStatus||'-')+'</b></div></div></div>';
      if(markers[id]){
        markers[id].marker.setLatLng([lat||-14.2,lon||-51.9]).setPopupContent(popup);
        markers[id].circle.setLatLng([lat||-14.2,lon||-51.9]).setStyle({fillColor:color,color:color});
      }else{
        markers[id]={marker:L.marker([lat||-14.2,lon||-51.9]).addTo(map).bindPopup(popup),circle:L.circleMarker([lat||-14.2,lon||-51.9],{radius:8,fillColor:color,color:color,weight:2,fillOpacity:0.6}).addTo(map)};
      }
      if(online && d.hectaresApplied > 0){
        if(workAreas[id]) map.removeLayer(workAreas[id]);
        const area=createWorkArea(lat,lon,d.hectaresApplied);
        if(area){ area.addTo(map); workAreas[id]=area; }
      }
    });
    Object.keys(markers).forEach(function(id){if(!data[id]){map.removeLayer(markers[id].marker);map.removeLayer(markers[id].circle);delete markers[id];}});
    Object.keys(workAreas).forEach(function(id){if(!data[id]||data[id].offline){map.removeLayer(workAreas[id]);delete workAreas[id];}});
    if(firstValid && !viewSet){map.setView([firstValid.lat,firstValid.lon],15);viewSet=true;}
  }catch(e){console.error(e);}
}
refresh();setInterval(refresh,5000);
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (parsedUrl.pathname === '/map') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(MAP_HTML);
    return;
  }

  if (parsedUrl.pathname === '/app' || parsedUrl.pathname === '/app/' || parsedUrl.pathname === '/app/login') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getAppHtml());
    return;
  }

  if (parsedUrl.pathname === '/debug') {
    sendJson(res, 200, {
      clientIp: getClientIp(req),
      headers: req.headers,
      remoteAddress: req.connection.remoteAddress,
      socketRemoteAddress: req.socket.remoteAddress
    });
    return;
  }

  if (parsedUrl.pathname === '/auth/login' && req.method === 'POST') {
    parseBody(req, async (body) => {
      if (!body) {
        sendJson(res, 400, { error: 'Body invalido' });
        return;
      }
      const { email, password } = body;
      const user = db.users.find((item) => item.email === email);
      if (!user || !await bcrypt.compare(password, user.password)) {
        sendJson(res, 401, { error: 'Credenciais invalidas' });
        return;
      }
      const token = jwt.sign({ id: user.id, email, role: user.role, companyId: user.companyId }, JWT_SECRET);
      sendJson(res, 200, {
        token,
        user: {
          id: user.id,
          name: user.name,
          email,
          role: user.role,
          companyId: user.companyId
        }
      });
    });
    return;
  }

  if (parsedUrl.pathname === '/auth/register' && req.method === 'POST') {
    parseBody(req, async (body) => {
      if (!body) {
        sendJson(res, 400, { error: 'Body invalido' });
        return;
      }
      const { email, password, name, companyName } = body;
      if (!email || !password || !name) {
        sendJson(res, 400, { error: 'Nome, email e senha sao obrigatorios' });
        return;
      }
      if (db.users.find((user) => user.email === email)) {
        sendJson(res, 409, { error: 'E-mail ja cadastrado' });
        return;
      }
      const company = {
        id: nextId(db.companies),
        name: companyName || `${name} Ltda`,
        plan: 'free',
        active: true,
        createdAt: new Date().toISOString()
      };
      db.companies.push(company);
      const user = {
        id: nextId(db.users),
        email,
        password: await bcrypt.hash(password, 10),
        name,
        role: 'cliente',
        companyId: company.id,
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      schedulePersist();
      const token = jwt.sign({ id: user.id, email, role: user.role, companyId: company.id }, JWT_SECRET);
      sendJson(res, 200, {
        token,
        user: { id: user.id, name, email, role: user.role, companyId: company.id }
      });
    });
    return;
  }

  if (parsedUrl.pathname === '/api/me' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const user = db.users.find((item) => item.id === req.user.id);
      const company = db.companies.find((item) => item.id === user.companyId);
      sendJson(res, 200, {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: company ? { id: company.id, name: company.name, plan: company.plan } : null
      });
    });
    return;
  }

  if (parsedUrl.pathname === '/api/drones' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const companyId = getOperationsCompanyFilter(req.user);
      const items = db.drones
        .filter((drone) => !companyId || drone.companyId === companyId)
        .map((drone) => ({
          ...drone,
          pilot: db.users.find((user) => user.id === drone.pilotId)?.name || null,
          farm: db.farms.find((farm) => farm.id === drone.farmId)?.name || null
        }));
      sendJson(res, 200, items);
    });
    return;
  }

  if (parsedUrl.pathname === '/api/drones' && req.method === 'POST') {
    authMiddleware(req, res, () => {
      parseBody(req, (body) => {
        if (!body?.code) {
          sendJson(res, 400, { error: 'Codigo do drone e obrigatorio' });
          return;
        }
        if (db.drones.find((drone) => drone.code === body.code)) {
          sendJson(res, 409, { error: 'Ja existe um drone com este codigo' });
          return;
        }
        const drone = {
          id: nextId(db.drones),
          code: body.code,
          model: body.model || 'DJI Agras',
          companyId: getScopedCompanyId(req.user, body.companyId),
          pilotId: body.pilotId || null,
          farmId: body.farmId || null,
          active: true,
          createdAt: new Date().toISOString(),
          lastData: null,
          lastSeen: null,
          lastLat: null,
          lastLon: null
        };
        db.drones.push(drone);
        schedulePersist();
        sendJson(res, 200, drone);
      });
    });
    return;
  }

  if (parsedUrl.pathname === '/api/farms' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const companyId = getOperationsCompanyFilter(req.user);
      sendJson(res, 200, db.farms.filter((farm) => !companyId || farm.companyId === companyId));
    });
    return;
  }

  if (parsedUrl.pathname === '/api/farms' && req.method === 'POST') {
    authMiddleware(req, res, () => {
      parseBody(req, (body) => {
        if (!body?.name) {
          sendJson(res, 400, { error: 'Nome da fazenda e obrigatorio' });
          return;
        }
        const farm = {
          id: nextId(db.farms),
          name: body.name,
          location: body.location || null,
          companyId: getScopedCompanyId(req.user, body.companyId),
          active: true,
          createdAt: new Date().toISOString()
        };
        db.farms.push(farm);
        schedulePersist();
        sendJson(res, 200, farm);
      });
    });
    return;
  }

  if (parsedUrl.pathname === '/operations' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
        schedulePersist();
      }
      const dateFrom = parsedUrl.query.dateFrom ? normalizeDateParam(parsedUrl.query.dateFrom) : null;
      const dateTo = parsedUrl.query.dateTo ? normalizeDateParam(parsedUrl.query.dateTo) : null;
      sendJson(res, 200, {
        days: listOperationDays(db.operations, {
          companyId: getOperationsCompanyFilter(req.user),
          dateFrom,
          dateTo
        }, db.operationStates)
      });
    });
    return;
  }

  if (parsedUrl.pathname === '/operations/export.csv' && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const companyId = getOperationsCompanyFilter(req.user);
      const dateKey = parsedUrl.query.date ? normalizeDateParam(parsedUrl.query.date) : null;
      const dateFrom = parsedUrl.query.dateFrom ? normalizeDateParam(parsedUrl.query.dateFrom) : null;
      const dateTo = parsedUrl.query.dateTo ? normalizeDateParam(parsedUrl.query.dateTo) : null;
      const droneFilter = parsedUrl.query.droneId ? String(parsedUrl.query.droneId) : null;
      if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
        schedulePersist();
      }
      const payload = buildOperationsResponse(db.operations, {
        companyId,
        dateKey,
        dateFrom,
        dateTo,
        droneFilter,
        operationStates: db.operationStates
      });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="operations-${dateKey || dateFrom || 'all'}${dateTo ? `-${dateTo}` : ''}${droneFilter ? `-${droneFilter}` : ''}.csv"`
      });
      res.end(buildOperationsCsv(payload.operations));
    });
    return;
  }

  const operationsSummaryMatch = parsedUrl.pathname.match(/^\/operations\/summary\/([^/]+)$/);
  if (operationsSummaryMatch && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const dateKey = normalizeDateParam(decodeURIComponent(operationsSummaryMatch[1]));
      if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
        schedulePersist();
      }
      const payload = buildOperationsResponse(db.operations, {
        companyId: getOperationsCompanyFilter(req.user),
        dateKey,
        operationStates: db.operationStates
      });
      sendJson(res, 200, payload.summary);
    });
    return;
  }

  const operationsDroneDayMatch = parsedUrl.pathname.match(/^\/operations\/([^/]+)\/([^/]+)$/);
  if (operationsDroneDayMatch && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const dateKey = normalizeDateParam(decodeURIComponent(operationsDroneDayMatch[1]));
      const droneFilter = decodeURIComponent(operationsDroneDayMatch[2]);
      if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
        schedulePersist();
      }
      sendJson(res, 200, buildOperationsResponse(db.operations, {
        companyId: getOperationsCompanyFilter(req.user),
        dateKey,
        droneFilter,
        operationStates: db.operationStates
      }));
    });
    return;
  }

  const operationsDayMatch = parsedUrl.pathname.match(/^\/operations\/([^/]+)$/);
  if (operationsDayMatch && req.method === 'GET') {
    authMiddleware(req, res, () => {
      const dateKey = normalizeDateParam(decodeURIComponent(operationsDayMatch[1]));
      if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
        schedulePersist();
      }
      sendJson(res, 200, buildOperationsResponse(db.operations, {
        companyId: getOperationsCompanyFilter(req.user),
        dateKey,
        operationStates: db.operationStates
      }));
    });
    return;
  }

  if (parsedUrl.pathname === '/drone' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const droneCode = payload._id || payload.id || 'A001';
        const existingLive = drones.get(droneCode);
        const merged = { ...(existingLive ? existingLive.data : {}) };

        Object.entries(payload).forEach(([key, value]) => {
          if (key === '_pilot' || key === '_farm' || key === '_version') {
            merged[key] = value;
            return;
          }
          if (key.startsWith('_')) return;
          const mappedKey = FIELD_MAP[key] || key;
          merged[mappedKey] = value;
        });

        if (payload.latitude != null) merged.latitude = payload.latitude;
        if (payload.longitude != null) merged.longitude = payload.longitude;
        if (merged.speedKmh != null) merged.speedKmh = Math.round(Number(merged.speedKmh) * 10) / 10;
        if (merged.altitude != null) merged.altitude = Math.round(Number(merged.altitude) * 10) / 10;
        if (merged.tankLiters != null) merged.tankLiters = Math.round(Number(merged.tankLiters) * 100) / 100;
        if (merged.flowRate != null) merged.flowRate = Math.round(Number(merged.flowRate) * 10) / 10;
        if (merged.hectaresApplied != null) merged.hectaresApplied = Math.round(Number(merged.hectaresApplied) * 100) / 100;

        if (merged.latitude == null || merged.longitude == null) {
          const clientIp = getClientIp(req);
          const location = await fetchIpLocation(clientIp);
          if (location) {
            merged.latitude = location.lat;
            merged.longitude = location.lon;
            merged._geoCity = location.city;
            merged._geoRegion = location.region;
          }
        }

        const telemetryAtMs = Number(payload._ts || payload.ts || Date.now());
        drones.set(droneCode, { data: merged, time: Date.now() });
        touchRegisteredDrone(droneCode, merged, Number.isFinite(telemetryAtMs) ? telemetryAtMs : Date.now());

        const operationResult = processTelemetryForOperations({
          operations: db.operations,
          operationStates: db.operationStates,
          droneCode,
          droneId: getOperationDroneId(droneCode),
          companyId: getOperationCompanyId(droneCode),
          telemetry: merged,
          telemetryAtMs: Number.isFinite(telemetryAtMs) ? telemetryAtMs : Date.now(),
          pilotName: payload._pilot || merged._pilot || null,
          farmName: payload._farm || merged._farm || null
        });

        if (operationResult.changed) schedulePersist();

        sendJson(res, 200, {
          ok: true,
          id: droneCode,
          operationId: operationResult.currentOperationId || null
        });
      } catch {
        sendJson(res, 400, { error: 'Payload invalido' });
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/dash-all') {
    const result = {};
    for (const [droneCode, live] of drones.entries()) {
      result[droneCode] = {
        ...live.data,
        offline: Date.now() - live.time > OFFLINE_THRESHOLD_MS
      };
    }
    sendJson(res, 200, result);
    return;
  }

  if (parsedUrl.pathname === '/health' || parsedUrl.pathname === '/ping') {
    if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
      schedulePersist();
    }
    const droneList = Array.from(drones.entries()).map(([droneCode, live]) => ({
      id: droneCode,
      online: Date.now() - live.time < OFFLINE_THRESHOLD_MS,
      lastSeen: live.time,
      lat: live.data.latitude,
      lon: live.data.longitude,
      city: live.data._geoCity
    }));
    sendJson(res, 200, {
      status: 'ok',
      version: APP_VERSION,
      drones: droneList,
      operationsTracked: db.operations.length,
      persistenceFile: fs.existsSync(STORE_FILE) ? path.basename(STORE_FILE) : null,
      inactivityWindowMs: OPERATION_INACTIVITY_MS
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, async () => {
  await seed();
  if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
    persistStoreNow();
  }
  setInterval(() => {
    if (closeInactiveOperations({ operations: db.operations, operationStates: db.operationStates })) {
      schedulePersist();
    }
  }, 60000);
  console.log(`[AGRYON] v${APP_VERSION} - Auth JWT + API - Porta ${PORT}`);
});

process.on('SIGINT', () => {
  persistStoreNow();
  process.exit(0);
});

process.on('SIGTERM', () => {
  persistStoreNow();
  process.exit(0);
});