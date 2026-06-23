import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import dotenv from 'dotenv';
import routes from './routes';
import { TelemetryWebSocketServer } from './websocket';
import { logger } from './database';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new TelemetryWebSocketServer(server);

const PORT = parseInt(process.env.PORT || '8080', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

app.use('/api', routes);

app.get('/', (_req, res) => {
  res.json({
    name: 'Drone Monitor Backend',
    version: '1.0.0',
    status: 'running',
    wsClients: wss.getConnectedCount(),
  });
});

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Servidor iniciado na porta ${PORT}`);
  logger.info(`WebSocket: ws://0.0.0.0:${PORT}/ws`);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});
