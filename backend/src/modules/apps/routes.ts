import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { conflict, notFound } from '../../lib/errors.js';
import { pageMeta, pageQuery, skipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { isValidTimezone } from '../../lib/time.js';
import { requireUser, requireWriteRole } from '../../middleware/auth.js';
import type { Actor } from '../../types.js';
import { writeAudit } from '../audit/service.js';
import { createEnvironment, SECRET_NOTICE, serializeEnvironment } from './service.js';

const httpUrl = z
  .string()
  .url()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL');

const appFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  iconUrl: httpUrl.nullable().optional(),
  isVip: z.boolean().optional(),
  serviceValidUntil: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().refine(isValidTimezone, 'Must be an IANA timezone').optional(),
};

const createBody = z.object(appFields).strict();
const updateBody = z.object(appFields).partial().strict();
const listQuery = pageQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const actorOf = (req: Request): Actor => ({
  userId: req.user!.id,
  label: req.user!.email,
  ip: req.ip,
});

const appId = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Application');
  return id;
};

const loadApp = async (id: number) => {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      environments: {
        include: { credentials: { where: { status: 'ACTIVE' } } },
        orderBy: { type: 'asc' },
      },
    },
  });
  if (!application) throw notFound('Application');
  return application;
};

const toValidity = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);

const serializeApp = (application: Awaited<ReturnType<typeof loadApp>>) => {
  const { environments, ...metadata } = application;
  return {
    ...metadata,
    environments: environments.map((e) => serializeEnvironment(e, application)),
  };
};

export function appsRouter(_deps: Deps) {
  const router = Router();
  router.use(requireUser, requireWriteRole);

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.application.findMany({
        where,
        orderBy: { id: 'desc' },
        ...skipTake(query),
        include: { environments: { select: { id: true, type: true, appKey: true } } },
      }),
      prisma.application.count({ where }),
    ]);
    res.json({ data: rows, meta: pageMeta(query, total) });
  });

  router.post('/', async (req, res) => {
    const { serviceValidUntil, ...fields } = createBody.parse(req.body);
    const { application, environment, masterSecret } = await prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: { ...fields, serviceValidUntil: toValidity(serviceValidUntil) ?? null },
      });
      const issued = await createEnvironment(tx, created.id, 'PRODUCTION');
      await writeAudit(
        actorOf(req),
        { action: 'app.created', entityType: 'Application', entityId: created.id },
        tx,
      );
      return { application: created, ...issued };
    });
    res.status(201).json({
      data: {
        application: serializeApp(await loadApp(application.id)),
        credentials: {
          environmentId: environment.id,
          appKey: environment.appKey,
          masterSecret,
          notice: SECRET_NOTICE,
        },
      },
    });
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: serializeApp(await loadApp(appId(req))) });
  });

  router.patch('/:id', async (req, res) => {
    const id = appId(req);
    const { serviceValidUntil, ...fields } = updateBody.parse(req.body);
    const before = await loadApp(id);
    if (before.status !== 'ACTIVE') throw conflict('APP_INACTIVE', 'Reactivate the app to edit it');
    await prisma.application.update({
      where: { id },
      data: { ...fields, serviceValidUntil: toValidity(serviceValidUntil) },
    });
    await writeAudit(actorOf(req), {
      action: 'app.updated',
      entityType: 'Application',
      entityId: id,
      metadata: { fields: Object.keys(req.body as object) },
    });
    res.json({ data: serializeApp(await loadApp(id)) });
  });

  for (const [path, status] of [
    ['deactivate', 'INACTIVE'],
    ['activate', 'ACTIVE'],
  ] as const) {
    router.post(`/:id/${path}`, async (req, res) => {
      const id = appId(req);
      await loadApp(id);
      await prisma.application.update({ where: { id }, data: { status } });
      await writeAudit(actorOf(req), {
        action: `app.${path}d`,
        entityType: 'Application',
        entityId: id,
      });
      res.json({ data: serializeApp(await loadApp(id)) });
    });
  }

  router.post('/:id/testing-environment', async (req, res) => {
    const id = appId(req);
    const application = await loadApp(id);
    if (application.status !== 'ACTIVE') {
      throw conflict('APP_INACTIVE', 'Reactivate the app to add a testing environment');
    }
    if (application.environments.some((e) => e.type === 'TESTING')) {
      throw conflict('TESTING_ENV_EXISTS', 'This application already has a testing environment');
    }
    const production = await prisma.appEnvironment.findUniqueOrThrow({
      where: { applicationId_type: { applicationId: id, type: 'PRODUCTION' } },
    });
    const { environment, masterSecret } = await prisma.$transaction(async (tx) => {
      const issued = await createEnvironment(tx, id, 'TESTING', production);
      await writeAudit(
        actorOf(req),
        { action: 'environment.created', entityType: 'AppEnvironment', entityId: issued.environment.id },
        tx,
      );
      return issued;
    });
    res.status(201).json({
      data: {
        application: serializeApp(await loadApp(id)),
        credentials: {
          environmentId: environment.id,
          appKey: environment.appKey,
          masterSecret,
          notice: SECRET_NOTICE,
        },
      },
    });
  });

  return router;
}
