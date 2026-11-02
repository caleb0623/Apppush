import { DateTime } from 'luxon';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { localDateRange, localToday } from '../../lib/time.js';
import {
  addFact,
  emptyFunnel,
  failureBreakdown,
  groupFacts,
  safeRate,
  summarize,
  type TargetFact,
} from './metrics.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const analyticsQuery = z.object({
  from: z.string().regex(DATE, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(DATE, 'Use YYYY-MM-DD').optional(),
  granularity: z.enum(['day', 'month']).default('day'),
  deliveryMode: z.enum(['REAL', 'SIMULATED']).optional(),
  platform: z.enum(['ANDROID', 'IOS', 'HARMONYOS']).optional(),
  channel: z.string().trim().max(16).optional(),
});

export const messageAnalyticsQuery = analyticsQuery.pick({ platform: true, channel: true });

type Granularity = 'hour' | 'day' | 'month';
export type AnalyticsQuery = Omit<z.infer<typeof analyticsQuery>, 'granularity'> & {
  granularity: Granularity;
};

const DEFAULT_RANGE_DAYS = 30;
const BUCKET_FORMAT = { hour: 'yyyy-MM-dd HH', day: 'yyyy-MM-dd', month: 'yyyy-MM' } as const;

/** A failed target has no final channel, but its loss belongs to the channel that failed it. */
function channelOf(target: {
  finalChannel: string | null;
  attempts: { channel: string; outcome: string }[];
}) {
  const attempted = target.attempts.find((a) => a.outcome !== 'SKIPPED') ?? target.attempts[0];
  return target.finalChannel ?? attempted?.channel ?? null;
}

const lastAttemptFirst = {
  select: { channel: true, outcome: true },
  orderBy: { attemptNo: 'desc' },
} as const;

function resolveRange(query: AnalyticsQuery, timezone: string, now: Date) {
  const today = localToday(timezone, now);
  const to = query.to ?? today.toISODate()!;
  const from = query.from ?? today.minus({ days: DEFAULT_RANGE_DAYS - 1 }).toISODate()!;
  return { from, to, ...localDateRange(from, to, timezone) };
}

function allBuckets(from: string, to: string, timezone: string, granularity: Granularity) {
  const end = DateTime.fromISO(to, { zone: timezone }).endOf('day');
  const buckets: string[] = [];
  let cursor = DateTime.fromISO(from, { zone: timezone }).startOf(granularity);
  while (cursor <= end) {
    buckets.push(cursor.toFormat(BUCKET_FORMAT[granularity]));
    cursor = cursor.plus({ [granularity]: 1 });
  }
  return buckets;
}

/**
 * Aggregates in the application rather than in SQL because buckets follow the
 * app's IANA timezone, including DST, which fixed-offset SQL grouping cannot do.
 * At real scale this would become a rollup table.
 */
