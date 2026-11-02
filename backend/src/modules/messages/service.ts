import { createHash, randomInt } from 'node:crypto';
import { Prisma, type PushMessage } from '@prisma/client';
import type { Deps } from '../../deps.js';
import { env } from '../../config/env.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { isUniqueViolation, prisma } from '../../lib/prisma.js';
import { parseAppTime } from '../../lib/time.js';
import type { EnvironmentContext } from '../../types.js';
import { funnelForMessages } from '../analytics/service.js';
import { claimJob, executeJob } from '../scheduler/service.js';
import type { CreateMessageInput } from './schemas.js';

const MAX_SCHEDULE_DAYS = 365;

export const SIMULATION_NOTICE =
  'Delivery results are produced by local channel simulators. No real device received this message.';

export const MIXED_DELIVERY_NOTICE =
  'Some targets are simulated records. Only targets marked Real were sent through a real provider.';

/** 13-digit millisecond timestamp plus 6 random digits: sortable and unique. */
export const generateMsgid = (now: Date) => `${now.getTime()}${randomInt(100_000, 1_000_000)}`;

const hashRequest = (input: CreateMessageInput): string =>
  createHash('sha256').update(JSON.stringify({ ...input, idempotencyKey: undefined })).digest('hex');

function resolveSchedule(input: CreateMessageInput, timezone: string, now: Date) {
  if (!input.scheduledAt) return null;
  const at = parseAppTime(input.scheduledAt, timezone);
  if (at <= now) throw badRequest('SCHEDULE_IN_PAST', 'scheduledAt must be in the future');
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) {
    throw badRequest('SCHEDULE_TOO_FAR', `scheduledAt must be within ${MAX_SCHEDULE_DAYS} days`);
  }
  return at;
}

async function replay(existing: PushMessage, requestHash: string) {
  if (existing.requestHash !== requestHash) {
    throw conflict(
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used with a different request body',
    );
  }
  return { message: existing, replayed: true };
}

export async function createMessage(
  deps: Deps,
  scope: EnvironmentContext,
  input: CreateMessageInput,
) {
  const { environment, application, actor } = scope;
  const now = deps.clock();
  const scheduledAt = resolveSchedule(input, application.timezone, now);
  const requestHash = hashRequest(input);
  const idempotencyKey = input.idempotencyKey ?? null;

  if (idempotencyKey) {
    const existing = await prisma.pushMessage.findUnique({
      where: { environmentId_idempotencyKey: { environmentId: environment.id, idempotencyKey } },
    });
    if (existing) return replay(existing, requestHash);
  }

  let message: PushMessage;
  try {
    message = await prisma.pushMessage.create({
      data: {
        msgid: generateMsgid(now),
        environmentId: environment.id,
        type: input.type,
        title: input.title ?? null,
        body: input.body ?? null,
        style: input.style,
        styleConfig: (input.styleConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        customPayload: (input.customPayload ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        platforms: input.platforms,
        audienceType: input.audience.type,
        audience: input.audience.type === 'ALL' ? [] : input.audience.values,
        strategy: input.strategy,
        channelOverride: input.channel ?? null,
        scheduleType: scheduledAt ? 'SCHEDULED' : 'IMMEDIATE',
        scheduledAt,
        idempotencyKey,
        requestHash,
        createdById: actor.userId,
        // The job commits with the message, so a saved message always gets processed.
        job: { create: { runAt: scheduledAt ?? now, maxAttempts: env.WORKER_MAX_ATTEMPTS } },
      },
      include: { job: true },
    });
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error)) {
      // Two identical requests raced; the unique key let only one through.
      const winner = await prisma.pushMessage.findUniqueOrThrow({
        where: { environmentId_idempotencyKey: { environmentId: environment.id, idempotencyKey } },
      });
      return replay(winner, requestHash);
    }
    throw error;
  }

  if (!scheduledAt) {
    const jobId = (message as PushMessage & { job: { id: number } }).job.id;
    // If this loses a race with the worker, the worker finishes the job instead.
    if (await claimJob(jobId, `api-${process.pid}`, deps.clock())) {
      await executeJob(deps, jobId);
    }
    message = await prisma.pushMessage.findUniqueOrThrow({ where: { id: message.id } });
  }

  return { message, replayed: false };
}

export async function findMessage(environmentId: number, msgid: string) {
  const message = await prisma.pushMessage.findFirst({
    where: { msgid, environmentId },
    include: { job: true },
  });
  if (!message) throw notFound('Message');
  return message;
}

export async function serializeMessage(message: PushMessage) {
  const [[funnel], modes] = await Promise.all([
    funnelForMessages([message.id]),
    prisma.messageTarget.groupBy({
      by: ['deliveryMode'],
      where: { messageId: message.id },
      _count: { _all: true },
    }),
  ]);
  const count = (mode: string) => modes.find((m) => m.deliveryMode === mode)?._count._all ?? 0;
  const delivery = { real: count('REAL'), simulated: count('SIMULATED') };
  const simulationNotice =
    delivery.simulated === 0 ? null : delivery.real > 0 ? MIXED_DELIVERY_NOTICE : SIMULATION_NOTICE;
  return { ...message, funnel: funnel?.funnel, delivery, simulationNotice };
}
