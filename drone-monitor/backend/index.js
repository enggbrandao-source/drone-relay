const http = require('http');
const url = require('url');

/**
 * Servidor HTTP para Render Free - Drone Relay Cloud
 * Recebe POST do RC, serve dashboard via HTTP polling
 * Acumula dados de delta packets
 */

const PORT = process.env.PORT || 8080;
const drones = new Map(); // { id: { data: {}, time: Date.now() } }

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
  {k:'speedKmh',l:'Velocidade',u:'km/h',round:1},
  {k:'altitude',l:'Altitude',u:'m',round:1},
  {k:'batteryPercent',l:'Bateria',u:'%',round:0},
  {k:'tankLiters',l:'Tanque',u:'L',round:2},
  {k:'flowRate',l:'Vazao',u:'L/min',round:1},
  {k:'hectaresApplied',l:'Hectares',u:'ha',round:2},
  {k:'signalStrength',l:'Sinal',u:'%',round:0},
  {k:'rtkStatus',l:'RTK',u:'',round:0},
  {k:'operationalStatus',l:'Status',u:'',round:0}
];
const cards=document.getElementById('cards');
fields.forEach(f=>{
  const d=document.createElement('div');d.className='card';
  d.innerHTML=\`<div class="label">\${f.l}</div><div class="value" id="v-\${f.k}">--</div><div class="unit">\${f.u}</div>\`;
  cards.appendChild(d);
});
function fmt(v, rnd) {
  if (v == null) return '--';
  if (typeof v === 'number') return v.toFixed(rnd);
  return v;
}
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
      if(el)el.textContent=fmt(d[f.k], f.round);
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

// Mapeamento de nomes curtos -> longos
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
  st: 'operationalStatus',
  alerts: 'systemAlerts',
  speed: 'speed',
  altitude: 'altitude',
  batteryPercent: 'batteryPercent',
  tankLevel: 'tankLevel',
  tankLiters: 'tankLiters',
  speedKmh: 'speedKmh',
  flowRate: 'flowRate',
  hectaresApplied: 'hectaresApplied',
  signalStrength: 'signalStrength',
  rtkStatus: 'rtkStatus',
  operationalStatus: 'operationalStatus',
  systemAlerts: 'systemAlerts'
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

        // Get existing accumulator for this drone
        const existing = drones.get(id);
        const existingData = existing ? existing.data : {};

        // Merge new fields into accumulator (handle both short and long names)
        const merged = { ...existingData };
        for (const [key, value] of Object.entries(j)) {
          if (key.startsWith('_')) continue; // skip metadata
          const mappedKey = FIELD_MAP[key] || key;
          if (mappedKey) {
            merged[mappedKey] = value;
          }
        }

        // Arredonda valores para evitar decimais infinitos
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

  // Ping / Health
  if (p.pathname === '/ping' || p.pathname === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ status: 'ok', drones: Array.from(drones.keys()) }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, () => console.log('[SERVER] Drone Relay na porta', PORT));