export async function environmentAnalytics(
  environmentId: number,
  timezone: string,
  query: AnalyticsQuery,
  now: Date,
) {
  const { from, to, start, endExclusive } = resolveRange(query, timezone, now);
  const inRange = { environmentId, dispatchedAt: { gte: start, lt: endExclusive } };
  const targetFilter = {
    message: inRange,
    ...(query.deliveryMode ? { deliveryMode: query.deliveryMode } : {}),
    ...(query.platform ? { platform: query.platform } : {}),
  };

  const targets = await prisma.messageTarget.findMany({
    where: targetFilter,
    select: {
      platform: true,
      appVersion: true,
      finalChannel: true,
      deliveryMode: true,
      isValid: true,
      invalidReason: true,
      failureReason: true,
      message: { select: { msgid: true, type: true, dispatchedAt: true } },
      events: { select: { type: true } },
      attempts: lastAttemptFirst,
    },
  });

  const allFacts: TargetFact[] = targets.map((t) => ({
    msgid: t.message.msgid,
    // Cohort basis: every stage is attributed to the day the message was dispatched.
    bucket: DateTime.fromJSDate(t.message.dispatchedAt!, { zone: timezone }).toFormat(
      BUCKET_FORMAT[query.granularity],
    ),
    platform: t.platform,
    channel: channelOf(t),
    deliveryMode: t.deliveryMode,
    messageType: t.message.type,
    appVersion: t.appVersion,
    isValid: t.isValid,
    invalidReason: t.invalidReason,
    failureReason: t.failureReason,
    events: new Set(t.events.map((e) => e.type)),
  }));
  const facts = query.channel ? allFacts.filter((f) => f.channel === query.channel) : allFacts;

  const totals = emptyFunnel();
  for (const fact of facts) addFact(totals, fact);

  const byBucket = new Map(groupFacts(facts, (f) => f.bucket).map((g) => [g.key, g]));
  const trend = allBuckets(from, to, timezone, query.granularity).map((bucket) => {
    const { key: _key, ...values } = byBucket.get(bucket) ?? { key: bucket, ...summarize(emptyFunnel()) };
    return { bucket, ...values };
  });

  const attempts = await prisma.deliveryAttempt.groupBy({
    by: ['channel', 'outcome'],
    where: { target: targetFilter, ...(query.channel ? { channel: query.channel } : {}) },
    _count: { _all: true },
  });
  const byChannel = groupFacts(facts, (f) => f.channel);
  const attemptStats = [...new Set(attempts.map((a) => a.channel))].sort().map((channel) => {
    const count = (outcome: string) =>
      attempts.find((a) => a.channel === channel && a.outcome === outcome)?._count._all ?? 0;
    return {
      channel,
      accepted: count('DELIVERED') + count('ACCEPTED'),
      failed: count('FAILED'),
      skipped: count('SKIPPED'),
    };
  });

  return {
    range: { from, to, timezone, granularity: query.granularity },
    totals: {
      ...summarize(totals),
      messagesDispatched: new Set(facts.map((f) => f.msgid)).size,
      messagesSent: new Set(facts.filter((f) => f.events.has('SENT')).map((f) => f.msgid)).size,
    },
    byDeliveryMode: groupFacts(facts, (f) => f.deliveryMode),
    byPlatform: groupFacts(facts, (f) => f.platform),
    byChannel,
    channelAttempts: attemptStats,
    byMessageType: groupFacts(facts, (f) => f.messageType),
    byAppVersion: groupFacts(facts, (f) => f.appVersion),
    failureReasons: failureBreakdown(facts),
    trend,
    simulated: facts.some((f) => f.deliveryMode === 'SIMULATED'),
  };
}

/** The opening view: today against yesterday by hour, yesterday's funnel, and permission rate. */
export async function environmentOverview(environmentId: number, timezone: string, now: Date) {
  const today = localToday(timezone, now).toISODate()!;
  const yesterday = localToday(timezone, now).minus({ days: 1 }).toISODate()!;
  const hourly = await environmentAnalytics(
    environmentId,
    timezone,
    { from: yesterday, to: today, granularity: 'hour' },
    now,
  );
  const hoursOf = (date: string) =>
    hourly.trend
      .filter((point) => point.bucket.startsWith(date))
      .map((point) => ({ ...point, bucket: `${point.bucket.slice(11)}:00` }));
  const previous = await environmentAnalytics(
    environmentId,
    timezone,
    { from: yesterday, to: yesterday, granularity: 'day' },
    now,
  );
  const [enabled, known] = await Promise.all([
    prisma.device.count({ where: { environmentId, notificationsEnabled: true } }),
    prisma.device.count({ where: { environmentId, notificationsEnabled: { not: null } } }),
  ]);
  return {
    today: hoursOf(today),
    yesterday: hoursOf(yesterday),
    yesterdayFunnel: previous.totals,
    notificationPermission: { enabled, known, rate: safeRate(enabled, known) },
  };
}

interface UserCounts {
  key: string;
  total: number;
  online: number;
  newUsers: number;
  activeUsers: number;
}

/**
 * New users come from registration time. Active users come from each device's
 * last activity, because no daily history is kept, so a device counts once, on
 * its most recent active day. Online is the current count.
 */
