import type { AttemptOutcome, MessageTarget, Prisma, PushMessage } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type { Deps } from '../../deps.js';
import {
  CHANNELS,
  type ChannelId,
  type ChannelResult,
  type PushChannel,
  type SimulatorConfig,
} from './channels.js';
import { FcmChannel } from './fcm.js';
import { buildChannelPlan, type PlanStep } from './strategy.js';
import { materializeTargets } from './targets.js';

const BATCH_SIZE = 25;

/** FCM is the only real adapter, and a phone has no connection to any simulator. */
const REAL_CHANNEL = 'fcm';

export interface DispatchContext {
  enabledChannels: string[];
  simulatorConfig: SimulatorConfig;
}

const adapterFor = (
  deps: Deps,
  channel: ChannelId,
  target: MessageTarget,
  config: SimulatorConfig,
): PushChannel =>
  target.deliveryMode === 'REAL'
    ? new FcmChannel(deps.fcm, deps.fcmOptions, deps.clock)
    : deps.channels.get(channel, config);

async function callChannel(
  deps: Deps,
  step: PlanStep,
  message: PushMessage,
  target: MessageTarget,
  context: { config: SimulatorConfig; pushToken: string | null },
): Promise<ChannelResult> {
  const channel = step.channel as ChannelId;
  try {
    return await adapterFor(deps, channel, target, context.config).send({
      msgid: message.msgid,
      registrationId: target.registrationId,
      platform: target.platform!,
      online: target.online,
      title: message.title,
      body: message.body,
      payload: message.customPayload,
      pushToken: context.pushToken,
      messageType: message.type,
      style: message.style,
      styleConfig: message.styleConfig,
    });
  } catch (error) {
    // A misbehaving adapter counts as a failed attempt, so fallback still runs.
    return {
      channel,
      provider: channel,
      outcome: 'FAILED',
      timestamp: deps.clock(),
      failureReason: `PROVIDER_ERROR: ${(error as Error).message}`.slice(0, 255),
      providerMessageId: null,
      simulated: false,
    };
  }
}

async function recordFailure(
  target: MessageTarget,
  attemptNo: number,
  step: PlanStep,
  outcome: AttemptOutcome,
  fields: {
    provider: string;
    simulated: boolean;
    reason: string | null;
    at: Date;
    providerResponse?: Prisma.InputJsonValue | undefined;
  },
) {
  await prisma.deliveryAttempt.create({
    data: {
      targetId: target.id,
      attemptNo,
      channel: step.channel,
      provider: fields.provider,
      isFallback: step.isFallback,
      isSimulated: fields.simulated,
      outcome,
      failureReason: fields.reason,
      providerResponse: fields.providerResponse,
      attemptedAt: fields.at,
    },
  });
}

/** The attempt, target state and funnel events commit together or not at all. */
async function recordAcceptance(
  target: MessageTarget,
  attemptNo: number,
  step: PlanStep,
  result: ChannelResult,
) {
  const delivered = result.outcome === 'DELIVERED';
  const source = result.simulated ? ('DELIVERY_SIMULATOR' as const) : ('PROVIDER' as const);
  await prisma.$transaction([
    prisma.deliveryAttempt.create({
      data: {
        targetId: target.id,
        attemptNo,
        channel: result.channel,
        provider: result.provider,
        isFallback: step.isFallback,
        isSimulated: result.simulated,
        outcome: result.outcome,
        providerMessageId: result.providerMessageId,
        providerResponse: result.providerResponse,
        attemptedAt: result.timestamp,
      },
    }),
    prisma.messageTarget.update({
      where: { id: target.id },
      data: { finalChannel: result.channel, failureReason: null },
    }),
    // A fast phone can report receipt before this runs; that later state must stand.
    prisma.messageTarget.updateMany({
      where: { id: target.id, status: 'PENDING' },
      data: { status: delivered ? 'DELIVERED' : 'SENT' },
    }),
    prisma.messageEvent.createMany({
      data: (delivered ? (['SENT', 'DELIVERED'] as const) : (['SENT'] as const)).map((type) => ({
        targetId: target.id,
        type,
        source,
        channel: result.channel,
        occurredAt: result.timestamp,
      })),
      skipDuplicates: true,
    }),
    prisma.messageEvent.updateMany({
      where: { targetId: target.id, type: 'SENT', inferred: true },
      data: { source, inferred: false, channel: result.channel, occurredAt: result.timestamp },
    }),
  ]);
}

