const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'agryon-default-secret';

const db = {
  users: [],
  companies: [],
  drones: [],
  farms: [],
  telemetry: []
};

// Seed inicial
async function seed() {
  db.companies.push({ id: '1', name: 'AgroDrone Demo', plan: 'pro', active: true, createdAt: new Date() });
  db.users.push({ id: '1', email: 'admin@agryon.com', password: 'admin123', name: 'Administrador', role: 'admin', companyId: '1', createdAt: new Date() });
  db.users.push({ id: '2', email: 'cliente@demo.com', password: 'cliente123', name: 'Cliente Demo', role: 'cliente', companyId: '1', createdAt: new Date() });
  db.drones.push({ id: '1', code: 'AGRAS001', model: 'DJI Agras T40', companyId: '1', active: true, createdAt: new Date() });
  db.farms.push({ id: '1', name: 'Fazenda São João', location: 'Ribeirão Preto - SP', companyId: '1', createdAt: new Date() });
}

const drones = new Map();
const OFFLINE_THRESHOLD_MS = 120000;

const FIELD_MAP = {
  sp: 'speed', alt: 'altitude', bat: 'batteryPercent',
  tk: 'tankLevel', tkl: 'tankLiters', skm: 'speedKmh',
  fr: 'flowRate', ha: 'hectaresApplied', sig: 'signalStrength',
  rtk: 'rtkStatus', st: 'operationalStatus'
};

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
.drone-status.online{background:rgba(0,255,136,0.15);color:#00FF88}
.drone-status.offline{background:rgba(255,107,44,0.15);color:#FF6B2C}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.card{background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 6px;text-align:center}
.card .label{color:#9aa0a6;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
.card .value{font-size:18px;font-weight:700;color:#fff;margin-top:3px}
.card .unit{color:#9aa0a6;font-size:10px}
.alert{margin-top:8px;padding:6px 8px;background:rgba(255,68,68,0.1);border-radius:6px;color:#ff4444;font-size:11px}
.timer{text-align:center;margin-top:12px;font-size:12px;color:#666}
.version{text-align:center;margin-top:4px;font-size:10px;color:#444}
.drone-info{display:flex;gap:10px;margin-top:8px;font-size:11px;color:#9aa0a6}
.admin-link{display:block;text-align:center;margin:8px 0;color:#00FF88;text-decoration:none;font-size:12px}
</style>
</head>
<body>
<h2>AGRYON CONTROL</h2>
<div class="subtitle">Monitoramento de Frota de Drones</div>
<a href="/app" class="admin-link">Acessar Painel Administrativo</a>
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
let currentFilter='all', droneData={};
function setFilter(f){currentFilter=f;document.querySelectorAll('.filters button').forEach(b=>b.classList.remove('active'));event.target.classList.add('active');render()}
function fmt(v,rnd){if(v==null)return'--';if(typeof v==='number')return v.toFixed(rnd);return v}
function isOnline(d){return d&&!d.offline}
function render(){
  const grid=document.getElementById('droneGrid');grid.innerHTML='';
  const ids=Object.keys(droneData).sort();let visibleCount=0;
  ids.forEach(id=>{
    const d=droneData[id],online=isOnline(d);
    if(currentFilter==='online'&&!online)return;
    if(currentFilter==='offline'&&online)return;
    visibleCount++;
    const card=document.createElement('div');
    card.className='drone-card '+(online?'online':'offline');
    let html='<div class="drone-header"><div class="drone-id">'+id+'</div><div class="drone-status '+(online?'online':'offline')+'">'+(online?'ONLINE':'OFFLINE')+'</div></div>';
    html+='<div class="drone-info"><span>Piloto: '+(d._pilot||'—')+'</span><span>Fazenda: '+(d._farm||'—')+'</span></div><div class="cards">';
    fields.forEach(f=>{html+='<div class="card"><div class="label">'+f.l+'</div><div class="value">'+fmt(d[f.k],f.round)+'</div><div class="unit">'+f.u+'</div></div>'});
    html+='</div>';
    if(d.systemAlerts&&d.systemAlerts.length){html+='<div class="alert">'+d.systemAlerts.join('; ')+'</div>'}
    if(d._version){html+='<div class="version">APK v'+d._version+'</div>'}
    card.innerHTML=html;grid.appendChild(card);
  });
  if(visibleCount===0)grid.innerHTML='<div style="text-align:center;color:#666;padding:40px">Nenhum drone encontrado</div>';
}
async function poll(){
  try{const r=await fetch('/dash-all',{cache:'no-store'});if(!r.ok)throw new Error('offline');droneData=await r.json();render();document.getElementById('timer').textContent='Ultima atualizacao: '+new Date().toLocaleTimeString('pt-BR')}catch(e){document.getElementById('timer').textContent='Erro de conexao — '+new Date().toLocaleTimeString('pt-BR')}}
poll();setInterval(poll,3000);
</script>
</body></html>`;

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Agryon Control — Login</title>
<style>
*{margin:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0b0f19;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-box{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;width:100%;max-width:400px}
h1{text-align:center;color:#00FF88;margin-bottom:8px}.subtitle{text-align:center;color:#9aa0a6;font-size:13px;margin-bottom:24px}
input{width:100%;padding:12px;margin-bottom:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#111;color:#fff}
input:focus{outline:none;border-color:#00FF88}
button{width:100%;padding:12px;border-radius:8px;border:none;background:#00FF88;color:#000;font-weight:700;cursor:pointer}
button:hover{background:#00cc6a}
.error{background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.3);color:#ff4444;padding:10px;border-radius:8px;margin-bottom:12px;font-size:12px;display:none}
.demo{text-align:center;margin-top:16px;font-size:11px;color:#666}
</style></head>
<body>
<div class="login-box">
<h1>AGRYON</h1><div class="subtitle">Control — Monitoramento de Drones</div>
<div class="error" id="error"></div>
<form id="loginForm">
<input type="email" id="email" placeholder="Email" required>
<input type="password" id="password" placeholder="Senha" required>
<button type="submit">Entrar</button>
</form>
<div class="demo">Demo: admin@agryon.com / admin123</div>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit',async(e)=>{
  e.preventDefault();
  try{const res=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Erro ao fazer login');
  localStorage.setItem('agryon_token',data.token);localStorage.setItem('agryon_user',JSON.stringify(data.user));window.location.href='/app';}
  catch(err){const el=document.getElementById('error');el.textContent=err.message;el.style.display='block';}
});
</script></body></html>`;

const APP_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Agryon Control — Painel</title>
<style>
*{margin:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0b0f19;color:#e0e0e0}
.sidebar{width:220px;background:#080c14;border-right:1px solid rgba(255,255,255,0.08);height:100vh;position:fixed;display:flex;flex-direction:column}
.sidebar-header{padding:20px;border-bottom:1px solid rgba(255,255,255,0.08)}.sidebar-header h2{color:#00FF88;font-size:20px}.sidebar-header p{color:#666;font-size:11px;margin-top:2px}
.nav{flex:1;padding:12px}.nav a{display:block;padding:10px 12px;border-radius:8px;color:#9aa0a6;text-decoration:none;font-size:14px;margin-bottom:4px}
.nav a:hover,.nav a.active{background:rgba(0,255,136,0.1);color:#00FF88}
.user{padding:16px;border-top:1px solid rgba(255,255,255,0.08);font-size:13px}
.user-name{color:#fff;font-weight:600}.user-company{color:#666;font-size:11px;margin-top:2px}
.logout{color:#ff4444;background:none;border:none;cursor:pointer;font-size:12px;margin-top:8px}
.main{margin-left:220px;padding:24px}
.page-title{font-size:24px;font-weight:700;margin-bottom:16px}
.btn{padding:6px 12px;border-radius:6px;border:1px solid rgba(0,255,136,0.3);background:rgba(0,255,136,0.1);color:#00FF88;font-size:12px;cursor:pointer}
.btn:hover{background:rgba(0,255,136,0.2)}
.card{background:rgba(255,255,255,0.05);border-radius:12px;padding:16px;border:1px solid rgba(255,255,255,0.08);margin-bottom:12px}
</style></head>
<body>
<div class="sidebar">
<div class="sidebar-header"><h2>AGRYON</h2><p>Control</p></div>
<nav class="nav">
<a href="#" class="active" onclick="showPage('dashboard')">Dashboard</a>
<a href="#" onclick="showPage('drones')">Drones</a>
<a href="#" onclick="showPage('farms')">Fazendas</a>
<a href="/dashboard.html" target="_blank">Dashboard Publico</a>
</nav>
<div class="user">
<div class="user-name" id="userName">Carregando...</div>
<div class="user-company" id="userCompany">...</div>
<button class="logout" onclick="logout()">Sair</button>
</div>
</div>
<div class="main" id="mainContent"></div>
<script>
let token=localStorage.getItem('agryon_token');let user=JSON.parse(localStorage.getItem('agryon_user')||'{}');
if(!token)window.location.href='/app/login';
document.getElementById('userName').textContent=user.name||'User';
document.getElementById('userCompany').textContent=user.companyId||'Demo';
function logout(){localStorage.removeItem('agryon_token');localStorage.removeItem('agryon_user');window.location.href='/app/login';}
async function api(path,opts={}){const res=await fetch(path,{...opts,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...opts.headers}});if(res.status===401){logout();return;}return res.json();}
function showPage(page){currentPage=page;document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('active'));event.target.classList.add('active');if(page==='dashboard')renderDashboard();if(page==='drones')renderDrones();if(page==='farms')renderFarms();}
async function renderDashboard(){const drones=await api('/drones');const main=document.getElementById('mainContent');main.innerHTML='<div class="page-title">Dashboard</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">'+drones.map(d=>{const online=d.lastSeen&&(Date.now()-new Date(d.lastSeen).getTime()<120000);return'<div class="card" style="border-color:'+(online?'rgba(0,255,136,0.3)':'rgba(255,107,44,0.3)')+'"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong>'+d.code+'</strong><span style="font-size:11px;padding:3px 8px;border-radius:4px;background:'+(online?'rgba(0,255,136,0.15)':'rgba(255,107,44,0.15)')+';color:'+(online?'#00FF88':'#FF6B2C')+'">'+(online?'ONLINE':'OFFLINE')+'</span></div><div style="font-size:12px;color:#9aa0a6;">Modelo: '+d.model+'</div><div style="font-size:12px;color:#9aa0a6;">Fazenda: '+(d.farm||'—')+'</div></div>';}).join('')+'</div>';}
async function renderDrones(){const drones=await api('/drones');const main=document.getElementById('mainContent');main.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><div class="page-title">Drones</div><button class="btn" onclick="alert(\'Cadastro\')">+ Novo Drone</button></div><div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:16px;border:1px solid rgba(255,255,255,0.08);"><table style="width:100%;border-collapse:collapse;"><thead><tr style="border-bottom:1px solid rgba(255,255,255,0.08);"><th style="text-align:left;padding:8px;color:#9aa0a6;font-size:12px;">Codigo</th><th style="text-align:left;padding:8px;color:#9aa0a6;font-size:12px;">Modelo</th><th style="text-align:left;padding:8px;color:#9aa0a6;font-size:12px;">Fazenda</th><th style="text-align:left;padding:8px;color:#9aa0a6;font-size:12px;">Status</th></tr></thead><tbody>'+drones.map(d=>{const online=d.lastSeen&&(Date.now()-new Date(d.lastSeen).getTime()<120000);return'<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px;">'+d.code+'</td><td style="padding:8px;">'+d.model+'</td><td style="padding:8px;">'+(d.farm||'—')+'</td><td style="padding:8px;">'+(online?'Online':'Offline')+'</td></tr>';}).join('')+'</tbody></table></div>';}
async function renderFarms(){const farms=await api('/farms');const main=document.getElementById('mainContent');main.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><div class="page-title">Fazendas</div><button class="btn" onclick="alert(\'Cadastro\')">+ Nova Fazenda</button></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">'+farms.map(f=>'<div class="card"><strong>'+f.name+'</strong><div style="font-size:12px;color:#9aa0a6;margin-top:4px;">'+(f.location||'Sem localizacao')+'</div></div>').join('')+'</div>';}
renderDashboard();
</script></body></html>`;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const p = url.parse(req.url, true);

  // HTML Pages
  if (p.pathname === '/' || p.pathname === '/dashboard.html') {
    res.writeHead(200, {'Content-Type': 'text/html'}); res.end(DASHBOARD_HTML); return;
  }
  if (p.pathname === '/app/login') {
    res.writeHead(200, {'Content-Type': 'text/html'}); res.end(LOGIN_HTML); return;
  }
  if (p.pathname === '/app' || p.pathname === '/app/') {
    res.writeHead(200, {'Content-Type': 'text/html'}); res.end(APP_HTML); return;
  }

  // Auth Login
  if (p.pathname === '/auth/login' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const { email, password } = JSON.parse(b);
        const user = db.users.find(u => u.email === email);
        if (!user || user.password !== password) {
          res.writeHead(401, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: 'Credenciais invalidas' })); return;
        }
        const token = jwtSign({ id: user.id, email, role: user.role, companyId: user.companyId });
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ token, user: { id: user.id, name: user.name, email, role: user.role, companyId: user.companyId } }));
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // Auth Register
  if (p.pathname === '/auth/register' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const { email, password, name, companyName } = JSON.parse(b);
        const company = { id: String(db.companies.length + 1), name: companyName || name + ' Ltda', plan: 'free', active: true, createdAt: new Date() };
        db.companies.push(company);
        const user = { id: String(db.users.length + 1), email, password, name, role: 'cliente', companyId: company.id, createdAt: new Date() };
        db.users.push(user);
        const token = jwtSign({ id: user.id, email, role: user.role, companyId: company.id });
        res.json({ token, user: { id: user.id, name, email, role: user.role, companyId: company.id } });
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // Drones
  if (p.pathname === '/drones') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(db.drones.map(d => ({
      ...d,
      farm: db.farms.find(f => f.id === d.farmId)?.name || null
    }))));
    return;
  }

  if (p.pathname === '/farms') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(db.farms));
    return;
  }

  // Drone telemetria
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
        if (merged.speedKmh != null) merged.speedKmh = Math.round(merged.speedKmh * 10) / 10;
        if (merged.altitude != null) merged.altitude = Math.round(merged.altitude * 10) / 10;
        if (merged.tankLiters != null) merged.tankLiters = Math.round(merged.tankLiters * 100) / 100;
        if (merged.flowRate != null) merged.flowRate = Math.round(merged.flowRate * 10) / 10;
        if (merged.hectaresApplied != null) merged.hectaresApplied = Math.round(merged.hectaresApplied * 100) / 100;
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
      id, online: now - d.time < OFFLINE_THRESHOLD_MS, lastSeen: d.time
    }));
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ status: 'ok', version: '2.3.0', drones: droneList }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, () => {
  seed();
  console.log('[AGRYON] Servidor rodando na porta', PORT);
});

function jwtSign(payload) {
  return require('jsonwebtoken').sign(payload, JWT_SECRET);
}
