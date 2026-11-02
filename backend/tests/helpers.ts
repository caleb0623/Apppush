import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDeps, type Deps } from '../src/deps.js';
import { SlidingWindowRateLimiter } from '../src/lib/rate-limiter.js';
import { prisma } from '../src/lib/prisma.js';
import { signToken } from '../src/middleware/auth.js';

export { prisma };

export const PASSWORD = 'correct-horse-battery';

export async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.workerHeartbeat.deleteMany();
  await prisma.application.findMany().then(async (apps) => {
    await prisma.appEnvironment.deleteMany({
      where: { applicationId: { in: apps.map((a) => a.id) } },
    });
  });
  await prisma.application.deleteMany();
}

export function buildDeps(overrides: Partial<Deps> = {}): Deps {
  return createDeps({
    testingLimiter: new SlidingWindowRateLimiter(1_000_000, 1000),
    loginLimiter: new SlidingWindowRateLimiter(1_000_000, 1000),
    clientLimiter: new SlidingWindowRateLimiter(1_000_000, 1000),
    ...overrides,
  });
}

export async function createUser(role: 'ADMIN' | 'VIEWER' = 'ADMIN', email = 'admin@test.local') {
  const user = await prisma.adminUser.create({
    data: { email, name: role, role, passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  return { user, token: signToken(user.id) };
}

export async function harness(overrides: Partial<Deps> = {}) {
  await resetDatabase();
  const deps = buildDeps(overrides);
  const app = createApp(deps);
  const { user, token } = await createUser();
  const bearer = `Bearer ${token}`;
  const api = {
    get: (url: string) => request(app).get(url).set('Authorization', bearer),
    post: (url: string, body?: object) =>
      request(app).post(url).set('Authorization', bearer).send(body),
    patch: (url: string, body: object) =>
      request(app).patch(url).set('Authorization', bearer).send(body),
    put: (url: string, body: object) =>
      request(app).put(url).set('Authorization', bearer).send(body),
    delete: (url: string) => request(app).delete(url).set('Authorization', bearer),
  };
  return { app, api, deps, user, token };
}

export type Harness = Awaited<ReturnType<typeof harness>>;

export async function createApplication(h: Harness, name = 'Test App') {
  const res = await h.api.post('/api/v1/apps', { name }).expect(201);
  const { application, credentials } = res.body.data;
  return {
    appId: application.id as number,
    envId: credentials.environmentId as number,
    appKey: credentials.appKey as string,
    masterSecret: credentials.masterSecret as string,
  };
}

export async function createTestingEnv(h: Harness, appId: number) {
  const res = await h.api.post(`/api/v1/apps/${appId}/testing-environment`).expect(201);
  const { credentials } = res.body.data;
  return {
    envId: credentials.environmentId as number,
    appKey: credentials.appKey as string,
    masterSecret: credentials.masterSecret as string,
  };
}

export const basic = (appKey: string, secret: string) =>
  `Basic ${Buffer.from(`${appKey}:${secret}`).toString('base64')}`;

interface DeviceInput {
  registrationId: string;
  platform?: 'ANDROID' | 'IOS' | 'HARMONYOS';
  vendor?: string;
  online?: boolean;
  appVersion?: string;
}

export const registerDevice = (h: Harness, envId: number, input: DeviceInput) =>
  h.api
    .post(`/api/v1/environments/${envId}/devices`, {
      platform: 'ANDROID',
      appVersion: '1.0.0',
      online: true,
      ...input,
    })
    .expect(201);

export const configureSimulator = (h: Harness, envId: number, simulatorConfig: object) =>
  h.api.patch(`/api/v1/environments/${envId}/config`, { simulatorConfig }).expect(200);

export const notification = (overrides: object = {}) => ({
  type: 'NOTIFICATION',
  title: 'Hello',
  body: 'World',
  platforms: ['ANDROID', 'IOS', 'HARMONYOS'],
  audience: { type: 'ALL' },
  strategy: 'mtpush',
  ...overrides,
});

export const send = (h: Harness, envId: number, overrides: object = {}) =>
  h.api.post(`/api/v1/environments/${envId}/messages`, notification(overrides));

export async function attemptsOf(h: Harness, envId: number, msgid: string) {
  const res = await h.api.get(`/api/v1/environments/${envId}/messages/${msgid}/attempts`).expect(200);
  return res.body.data as {
    channel: string;
    outcome: string;
    isFallback: boolean;
    isSimulated: boolean;
    failureReason: string | null;
    attemptedAt: string;
  }[];
}
