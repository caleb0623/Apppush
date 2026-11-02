import { randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { Deps } from '../../deps.js';
import { issueCredential } from '../../lib/credentials.js';
import { conflict, notFound } from '../../lib/errors.js';
import { pageMeta, pageQuery, skipTake } from '../../lib/pagination.js';
import { isUniqueViolation, prisma } from '../../lib/prisma.js';
import { resolveEnvironment, scopeOf } from '../../middleware/environment.js';
import {
  analyticsQuery,
  environmentAnalytics,
  environmentOverview,
  funnelForMessages,
  messageAnalytics,
  messageAnalyticsQuery,
  userAnalytics,
} from '../analytics/service.js';
import { SECRET_NOTICE, serializeEnvironment } from '../apps/service.js';
import { writeAudit } from '../audit/service.js';
import { CHANNELS, simulatorConfigSchema } from '../delivery/channels.js';
import {
  createDevice,
  createTag,
  findDevice,
  setDeviceAlias,
  updateDeviceTags,
  updateTagDevices,
} from '../devices/service.js';
import { recordSimulatedEvents } from '../messages/events.js';
import { createMessageBody, listMessagesQuery, recordEventsBody } from '../messages/schemas.js';
import { createMessage, findMessage, serializeMessage } from '../messages/service.js';
import { cancelJob } from '../scheduler/service.js';

const name = z.string().trim().min(1).max(64);
const names = z.array(name).max(100).default([]);

const configBody = z
  .object({
    callbackUrl: z.string().url().max(500).nullable(),
    callbackEnabled: z.boolean(),
    ipAllowlist: z.array(z.string().ip()).max(50),
    enabledChannels: z.array(z.enum(CHANNELS)).min(1),
    simulatorConfig: simulatorConfigSchema,
  })
  .partial()
  .strict();

const deviceFields = {
  platform: z.enum(['ANDROID', 'IOS', 'HARMONYOS']),
  vendor: z.string().trim().toLowerCase().min(1).max(32).nullable().optional(),
  model: z.string().trim().min(1).max(64).nullable().optional(),
  osVersion: z.string().trim().min(1).max(32).nullable().optional(),
  appVersion: z.string().trim().min(1).max(32),
};

const registerDeviceBody = z
  .object({
    ...deviceFields,
    registrationId: z.string().trim().regex(/^[\w-]{6,64}$/).optional(),
    online: z.boolean().default(false),
  })
  .strict();

const updateDeviceBody = z
  .object({
    vendor: deviceFields.vendor,
    model: deviceFields.model,
    osVersion: deviceFields.osVersion,
    appVersion: deviceFields.appVersion.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    online: z.boolean().optional(),
  })
  .strict();

const listDevicesQuery = pageQuery.extend({
  platform: z.enum(['ANDROID', 'IOS', 'HARMONYOS']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  online: z.enum(['true', 'false']).optional(),
  tag: z.string().max(64).optional(),
  alias: z.string().max(64).optional(),
  appVersion: z.string().max(32).optional(),
  search: z.string().trim().max(64).optional(),
});

const cleanupBody = z
  .object({ inactiveDays: z.number().int().min(1).max(3650), dryRun: z.boolean().default(false) })
  .strict();

const addRemoveBody = z.object({ add: names, remove: names }).strict();
const aliasBody = z.object({ alias: name.nullable() }).strict();
const createTagBody = z.object({ name }).strict();
const listJobsQuery = pageQuery.extend({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
});

const ANALYTICS_NOTICE =
  'These figures include simulated targets from local channel simulators. Filter by delivery mode to see real devices alone.';

const param = (req: Request, key: string) => String(req.params[key]);

const serializeDevice = <
  T extends {
    alias?: { name: string } | null;
    tags?: { tag: { name: string } }[];
    pushToken: string | null;
    deviceSecretHash: string | null;
    installationId: string | null;
  },
>(
  device: T,
) => {
  const { alias, tags, pushToken: _pushToken, deviceSecretHash: _hash, installationId, ...rest } = device;
  return {
    ...rest,
    deliveryMode: installationId ? ('REAL' as const) : ('SIMULATED' as const),
    alias: alias?.name ?? null,
    tags: tags?.map((t) => t.tag.name) ?? [],
  };
};

const deviceInclude = { alias: true, tags: { include: { tag: true } } } as const;

/** Mounted twice: for the console by environment ID and for API clients by AppKey. */
export function environmentRouter(deps: Deps) {
  const router = Router({ mergeParams: true });
  router.use(resolveEnvironment(deps));

  // --- Environment ---

  router.get('/', async (req, res) => {
    const { environment, application } = scopeOf(req);
    const [full, devices, tags, aliases, messages] = await Promise.all([
      prisma.appEnvironment.findUniqueOrThrow({
        where: { id: environment.id },
        include: { credentials: { where: { status: 'ACTIVE' } } },
      }),
      prisma.device.count({ where: { environmentId: environment.id } }),
      prisma.tag.count({ where: { environmentId: environment.id } }),
      prisma.alias.count({ where: { environmentId: environment.id } }),
      prisma.pushMessage.count({ where: { environmentId: environment.id } }),
    ]);
    res.json({
      data: {
        ...serializeEnvironment(full, application),
        usage: { devices, tags, aliases, messages },
      },
    });
  });

  router.patch('/config', async (req, res) => {
    const { environment, application, actor } = scopeOf(req);
    const body = configBody.parse(req.body);
    const updated = await prisma.appEnvironment.update({
      where: { id: environment.id },
      data: body as Prisma.AppEnvironmentUpdateInput,
      include: { credentials: { where: { status: 'ACTIVE' } } },
    });
    await writeAudit(actor, {
      action: 'environment.config_updated',
      entityType: 'AppEnvironment',
      entityId: environment.id,
      metadata: { fields: Object.keys(body) },
    });
    res.json({ data: serializeEnvironment(updated, application) });
  });

  router.post('/credentials/rotate', async (req, res) => {
    const { environment, actor } = scopeOf(req);
    const { masterSecret, record } = issueCredential();
    await prisma.$transaction(async (tx) => {
      await tx.appCredential.updateMany({
        where: { environmentId: environment.id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: deps.clock() },
      });
      await tx.appCredential.create({ data: { ...record, environmentId: environment.id } });
      await writeAudit(
        actor,
        { action: 'credentials.rotated', entityType: 'AppEnvironment', entityId: environment.id },
        tx,
      );
    });
    res.json({ data: { appKey: environment.appKey, masterSecret, notice: SECRET_NOTICE } });
  });

  // --- Devices ---

  router.get('/devices', async (req, res) => {
    const { environment } = scopeOf(req);
    const query = listDevicesQuery.parse(req.query);
    const where: Prisma.DeviceWhereInput = {
      environmentId: environment.id,
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.online ? { online: query.online === 'true' } : {}),
      ...(query.appVersion ? { appVersion: query.appVersion } : {}),
      ...(query.search ? { registrationId: { contains: query.search } } : {}),
      ...(query.tag ? { tags: { some: { tag: { name: query.tag } } } } : {}),
      ...(query.alias ? { alias: { name: query.alias } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.device.findMany({
        where,
        include: deviceInclude,
        orderBy: { id: 'desc' },
        ...skipTake(query),
      }),
      prisma.device.count({ where }),
    ]);
    res.json({ data: rows.map(serializeDevice), meta: pageMeta(query, total) });
  });

  router.post('/devices', async (req, res) => {
    const { environment } = scopeOf(req);
    const body = registerDeviceBody.parse(req.body);
    const registrationId = body.registrationId ?? `rid_${randomBytes(12).toString('hex')}`;
    try {
      const device = await createDevice(environment, (tx) =>
        tx.device.create({
          data: {
            ...body,
            registrationId,
            environmentId: environment.id,
            lastActiveAt: deps.clock(),
          },
          include: deviceInclude,
        }),
      );
      res.status(201).json({ data: serializeDevice(device) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('DEVICE_EXISTS', 'This registration ID is already registered');
      }
      throw error;
    }
  });

  // Registered before /devices/:registrationId so that "cleanup" is not read as an ID.
  router.post('/devices/cleanup', async (req, res) => {
    const { environment, actor } = scopeOf(req);
    const { inactiveDays, dryRun } = cleanupBody.parse(req.body);
    const cutoff = new Date(deps.clock().getTime() - inactiveDays * 86_400_000);
    const where: Prisma.DeviceWhereInput = {
      environmentId: environment.id,
      OR: [{ lastActiveAt: { lt: cutoff } }, { lastActiveAt: null, createdAt: { lt: cutoff } }],
    };
    if (dryRun) {
      res.json({ data: { dryRun, cutoff, matched: await prisma.device.count({ where }) } });
      return;
    }
    const { count } = await prisma.device.deleteMany({ where });
    await writeAudit(actor, {
      action: 'devices.cleanup',
      entityType: 'AppEnvironment',
      entityId: environment.id,
      metadata: { inactiveDays, deleted: count },
    });
    res.json({ data: { dryRun, cutoff, deleted: count } });
  });

  router.get('/devices/:registrationId', async (req, res) => {
    const { environment } = scopeOf(req);
    const device = await prisma.device.findFirst({
      where: { registrationId: param(req, 'registrationId'), environmentId: environment.id },
      include: deviceInclude,
    });
    if (!device) throw notFound('Device');
    res.json({ data: serializeDevice(device) });
  });

  router.patch('/devices/:registrationId', async (req, res) => {
    const { environment } = scopeOf(req);
    const body = updateDeviceBody.parse(req.body);
    const device = await findDevice(environment.id, param(req, 'registrationId'));
    const updated = await prisma.device.update({
      where: { id: device.id },
      data: { ...body, ...(body.online ? { lastActiveAt: deps.clock() } : {}) },
      include: deviceInclude,
    });
    res.json({ data: serializeDevice(updated) });
  });

  router.delete('/devices/:registrationId', async (req, res) => {
    const { environment } = scopeOf(req);
    const device = await findDevice(environment.id, param(req, 'registrationId'));
    await prisma.device.delete({ where: { id: device.id } });
    res.status(204).end();
  });

  router.put('/devices/:registrationId/tags', async (req, res) => {
    const { environment } = scopeOf(req);
    const { add, remove } = addRemoveBody.parse(req.body);
    await updateDeviceTags(environment, param(req, 'registrationId'), add, remove);
    const device = await prisma.device.findFirstOrThrow({
      where: { registrationId: param(req, 'registrationId') },
      include: deviceInclude,
    });
    res.json({ data: serializeDevice(device) });
  });

  router.put('/devices/:registrationId/alias', async (req, res) => {
    const { environment } = scopeOf(req);
    const { alias } = aliasBody.parse(req.body);
    await setDeviceAlias(environment, param(req, 'registrationId'), alias);
    const device = await prisma.device.findFirstOrThrow({
      where: { registrationId: param(req, 'registrationId') },
      include: deviceInclude,
    });
    res.json({ data: serializeDevice(device) });
  });

  // --- Tags ---

  router.get('/tags', async (req, res) => {
    const { environment } = scopeOf(req);
    const query = pageQuery.parse(req.query);
    const where = { environmentId: environment.id };
    const [rows, total] = await Promise.all([
      prisma.tag.findMany({
        where,
        include: { _count: { select: { devices: true } } },
        orderBy: { name: 'asc' },
        ...skipTake(query),
      }),
      prisma.tag.count({ where }),
    ]);
    res.json({
      data: rows.map(({ _count, ...tag }) => ({ ...tag, deviceCount: _count.devices })),
      meta: pageMeta(query, total),
    });
  });

  router.post('/tags', async (req, res) => {
    const { environment } = scopeOf(req);
    const body = createTagBody.parse(req.body);
    res.status(201).json({ data: await createTag(environment, body.name) });
  });

  router.delete('/tags/:name', async (req, res) => {
    const { environment } = scopeOf(req);
    const { count } = await prisma.tag.deleteMany({
      where: { environmentId: environment.id, name: param(req, 'name') },
    });
    if (count === 0) throw notFound('Tag');
    res.status(204).end();
  });

  router.post('/tags/:name/devices', async (req, res) => {
    const { environment } = scopeOf(req);
    const { add, remove } = addRemoveBody.parse(req.body);
    await updateTagDevices(environment, param(req, 'name'), add, remove);
    res.status(204).end();
  });

  // --- Aliases ---

  router.get('/aliases', async (req, res) => {
    const { environment } = scopeOf(req);
    const query = pageQuery.parse(req.query);
    const where = { environmentId: environment.id };
    const [rows, total] = await Promise.all([
      prisma.alias.findMany({
        where,
        include: { devices: { select: { registrationId: true, platform: true } } },
        orderBy: { name: 'asc' },
        ...skipTake(query),
      }),
      prisma.alias.count({ where }),
    ]);
    res.json({ data: rows, meta: pageMeta(query, total) });
  });

  router.delete('/aliases/:name', async (req, res) => {
    const { environment } = scopeOf(req);
    const { count } = await prisma.alias.deleteMany({
      where: { environmentId: environment.id, name: param(req, 'name') },
    });
    if (count === 0) throw notFound('Alias');
    res.status(204).end();
  });

  // --- Messages ---

  router.get('/messages', async (req, res) => {
    const { environment } = scopeOf(req);
    const page = pageQuery.parse(req.query);
    const { search, ...filters } = listMessagesQuery.parse(req.query);
    const where: Prisma.PushMessageWhereInput = {
      environmentId: environment.id,
      ...filters,
      ...(search ? { OR: [{ title: { contains: search } }, { msgid: { contains: search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.pushMessage.findMany({ where, orderBy: { id: 'desc' }, ...skipTake(page) }),
      prisma.pushMessage.count({ where }),
    ]);
    const funnels = await funnelForMessages(rows.map((m) => m.id));
    res.json({
      data: rows.map((message, i) => ({ ...message, funnel: funnels[i]!.funnel })),
      meta: pageMeta(page, total),
    });
  });

  router.post('/messages', async (req, res) => {
    const scope = scopeOf(req);
    const header = req.headers['idempotency-key'];
    const body = createMessageBody.parse({
      ...(req.body as object),
      ...(typeof header === 'string' ? { idempotencyKey: header } : {}),
    });
    const { message, replayed } = await createMessage(deps, scope, body);
    res
      .status(replayed ? 200 : 201)
      .json({ data: { ...(await serializeMessage(message)), idempotentReplay: replayed } });
  });

  router.get('/messages/:msgid', async (req, res) => {
    const { environment } = scopeOf(req);
    const message = await findMessage(environment.id, param(req, 'msgid'));
    res.json({ data: await serializeMessage(message) });
  });

  router.get('/messages/:msgid/targets', async (req, res) => {
    const { environment } = scopeOf(req);
    const query = pageQuery.parse(req.query);
    const message = await findMessage(environment.id, param(req, 'msgid'));
    const where = { messageId: message.id };
    const [rows, total] = await Promise.all([
      prisma.messageTarget.findMany({
        where,
        include: {
          attempts: { orderBy: { attemptNo: 'asc' } },
          events: { orderBy: { occurredAt: 'asc' } },
        },
        orderBy: { id: 'asc' },
        ...skipTake(query),
      }),
      prisma.messageTarget.count({ where }),
    ]);
    res.json({ data: rows, meta: pageMeta(query, total) });
  });

  router.get('/messages/:msgid/attempts', async (req, res) => {
    const { environment } = scopeOf(req);
    const query = pageQuery.parse(req.query);
    const message = await findMessage(environment.id, param(req, 'msgid'));
    const where = { target: { messageId: message.id } };
    const [rows, total] = await Promise.all([
      prisma.deliveryAttempt.findMany({
        where,
        include: { target: { select: { registrationId: true } } },
        orderBy: [{ targetId: 'asc' }, { attemptNo: 'asc' }],
        ...skipTake(query),
      }),
      prisma.deliveryAttempt.count({ where }),
    ]);
    res.json({
      data: rows.map(({ target, ...attempt }) => ({
        ...attempt,
        registrationId: target.registrationId,
      })),
      meta: pageMeta(query, total),
    });
  });

  router.post('/messages/:msgid/events', async (req, res) => {
    const { environment } = scopeOf(req);
    const body = recordEventsBody.parse(req.body);
    const message = await findMessage(environment.id, param(req, 'msgid'));
    res.json({ data: await recordSimulatedEvents(message.id, body, deps.clock()) });
  });

  // --- Scheduled jobs ---

  router.get('/schedules', async (req, res) => {
    const { environment } = scopeOf(req);
    const query = listJobsQuery.parse(req.query);
    const where: Prisma.ScheduledJobWhereInput = {
      message: { environmentId: environment.id, scheduleType: 'SCHEDULED' },
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total, heartbeat] = await Promise.all([
      prisma.scheduledJob.findMany({
        where,
        include: {
          message: {
            select: { msgid: true, title: true, body: true, type: true, strategy: true, status: true },
          },
        },
        orderBy: { runAt: 'desc' },
        ...skipTake(query),
      }),
      prisma.scheduledJob.count({ where }),
      prisma.workerHeartbeat.findFirst({ orderBy: { lastBeatAt: 'desc' } }),
    ]);
    res.json({
      data: rows,
      meta: { ...pageMeta(query, total), workerLastSeenAt: heartbeat?.lastBeatAt ?? null },
    });
  });

  router.post('/schedules/:jobId/cancel', async (req, res) => {
    const { environment, actor } = scopeOf(req);
    const jobId = Number(param(req, 'jobId'));
    if (!Number.isInteger(jobId)) throw notFound('Scheduled job');
    await cancelJob(deps, environment.id, jobId);
    await writeAudit(actor, {
      action: 'schedule.cancelled',
      entityType: 'ScheduledJob',
      entityId: jobId,
    });
    res.json({ data: await prisma.scheduledJob.findUniqueOrThrow({ where: { id: jobId } }) });
  });

  // --- Analytics ---

  router.get('/analytics', async (req, res) => {
    const { environment, application } = scopeOf(req);
    const query = analyticsQuery.parse(req.query);
    const data = await environmentAnalytics(environment.id, application.timezone, query, deps.clock());
    res.json({ data, meta: data.simulated ? { notice: ANALYTICS_NOTICE } : {} });
  });

  router.get('/analytics/overview', async (req, res) => {
    const { environment, application } = scopeOf(req);
    res.json({
      data: await environmentOverview(environment.id, application.timezone, deps.clock()),
    });
  });

  router.get('/analytics/users', async (req, res) => {
    const { environment, application } = scopeOf(req);
    const query = analyticsQuery.parse(req.query);
    res.json({
      data: await userAnalytics(environment.id, application.timezone, query, deps.clock()),
    });
  });

  router.get('/analytics/messages/:msgid', async (req, res) => {
    const { environment } = scopeOf(req);
    const message = await findMessage(environment.id, param(req, 'msgid'));
    const analytics = await messageAnalytics(message.id, messageAnalyticsQuery.parse(req.query));
    res.json({
      data: { msgid: message.msgid, type: message.type, ...analytics },
      meta: analytics.simulated ? { notice: ANALYTICS_NOTICE } : {},
    });
  });

  return router;
}
