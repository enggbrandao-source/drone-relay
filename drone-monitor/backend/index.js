const http = require('http');
const url = require('url');

/**
 * Servidor HTTP para Render Free - Drone Relay Cloud
 * Recebe POST do RC, serve dashboard via HTTP polling
 */

const PORT = process.env.PORT || 8080;
const drones = new Map();

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Drone Monitor Cloud</title>
<style>
* { margin:0; box-sizing:border-box }
body { font-family:'Segoe UI',sans-serif; background:#0b0f19; color:#e0e0e0; padding:10px; }
h2 { text-align:center; color:#00FF88; margin-bottom:10px; }
.status { text-align:center; font-size:14px; margin-bottom:15px }
.status.online { color:#00FF88; }
.status.offline { color:#FF6B2C; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; max-width:900px; margin:auto }
.card { background:rgba(255,255,255,0.06); border-radius:10px; padding:14px; text-align:center; border:1px solid rgba(0,255,136,0.15) }
.card .label { color:#9aa0a6; font-size:11px; text-transform:uppercase; letter-spacing:0.5px }
.card .value { font-size:22px; font-weight:700; color:#fff; margin-top:4px }
.card .unit { color:#9aa0a6; font-size:11px }
.timer { text-align:center; margin-top:16px; font-size:18px; color:#FF6B2C; }
.alert { text-align:center; margin-top:12px; color:#ff4444; }
select { display:block; margin:auto; padding:8px 12px; border-radius:6px; border:1px solid rgba(0,255,136,0.3); background:#111112; color:#00FF88; font-size:14px; }
</style>
</head>
<body>
<h2>CONTROLADOR REMOTO AGRAS</h2>
<select id="droneSelect"><option value="A001">A001</option><option value="AGRAS001">AGRAS001</option></select>
<div class="status offline" id="status">OFFLINE - Aguardando dados do RC Plus</div>
<div class="cards" id="cards"></div>
<div class="timer" id="timer">Ultima atualizacao: --</div>
<div class="alert" id="alert"></div>
<script>
const fields=[
  {k:'speed',l:'Velocidade',u:'km/h'},
  {k:'altitude',l:'Altitude',u:'m'},
  {k:'batteryPercent',l:'Bateria',u:'%'},
  {k:'tankLevel',l:'Tanque',u:'L'},
  {k:'flowRate',l:'Vazao',u:'L/min'},
  {k:'hectaresApplied',l:'Hectares',u:'ha'},
  {k:'signalStrength',l:'Sinal',u:'%'},
  {k:'rtkStatus',l:'RTK',u:''},
  {k:'operationalStatus',l:'Status',u:''}
];
const cards=document.getElementById('cards');
fields.forEach(f=>{
  const d=document.createElement('div');d.className='card';
  d.innerHTML=\`<div class="label">\${f.l}</div><div class="value" id="v-\${f.k}">--</div><div class="unit">\${f.u}</div>\`;
  cards.appendChild(d);
});
async function poll(){
  try{
    const id=document.getElementById('droneSelect').value;
    const r=await fetch('/dash?id='+id,{cache:'no-store'});
    if(!r.ok)throw new Error('offline');
    const d=await r.json();
    if(d.offline)throw new Error('offline');
    document.getElementById('status').textContent='ONLINE - Conectado ao RC Plus';
    document.getElementById('status').className='status online';
    fields.forEach(f=>{
      const el=document.getElementById('v-'+f.k);
      if(el)el.textContent=(d[f.k]!=null?d[f.k]:'--');
    });
    const t=new Date().toLocaleTimeString('pt-BR');
    document.getElementById('timer').textContent='Ultima atualizacao: '+t;
    document.getElementById('alert').textContent=d.systemAlerts&&d.systemAlerts.length?d.systemAlerts.join('; '):'';
  }catch(e){
    document.getElementById('status').textContent='OFFLINE - RC Plus desconectado';
    document.getElementById('status').className='status offline';
  }
}
poll();
setInterval(poll,2000);
</script>
</body></html>`;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const p = url.parse(req.url, true);

  // Dashboard
  if (p.pathname === '/dashboard.html' || p.pathname === '/') {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(DASHBOARD_HTML);
    return;
  }

  // Drone envia telemetria
  if (p.pathname === '/drone' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(b);
        const id = j._id || j.id || 'A001';
        drones.set(id, { data: j, time: Date.now() });
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ ok: true, id }));
        console.log('DRONE', id, new Date().toISOString());
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // Dashboard pega dados
  if (p.pathname === '/dash') {
    const id = p.query.id || 'A001';
    const d = drones.get(id);
    if (d && Date.now() - d.time < 120000) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(d.data));
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ offline: true }));
    }
    return;
  }

  // Ping
  if (p.pathname === '/ping' || p.pathname === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ status: 'ok', drones: Array.from(drones.keys()) }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, () => console.log('[SERVER] Drone Relay na porta', PORT));