export async function userAnalytics(
  environmentId: number,
  timezone: string,
  query: AnalyticsQuery,
  now: Date,
) {
  const { from, to, start, endExclusive } = resolveRange(query, timezone, now);
  const devices = await prisma.device.findMany({
    where: { environmentId, ...(query.platform ? { platform: query.platform } : {}) },
    select: { platform: true, vendor: true, appVersion: true, online: true, createdAt: true, lastActiveAt: true },
  });

  const inRange = (date: Date | null): date is Date =>
    date !== null && date >= start && date < endExclusive;
  const bucketOf = (date: Date) =>
    DateTime.fromJSDate(date, { zone: timezone }).toFormat(BUCKET_FORMAT[query.granularity]);

  const trend = allBuckets(from, to, timezone, query.granularity).map((bucket) => ({
    bucket,
    newUsers: 0,
    activeUsers: 0,
  }));
  const byBucket = new Map(trend.map((point) => [point.bucket, point]));
  for (const device of devices) {
    if (inRange(device.createdAt)) byBucket.get(bucketOf(device.createdAt))!.newUsers += 1;
    if (inRange(device.lastActiveAt)) byBucket.get(bucketOf(device.lastActiveAt))!.activeUsers += 1;
  }

  const groupBy = (keyOf: (device: (typeof devices)[number]) => string | null) => {
    const groups = new Map<string, UserCounts>();
    for (const device of devices) {
      const key = keyOf(device) ?? 'unknown';
      const group = groups.get(key) ?? { key, total: 0, online: 0, newUsers: 0, activeUsers: 0 };
      group.total += 1;
      if (device.online) group.online += 1;
      if (inRange(device.createdAt)) group.newUsers += 1;
      if (inRange(device.lastActiveAt)) group.activeUsers += 1;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  };

  const [totals] = groupBy(() => 'all');
  return {
    range: { from, to, timezone, granularity: query.granularity },
    totals: totals ?? { key: 'all', total: 0, online: 0, newUsers: 0, activeUsers: 0 },
    trend,
    byPlatform: groupBy((d) => d.platform),
    byVendor: groupBy((d) => d.vendor),
    byAppVersion: groupBy((d) => d.appVersion),
  };
}

/** Funnels for specific messages, used by message lists and detail views. */
export async function funnelForMessages(messageIds: number[]) {
  const targets = await prisma.messageTarget.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, isValid: true, events: { select: { type: true } } },
  });
  const funnels = new Map(messageIds.map((id) => [id, emptyFunnel()]));
  for (const target of targets) {
    addFact(funnels.get(target.messageId)!, {
      isValid: target.isValid,
      events: new Set(target.events.map((e) => e.type)),
    });
  }
  return messageIds.map((id) => ({ id, funnel: summarize(funnels.get(id)!) }));
}

export async function messageAnalytics(
  messageId: number,
  filter: z.infer<typeof messageAnalyticsQuery> = {},
) {
  const targets = await prisma.messageTarget.findMany({
    where: { messageId, ...(filter.platform ? { platform: filter.platform } : {}) },
    select: {
      platform: true,
      appVersion: true,
      finalChannel: true,
      deliveryMode: true,
      isValid: true,
      invalidReason: true,
      failureReason: true,
      events: { select: { type: true } },
      attempts: lastAttemptFirst,
    },
  });
  const allFacts: TargetFact[] = targets.map((t) => ({
    msgid: '',
    bucket: '',
    platform: t.platform,
    channel: channelOf(t),
    deliveryMode: t.deliveryMode,
    messageType: '',
    appVersion: t.appVersion,
    isValid: t.isValid,
    invalidReason: t.invalidReason,
    failureReason: t.failureReason,
    events: new Set(t.events.map((e) => e.type)),
  }));
  const facts = filter.channel ? allFacts.filter((f) => f.channel === filter.channel) : allFacts;
  const totals = emptyFunnel();
  for (const fact of facts) addFact(totals, fact);
  return {
    totals: summarize(totals),
    byDeliveryMode: groupFacts(facts, (f) => f.deliveryMode),
    byPlatform: groupFacts(facts, (f) => f.platform),
    byChannel: groupFacts(facts, (f) => f.channel),
    byAppVersion: groupFacts(facts, (f) => f.appVersion),
    failureReasons: failureBreakdown(facts),
    simulated: facts.some((f) => f.deliveryMode === 'SIMULATED'),
  };
}
