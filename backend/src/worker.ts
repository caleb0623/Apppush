import { env } from './config/env.js';
import { createDeps } from './deps.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { newWorkerId, processDueJobs, recoverStaleJobs } from './modules/scheduler/service.js';

const deps = createDeps();
const workerId = newWorkerId();
const startedAt = new Date();
let running = true;

async function tick() {
  await prisma.workerHeartbeat.upsert({
    where: { workerId },
    create: { workerId, startedAt, lastBeatAt: new Date() },
    update: { lastBeatAt: new Date() },
  });
  const recovered = await recoverStaleJobs(deps);
  const processed = await processDueJobs(deps, workerId);
  if (recovered > 0 || processed > 0) {
    logger.info({ recovered, processed }, 'Worker tick finished');
  }
}

async function loop() {
  logger.info({ workerId, pollMs: env.WORKER_POLL_INTERVAL_MS }, 'Worker started');
  while (running) {
    await tick().catch((error: unknown) => logger.error({ err: error }, 'Worker tick failed'));
    await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
  }
  await prisma.workerHeartbeat.deleteMany({ where: { workerId } }).catch(() => undefined);
  await prisma.$disconnect();
  logger.info('Worker stopped');
  process.exit(0);
}

// The current tick is allowed to finish, so a shutdown never abandons a claimed job.
const stop = () => {
  running = false;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await loop();
