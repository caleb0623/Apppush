import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenMessage } from 'firebase-admin/messaging';
import type { FcmSender } from '../../src/modules/delivery/fcm.js';
import { processDueJobs } from '../../src/modules/scheduler/service.js';
import {
  attemptsOf,
  createApplication,
  harness,
  prisma,
  registerDevice,
  send,
  type Harness,
} from '../helpers.js';

const TOKEN = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const FCM_NAME = 'projects/demo/messages/0:1760000000';

const fcmError = (code: string, message = 'FCM said no') => Object.assign(new Error(message), { code });

/** Mock provider: this suite proves everything around Firebase, not Firebase itself. */
function mockSender() {
  const send = vi.fn<(message: TokenMessage, dryRun?: boolean) => Promise<string>>();
  send.mockResolvedValue(FCM_NAME);
  const sender: FcmSender = { projectId: 'demo', send };
  return { sender, send };
}

describe('delivery to a real device', () => {
  let h: Harness;
  let fcm: ReturnType<typeof mockSender>;
  let envId: number;
  let appKey: string;
  let device: { registrationId: string; deviceSecret: string };
  let deviceUrl: string;

  const pushToDevice = (overrides = {}) =>
    send(h, envId, {
      platforms: ['ANDROID'],
      audience: { type: 'REGISTRATION_IDS', values: [device.registrationId] },
      ...overrides,
    }).expect(201);

  async function setup(sender: FcmSender | null) {
    h = await harness({ fcm: sender });
    ({ envId, appKey } = await createApplication(h));
    const res = await request(h.app)
      .post('/api/v1/client/devices')
      .set('X-App-Key', appKey)
      .send({ installationId: 'install-0001', pushToken: TOKEN, appVersion: '1.0.0', vendor: 'xiaomi' })
      .expect(201);
    device = res.body.data;
    deviceUrl = `/api/v1/environments/${envId}/devices/${device.registrationId}`;
  }

  const target = () => prisma.messageTarget.findFirstOrThrow({ where: { registrationId: device.registrationId } });

  beforeEach(async () => {
    fcm = mockSender();
    await setup(fcm.sender);
  });

  it('calls FCM, keeps its answer, and stops at "sent" until the phone reports', async () => {
    const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;

    expect(fcm.send).toHaveBeenCalledOnce();
    expect(fcm.send.mock.calls[0]?.[0]).toMatchObject({
      token: TOKEN,
      data: { msgid: data.msgid, title: 'Hello', body: 'World', type: 'NOTIFICATION' },
    });
    expect(data).toMatchObject({
      status: 'COMPLETED',
      isSimulated: false,
      simulationNotice: null,
      delivery: { real: 1, simulated: 0 },
    });
    expect(data.funnel).toMatchObject({ planned: 1, valid: 1, sent: 1, delivered: 0, displayed: 0, clicked: 0 });

    const stored = await prisma.deliveryAttempt.findFirstOrThrow();
    expect(stored).toMatchObject({
      channel: 'fcm',
      provider: 'Google FCM',
      outcome: 'ACCEPTED',
      isSimulated: false,
      providerMessageId: FCM_NAME,
      providerResponse: { name: FCM_NAME, projectId: 'demo' },
    });
    expect(await target()).toMatchObject({ status: 'SENT', deliveryMode: 'REAL', finalChannel: 'fcm' });

    const event = await prisma.messageEvent.findFirstOrThrow();
    expect(event).toMatchObject({ type: 'SENT', source: 'PROVIDER' });
  });

  it('does not let a simulated device reach the provider', async () => {
    await registerDevice(h, envId, { registrationId: 'simulated-1' });
    const { data } = (await send(h, envId, { platforms: ['ANDROID'], strategy: 'fcm_mtpush' }).expect(201)).body;
    expect(fcm.send).toHaveBeenCalledOnce();
    expect(fcm.send.mock.calls[0]?.[0]).toMatchObject({ token: TOKEN });
    expect(data.delivery).toEqual({ real: 1, simulated: 1 });
    expect(data.simulationNotice).toMatch(/Some targets are simulated/);
    expect(await prisma.messageTarget.findFirstOrThrow({ where: { registrationId: 'simulated-1' } }))
      .toMatchObject({ deliveryMode: 'SIMULATED', status: 'DELIVERED' });
  });

  describe('strategies', () => {
    it.each([
      ['fcm_mtpush', [['fcm', 'ACCEPTED']], 'COMPLETED'],
      ['mtpush_fcm', [['mtpush', 'SKIPPED'], ['fcm', 'ACCEPTED']], 'COMPLETED'],
      ['mtpush', [['mtpush', 'SKIPPED']], 'FAILED'],
      ['pns_mtpush', [['xiaomi', 'SKIPPED'], ['mtpush', 'SKIPPED']], 'FAILED'],
      ['mtpush_pns', [['mtpush', 'SKIPPED'], ['xiaomi', 'SKIPPED']], 'FAILED'],
    ] as const)('%s never claims a delivery a simulator cannot make', async (strategy, expected, status) => {
      const { data } = (await pushToDevice({ strategy })).body;
      const attempts = await attemptsOf(h, envId, data.msgid);
      expect(attempts.map((a) => [a.channel, a.outcome])).toEqual(expected);
      expect(data.status).toBe(status);
      expect(data.funnel.delivered).toBe(0);
      if (status === 'FAILED') {
        expect(fcm.send).not.toHaveBeenCalled();
        expect((await target()).failureReason).toBe('SIMULATOR_CANNOT_REACH_REAL_DEVICE');
      }
    });

    it('treats a real phone as offline to EngageLab, so mtpush_fcm reaches it through FCM', async () => {
      const { data } = (await pushToDevice({ strategy: 'mtpush_fcm' })).body;
      expect((await attemptsOf(h, envId, data.msgid))[0]).toMatchObject({
        channel: 'mtpush',
        failureReason: 'MTPUSH_OFFLINE',
      });
    });

    it('honours a channel override instead of the strategy chain', async () => {
      const { data } = (await pushToDevice({ strategy: 'mtpush', channel: 'fcm' })).body;
      expect(data.channelOverride).toBe('fcm');
      expect((await attemptsOf(h, envId, data.msgid)).map((a) => [a.channel, a.outcome, a.isFallback])).toEqual([
        ['fcm', 'ACCEPTED', false],
      ]);
    });

    it('rejects an override that cannot apply to the device', async () => {
      const { data } = (await pushToDevice({ channel: 'apns' })).body;
      expect((await attemptsOf(h, envId, data.msgid)).map((a) => [a.channel, a.failureReason])).toEqual([
        ['apns', 'CHANNEL_NOT_APPLICABLE'],
      ]);
      expect(fcm.send).not.toHaveBeenCalled();
    });

    it('respects a channel disabled for the environment', async () => {
      await h.api.patch(`/api/v1/environments/${envId}/config`, { enabledChannels: ['mtpush'] }).expect(200);
      const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;
      expect(data.status).toBe('FAILED');
      expect(fcm.send).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('marks a dead token, and later messages skip the device', async () => {
      fcm.send.mockRejectedValue(fcmError('messaging/registration-token-not-registered'));
      const first = (await pushToDevice({ strategy: 'fcm_mtpush' })).body.data;
      expect(first).toMatchObject({ status: 'FAILED', failureReason: 'ALL_TARGETS_FAILED' });
      const attempts = await attemptsOf(h, envId, first.msgid);
      expect(attempts[0]).toMatchObject({ channel: 'fcm', outcome: 'FAILED', failureReason: 'TOKEN_UNREGISTERED' });
      expect(await prisma.device.findFirstOrThrow()).toMatchObject({ pushTokenStatus: 'INVALID' });

      fcm.send.mockClear();
      const second = (await pushToDevice({ strategy: 'fcm_mtpush' })).body.data;
      expect(fcm.send).not.toHaveBeenCalled();
      expect(second.funnel).toMatchObject({ planned: 1, valid: 0 });
      const row = await prisma.messageTarget.findFirstOrThrow({ where: { message: { msgid: second.msgid } } });
      expect(row).toMatchObject({ isValid: false, invalidReason: 'PUSH_TOKEN_INVALID', status: 'INVALID' });
    });

    it('recovers a device once the app refreshes its token', async () => {
      fcm.send.mockRejectedValueOnce(fcmError('messaging/registration-token-not-registered'));
      await pushToDevice({ strategy: 'fcm_mtpush' });
      await request(h.app)
        .put('/api/v1/client/devices/me/token')
        .set({ 'X-Registration-Id': device.registrationId, 'X-Device-Secret': device.deviceSecret })
        .send({ pushToken: `${TOKEN}-new` })
        .expect(200);
      const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;
      expect(data.funnel).toMatchObject({ valid: 1, sent: 1 });
      expect(fcm.send.mock.lastCall?.[0]).toMatchObject({ token: `${TOKEN}-new` });
    });

    it('does not undo a token refreshed while the failing send was in flight', async () => {
      fcm.send.mockImplementationOnce(async () => {
        await prisma.device.updateMany({ data: { pushToken: `${TOKEN}-new`, pushTokenStatus: 'ACTIVE' } });
        throw fcmError('messaging/registration-token-not-registered');
      });
      await pushToDevice({ strategy: 'fcm_mtpush' });
      expect((await prisma.device.findFirstOrThrow()).pushTokenStatus).toBe('ACTIVE');
    });

    it.each([
      ['app/network-error', 'NETWORK_ERROR'],
      ['messaging/server-unavailable', 'PROVIDER_UNAVAILABLE'],
      ['messaging/message-rate-exceeded', 'PROVIDER_THROTTLED'],
      ['messaging/mismatched-credential', 'SENDER_ID_MISMATCH'],
    ])('records %s without blaming the token', async (code, reason) => {
      fcm.send.mockRejectedValue(fcmError(code, 'Socket closed'));
      const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;
      const [attempt] = await prisma.deliveryAttempt.findMany({ orderBy: { attemptNo: 'asc' } });
      expect(attempt).toMatchObject({
        failureReason: reason,
        isSimulated: false,
        providerResponse: { code, message: 'Socket closed' },
      });
      expect(data.funnel).toMatchObject({ sent: 0, delivered: 0 });
      expect((await prisma.device.findFirstOrThrow()).pushTokenStatus).toBe('ACTIVE');
    });

    it('fails honestly when Firebase is not configured, rather than simulating', async () => {
      await setup(null);
      const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;
      expect(data).toMatchObject({ status: 'FAILED', failureReason: 'ALL_TARGETS_FAILED' });
      expect(await attemptsOf(h, envId, data.msgid)).toMatchObject([
        { channel: 'fcm', outcome: 'FAILED', failureReason: 'FCM_NOT_CONFIGURED', isSimulated: false },
        { channel: 'mtpush', outcome: 'SKIPPED', failureReason: 'SIMULATOR_CANNOT_REACH_REAL_DEVICE' },
      ]);
    });

    it('records no funnel events for a failed send', async () => {
      fcm.send.mockRejectedValue(fcmError('messaging/internal-error'));
      await pushToDevice({ strategy: 'fcm_mtpush' });
      expect(await prisma.messageEvent.count()).toBe(0);
    });
  });

  describe('duplicate protection', () => {
    it('sends once for a repeated idempotency key', async () => {
      await pushToDevice({ strategy: 'fcm_mtpush', idempotencyKey: 'k1' });
      await send(h, envId, {
        platforms: ['ANDROID'],
        strategy: 'fcm_mtpush',
        audience: { type: 'REGISTRATION_IDS', values: [device.registrationId] },
        idempotencyKey: 'k1',
      }).expect(200);
      expect(fcm.send).toHaveBeenCalledOnce();
    });

    it('does not call FCM again when a finished job is reprocessed', async () => {
      await pushToDevice({ strategy: 'fcm_mtpush' });
      await prisma.scheduledJob.updateMany({ data: { status: 'PENDING', runAt: new Date(0) } });
      await processDueJobs(h.deps, 'worker-test');
      expect(fcm.send).toHaveBeenCalledOnce();
    });

    it('reaches a device once when two tags select it', async () => {
      const base = `/api/v1/environments/${envId}/devices/${device.registrationId}/tags`;
      await h.api.put(base, { add: ['a', 'b'], remove: [] }).expect(200);
      await send(h, envId, {
        platforms: ['ANDROID'],
        strategy: 'fcm_mtpush',
        audience: { type: 'TAGS', values: ['a', 'b'] },
      }).expect(201);
      expect(fcm.send).toHaveBeenCalledOnce();
    });

    it('survives the phone reporting before the provider call returns', async () => {
      fcm.send.mockImplementationOnce(async (message) => {
        const msgid = message.data!.msgid!;
        await request(h.app)
          .post('/api/v1/client/events')
          .set({ 'X-Registration-Id': device.registrationId, 'X-Device-Secret': device.deviceSecret })
          .send({ msgid, type: 'DELIVERED' })
          .expect(200);
        return FCM_NAME;
      });
      const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;
      expect(data.funnel).toMatchObject({ sent: 1, delivered: 1 });
      expect(await target()).toMatchObject({ status: 'DELIVERED', finalChannel: 'fcm' });
      expect(await prisma.messageEvent.findFirstOrThrow({ where: { type: 'SENT' } })).toMatchObject({
        source: 'PROVIDER',
        inferred: false,
      });
    });
  });

  describe('honest reporting', () => {
    it('refuses to fabricate events for a real device', async () => {
      const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;
      const url = `/api/v1/environments/${envId}/messages/${data.msgid}/events`;
      await h.api.post(url, { type: 'DELIVERED', registrationIds: [device.registrationId] }).expect(409);
      const bulk = await h.api.post(url, { type: 'DELIVERED' }).expect(200);
      expect(bulk.body.data.recorded).toBe(0);
      expect(await prisma.messageEvent.count({ where: { type: 'DELIVERED' } })).toBe(0);
    });

    it('separates real and simulated figures in analytics', async () => {
      await registerDevice(h, envId, { registrationId: 'simulated-1' });
      await send(h, envId, { platforms: ['ANDROID'], strategy: 'fcm_mtpush' }).expect(201);
      const url = `/api/v1/environments/${envId}/analytics`;

      const all = (await h.api.get(url).expect(200)).body;
      expect(all.data.simulated).toBe(true);
      expect(all.meta.notice).toMatch(/simulated targets/);
      expect(all.data.byDeliveryMode.map((g: { key: string; delivered: number }) => [g.key, g.delivered]).sort()).toEqual([
        ['REAL', 0],
        ['SIMULATED', 1],
      ]);

      const real = (await h.api.get(`${url}?deliveryMode=REAL`).expect(200)).body;
      expect(real.data.simulated).toBe(false);
      expect(real.meta.notice).toBeUndefined();
      expect(real.data.totals).toMatchObject({ planned: 1, sent: 1, delivered: 0, messagesSent: 1 });
      expect(real.data.channelAttempts).toEqual([{ channel: 'fcm', accepted: 1, failed: 0, skipped: 0 }]);
    });

    it('reports real provider configuration in the health endpoint', async () => {
      const { body } = await request(h.app).get('/api/health').expect(200);
      expect(body).toMatchObject({
        deliveryMode: 'real',
        fcm: { configured: true, projectId: 'demo', payloadMode: 'data', problem: null },
      });
    });
  });

  describe('scheduled sends', () => {
    it('dispatches a due message through the worker path with the current token', async () => {
      const { data } = (await pushToDevice({
        strategy: 'fcm_mtpush',
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      })).body;
      expect(fcm.send).not.toHaveBeenCalled();

      await request(h.app)
        .put('/api/v1/client/devices/me/token')
        .set({ 'X-Registration-Id': device.registrationId, 'X-Device-Secret': device.deviceSecret })
        .send({ pushToken: `${TOKEN}-later` })
        .expect(200);
      await prisma.scheduledJob.updateMany({ data: { runAt: new Date(0) } });
      await processDueJobs(h.deps, 'worker-test');

      expect(fcm.send.mock.calls[0]?.[0]).toMatchObject({ token: `${TOKEN}-later` });
      expect(await prisma.pushMessage.findUniqueOrThrow({ where: { msgid: data.msgid } })).toMatchObject({
        status: 'COMPLETED',
        isSimulated: false,
      });
    });
  });

  it('keeps history after the device is deleted', async () => {
    const { data } = (await pushToDevice({ strategy: 'fcm_mtpush' })).body;
    await h.api.delete(deviceUrl).expect(204);
    const { body } = await h.api.get(`/api/v1/environments/${envId}/messages/${data.msgid}`).expect(200);
    expect(body.data.funnel.sent).toBe(1);
  });
});
