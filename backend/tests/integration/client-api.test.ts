import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidingWindowRateLimiter } from '../../src/lib/rate-limiter.js';
import {
  createApplication,
  createTestingEnv,
  harness,
  prisma,
  send,
  type Harness,
} from '../helpers.js';

const TOKEN = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const registerBody = (overrides = {}) => ({
  installationId: 'install-0001',
  pushToken: TOKEN,
  vendor: 'Google',
  model: 'Pixel 8',
  osVersion: '14',
  appVersion: '1.0.0',
  ...overrides,
});

describe('client API', () => {
  let h: Harness;
  let appKey: string;
  let envId: number;
  const url = '/api/v1/client';

  const register = (body = registerBody(), key = appKey) =>
    request(h.app).post(`${url}/devices`).set('X-App-Key', key).send(body);

  const asDevice = (device: { registrationId: string; deviceSecret: string }) => ({
    'X-Registration-Id': device.registrationId,
    'X-Device-Secret': device.deviceSecret,
  });

  async function registered(overrides = {}) {
    return (await register(registerBody(overrides)).expect(201)).body.data as {
      registrationId: string;
      deviceSecret: string;
    };
  }

  beforeEach(async () => {
    const sender = { projectId: 'demo', send: vi.fn().mockResolvedValue('projects/demo/messages/1') };
    h = await harness({ fcm: sender });
    ({ appKey, envId } = await createApplication(h));
  });

  describe('registration', () => {
    it('registers a real device and shows the secret once', async () => {
      const res = await register().expect(201);
      expect(res.body.data).toMatchObject({ status: 'ACTIVE', pushTokenStatus: 'ACTIVE' });
      expect(res.body.data.registrationId).toMatch(/^rid_/);
      expect(res.body.data.deviceSecret.length).toBeGreaterThan(30);

      const device = await prisma.device.findFirstOrThrow();
      expect(device).toMatchObject({
        environmentId: envId,
        vendor: 'google',
        model: 'Pixel 8',
        platform: 'ANDROID',
        pushToken: TOKEN,
        pushTokenStatus: 'ACTIVE',
      });
      expect(device.deviceSecretHash).not.toContain(res.body.data.deviceSecret);
    });

    it('rejects a missing or unknown AppKey', async () => {
      await request(h.app).post(`${url}/devices`).send(registerBody()).expect(401);
      const res = await register(registerBody(), 'unknown').expect(401);
      expect(res.body.error.code).toBe('INVALID_APP_KEY');
    });

    it('rejects a deactivated application', async () => {
      const app = await prisma.application.findFirstOrThrow();
      await h.api.post(`/api/v1/apps/${app.id}/deactivate`).expect(200);
      await register().expect(403);
    });

    it('validates the body', async () => {
      await register(registerBody({ pushToken: 'short' })).expect(400);
      await register(registerBody({ installationId: 'bad id!' })).expect(400);
      await register(registerBody({ platform: 'IOS' })).expect(400);
    });

    it('updates the same device when it registers again with its secret', async () => {
      const device = await registered();
      const res = await request(h.app)
        .post(`${url}/devices`)
        .set('X-App-Key', appKey)
        .set('X-Device-Secret', device.deviceSecret)
        .send(registerBody({ pushToken: `${TOKEN}-new`, appVersion: '1.1.0' }))
        .expect(200);
      expect(res.body.data).toMatchObject({
        registrationId: device.registrationId,
        deviceSecret: null,
      });
      expect(await prisma.device.count()).toBe(1);
      expect(await prisma.device.findFirstOrThrow()).toMatchObject({
        pushToken: `${TOKEN}-new`,
        appVersion: '1.1.0',
      });
    });

    it('stops another caller taking over an installation', async () => {
      await registered();
      const res = await register(registerBody({ pushToken: `${TOKEN}-evil` })).expect(401);
      expect(res.body.error.code).toBe('DEVICE_SECRET_REQUIRED');
      expect((await prisma.device.findFirstOrThrow()).pushToken).toBe(TOKEN);
    });

    it('moves a token to the newest installation that presents it', async () => {
      const first = await registered();
      const second = await registered({ installationId: 'install-0002' });
      const old = await prisma.device.findUniqueOrThrow({ where: { registrationId: first.registrationId } });
      const current = await prisma.device.findUniqueOrThrow({ where: { registrationId: second.registrationId } });
      expect(old.pushToken).toBeNull();
      expect(current.pushToken).toBe(TOKEN);
    });

    it('enforces the testing device limit', async () => {
      const app = await prisma.application.findFirstOrThrow();
      const testing = await createTestingEnv(h, app.id);
      await prisma.device.createMany({
        data: Array.from({ length: 1000 }, (_, i) => ({
          environmentId: testing.envId,
          registrationId: `sim-${i}`,
          platform: 'ANDROID' as const,
          appVersion: '1',
        })),
      });
      const res = await register(registerBody(), testing.appKey).expect(409);
      expect(res.body.error.code).toBe('TESTING_DEVICE_LIMIT');
    });

    it('applies the 10 QPS limit of testing environments', async () => {
      h = await harness({
        fcm: null,
        testingLimiter: new SlidingWindowRateLimiter(1, 60_000),
      });
      const created = await createApplication(h);
      const testing = await createTestingEnv(h, created.appId);
      const ping = () => request(h.app).get(`${url}/ping`).set('X-App-Key', testing.appKey);
      await ping().expect(200);
      await ping().expect(429);
    });

    it('limits one address, whatever AppKey it uses', async () => {
      h = await harness({ fcm: null, clientLimiter: new SlidingWindowRateLimiter(1, 60_000) });
      await request(h.app).get(`${url}/ping`).set('X-App-Key', 'a').expect(401);
      await request(h.app).get(`${url}/ping`).set('X-App-Key', 'b').expect(429);
    });
  });

  describe('sensitive fields', () => {
    it('never returns the token, secret hash or installation ID through the admin API', async () => {
      const device = await registered();
      const list = await h.api.get(`/api/v1/environments/${envId}/devices`).expect(200);
      const one = await h.api
        .get(`/api/v1/environments/${envId}/devices/${device.registrationId}`)
        .expect(200);
      for (const body of [list.body, one.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain('deviceSecretHash');
        expect(text).not.toContain('install-0001');
      }
      expect(one.body.data).toMatchObject({ deliveryMode: 'REAL', pushTokenStatus: 'ACTIVE' });
    });

    it('labels devices created by the admin API as simulated', async () => {
      await h.api
        .post(`/api/v1/environments/${envId}/devices`, { platform: 'ANDROID', appVersion: '1' })
        .expect(201);
      const list = await h.api.get(`/api/v1/environments/${envId}/devices`).expect(200);
      expect(list.body.data[0].deliveryMode).toBe('SIMULATED');
    });
  });

  describe('ping', () => {
    it('confirms connectivity and reports the setup', async () => {
      const res = await request(h.app).get(`${url}/ping`).set('X-App-Key', appKey).expect(200);
      expect(res.body.data).toMatchObject({
        ok: true,
        environment: 'PRODUCTION',
        fcmConfigured: true,
        device: null,
      });
    });

    it('reports the device and records activity', async () => {
      const device = await registered();
      await prisma.device.updateMany({ data: { lastActiveAt: null } });
      const res = await request(h.app)
        .get(`${url}/ping`)
        .set('X-App-Key', appKey)
        .set(asDevice(device))
        .expect(200);
      expect(res.body.data.device).toMatchObject({ registrationId: device.registrationId });
      expect((await prisma.device.findFirstOrThrow()).lastActiveAt).not.toBeNull();
    });

    it('tells the app a deleted device must register again', async () => {
      const device = await registered();
      await h.api.delete(`/api/v1/environments/${envId}/devices/${device.registrationId}`).expect(204);
      const res = await request(h.app)
        .get(`${url}/ping`)
        .set('X-App-Key', appKey)
        .set(asDevice(device))
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_DEVICE_CREDENTIALS');
    });

    it('rejects a device presented with another environment\'s AppKey', async () => {
      const device = await registered();
      const other = await createApplication(h, 'Other');
      await request(h.app)
        .get(`${url}/ping`)
        .set('X-App-Key', other.appKey)
        .set(asDevice(device))
        .expect(401);
    });
  });

  describe('token refresh', () => {
    it('replaces the token and revives an invalid one', async () => {
      const device = await registered();
      await prisma.device.updateMany({ data: { pushTokenStatus: 'INVALID' } });
      const res = await request(h.app)
        .put(`${url}/devices/me/token`)
        .set(asDevice(device))
        .send({ pushToken: `${TOKEN}-refreshed` })
        .expect(200);
      expect(res.body.data.pushTokenStatus).toBe('ACTIVE');
      expect((await prisma.device.findFirstOrThrow()).pushToken).toBe(`${TOKEN}-refreshed`);
    });

    it('requires the device secret', async () => {
      const device = await registered();
      await request(h.app)
        .put(`${url}/devices/me/token`)
        .set({ ...asDevice(device), 'X-Device-Secret': 'wrong' })
        .send({ pushToken: `${TOKEN}-evil` })
        .expect(401);
    });
  });

  describe('events', () => {
    let device: { registrationId: string; deviceSecret: string };
    let msgid: string;

    const report = (body: object, as = device) =>
      request(h.app).post(`${url}/events`).set(asDevice(as)).send(body);

    const stages = async () => {
      const events = await prisma.messageEvent.findMany({
        where: { target: { registrationId: device.registrationId } },
        orderBy: { id: 'asc' },
      });
      return Object.fromEntries(events.map((e) => [e.type, [e.source, e.inferred]]));
    };

    beforeEach(async () => {
      device = await registered();
      const res = await send(h, envId, {
        strategy: 'fcm_mtpush',
        platforms: ['ANDROID'],
        audience: { type: 'REGISTRATION_IDS', values: [device.registrationId] },
      }).expect(201);
      msgid = res.body.data.msgid;
    });

    it('moves a message through the funnel with device evidence', async () => {
      await report({ msgid, type: 'DELIVERED' }).expect(200);
      await report({ msgid, type: 'DISPLAYED' }).expect(200);
      await report({ msgid, type: 'CLICKED' }).expect(200);
      expect(await stages()).toEqual({
        SENT: ['PROVIDER', false],
        DELIVERED: ['DEVICE_CLIENT', false],
        DISPLAYED: ['DEVICE_CLIENT', false],
        CLICKED: ['DEVICE_CLIENT', false],
      });
      const { body } = await h.api.get(`/api/v1/environments/${envId}/messages/${msgid}`);
      expect(body.data.funnel).toMatchObject({ sent: 1, delivered: 1, displayed: 1, clicked: 1 });
      expect((await prisma.messageTarget.findFirstOrThrow()).status).toBe('DELIVERED');
    });

    it('counts a repeated report once', async () => {
      const first = await report({ msgid, type: 'DELIVERED' }).expect(200);
      const second = await report({ msgid, type: 'DELIVERED' }).expect(200);
      expect(first.body.data).toMatchObject({ recorded: true, duplicate: false });
      expect(second.body.data).toMatchObject({ recorded: false, duplicate: true });
      await Promise.all(Array.from({ length: 5 }, () => report({ msgid, type: 'CLICKED' })));
      expect(await prisma.messageEvent.count({ where: { type: 'CLICKED' } })).toBe(1);
    });

    it('marks stages it had to infer from a later report', async () => {
      await report({ msgid, type: 'CLICKED' }).expect(200);
      expect(await stages()).toEqual({
        SENT: ['PROVIDER', false],
        DELIVERED: ['DEVICE_CLIENT', true],
        DISPLAYED: ['DEVICE_CLIENT', true],
        CLICKED: ['DEVICE_CLIENT', false],
      });
    });

    it('accepts reports that arrive at the same moment', async () => {
      // A phone sends delivered and displayed milliseconds apart, which once deadlocked MySQL.
      const msgids = [msgid];
      for (let i = 0; i < 7; i += 1) {
        const res = await send(h, envId, {
          strategy: 'fcm_mtpush',
          platforms: ['ANDROID'],
          audience: { type: 'REGISTRATION_IDS', values: [device.registrationId] },
        }).expect(201);
        msgids.push(res.body.data.msgid);
      }
      const responses = await Promise.all(
        msgids.flatMap((id) => [
          report({ msgid: id, type: 'DELIVERED' }),
          report({ msgid: id, type: 'DISPLAYED' }),
          report({ msgid: id, type: 'CLICKED' }),
        ]),
      );
      expect(responses.map((r) => r.status)).toEqual(responses.map(() => 200));
      expect(await prisma.messageEvent.count({ where: { type: 'CLICKED' } })).toBe(8);
      expect(await prisma.messageEvent.count({ where: { type: 'DELIVERED' } })).toBe(8);
    });

    it('replaces an inference when the direct report arrives late', async () => {
      await report({ msgid, type: 'DISPLAYED' }).expect(200);
      expect((await stages()).DELIVERED).toEqual(['DEVICE_CLIENT', true]);
      await report({ msgid, type: 'DELIVERED' }).expect(200);
      expect(await stages()).toEqual({
        SENT: ['PROVIDER', false],
        DELIVERED: ['DEVICE_CLIENT', false],
        DISPLAYED: ['DEVICE_CLIENT', false],
      });
    });

    it('accepts a report for a send the provider appeared to fail', async () => {
      await prisma.messageEvent.deleteMany();
      await prisma.messageTarget.updateMany({
        data: { status: 'FAILED', failureReason: 'FCM_TIMEOUT' },
      });
      await report({ msgid, type: 'DELIVERED' }).expect(200);
      expect(await prisma.messageTarget.findFirstOrThrow()).toMatchObject({
        status: 'DELIVERED',
        failureReason: null,
      });
      expect((await stages()).SENT).toEqual(['DEVICE_CLIENT', true]);
    });

    it('records why a message reached the phone but could not be shown', async () => {
      await report({ msgid, type: 'DISPLAY_FAILED', reason: 'NOTIFICATIONS_DISABLED' }).expect(200);
      expect(await stages()).toEqual({
        SENT: ['PROVIDER', false],
        DELIVERED: ['DEVICE_CLIENT', false],
      });
      const { body } = await h.api.get(`/api/v1/environments/${envId}/analytics`);
      expect(body.data.failureReasons).toEqual([
        { reason: 'NOTIFICATIONS_DISABLED', stage: 'DISPLAY_FAILED', count: 1 },
      ]);
    });

    it('rejects a report for a message this device never received', async () => {
      const other = await registered({ installationId: 'install-0002', pushToken: `${TOKEN}-2` });
      await report({ msgid, type: 'CLICKED' }, other).expect(404);
      await report({ msgid: 'unknown', type: 'CLICKED' }).expect(404);
    });

    it('rejects unknown event types and bad credentials', async () => {
      await report({ msgid, type: 'SENT' }).expect(400);
      await request(h.app).post(`${url}/events`).send({ msgid, type: 'CLICKED' }).expect(401);
    });

    it('keeps the phone\'s timestamp when it is plausible, and distrusts a broken clock', async () => {
      const at = new Date(h.deps.clock().getTime() + 1000);
      await report({ msgid, type: 'DELIVERED', occurredAt: at.toISOString() }).expect(200);
      await report({ msgid, type: 'DISPLAYED', occurredAt: '2001-01-01T00:00:00Z' }).expect(200);
      const events = await prisma.messageEvent.findMany();
      const time = (type: string) => events.find((e) => e.type === type)!.occurredAt.getTime();
      expect(time('DELIVERED')).toBe(at.getTime());
      expect(time('DISPLAYED')).toBeGreaterThan(Date.parse('2020-01-01'));
    });
  });
});
