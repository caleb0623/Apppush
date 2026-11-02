import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  configureSimulator,
  createApplication,
  createTestingEnv,
  harness,
  prisma,
  registerDevice,
  send,
  type Harness,
} from '../helpers.js';

describe('product specification', () => {
  let h: Harness;
  let appId: number;
  let envId: number;
  let appKey: string;
  let url: string;

  beforeEach(async () => {
    h = await harness();
    ({ appId, envId, appKey } = await createApplication(h));
    url = `/api/v1/environments/${envId}`;
  });

  describe('testing environment', () => {
    it('starts with a copy of the production configuration', async () => {
      await h.api
        .patch(`${url}/config`, {
          callbackUrl: 'https://example.com/hook',
          callbackEnabled: true,
          ipAllowlist: ['10.0.0.1'],
          enabledChannels: ['fcm', 'mtpush'],
          simulatorConfig: { fcm: { mode: 'accept_only' } },
        })
        .expect(200);

      const testing = await createTestingEnv(h, appId);
      const { data } = (await h.api.get(`/api/v1/environments/${testing.envId}`).expect(200)).body;
      expect(data).toMatchObject({
        type: 'TESTING',
        callbackUrl: 'https://example.com/hook',
        callbackEnabled: true,
        ipAllowlist: ['10.0.0.1'],
        enabledChannels: ['fcm', 'mtpush'],
        simulatorConfig: { fcm: { mode: 'accept_only' } },
      });
      expect(data.appKey).not.toBe(appKey);
    });

    it('is configured independently after that', async () => {
      const testing = await createTestingEnv(h, appId);
      await h.api
        .patch(`/api/v1/environments/${testing.envId}/config`, { callbackUrl: 'https://example.com/test' })
        .expect(200);
      expect((await h.api.get(url).expect(200)).body.data.callbackUrl).toBeNull();
    });
  });

  describe('overview', () => {
    it('compares today with yesterday by hour, and shows yesterday\'s funnel', async () => {
      await registerDevice(h, envId, { registrationId: 'device-1' });
      await send(h, envId).expect(201);
      const message = await prisma.pushMessage.findFirstOrThrow();

      const first = (await h.api.get(`${url}/analytics/overview`).expect(200)).body.data;
      expect(first.today).toHaveLength(24);
      expect(first.yesterday).toHaveLength(24);
      expect(first.today[0].bucket).toBe('00:00');
      expect(first.today.reduce((sum: number, p: { sent: number }) => sum + p.sent, 0)).toBe(1);
      expect(first.yesterdayFunnel.sent).toBe(0);

      await prisma.pushMessage.update({
        where: { id: message.id },
        data: { dispatchedAt: new Date(Date.now() - 86_400_000) },
      });
      const second = (await h.api.get(`${url}/analytics/overview`).expect(200)).body.data;
      expect(second.yesterdayFunnel).toMatchObject({ planned: 1, sent: 1, delivered: 1 });
    });

    it('reports the latest notification permission rate, ignoring unknown devices', async () => {
      const register = (installationId: string, notificationsEnabled: boolean) =>
        request(h.app)
          .post('/api/v1/client/devices')
          .set('X-App-Key', appKey)
          .send({
            installationId,
            pushToken: `fcm-token-${installationId}-aaaaaaaaaaaa`,
            appVersion: '1.0.0',
            notificationsEnabled,
          })
          .expect(201);
      await register('install-0001', true);
      await register('install-0002', true);
      await register('install-0003', false);
      await registerDevice(h, envId, { registrationId: 'simulated-1' });

      const { data } = (await h.api.get(`${url}/analytics/overview`).expect(200)).body;
      expect(data.notificationPermission).toEqual({ enabled: 2, known: 3, rate: 0.6667 });
    });

    it('shows no rate, rather than 0%, when nothing is known', async () => {
      const { data } = (await h.api.get(`${url}/analytics/overview`).expect(200)).body;
      expect(data.notificationPermission.rate).toBeNull();
    });
  });

  describe('user statistics', () => {
    it('counts new, online and active users, with breakdowns', async () => {
      await registerDevice(h, envId, { registrationId: 'a-online', vendor: 'xiaomi', appVersion: '2.0' });
      await registerDevice(h, envId, { registrationId: 'a-offline', vendor: 'oppo', online: false, appVersion: '1.0' });
      await registerDevice(h, envId, { registrationId: 'ios-one', platform: 'IOS', appVersion: '2.0' });

      const { data } = (await h.api.get(`${url}/analytics/users`).expect(200)).body;
      expect(data.totals).toMatchObject({ total: 3, online: 2, newUsers: 3, activeUsers: 3 });
      expect(data.byPlatform.map((g: { key: string; total: number }) => [g.key, g.total])).toEqual([
        ['ANDROID', 2],
        ['IOS', 1],
      ]);
      expect(data.byAppVersion[0]).toMatchObject({ key: '2.0', total: 2 });
      expect(data.trend.at(-1)).toMatchObject({ newUsers: 3, activeUsers: 3 });

      const ios = (await h.api.get(`${url}/analytics/users?platform=IOS`).expect(200)).body.data;
      expect(ios.totals).toMatchObject({ total: 1, online: 1 });
    });

    it('excludes users outside the range, and supports months', async () => {
      await registerDevice(h, envId, { registrationId: 'old-user' });
      await prisma.device.updateMany({
        data: { createdAt: new Date('2020-01-15T00:00:00Z'), lastActiveAt: new Date('2020-01-15T00:00:00Z') },
      });
      const { data } = (await h.api.get(`${url}/analytics/users`).expect(200)).body;
      expect(data.totals).toMatchObject({ total: 1, newUsers: 0, activeUsers: 0 });

      const months = (
        await h.api.get(`${url}/analytics/users?from=2020-01-01&to=2020-02-29&granularity=month`).expect(200)
      ).body.data;
      expect(months.trend).toEqual([
        { bucket: '2020-01', newUsers: 1, activeUsers: 1 },
        { bucket: '2020-02', newUsers: 0, activeUsers: 0 },
      ]);
    });
  });

  describe('loss analysis', () => {
    beforeEach(async () => {
      await registerDevice(h, envId, { registrationId: 'fails-fcm' });
      await registerDevice(h, envId, { registrationId: 'succeeds' });
      await registerDevice(h, envId, { registrationId: 'iphone-1', platform: 'IOS' });
      await configureSimulator(h, envId, {
        fcm: { mode: 'success', failRegistrationIds: ['fails-fcm'], failureReason: 'FCM_DOWN' },
        mtpush: { mode: 'success', failRegistrationIds: ['fails-fcm'], failureReason: 'MT_DOWN' },
      });
    });

    it('keeps failed sends in the channel that failed them', async () => {
      await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201);
      const { data } = (await h.api.get(`${url}/analytics`).expect(200)).body;
      const mtpush = data.byChannel.find((g: { key: string }) => g.key === 'mtpush');
      expect(mtpush).toMatchObject({ planned: 1, sent: 0 });
      expect(mtpush.loss.notSent).toBe(1);
    });

    it('filters a msgid by platform and channel, with two-level reasons', async () => {
      const { msgid } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body.data;
      const base = `${url}/analytics/messages/${msgid}`;

      const android = (await h.api.get(`${base}?platform=ANDROID`).expect(200)).body.data;
      expect(android.totals.planned).toBe(2);
      expect(android.failureReasons).toEqual([{ reason: 'MT_DOWN', stage: 'SEND_FAILED', count: 1 }]);

      const apns = (await h.api.get(`${base}?channel=apns`).expect(200)).body.data;
      expect(apns.totals.planned).toBe(1);
      expect(apns.failureReasons).toEqual([]);
    });

    it('filters the trend by platform and channel', async () => {
      await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201);
      const ios = (await h.api.get(`${url}/analytics?platform=IOS`).expect(200)).body.data;
      expect(ios.totals.planned).toBe(1);
      const fcm = (await h.api.get(`${url}/analytics?channel=fcm`).expect(200)).body.data;
      expect(fcm.totals.planned).toBe(1);
      expect(fcm.channelAttempts.map((a: { channel: string }) => a.channel)).toEqual(['fcm']);
    });
  });
});
