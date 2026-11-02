import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { generateDeviceSecret, hashDeviceSecret, verifyDeviceSecret } from '../../lib/credentials.js';
import { ApiError, conflict, unauthorized } from '../../lib/errors.js';
import { isUniqueViolation, prisma, type Tx } from '../../lib/prisma.js';
import { assertApplicationUsable, enforceTestingLimit } from '../../middleware/environment.js';
import { createDevice } from '../devices/service.js';
import { recordDeviceReport } from '../messages/events.js';

const pushToken = z.string().trim().min(20).max(512);

const registerBody = z
  .object({
    installationId: z.string().trim().regex(/^[\w-]{8,64}$/),
    pushToken,
    platform: z.literal('ANDROID').default('ANDROID'),
    vendor: z.string().trim().toLowerCase().min(1).max(32).nullable().optional(),
    model: z.string().trim().min(1).max(64).nullable().optional(),
    osVersion: z.string().trim().min(1).max(32).nullable().optional(),
    appVersion: z.string().trim().min(1).max(32),
    notificationsEnabled: z.boolean().optional(),
  })
  .strict();

const tokenBody = z.object({ pushToken }).strict();

const eventBody = z
  .object({
    msgid: z.string().trim().min(1).max(32),
    type: z.enum(['DELIVERED', 'DISPLAYED', 'CLICKED', 'DISPLAY_FAILED']),
    occurredAt: z.coerce.date().optional(),
    /** Why a message could not be shown; only meaningful with DISPLAY_FAILED. */
    reason: z.string().trim().regex(/^[A-Z0-9_]{1,64}$/).optional(),
  })
  .strict();

const header = (req: Request, name: string) => {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

async function environmentOf(deps: Deps, req: Request, res: Response) {
  const appKey = header(req, 'x-app-key');
  if (!appKey) throw unauthorized('The X-App-Key header is required', 'APP_KEY_REQUIRED');
  const found = await prisma.appEnvironment.findUnique({
    where: { appKey },
    include: { application: true },
  });
  if (!found) throw unauthorized('Unknown AppKey', 'INVALID_APP_KEY');
  const { application, ...environment } = found;
  assertApplicationUsable(application, deps.clock());
  enforceTestingLimit(deps, environment, res);
  return { environment, application };
}

/** Only this device's secret can speak for it. Unknown IDs get the same answer, to hide which exist. */
async function deviceOf(deps: Deps, req: Request, res: Response) {
  const registrationId = header(req, 'x-registration-id');
  const secret = header(req, 'x-device-secret');
  const invalid = () => unauthorized('Invalid device credentials', 'INVALID_DEVICE_CREDENTIALS');
  if (!registrationId || !secret) throw invalid();
  const device = await prisma.device.findUnique({
    where: { registrationId },
    include: { environment: { include: { application: true } } },
  });
  if (!device?.deviceSecretHash || !verifyDeviceSecret(secret, device.deviceSecretHash)) {
    throw invalid();
  }
  assertApplicationUsable(device.environment.application, deps.clock());
  enforceTestingLimit(deps, device.environment, res);
  return device;
}

/** A token belongs to one installation. A reinstall can reuse it, and the old row must let go. */
const releaseToken = (tx: Tx, environmentId: number, token: string, deviceId: number | null) =>
  tx.device.updateMany({
    where: { environmentId, pushToken: token, ...(deviceId ? { id: { not: deviceId } } : {}) },
    data: { pushToken: null, pushTokenStatus: null },
  });

const tokenFields = (token: string, now: Date) => ({
  pushToken: token,
  pushTokenStatus: 'ACTIVE' as const,
  pushTokenUpdatedAt: now,
  lastActiveAt: now,
  online: true,
});

const deviceView = (device: {
  registrationId: string;
  status: string;
  pushTokenStatus: string | null;
}) => ({
  registrationId: device.registrationId,
  status: device.status,
  pushTokenStatus: device.pushTokenStatus,
});

/** The API the Android app calls. It authenticates with the public AppKey, then a per-device secret. */
export function clientRouter(deps: Deps) {
  const router = Router();

  router.use((req, res, next) => {
    const decision = deps.clientLimiter.consume(`ip:${req.ip}`);
    if (!decision.allowed) {
      res.setHeader('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests from this address');
    }
    next();
  });

  router.get('/ping', async (req, res) => {
    const { environment, application } = await environmentOf(deps, req, res);
    const registered = header(req, 'x-registration-id');
    const device = registered ? await deviceOf(deps, req, res) : null;
    if (device && device.environmentId !== environment.id) {
      throw unauthorized('This device belongs to another AppKey', 'INVALID_DEVICE_CREDENTIALS');
    }
    if (device) {
      await prisma.device.update({
        where: { id: device.id },
        data: { lastActiveAt: deps.clock(), online: true },
      });
    }
    res.json({
      data: {
        ok: true,
        serverTime: deps.clock(),
        application: application.name,
        environment: environment.type,
        fcmConfigured: deps.fcm !== null,
        device: device ? deviceView(device) : null,
      },
    });
  });

  router.post('/devices', async (req, res) => {
    const { environment } = await environmentOf(deps, req, res);
    const { pushToken: token, ...body } = registerBody.parse(req.body);
    const now = deps.clock();

    const existing = await prisma.device.findUnique({
      where: {
        environmentId_installationId: {
          environmentId: environment.id,
          installationId: body.installationId,
        },
      },
    });
    if (existing) {
      const secret = header(req, 'x-device-secret');
      if (!secret || !existing.deviceSecretHash || !verifyDeviceSecret(secret, existing.deviceSecretHash)) {
        throw unauthorized('This installation is already registered', 'DEVICE_SECRET_REQUIRED');
      }
      const device = await prisma.$transaction(async (tx) => {
        await releaseToken(tx, environment.id, token, existing.id);
        return tx.device.update({
          where: { id: existing.id },
          data: { ...body, ...tokenFields(token, now) },
        });
      });
      res.json({ data: { ...deviceView(device), deviceSecret: null } });
      return;
    }

    const deviceSecret = generateDeviceSecret();
    try {
      const device = await createDevice(environment, async (tx) => {
        await releaseToken(tx, environment.id, token, null);
        return tx.device.create({
          data: {
            ...body,
            ...tokenFields(token, now),
            environmentId: environment.id,
            registrationId: `rid_${randomBytes(12).toString('hex')}`,
            deviceSecretHash: hashDeviceSecret(deviceSecret),
          },
        });
      });
      res.status(201).json({ data: { ...deviceView(device), deviceSecret } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('DEVICE_EXISTS', 'This installation was registered by another request');
      }
      throw error;
    }
  });

  router.put('/devices/me/token', async (req, res) => {
    const device = await deviceOf(deps, req, res);
    const { pushToken: token } = tokenBody.parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      await releaseToken(tx, device.environmentId, token, device.id);
      return tx.device.update({
        where: { id: device.id },
        data: tokenFields(token, deps.clock()),
      });
    });
    res.json({ data: deviceView(updated) });
  });

  router.post('/events', async (req, res) => {
    const device = await deviceOf(deps, req, res);
    const body = eventBody.parse(req.body);
    res.json({ data: await recordDeviceReport(device, body, deps.clock()) });
  });

  return router;
}
