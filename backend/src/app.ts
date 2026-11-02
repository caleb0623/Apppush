import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { createDeps, type Deps } from './deps.js';
import { openApiDocument } from './docs/openapi.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler, requestLogger } from './middleware/error.js';
import { appsRouter } from './modules/apps/routes.js';
import { auditRouter, authRouter } from './modules/auth/routes.js';
import { clientRouter } from './modules/client/routes.js';
import { environmentRouter } from './modules/environments/routes.js';

const WORKER_ONLINE_WINDOW_MS = 15_000;

export function createApp(overrides: Partial<Deps> = {}) {
  const deps = createDeps(overrides);
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', async (_req, res) => {
    const heartbeat = await prisma.workerHeartbeat
      .findFirst({ orderBy: { lastBeatAt: 'desc' } })
      .catch(() => null);
    const database = await prisma.$queryRaw`SELECT 1`.then(
      () => 'up' as const,
      () => 'down' as const,
    );
    const age = heartbeat ? deps.clock().getTime() - heartbeat.lastBeatAt.getTime() : null;
    res.status(database === 'up' ? 200 : 503).json({
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      worker: age !== null && age < WORKER_ONLINE_WINDOW_MS ? 'up' : 'down',
      workerLastSeenAt: heartbeat?.lastBeatAt ?? null,
      deliveryMode: deps.fcm ? 'real' : 'simulated',
      fcm: {
        configured: deps.fcm !== null,
        projectId: deps.fcm?.projectId ?? null,
        payloadMode: deps.fcmOptions.mode,
        problem: deps.fcmProblem,
      },
    });
  });

  app.get('/api/docs.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  const v1 = express.Router();
  v1.use('/auth', authRouter(deps));
  v1.use('/apps', appsRouter(deps));
  v1.use('/audit-logs', auditRouter());
  v1.use('/client', clientRouter(deps));
  const scoped = environmentRouter(deps);
  v1.use('/environments/:envId', scoped);
  v1.use('/open', scoped);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
