const http = require('http');
const url = require('url');
const https = require('https');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'agryon-default-secret';
const APP_VERSION = require('./package.json').version;
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

const APP_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agryon Control App</title>
<style>
*{margin:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0b0f19;color:#e5e7eb}
.wrap{min-height:100vh;display:flex}
.sidebar{width:250px;background:#0f172a;border-right:1px solid rgba(255,255,255,.08);padding:20px;display:flex;flex-direction:column}
.brand{font-size:28px;font-weight:800;color:#34d399}.sub{font-size:12px;color:#64748b;margin-top:2px;margin-bottom:24px}
.nav a{display:block;padding:12px 14px;border-radius:10px;color:#cbd5e1;text-decoration:none;margin-bottom:8px;border:1px solid transparent}
.nav a.active,.nav a:hover{background:rgba(52,211,153,.12);border-color:rgba(52,211,153,.25);color:#34d399}
.user{margin-top:auto;border-top:1px solid rgba(255,255,255,.08);padding-top:14px;font-size:13px;color:#94a3b8}
.logout{margin-top:8px;background:none;border:none;color:#f87171;cursor:pointer;padding:0}
.main{flex:1;padding:24px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px}
.login{max-width:420px;margin:70px auto;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:28px}
.login h1{color:#34d399;text-align:center;margin-bottom:8px}.login p{color:#94a3b8;text-align:center;margin-bottom:18px}
.login label{display:block;font-size:13px;color:#94a3b8;margin-bottom:6px}
.login input{width:100%;padding:12px 14px;margin-bottom:14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#020617;color:#fff}
.login button,.btn{background:#34d399;color:#052e16;border:none;border-radius:10px;padding:12px 14px;font-weight:700;cursor:pointer}
.err{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.25);color:#fca5a5;padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:13px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.title{font-size:28px;font-weight:800}
.muted{color:#94a3b8}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.drone{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px}
.status{font-size:11px;padding:4px 8px;border-radius:999px;font-weight:700}
.online{background:rgba(52,211,153,.12);color:#34d399}.offline{background:rgba(248,113,113,.12);color:#f87171}
.mini{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.mini>div{background:rgba(0,0,0,.2);border-radius:10px;padding:10px;text-align:center}
.mini .k{font-size:10px;color:#94a3b8;text-transform:uppercase}.mini .v{font-size:18px;font-weight:800;color:#fff}
.toolbar{display:flex;gap:8px}
.toolbar button{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#cbd5e1;cursor:pointer}
.toolbar button.active{background:rgba(52,211,153,.12);border-color:rgba(52,211,153,.25);color:#34d399}
.list{display:grid;gap:12px}
.item{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px}
.form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-bottom:14px}
.form input{padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#020617;color:#fff}
.hidden{display:none}
@media (max-width: 900px){.wrap{display:block}.sidebar{width:100%;border-right:none;border-bottom:1px solid rgba(255,255,255,.08)}.main{padding:16px}.form{grid-template-columns:1fr}}
</style>
</head>
<body>
<div id="app"></div>
<script>
const API = '';
const state = { token: localStorage.getItem('agryon_token'), user: JSON.parse(localStorage.getItem('agryon_user') || 'null'), route: 'dashboard', dronesLive: {}, dronesApi: [], farms: [], filter: 'all' };
function esc(v){return String(v ?? '').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function fmt(v,r=0){if(v==null||v==='')return '--';return typeof v==='number'?v.toFixed(r):esc(v)}
function setRoute(r){state.route=r; render(); if(state.token) loadRouteData();}
function saveAuth(token,user){state.token=token;state.user=user;localStorage.setItem('agryon_token',token);localStorage.setItem('agryon_user',JSON.stringify(user))}
function logout(){state.token=null;state.user=null;localStorage.removeItem('agryon_token');localStorage.removeItem('agryon_user');render()}
async function api(path, opts={}){const headers=Object.assign({'Content-Type':'application/json'}, opts.headers||{}); if(state.token) headers.Authorization='Bearer '+state.token; const res=await fetch(API+path,Object.assign({},opts,{headers})); const text=await res.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:text}} if(!res.ok) throw new Error(data.error||('HTTP '+res.status)); return data}
async function doLogin(ev){ev.preventDefault(); const email=document.getElementById('email').value; const password=document.getElementById('password').value; const err=document.getElementById('err'); err.classList.add('hidden'); try{const data=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})}); saveAuth(data.token,data.user); render(); loadRouteData();}catch(e){err.textContent=e.message; err.classList.remove('hidden')}}
async function loadRouteData(){ if(!state.token) return;
  try{
    if(state.route==='dashboard'){ state.dronesLive = await fetch('/dash-all',{cache:'no-store'}).then(r=>r.json()); renderContent(); }
    if(state.route==='drones'){ state.dronesApi = await api('/api/drones'); renderContent(); }
    if(state.route==='farms'){ state.farms = await api('/api/farms'); renderContent(); }
    if(state.route==='mapa'){ renderContent(); }
  }catch(e){ console.error(e); }
}
async function createDrone(ev){ev.preventDefault(); const code=document.getElementById('droneCode').value; const model=document.getElementById('droneModel').value; await api('/api/drones',{method:'POST',body:JSON.stringify({code,model})}); document.getElementById('droneCode').value=''; loadRouteData();}
async function createFarm(ev){ev.preventDefault(); const name=document.getElementById('farmName').value; const location=document.getElementById('farmLocation').value; await api('/api/farms',{method:'POST',body:JSON.stringify({name,location})}); document.getElementById('farmName').value=''; document.getElementById('farmLocation').value=''; loadRouteData();}
function dashboardView(){ const ids=Object.keys(state.dronesLive).sort().filter(id=>{const d=state.dronesLive[id]; const online=!d.offline; return state.filter==='all'||(state.filter==='online'&&online)||(state.filter==='offline'&&!online)}); return '<div class="row"><div><div class="title">Dashboard</div><div class="muted">Telemetria em tempo real</div></div><div class="toolbar"><button class="'+(state.filter==='all'?'active':'')+'" onclick="state.filter=\'all\';renderContent()">Todos</button><button class="'+(state.filter==='online'?'active':'')+'" onclick="state.filter=\'online\';renderContent()">Online</button><button class="'+(state.filter==='offline'?'active':'')+'" onclick="state.filter=\'offline\';renderContent()">Offline</button></div></div><div class="grid">'+ids.map(id=>{const d=state.dronesLive[id],online=!d.offline; return '<div class="drone"><div class="row"><div><div style="font-size:20px;font-weight:800">'+esc(id)+'</div><div class="muted" style="font-size:12px">Piloto: '+esc(d._pilot||'—')+' | Fazenda: '+esc(d._farm||'—')+'</div></div><div class="status '+(online?'online':'offline')+'">'+(online?'ONLINE':'OFFLINE')+'</div></div><div class="mini"><div><div class="k">Velocidade</div><div class="v">'+fmt(d.speedKmh,1)+'</div></div><div><div class="k">Altitude</div><div class="v">'+fmt(d.altitude,1)+'</div></div><div><div class="k">Bateria</div><div class="v">'+fmt(d.batteryPercent,0)+'</div></div><div><div class="k">Tanque</div><div class="v">'+fmt(d.tankLiters,2)+'</div></div><div><div class="k">Satélites</div><div class="v">'+fmt(d.signalStrength,0)+'</div></div><div><div class="k">Status</div><div class="v" style="font-size:15px">'+fmt(d.operationalStatus,0)+'</div></div></div></div>'}).join('')+'</div>'}
function dronesView(){ return '<div class="row"><div><div class="title">Drones</div><div class="muted">Cadastro de aeronaves</div></div></div><form class="form" onsubmit="createDrone(event)"><input id="droneCode" placeholder="Código ex: AGRAS001" required><input id="droneModel" placeholder="Modelo" value="DJI Agras" required><button class="btn" type="submit">Salvar</button></form><div class="list">'+state.dronesApi.map(d=>'<div class="item"><div><div style="font-weight:800">'+esc(d.code)+'</div><div class="muted">'+esc(d.model||'—')+'</div></div><div class="muted">'+esc(d.farm||'Sem fazenda')+'</div></div>').join('')+'</div>'}
function farmsView(){ return '<div class="row"><div><div class="title">Fazendas</div><div class="muted">Cadastro de propriedades</div></div></div><form class="form" onsubmit="createFarm(event)"><input id="farmName" placeholder="Nome da fazenda" required><input id="farmLocation" placeholder="Cidade / Estado"><button class="btn" type="submit">Salvar</button></form><div class="list">'+state.farms.map(f=>'<div class="item"><div><div style="font-weight:800">'+esc(f.name)+'</div><div class="muted">'+esc(f.location||'Sem localização')+'</div></div></div>').join('')+'</div>'}
function mapaView(){ return '<div class="row"><div><div class="title">Mapa</div><div class="muted">Abrir mapa operacional</div></div><a class="btn" href="/map" target="_blank" rel="noreferrer" style="text-decoration:none;display:inline-block">Abrir mapa</a></div><div class="card"><p class="muted">O mapa operacional live está disponível em <strong>/map</strong> e usa os dados em tempo real do backend.</p></div>'}
function renderContent(){ const root=document.getElementById('content'); if(!root) return; root.innerHTML = state.route==='dashboard'?dashboardView():state.route==='drones'?dronesView():state.route==='farms'?farmsView():mapaView(); }
function render(){ const app=document.getElementById('app'); if(!state.token){ app.innerHTML='<div class="login"><h1>AGRYON</h1><p>Control — Monitoramento de Drones</p><div id="err" class="err hidden"></div><form onsubmit="doLogin(event)"><label>Email</label><input id="email" type="email" value="admin@agryon.com" placeholder="admin@agryon.com"><label>Senha</label><input id="password" type="password" value="admin123" placeholder="********"><button type="submit" style="width:100%">Entrar</button></form><p style="margin-top:14px;font-size:12px;color:#64748b;text-align:center">Demo: admin@agryon.com / admin123</p></div>'; return; }
  app.innerHTML='<div class="wrap"><aside class="sidebar"><div class="brand">AGRYON</div><div class="sub">Control</div><nav class="nav"><a href="#" class="'+(state.route==='dashboard'?'active':'')+'" onclick="setRoute(\'dashboard\');return false;">Dashboard</a><a href="#" class="'+(state.route==='drones'?'active':'')+'" onclick="setRoute(\'drones\');return false;">Drones</a><a href="#" class="'+(state.route==='farms'?'active':'')+'" onclick="setRoute(\'farms\');return false;">Fazendas</a><a href="#" class="'+(state.route==='mapa'?'active':'')+'" onclick="setRoute(\'mapa\');return false;">Mapa</a></nav><div class="user"><div>'+(state.user?.name||'Usuário')+'</div><div>'+(state.user?.email||'')+'</div><button class="logout" onclick="logout()">Sair</button></div></aside><main class="main"><div id="content"></div></main></div>'; renderContent(); }
render(); if(state.token){ loadRouteData(); setInterval(()=>{ if(state.route==='dashboard') loadRouteData(); }, 5000); }
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

// Cria um poligono de area de trabalho simulado ao redor do drone
function createWorkArea(lat, lon, hectares) {
  if (!lat || !lon) return null;
  // Aproximacao: 1 hectare = 100x100m
  const size = hectares ? Math.sqrt(hectares) * 0.00045 : 0.0009; // graus aprox
  const bounds = [
    [lat - size, lon - size],
    [lat - size, lon + size],
    [lat + size, lon + size],
    [lat + size, lon - size]
  ];
  return L.polygon(bounds, {
    color: '#00FF88',
    fillColor: '#00FF88',
    fillOpacity: 0.1,
    weight: 1,
    dashArray: '5, 5'
  });
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
      
      // Atualiza cor do circulo
      if(markers[id].circle){
        markers[id].circle.setStyle({fillColor:color,color:color});
      }
      
      // Area de trabalho (simulada ao redor do drone)
      if(online && d.hectaresApplied > 0) {
        if(workAreas[id]) {
          map.removeLayer(workAreas[id]);
        }
        const area = createWorkArea(lat, lon, d.hectaresApplied);
        if(area) {
          area.addTo(map);
          workAreas[id] = area;
        }
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

  // App autenticado
  if (p.pathname === '/app' || p.pathname === '/app/' || p.pathname === '/app/login') {
    res.writeHead(200, {'Content-Type': 'text/html'}); res.end(APP_HTML); return;
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
    res.end(JSON.stringify({ status: 'ok', version: APP_VERSION, drones: droneList }));
    return;
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, async () => {
  await seed();
  console.log(`[AGRYON] v${APP_VERSION} — Auth JWT + API — Porta`, PORT);
});