async function deliverToTarget(
  deps: Deps,
  message: PushMessage,
  target: MessageTarget,
  context: DispatchContext,
  pushToken: string | null,
): Promise<void> {
  // After a crash, resume the plan: channels that already answered are not called again.
  const earlier = await prisma.deliveryAttempt.findMany({
    where: { targetId: target.id },
    select: { channel: true, failureReason: true },
    orderBy: { attemptNo: 'asc' },
  });
  const tried = new Set(earlier.map((a) => a.channel));
  let attemptNo = earlier.length;
  let lastFailure = earlier.at(-1)?.failureReason ?? 'NO_AVAILABLE_CHANNEL';

  const plan = buildChannelPlan(
    message.strategy,
    // A real phone has no EngageLab connection in this project, so it counts as offline.
    {
      platform: target.platform!,
      vendor: target.vendor,
      online: target.deliveryMode === 'SIMULATED' && target.online,
    },
    context.enabledChannels,
    message.channelOverride,
  );

  for (const step of plan) {
    if (tried.has(step.channel)) continue;
    attemptNo += 1;

    const skipReason =
      step.skipReason ??
      (target.deliveryMode === 'REAL' && step.channel !== REAL_CHANNEL
        ? 'SIMULATOR_CANNOT_REACH_REAL_DEVICE'
        : null);
    if (skipReason) {
      await recordFailure(target, attemptNo, step, 'SKIPPED', {
        provider: 'none',
        simulated: target.deliveryMode === 'SIMULATED',
        reason: skipReason,
        at: deps.clock(),
      });
      lastFailure = skipReason;
      continue;
    }

    const result = await callChannel(deps, step, message, target, {
      config: context.simulatorConfig,
      pushToken,
    });
    if (result.outcome !== 'FAILED') {
      await recordAcceptance(target, attemptNo, step, result);
      return;
    }
    if (result.tokenInvalid && target.deviceId !== null) {
      // Keyed on the token used, so a refresh that raced this send is not undone.
      await prisma.device.updateMany({
        where: { id: target.deviceId, pushToken },
        data: { pushTokenStatus: 'INVALID' },
      });
    }
    await recordFailure(target, attemptNo, step, 'FAILED', {
      provider: result.provider,
      simulated: result.simulated,
      reason: result.failureReason,
      at: result.timestamp,
      providerResponse: result.providerResponse,
    });
    lastFailure = result.failureReason ?? 'UNKNOWN_FAILURE';
  }

  await prisma.messageTarget.updateMany({
    where: { id: target.id, status: 'PENDING' },
    data: { status: 'FAILED', failureReason: lastFailure.slice(0, 255) },
  });
}

/** Tokens are read at send time, so a refresh after scheduling is still honoured. */
async function pushTokensOf(targets: MessageTarget[]) {
  const ids = targets.flatMap((t) => (t.deliveryMode === 'REAL' && t.deviceId ? [t.deviceId] : []));
  const devices = await prisma.device.findMany({
    where: { id: { in: ids } },
    select: { id: true, pushToken: true },
  });
  return new Map(devices.map((d) => [d.id, d.pushToken]));
}

/**
 * Sends a message to every pending target. Only PENDING targets are selected,
 * so re-running after a crash cannot deliver to anyone twice.
 */
export async function dispatchMessage(
  deps: Deps,
  messageId: number,
  context: DispatchContext,
): Promise<'COMPLETED' | 'FAILED'> {
  const message = await prisma.pushMessage.update({
    where: { id: messageId },
    data: { status: 'PROCESSING' },
  });
  if (!message.dispatchedAt) {
    await prisma.pushMessage.update({
      where: { id: messageId },
      data: { dispatchedAt: deps.clock() },
    });
  }

  await materializeTargets(message);

  const pending = await prisma.messageTarget.findMany({
    where: { messageId, status: 'PENDING' },
  });
  const tokens = await pushTokensOf(pending);
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    await Promise.all(
      pending.slice(i, i + BATCH_SIZE).map((t) =>
        deliverToTarget(deps, message, t, context, tokens.get(t.deviceId ?? 0) ?? null),
      ),
    );
  }

  const [valid, accepted, real] = await Promise.all([
    prisma.messageTarget.count({ where: { messageId, isValid: true } }),
    prisma.messageTarget.count({ where: { messageId, status: { in: ['SENT', 'DELIVERED'] } } }),
    prisma.messageTarget.count({ where: { messageId, deliveryMode: 'REAL' } }),
  ]);
  const failureReason =
    valid === 0 ? 'NO_VALID_TARGETS' : accepted === 0 ? 'ALL_TARGETS_FAILED' : null;
  const status = failureReason ? 'FAILED' : 'COMPLETED';
  await prisma.pushMessage.update({
    where: { id: messageId },
    data: { status, failureReason, isSimulated: real === 0, completedAt: deps.clock() },
  });
  return status;
}

export const dispatchContextOf = (environment: {
  enabledChannels: unknown;
  simulatorConfig: unknown;
}): DispatchContext => ({
  enabledChannels: (environment.enabledChannels as string[]) ?? [...CHANNELS],
  simulatorConfig: environment.simulatorConfig as SimulatorConfig,
});
