const WebSocket = require('ws');

/**
 * Cliente WebSocket de teste para o relay.
 * Simula um RC Plus enviando telemetria.
 */

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:8080/drone?droneId=AGRAS001';

const ws = new WebSocket(RELAY_URL);

ws.on('open', () => {
  console.log('[TEST] Conectado ao relay');

  // Envia telemetria a cada 2 segundos
  setInterval(() => {
    const telemetry = {
      bat: Math.floor(30 + Math.random() * 50),
      tk: Math.floor(20 + Math.random() * 60),
      sp: (Math.random() * 15).toFixed(1),
      alt: (Math.random() * 50).toFixed(1),
      sig: Math.floor(50 + Math.random() * 50),
      rtk: 'Fix',
      ha: (Math.random() * 10).toFixed(2),
      fr: (Math.random() * 5).toFixed(1),
      st: 'spraying',
      ts: Date.now()
    };
    ws.send(JSON.stringify(telemetry));
    console.log('[TEST] Enviado:', telemetry);
  }, 2000);
});

ws.on('message', (data) => {
  console.log('[TEST] Recebido:', data.toString());
});

ws.on('error', (err) => {
  console.error('[TEST] Erro:', err.message);
});

ws.on('close', () => {
  console.log('[TEST] Desconectado');
});
