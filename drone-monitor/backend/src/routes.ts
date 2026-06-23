import express, { Request, Response } from 'express';
import prisma, { logger } from './database';

const router = express.Router();

/**
 * GET /api/health
 * Health check do servidor
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

/**
 * GET /api/telemetry/latest
 * Ultimo snapshot de telemetria
 */
router.get('/telemetry/latest', async (_req: Request, res: Response) => {
  try {
    const latest = await prisma.telemetrySnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
    });
    if (!latest) return res.status(404).json({ error: 'No data yet' });
    return res.json(latest);
  } catch (err) {
    logger.error('Error fetching latest telemetry', { err });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/telemetry/history
 * Historico de telemetria com paginacao
 */
router.get('/telemetry/history', async (req: Request, res: Response) => {
  try {
    const droneId = (req.query.droneId as string) || 'DJI-AGRAS';
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const where: any = { droneId };
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const [data, count] = await Promise.all([
      prisma.telemetrySnapshot.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.telemetrySnapshot.count({ where }),
    ]);

    return res.json({ data, total: count, limit, offset });
  } catch (err) {
    logger.error('Error fetching telemetry history', { err });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/telemetry/sessions
 * Sessoes de voo
 */
router.get('/telemetry/sessions', async (req: Request, res: Response) => {
  try {
    const droneId = (req.query.droneId as string) || 'DJI-AGRAS';
    const sessions = await prisma.droneSession.findMany({
      where: { droneId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return res.json(sessions);
  } catch (err) {
    logger.error('Error fetching sessions', { err });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/alerts
 * Alertas do sistema
 */
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const droneId = (req.query.droneId as string) || 'DJI-AGRAS';
    const severity = req.query.severity as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);

    const where: any = { droneId };
    if (severity) where.severity = severity;

    const alerts = await prisma.alertLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    return res.json(alerts);
  } catch (err) {
    logger.error('Error fetching alerts', { err });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/alerts/:id/resolve
 * Resolver alerta
 */
router.post('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const alert = await prisma.alertLog.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
    return res.json(alert);
  } catch (err) {
    logger.error('Error resolving alert', { err });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
