import { beforeEach, describe, expect, it } from 'vitest';
import {
  configureSimulator,
  createApplication,
  harness,
  prisma,
  registerDevice,
  send,
  type Harness,
} from '../helpers.js';

describe('analytics', () => {
  let h: Harness;
  let envId: number;
  let url: string;
  let appId: number;
  let time: { now: Date };

  const recordEvent = (msgid: string, body: object) =>
    h.api.post(`${url}/messages/${msgid}/events`, body);

  beforeEach(async () => {
    time = { now: new Date('2026-06-15T12:00:00Z') };
    h = await harness({ clock: () => time.now });
    ({ envId, appId } = await createApplication(h));
    url = `/api/v1/environments/${envId}`;
  });

  /**
   * Fixture, calculated by hand:
   * 6 planned: a-1 to a-4 (Android), ios-1 (iOS), ghost (unknown), so 5 valid.
   * FCM fails for a-1, which falls back to mtpush. a-2 is offline: sent, not delivered.
   * Both channels fail for a-4. So 4 sent and 3 delivered (a-1, a-3, ios-1).
   * 2 displayed and 1 clicked.
   */
  async function fixture() {
    await registerDevice(h, envId, { registrationId: 'a-1aaa', appVersion: '1.0.0' });
    await registerDevice(h, envId, { registrationId: 'a-2aaa', online: false, appVersion: '1.0.0' });
    await registerDevice(h, envId, { registrationId: 'a-3aaa', appVersion: '2.0.0' });
    await registerDevice(h, envId, { registrationId: 'a-4aaa', appVersion: '2.0.0' });
    await registerDevice(h, envId, { registrationId: 'ios-1a', platform: 'IOS', appVersion: '2.0.0' });
    await configureSimulator(h, envId, {
      fcm: { mode: 'success', failRegistrationIds: ['a-1aaa', 'a-4aaa'], failureReason: 'FCM_DOWN' },
      mtpush: { mode: 'success', failRegistrationIds: ['a-4aaa'], failureReason: 'MT_DOWN' },
    });
    const { data } = (
      await send(h, envId, {
        strategy: 'fcm_mtpush',
        audience: {
          type: 'REGISTRATION_IDS',
          values: ['a-1aaa', 'a-2aaa', 'a-3aaa', 'a-4aaa', 'ios-1a', 'ghost-device'],
        },
      }).expect(201)
    ).body;
    await recordEvent(data.msgid, { type: 'DISPLAYED', registrationIds: ['a-1aaa', 'a-3aaa'] }).expect(200);
    await recordEvent(data.msgid, { type: 'CLICKED', registrationIds: ['a-1aaa'] }).expect(200);
    return data.msgid as string;
  }

  it('matches the hand-calculated totals, rates and loss', async () => {
    await fixture();
    const { data, meta } = (await h.api.get(`${url}/analytics`).expect(200)).body;
    expect(data.totals).toMatchObject({
      planned: 6,
      valid: 5,
      sent: 4,
      delivered: 3,
      displayed: 2,
      clicked: 1,
      deliveryRate: 0.75,
      displayRate: 0.6667,
      clickThroughRate: 0.5,
      messagesSent: 1,
      messagesDispatched: 1,
      loss: { invalid: 1, notSent: 1, notDelivered: 1, notClicked: 2, notDisplayed: 1 },
    });
    expect(data.simulated).toBe(true);
    expect(meta.notice).toMatch(/simulators/);
  });

  it('counts a fallback delivery once, attributed to the winning channel', async () => {
    await fixture();
    const { data } = (await h.api.get(`${url}/analytics`).expect(200)).body;
    const fcm = data.byChannel.find((c: { key: string }) => c.key === 'fcm');
    const mtpush = data.byChannel.find((c: { key: string }) => c.key === 'mtpush');
    expect(mtpush).toMatchObject({ sent: 1, delivered: 1 });
    expect(fcm).toMatchObject({ sent: 2, delivered: 1 });
    expect(data.channelAttempts.find((c: { channel: string }) => c.channel === 'fcm')).toEqual({
      channel: 'fcm',
      accepted: 2,
      failed: 2,
      skipped: 0,
    });
    // a-1: 2, a-2: 1, a-3: 1, a-4: 2, ios-1: 1. More attempts than the 5 valid targets.
    expect(await prisma.deliveryAttempt.count()).toBe(7);
  });

  it('breaks results down by platform, message type and app version', async () => {
    await fixture();
    const { data } = (await h.api.get(`${url}/analytics`).expect(200)).body;
    expect(data.byPlatform.find((p: { key: string }) => p.key === 'ANDROID').planned).toBe(4);
    expect(data.byPlatform.find((p: { key: string }) => p.key === 'IOS').delivered).toBe(1);
    expect(data.byMessageType).toMatchObject([{ key: 'NOTIFICATION', planned: 6 }]);
    expect(data.byAppVersion.map((v: { key: string; valid: number }) => [v.key, v.valid])).toEqual([
      ['2.0.0', 3],
      ['1.0.0', 2],
    ]);
  });

  it('lists failure reasons by stage', async () => {
    await fixture();
    const { data } = (await h.api.get(`${url}/analytics`).expect(200)).body;
    expect(data.failureReasons).toEqual(
      expect.arrayContaining([
        { reason: 'DEVICE_NOT_FOUND', stage: 'INVALID_TARGET', count: 1 },
        { reason: 'MT_DOWN', stage: 'SEND_FAILED', count: 1 },
      ]),
    );
  });

  it('reports the same figures at msgid level', async () => {
    const msgid = await fixture();
    const { data } = (await h.api.get(`${url}/analytics/messages/${msgid}`).expect(200)).body;
    expect(data.totals).toMatchObject({ planned: 6, delivered: 3, clicked: 1 });
    expect(data.msgid).toBe(msgid);
  });

  it('updates analytics as events are recorded', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const { data } = (await send(h, envId).expect(201)).body;
    const totals = async () => (await h.api.get(`${url}/analytics`)).body.data.totals;
    expect(await totals()).toMatchObject({ delivered: 1, displayed: 0, clicked: 0 });
    await recordEvent(data.msgid, { type: 'DISPLAYED' }).expect(200);
    expect(await totals()).toMatchObject({ displayed: 1, clicked: 0 });
    await recordEvent(data.msgid, { type: 'CLICKED' }).expect(200);
    expect(await totals()).toMatchObject({ displayed: 1, clicked: 1, clickThroughRate: 1 });
  });

  describe('simulated events', () => {
    it('are marked as manual simulation', async () => {
      await registerDevice(h, envId, { registrationId: 'device-1' });
      const { data } = (await send(h, envId).expect(201)).body;
      const res = await recordEvent(data.msgid, { type: 'CLICKED' }).expect(200);
      expect(res.body.data).toMatchObject({ recorded: 1, simulated: true });
      const event = await prisma.messageEvent.findFirstOrThrow({ where: { type: 'CLICKED' } });
      expect(event.source).toBe('MANUAL_SIMULATION');
    });

    it('do not double count', async () => {
      await registerDevice(h, envId, { registrationId: 'device-1' });
      const { data } = (await send(h, envId).expect(201)).body;
      await recordEvent(data.msgid, { type: 'DISPLAYED' }).expect(200);
      const again = await recordEvent(data.msgid, { type: 'DISPLAYED' }).expect(200);
      expect(again.body.data).toMatchObject({ recorded: 0 });
      expect(again.body.data.skipped[0].reason).toBe('ALREADY_RECORDED');
      expect(await prisma.messageEvent.count({ where: { type: 'DISPLAYED' } })).toBe(1);
    });

    it('imply a display when a click arrives first', async () => {
      await registerDevice(h, envId, { registrationId: 'device-1' });
      const { data } = (await send(h, envId).expect(201)).body;
      await recordEvent(data.msgid, { type: 'CLICKED' }).expect(200);
      expect(await prisma.messageEvent.count({ where: { type: 'DISPLAYED' } })).toBe(1);
    });

    it('cannot be recorded for a device that received nothing', async () => {
      await registerDevice(h, envId, { registrationId: 'device-1', online: false });
      const { data } = (await send(h, envId).expect(201)).body;
      const res = await recordEvent(data.msgid, {
        type: 'DISPLAYED',
        registrationIds: ['device-1'],
      }).expect(409);
      expect(res.body.error.code).toBe('EVENT_NOT_ALLOWED');
    });

    it('can confirm a delivery that had no receipt', async () => {
      await registerDevice(h, envId, { registrationId: 'device-1', online: false });
      const { data } = (await send(h, envId).expect(201)).body;
      await recordEvent(data.msgid, { type: 'DELIVERED' }).expect(200);
      const detail = (await h.api.get(`${url}/messages/${data.msgid}`)).body.data;
      expect(detail.funnel).toMatchObject({ sent: 1, delivered: 1 });
    });

    it('honour a count', async () => {
      await registerDevice(h, envId, { registrationId: 'device-1' });
      await registerDevice(h, envId, { registrationId: 'device-2' });
      const { data } = (await send(h, envId).expect(201)).body;
      const res = await recordEvent(data.msgid, { type: 'DISPLAYED', count: 1 }).expect(200);
      expect(res.body.data.recorded).toBe(1);
    });
  });

  describe('date handling', () => {
    beforeEach(async () => {
      await h.api.patch(`/api/v1/apps/${appId}`, { timezone: 'Asia/Shanghai' }).expect(200);
      await registerDevice(h, envId, { registrationId: 'device-1' });
    });

    it('fills empty days and buckets by the application timezone', async () => {
      // 20:00 UTC on the 14th is already the 15th in Shanghai.
      time.now = new Date('2026-06-14T20:00:00Z');
      await send(h, envId).expect(201);
      time.now = new Date('2026-06-16T00:00:00Z');
      const { data } = (
        await h.api.get(`${url}/analytics?from=2026-06-14&to=2026-06-16`).expect(200)
      ).body;
      expect(data.trend.map((b: { bucket: string; delivered: number }) => [b.bucket, b.delivered])).toEqual([
        ['2026-06-14', 0],
        ['2026-06-15', 1],
        ['2026-06-16', 0],
      ]);
    });

    it('supports monthly granularity', async () => {
      await send(h, envId).expect(201);
      time.now = new Date('2026-08-02T00:00:00Z');
      await send(h, envId).expect(201);
      const { data } = (
        await h.api
          .get(`${url}/analytics?from=2026-06-01&to=2026-08-31&granularity=month`)
          .expect(200)
      ).body;
      expect(data.trend.map((b: { bucket: string; delivered: number }) => [b.bucket, b.delivered])).toEqual([
        ['2026-06', 1],
        ['2026-07', 0],
        ['2026-08', 1],
      ]);
    });

    it('excludes messages outside the range', async () => {
      await send(h, envId).expect(201);
      const { data } = (
        await h.api.get(`${url}/analytics?from=2026-01-01&to=2026-01-31`).expect(200)
      ).body;
      expect(data.totals.planned).toBe(0);
      expect(data.totals.deliveryRate).toBeNull();
    });

    it('rejects invalid ranges', async () => {
      await h.api.get(`${url}/analytics?from=2026-02-01&to=2026-01-01`).expect(400);
      await h.api.get(`${url}/analytics?from=yesterday`).expect(400);
    });
  });

  it('keeps environments separate', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    await send(h, envId).expect(201);
    const other = await createApplication(h, 'Other');
    const { data } = (await h.api.get(`/api/v1/environments/${other.envId}/analytics`).expect(200)).body;
    expect(data.totals.planned).toBe(0);
  });
});
