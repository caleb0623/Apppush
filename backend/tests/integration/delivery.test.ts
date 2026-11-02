import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelRegistry } from '../../src/modules/delivery/channels.js';
import { dispatchContextOf, dispatchMessage } from '../../src/modules/delivery/dispatcher.js';
import {
  attemptsOf,
  configureSimulator,
  createApplication,
  harness,
  prisma,
  registerDevice,
  send,
  type Harness,
} from '../helpers.js';

const FAIL = (failureReason: string) => ({ mode: 'fail', failureReason });

describe('delivery scenarios', () => {
  let h: Harness;
  let envId: number;
  let url: string;

  const targetOf = (msgid: string) =>
    prisma.messageTarget.findFirstOrThrow({ where: { message: { msgid } } });

  beforeEach(async () => {
    h = await harness();
    ({ envId } = await createApplication(h));
    url = `/api/v1/environments/${envId}`;
  });

  it('1. EngageLab delivery succeeds', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const { data } = (await send(h, envId, { strategy: 'mtpush' }).expect(201)).body;
    const attempts = await attemptsOf(h, envId, data.msgid);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      channel: 'mtpush',
      outcome: 'DELIVERED',
      isFallback: false,
      isSimulated: true,
      failureReason: null,
    });
    expect(attempts[0]?.attemptedAt).toBeTruthy();
  });

  it('2. FCM succeeds without fallback', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;
    const attempts = await attemptsOf(h, envId, data.msgid);
    expect(attempts.map((a) => a.channel)).toEqual(['fcm']);
    expect((await targetOf(data.msgid)).finalChannel).toBe('fcm');
  });

  it('3. FCM fails and EngageLab succeeds', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    await configureSimulator(h, envId, { fcm: FAIL('FCM_DOWN') });
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;
    const attempts = await attemptsOf(h, envId, data.msgid);
    expect(attempts).toMatchObject([
      { channel: 'fcm', outcome: 'FAILED', failureReason: 'FCM_DOWN', isFallback: false },
      { channel: 'mtpush', outcome: 'DELIVERED', failureReason: null, isFallback: true },
    ]);
    expect(data.status).toBe('COMPLETED');
    expect(data.funnel).toMatchObject({ sent: 1, delivered: 1 });
  });

  it('4. Both primary and fallback channels fail', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    await configureSimulator(h, envId, { fcm: FAIL('FCM_DOWN'), mtpush: FAIL('MT_DOWN') });
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;
    expect(data).toMatchObject({ status: 'FAILED', failureReason: 'ALL_TARGETS_FAILED' });
    expect(data.funnel).toMatchObject({ valid: 1, sent: 0, delivered: 0 });
    const attempts = await attemptsOf(h, envId, data.msgid);
    expect(attempts.map((a) => a.outcome)).toEqual(['FAILED', 'FAILED']);
    expect((await targetOf(data.msgid)).failureReason).toBe('MT_DOWN');
    expect(await prisma.messageEvent.count()).toBe(0);
  });

  it('5. Manufacturer channel fallback works in both directions', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1', vendor: 'xiaomi' });
    await configureSimulator(h, envId, { xiaomi: FAIL('MI_DOWN') });
    const first = (await send(h, envId, { strategy: 'pns_mtpush' }).expect(201)).body.data;
    expect((await attemptsOf(h, envId, first.msgid)).map((a) => [a.channel, a.outcome])).toEqual([
      ['xiaomi', 'FAILED'],
      ['mtpush', 'DELIVERED'],
    ]);

    await configureSimulator(h, envId, { mtpush: FAIL('MT_DOWN') });
    const second = (await send(h, envId, { strategy: 'mtpush_pns' }).expect(201)).body.data;
    expect((await attemptsOf(h, envId, second.msgid)).map((a) => [a.channel, a.outcome])).toEqual([
      ['mtpush', 'FAILED'],
      ['xiaomi', 'DELIVERED'],
    ]);
  });

  it('6. Invalid targets are excluded from valid targets', async () => {
    await registerDevice(h, envId, { registrationId: 'good-001' });
    await registerDevice(h, envId, { registrationId: 'wrong-os', platform: 'IOS' });
    await registerDevice(h, envId, { registrationId: 'disabled' });
    await h.api.patch(`${url}/devices/disabled`, { status: 'INACTIVE' }).expect(200);

    const { data } = (
      await send(h, envId, {
        platforms: ['ANDROID'],
        audience: {
          type: 'REGISTRATION_IDS',
          values: ['good-001', 'wrong-os', 'disabled', 'does-not-exist'],
        },
      }).expect(201)
    ).body;
    expect(data.funnel).toMatchObject({ planned: 4, valid: 1, sent: 1, delivered: 1 });
    expect(data.funnel.loss.invalid).toBe(3);

    const targets = await prisma.messageTarget.findMany({ orderBy: { registrationId: 'asc' } });
    expect(Object.fromEntries(targets.map((t) => [t.registrationId, t.invalidReason]))).toEqual({
      'good-001': null,
      'wrong-os': 'PLATFORM_MISMATCH',
      disabled: 'DEVICE_INACTIVE',
      'does-not-exist': 'DEVICE_NOT_FOUND',
    });
    expect(await prisma.deliveryAttempt.count()).toBe(1);
  });

  it('fails a message with no valid targets', async () => {
    const { data } = (await send(h, envId).expect(201)).body;
    expect(data).toMatchObject({ status: 'FAILED', failureReason: 'NO_VALID_TARGETS' });
  });

  describe('7. duplicate requests', () => {
    beforeEach(() => registerDevice(h, envId, { registrationId: 'device-1' }));

    it('replays the original result for a repeated key', async () => {
      const first = await send(h, envId, { idempotencyKey: 'key-1' }).expect(201);
      const second = await send(h, envId, { idempotencyKey: 'key-1' }).expect(200);
      expect(second.body.data.msgid).toBe(first.body.data.msgid);
      expect(second.body.data.idempotentReplay).toBe(true);
      expect(await prisma.pushMessage.count()).toBe(1);
      expect(await prisma.deliveryAttempt.count()).toBe(1);
    });

    it('accepts the key as a header', async () => {
      const post = () =>
        h.api
          .post(`${url}/messages`)
          .set('Idempotency-Key', 'header-key')
          .send({
            type: 'NOTIFICATION',
            title: 'A',
            body: 'B',
            platforms: ['ANDROID'],
            audience: { type: 'ALL' },
            strategy: 'mtpush',
          });
      await post().expect(201);
      await post().expect(200);
    });

    it('rejects a reused key with a different body', async () => {
      await send(h, envId, { idempotencyKey: 'key-1' }).expect(201);
      const res = await send(h, envId, { idempotencyKey: 'key-1', title: 'Changed' }).expect(409);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('sends once under concurrent duplicates', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => send(h, envId, { idempotencyKey: 'race' })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(7);
      expect(await prisma.pushMessage.count()).toBe(1);
      expect(await prisma.deliveryAttempt.count()).toBe(1);
    });

    it('treats requests without a key as separate', async () => {
      await send(h, envId).expect(201);
      await send(h, envId).expect(201);
      expect(await prisma.pushMessage.count()).toBe(2);
    });
  });

  it('does not fall back after a channel accepts for an offline device', async () => {
    await registerDevice(h, envId, { registrationId: 'offline-1', online: false });
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;
    const attempts = await attemptsOf(h, envId, data.msgid);
    expect(attempts.map((a) => [a.channel, a.outcome])).toEqual([['fcm', 'ACCEPTED']]);
    expect(data.funnel).toMatchObject({ sent: 1, delivered: 0 });
    expect(data.status).toBe('COMPLETED');
  });

  describe('when EngageLab is not online', () => {
    it('mtpush_fcm uses FCM as its auxiliary channel', async () => {
      await registerDevice(h, envId, { registrationId: 'offline-1', online: false });
      const { data } = (await send(h, envId, { strategy: 'mtpush_fcm' }).expect(201)).body;
      expect(await attemptsOf(h, envId, data.msgid)).toMatchObject([
        { channel: 'mtpush', outcome: 'SKIPPED', failureReason: 'MTPUSH_OFFLINE', isFallback: false },
        { channel: 'fcm', isFallback: true },
      ]);
    });

    it('mtpush_pns uses the manufacturer as its auxiliary channel', async () => {
      await registerDevice(h, envId, { registrationId: 'offline-1', online: false, vendor: 'oppo' });
      const { data } = (await send(h, envId, { strategy: 'mtpush_pns' }).expect(201)).body;
      expect((await attemptsOf(h, envId, data.msgid)).map((a) => [a.channel, a.failureReason])).toEqual([
        ['mtpush', 'MTPUSH_OFFLINE'],
        ['oppo', null],
      ]);
    });

    it('stays on EngageLab while the device is online', async () => {
      await registerDevice(h, envId, { registrationId: 'online-1', online: true });
      const { data } = (await send(h, envId, { strategy: 'mtpush_fcm' }).expect(201)).body;
      expect((await attemptsOf(h, envId, data.msgid)).map((a) => a.channel)).toEqual(['mtpush']);
    });

    it('forced mtpush has no alternative, so it accepts and waits', async () => {
      await registerDevice(h, envId, { registrationId: 'offline-1', online: false });
      const { data } = (await send(h, envId, { strategy: 'mtpush' }).expect(201)).body;
      expect((await attemptsOf(h, envId, data.msgid)).map((a) => [a.channel, a.outcome])).toEqual([
        ['mtpush', 'ACCEPTED'],
      ]);
    });
  });

  it('accepts the published field name distribution_new', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const res = await h.api
      .post(`${url}/messages`, {
        type: 'NOTIFICATION',
        title: 'Hello',
        body: 'World',
        platforms: ['ANDROID'],
        audience: { type: 'ALL' },
        distribution_new: 'fcm_mtpush',
      })
      .expect(201);
    expect(res.body.data.strategy).toBe('fcm_mtpush');
  });

  it('records a skip for an unsupported vendor and uses the fallback', async () => {
    await registerDevice(h, envId, { registrationId: 'samsung-1', vendor: 'samsung' });
    const { data } = (await send(h, envId, { strategy: 'pns_mtpush' }).expect(201)).body;
    expect(await attemptsOf(h, envId, data.msgid)).toMatchObject([
      { channel: 'pns', outcome: 'SKIPPED', failureReason: 'NO_MANUFACTURER_CHANNEL' },
      { channel: 'mtpush', outcome: 'DELIVERED' },
    ]);
  });

  it('skips channels disabled for the environment', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    await h.api.patch(`${url}/config`, { enabledChannels: ['mtpush'] }).expect(200);
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;
    expect(await attemptsOf(h, envId, data.msgid)).toMatchObject([
      { channel: 'fcm', outcome: 'SKIPPED', failureReason: 'CHANNEL_DISABLED' },
      { channel: 'mtpush', outcome: 'DELIVERED' },
    ]);
  });

  it('uses the system channel on iOS and HarmonyOS', async () => {
    await registerDevice(h, envId, { registrationId: 'iphone-1', platform: 'IOS' });
    await registerDevice(h, envId, { registrationId: 'harmony-1', platform: 'HARMONYOS' });
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;
    const channels = (await attemptsOf(h, envId, data.msgid)).map((a) => a.channel).sort();
    expect(channels).toEqual(['apns', 'harmonyos']);
  });

  it('treats a throwing adapter as a failed attempt and falls back', async () => {
    const real = h.deps.channels;
    const flaky: ChannelRegistry = {
      get: (channel, config) =>
        channel === 'fcm'
          ? {
              id: 'fcm',
              send: () => Promise.reject(new Error('socket hang up')),
            }
          : real.get(channel, config),
    };
    h = await harness({ channels: flaky });
    ({ envId } = await createApplication(h));
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;
    const attempts = await attemptsOf(h, envId, data.msgid);
    expect(attempts[0]).toMatchObject({ outcome: 'FAILED', failureReason: 'PROVIDER_ERROR: socket hang up' });
    expect(attempts[1]).toMatchObject({ channel: 'mtpush', outcome: 'DELIVERED' });
  });

  it('resumes after a crash without repeating calls or deliveries', async () => {
    await registerDevice(h, envId, { registrationId: 'finished' });
    await registerDevice(h, envId, { registrationId: 'interrupted' });
    await configureSimulator(h, envId, { fcm: FAIL('FCM_DOWN') });
    const { data } = (await send(h, envId, { strategy: 'fcm_mtpush' }).expect(201)).body;

    // Rewind one target to the state a crash would leave: FCM failed, fallback not yet run.
    const target = await prisma.messageTarget.findFirstOrThrow({
      where: { registrationId: 'interrupted' },
    });
    await prisma.messageEvent.deleteMany({ where: { targetId: target.id } });
    await prisma.deliveryAttempt.deleteMany({ where: { targetId: target.id, attemptNo: 2 } });
    await prisma.messageTarget.update({
      where: { id: target.id },
      data: { status: 'PENDING', finalChannel: null },
    });
    const before = await prisma.deliveryAttempt.count();

    const environment = await prisma.appEnvironment.findUniqueOrThrow({ where: { id: envId } });
    const message = await prisma.pushMessage.findUniqueOrThrow({ where: { msgid: data.msgid } });
    await dispatchMessage(h.deps, message.id, dispatchContextOf(environment));

    expect(await prisma.deliveryAttempt.count()).toBe(before + 1);
    const attempts = await prisma.deliveryAttempt.findMany({
      where: { targetId: target.id },
      orderBy: { attemptNo: 'asc' },
    });
    expect(attempts.map((a) => a.channel)).toEqual(['fcm', 'mtpush']);
    expect(await prisma.messageTarget.count({ where: { status: 'DELIVERED' } })).toBe(2);
  });
});
