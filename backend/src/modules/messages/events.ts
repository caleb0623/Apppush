import type { EventType, MessageTarget, Prisma } from '@prisma/client';
import { conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export type SimulatedEventType = 'DELIVERED' | 'DISPLAYED' | 'CLICKED';

type TargetWithEvents = MessageTarget & { events: { type: string }[] };

const has = (target: TargetWithEvents, type: string) => target.events.some((e) => e.type === type);

/** Why a target cannot take this event, or null when it can. */
export function ineligibleReason(target: TargetWithEvents, type: SimulatedEventType): string | null {
  if (has(target, type)) return 'ALREADY_RECORDED';
  if (type === 'DELIVERED') return target.status === 'SENT' ? null : 'NOT_AWAITING_DELIVERY';
  return target.status === 'DELIVERED' ? null : 'NOT_DELIVERED';
}

const SOURCE = 'MANUAL_SIMULATION' as const;

/**
 * Records simulated receipts, which stand in for device reports. Stage order is
 * enforced, and the (targetId, type) key stops a stage being counted twice.
 * Real devices are never selected: only the phone may speak for itself.
 */
export async function recordSimulatedEvents(
  messageId: number,
  input: { type: SimulatedEventType; registrationIds?: string[] | undefined; count?: number | undefined },
  now: Date,
) {
  const targets = await prisma.messageTarget.findMany({
    where: {
      messageId,
      deliveryMode: 'SIMULATED',
      ...(input.registrationIds ? { registrationId: { in: input.registrationIds } } : {}),
    },
    include: { events: { select: { type: true } } },
    orderBy: { id: 'asc' },
  });

  const eligible: TargetWithEvents[] = [];
  const skipped: { registrationId: string; reason: string }[] = [];
  for (const target of targets) {
    const reason = ineligibleReason(target, input.type);
    if (reason) skipped.push({ registrationId: target.registrationId, reason });
    else eligible.push(target);
  }

  const selected = input.count ? eligible.slice(0, input.count) : eligible;
  if (selected.length === 0 && input.registrationIds) {
    throw conflict('EVENT_NOT_ALLOWED', 'None of these targets can take this event', { skipped });
  }

  const rows: Prisma.MessageEventCreateManyInput[] = selected.map((target) => ({
    targetId: target.id,
    type: input.type,
    source: SOURCE,
    channel: target.finalChannel,
    occurredAt: now,
  }));
  if (input.type === 'CLICKED') {
    // A click proves the notification was shown.
    for (const target of selected.filter((t) => !has(t, 'DISPLAYED'))) {
      rows.push({
        targetId: target.id,
        type: 'DISPLAYED',
        source: SOURCE,
        channel: target.finalChannel,
        occurredAt: now,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.messageEvent.createMany({ data: rows, skipDuplicates: true });
    if (input.type === 'DELIVERED') {
      await tx.messageTarget.updateMany({
        where: { id: { in: selected.map((t) => t.id) }, status: 'SENT' },
        data: { status: 'DELIVERED' },
      });
    }
  });

  return { type: input.type, recorded: selected.length, skipped, simulated: true };
}

const STAGES: EventType[] = ['SENT', 'DELIVERED', 'DISPLAYED', 'CLICKED'];

/** A report arrives after the fact; a phone with a wrong clock must not rewrite history. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function eventTime(reported: Date | undefined, floor: Date | null, now: Date): Date {
  if (!reported) return now;
  const tooLate = reported.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS;
  const tooEarly = floor !== null && reported.getTime() < floor.getTime() - MAX_CLOCK_SKEW_MS;
  return tooLate || tooEarly ? now : reported;
}

export interface DeviceReport {
  msgid: string;
  type: 'DELIVERED' | 'DISPLAYED' | 'CLICKED' | 'DISPLAY_FAILED';
  occurredAt?: Date | undefined;
  reason?: string | undefined;
}

/**
 * Records what a phone says happened to a message. Reports may arrive late, out
 * of order or twice, so every write is idempotent. A later stage proves the
 * earlier ones, which are recorded as inferred instead of being left as a gap.
 */
export async function recordDeviceReport(
  device: { id: number; environmentId: number },
  report: DeviceReport,
  now: Date,
) {
  const target = await prisma.messageTarget.findFirst({
    where: {
      deviceId: device.id,
      message: { msgid: report.msgid, environmentId: device.environmentId },
    },
    include: { message: { select: { dispatchedAt: true } } },
  });
  if (!target) throw notFound('A message for this device');

  const reached: EventType = report.type === 'DISPLAY_FAILED' ? 'DELIVERED' : report.type;
  const occurredAt = eventTime(report.occurredAt, target.message.dispatchedAt, now);
  const stages = STAGES.slice(0, STAGES.indexOf(reached) + 1);

  const created = await prisma.$transaction(async (tx) => {
    // A phone sends several reports at once. Without this lock their inserts deadlock.
    await tx.$queryRaw`SELECT id FROM MessageTarget WHERE id = ${target.id} FOR UPDATE`;
    const known = await tx.messageEvent.findMany({
      where: { targetId: target.id },
      select: { type: true },
    });
    const rows = stages
      .filter((stage) => !known.some((event) => event.type === stage))
      .map((stage) => ({
        targetId: target.id,
        type: stage,
        source: 'DEVICE_CLIENT' as const,
        channel: target.finalChannel,
        inferred: stage !== reached,
        occurredAt,
      }));

    await tx.messageEvent.createMany({ data: rows, skipDuplicates: true });
    // Reports race, so a direct report can arrive after a later stage already implied it.
    await tx.messageEvent.updateMany({
      where: { targetId: target.id, type: reached, inferred: true },
      data: { inferred: false, source: 'DEVICE_CLIENT', occurredAt },
    });
    // The phone outranks a provider error: a timed-out send may still have arrived.
    await tx.messageTarget.updateMany({
      where: { id: target.id, status: { in: ['PENDING', 'SENT', 'FAILED'] } },
      data: { status: 'DELIVERED', failureReason: null },
    });
    if (report.type === 'DISPLAY_FAILED') {
      await tx.messageTarget.update({
        where: { id: target.id },
        data: { failureReason: (report.reason ?? 'DISPLAY_FAILED').slice(0, 255) },
      });
    } else if (report.type === 'DISPLAYED' || report.type === 'CLICKED') {
      await tx.messageTarget.update({ where: { id: target.id }, data: { failureReason: null } });
    }
    return rows.length;
  });

  return { type: report.type, recorded: created > 0, duplicate: created === 0 };
}
