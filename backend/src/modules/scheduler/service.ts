import { randomUUID } from 'node:crypto';
import type { Deps } from '../../deps.js';
import { env } from '../../config/env.js';
import { conflict, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { assertApplicationUsable } from '../../middleware/environment.js';
import { dispatchContextOf, dispatchMessage } from '../delivery/dispatcher.js';

const RETRY_DELAY_MS = 30_000;

/**
 * Compare-and-swap on the status column. MySQL applies the update atomically,
 * so exactly one concurrent caller sees count === 1 and owns the job.
 */
export async function claimJob(jobId: number, workerId: string, now: Date): Promise<boolean> {
  const { count } = await prisma.scheduledJob.updateMany({
    where: { id: jobId, status: 'PENDING', runAt: { lte: now } },
    data: { status: 'PROCESSING', lockedBy: workerId, lockedAt: now, attempts: { increment: 1 } },
  });
  return count === 1;
}

async function failJob(jobId: number, messageId: number, reason: string, now: Date) {
  await prisma.$transaction([
    prisma.scheduledJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', lastError: reason.slice(0, 500), lockedBy: null, lockedAt: null, completedAt: now },
    }),
    prisma.pushMessage.update({
      where: { id: messageId },
      data: { status: 'FAILED', failureReason: reason.slice(0, 255), completedAt: now },
    }),
  ]);
}

/** Runs a job this process has already claimed. */
export async function executeJob(deps: Deps, jobId: number): Promise<void> {
  const job = await prisma.scheduledJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { message: { include: { environment: { include: { application: true } } } } },
  });
  const { environment } = job.message;

  try {
    assertApplicationUsable(environment.application, deps.clock());
  } catch (error) {
    // A business rejection will not fix itself, so it is not retried.
    await failJob(job.id, job.messageId, (error as Error).message, deps.clock());
    return;
  }

  try {
    const status = await dispatchMessage(deps, job.messageId, dispatchContextOf(environment));
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        status: status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        lockedBy: null,
        lockedAt: null,
        completedAt: deps.clock(),
      },
    });
  } catch (error) {
    const reason = (error as Error).message;
    logger.error({ err: error, jobId }, 'Job execution failed');
    if (job.attempts >= job.maxAttempts) {
      await failJob(job.id, job.messageId, reason, deps.clock());
      return;
    }
    await prisma.$transaction([
      prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          lockedBy: null,
          lockedAt: null,
          lastError: reason.slice(0, 500),
          runAt: new Date(deps.clock().getTime() + RETRY_DELAY_MS),
        },
      }),
      prisma.pushMessage.update({ where: { id: job.messageId }, data: { status: 'PENDING' } }),
    ]);
  }
}

/** Claims and runs every due job. Called by the worker on each tick. */
export async function processDueJobs(deps: Deps, workerId: string, batchSize = 20): Promise<number> {
  const due = await prisma.scheduledJob.findMany({
    where: { status: 'PENDING', runAt: { lte: deps.clock() } },
    orderBy: { runAt: 'asc' },
    take: batchSize,
    select: { id: true },
  });
  let processed = 0;
  for (const { id } of due) {
    if (await claimJob(id, workerId, deps.clock())) {
      await executeJob(deps, id);
      processed += 1;
    }
  }
  return processed;
}

/** Returns jobs orphaned by a crash to the queue, or fails them once attempts are used up. */
export async function recoverStaleJobs(deps: Deps, staleAfterMs = env.WORKER_STALE_LOCK_MS) {
  const now = deps.clock();
  const stale = await prisma.scheduledJob.findMany({
    where: { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - staleAfterMs) } },
  });
  for (const job of stale) {
    if (job.attempts >= job.maxAttempts) {
      await failJob(job.id, job.messageId, 'Job exceeded its retry limit after a crash', now);
      continue;
    }
    await prisma.$transaction([
      prisma.scheduledJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', lockedAt: job.lockedAt },
        data: { status: 'PENDING', lockedBy: null, lockedAt: null, lastError: 'Recovered after crash' },
      }),
      prisma.pushMessage.update({ where: { id: job.messageId }, data: { status: 'PENDING' } }),
    ]);
  }
  return stale.length;
}

export async function cancelJob(deps: Deps, environmentId: number, jobId: number) {
  const job = await prisma.scheduledJob.findFirst({
    where: { id: jobId, message: { environmentId } },
  });
  if (!job) throw notFound('Scheduled job');
  const now = deps.clock();
  const { count } = await prisma.scheduledJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'CANCELLED', completedAt: now },
  });
  if (count === 0) {
    throw conflict('JOB_NOT_CANCELLABLE', `A ${job.status.toLowerCase()} job cannot be cancelled`);
  }
  await prisma.pushMessage.update({
    where: { id: job.messageId },
    data: { status: 'CANCELLED', completedAt: now },
  });
}

export const newWorkerId = () => `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
