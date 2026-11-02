import { createApp } from './app.js';
import { env } from './config/env.js';
import { createDeps } from './deps.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const deps = createDeps();

if (deps.fcmProblem) logger.warn(`FCM is not usable: ${deps.fcmProblem}`);
else if (deps.fcm) logger.info(`FCM enabled for Firebase project ${deps.fcm.projectId}`);
else logger.warn('FCM is not configured; real devices cannot be reached. See docs/firebase-setup.md');

const server = createApp(deps).listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
  logger.info(`Swagger UI at http://localhost:${env.PORT}/api/docs`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down API`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
