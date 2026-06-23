import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import prisma, { logger } from './database';

interface TelemetryDelta {
  ts: number;
  id: string;
  [key: string]: any;
}

interface ClientState {
  droneId: string;
  lastPing: number;
}

export class TelemetryWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientState>();
  private lastTelemetry = new Map<string, TelemetryDelta>();

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupHandlers();
    this.startJanitor();
  }

  private setupHandlers() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const ip = req.socket.remoteAddress;
      logger.info(`WS client connected: ${ip}`);

      this.clients.set(ws, { droneId: 'DJI-AGRAS', lastPing: Date.now() });

      // Envia estado atual se disponivel
      const current = this.lastTelemetry.get('DJI-AGRAS');
      if (current) {
        ws.send(JSON.stringify({ type: 'telemetry', data: this.expandDelta(current) }));
      }

      ws.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          this.handleMessage(ws, payload);
        } catch (err) {
          logger.warn('Invalid WS message', { err });
        }
      });

      ws.on('pong', () => {
        const state = this.clients.get(ws);
        if (state) state.lastPing = Date.now();
      });

      ws.on('close', () => {
        logger.info(`WS client disconnected: ${ip}`);
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        logger.error('WS error', { err });
        this.clients.delete(ws);
      });
    });
  }

  private async handleMessage(ws: WebSocket, payload: TelemetryDelta) {
    // Delta decoding
    const expanded = this.expandDelta(payload);
    const droneId = expanded.id || 'DJI-AGRAS';

    // Atualiza cache
    this.lastTelemetry.set(droneId, expanded);

    // Persiste no banco
    try {
      await prisma.telemetrySnapshot.create({
        data: {
          droneId,
          timestamp: new Date(expanded.ts || Date.now()),
          speed: expanded.sp,
          altitude: expanded.alt,
          sprayWidth: expanded.sw,
          flowRate: expanded.fr,
          hectaresApplied: expanded.ha,
          flightTime: expanded.ft,
          rtkStatus: expanded.rtk,
          signalStrength: expanded.sig,
          batteryPercent: expanded.bat,
          tankLevel: expanded.tk,
          latitude: expanded.lat,
          longitude: expanded.lon,
          operationalStatus: expanded.st,
          alerts: expanded.alerts ? JSON.stringify(expanded.alerts) : null,
          rawJson: JSON.stringify(expanded),
        },
      });
    } catch (err) {
      logger.error('Failed to persist telemetry', { err });
    }

    // Verifica alertas
    this.checkAlerts(droneId, expanded);

    // Broadcast para todos os clientes conectados
    const message = JSON.stringify({ type: 'telemetry', data: expanded });
    this.clients.forEach((_state, client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private expandDelta(payload: TelemetryDelta): TelemetryDelta {
    const last = this.lastTelemetry.get(payload.id || 'DJI-AGRAS');
    if (!last || payload._f) return payload;

    const merged = { ...last, ...payload };
    merged._d = undefined;
    return merged;
  }

  private checkAlerts(droneId: string, data: TelemetryDelta) {
    const alerts: Array<{ severity: string; message: string }> = [];

    if (data.bat != null && data.bat < 20) {
      alerts.push({ severity: 'critical', message: `Bateria critica: ${data.bat}%` });
    } else if (data.bat != null && data.bat < 30) {
      alerts.push({ severity: 'warning', message: `Bateria baixa: ${data.bat}%` });
    }

    if (data.sig != null && data.sig < 20) {
      alerts.push({ severity: 'warning', message: `Sinal fraco: ${data.sig}%` });
    }

    if (data.tk != null && data.tk < 10) {
      alerts.push({ severity: 'warning', message: `Tanque quase vazio: ${data.tk}%` });
    }

    if (data.rtk && data.rtk.toString().toLowerCase() !== 'fix') {
      alerts.push({ severity: 'warning', message: `RTK nao esta Fix: ${data.rtk}` });
    }

    if (data.alerts && Array.isArray(data.alerts) && data.alerts.length > 0) {
      for (const alert of data.alerts) {
        alerts.push({ severity: 'critical', message: alert.toString() });
      }
    }

    for (const alert of alerts) {
      prisma.alertLog.create({
        data: {
          droneId,
          severity: alert.severity,
          message: alert.message,
        },
      }).catch((err) => logger.error('Failed to save alert', { err }));

      // Broadcast alert
      const msg = JSON.stringify({ type: 'alert', data: alert });
      this.clients.forEach((_state, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    }
  }

  private startJanitor() {
    setInterval(() => {
      const now = Date.now();
      this.clients.forEach((state, ws) => {
        if (now - state.lastPing > 60000) {
          ws.terminate();
          this.clients.delete(ws);
        } else {
          ws.ping();
        }
      });
    }, 30000);
  }

  getConnectedCount(): number {
    return this.clients.size;
  }
}
