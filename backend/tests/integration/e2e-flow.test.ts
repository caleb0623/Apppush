import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { processDueJobs } from '../../src/modules/scheduler/service.js';
import { attemptsOf, configureSimulator, harness, PASSWORD, prisma } from '../helpers.js';

/** The twelve-step journey from section 7 of the brief, driven through the HTTP API. */
describe('end-to-end journey', () => {
  it('runs from login to analytics, scheduling and testing limits', async () => {
    const time = { now: new Date('2026-06-15T04:00:00Z') };
    const h = await harness({ clock: () => time.now });

    // 1. Log in.
    const login = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: PASSWORD })
      .expect(200);
    const bearer = `Bearer ${login.body.data.token}`;
    const post = (url: string, body?: object) =>
      request(h.app).post(url).set('Authorization', bearer).send(body);
    const get = (url: string) => request(h.app).get(url).set('Authorization', bearer);

    // 2. Create an application.
    const created = await post('/api/v1/apps', { name: 'Journey', timezone: 'UTC' }).expect(201);
    const appId = created.body.data.application.id as number;
    const envId = created.body.data.credentials.environmentId as number;
    const url = `/api/v1/environments/${envId}`;

    // 3. Register test devices.
    for (const [registrationId, platform] of [
      ['journey-android', 'ANDROID'],
      ['journey-iphone', 'IOS'],
    ] as const) {
      await post(`${url}/devices`, { registrationId, platform, appVersion: '1.0.0', online: true }).expect(201);
    }

    // 4 and 5. Create a notification and select a strategy, with FCM failing.
    await configureSimulator(h, envId, { fcm: { mode: 'fail', failureReason: 'FCM_DOWN' } });

    // 6. Send a simulated notification.
    const sent = await post(`${url}/messages`, {
      type: 'NOTIFICATION',
      title: 'Journey',
      body: 'Hello',
      platforms: ['ANDROID', 'IOS'],
      audience: { type: 'ALL' },
      strategy: 'fcm_mtpush',
    }).expect(201);
    const { msgid } = sent.body.data;
    expect(sent.body.data.status).toBe('COMPLETED');

    // 7. Inspect the message ID and delivery attempts.
    const attempts = await attemptsOf(h, envId, msgid);
    expect(attempts.map((a) => [a.channel, a.outcome]).sort()).toEqual([
      ['apns', 'DELIVERED'],
      ['fcm', 'FAILED'],
      ['mtpush', 'DELIVERED'],
    ]);

    // 8. Record simulated display and click events.
    await post(`${url}/messages/${msgid}/events`, { type: 'DISPLAYED' }).expect(200);
    await post(`${url}/messages/${msgid}/events`, {
      type: 'CLICKED',
      registrationIds: ['journey-iphone'],
    }).expect(200);

    // 9. View updated analytics.
    const analytics = await get(`${url}/analytics`).expect(200);
    expect(analytics.body.data.totals).toMatchObject({
      planned: 2,
      valid: 2,
      sent: 2,
      delivered: 2,
      displayed: 2,
      clicked: 1,
      deliveryRate: 1,
      displayRate: 1,
      clickThroughRate: 0.5,
    });

    // 10. Schedule a notification and watch the worker process it.
    const scheduled = await post(`${url}/messages`, {
      type: 'NOTIFICATION',
      title: 'Later',
      body: 'Scheduled',
      platforms: ['ANDROID'],
      audience: { type: 'ALL' },
      strategy: 'mtpush',
      scheduledAt: '2026-06-15T05:00',
    }).expect(201);
    expect(scheduled.body.data.status).toBe('PENDING');
    time.now = new Date('2026-06-15T05:00:01Z');
    expect(await processDueJobs(h.deps, 'journey-worker')).toBe(1);
    const processed = await get(`${url}/messages/${scheduled.body.data.msgid}`).expect(200);
    expect(processed.body.data.status).toBe('COMPLETED');

    // 11. Switch between production and testing configurations.
    const testing = await post(`/api/v1/apps/${appId}/testing-environment`).expect(201);
    const testUrl = `/api/v1/environments/${testing.body.data.credentials.environmentId}`;
    await request(h.app)
      .patch(`${testUrl}/config`)
      .set('Authorization', bearer)
      .send({ callbackUrl: 'https://test.example/hook' })
      .expect(200);
    expect((await get(testUrl).expect(200)).body.data).toMatchObject({
      type: 'TESTING',
      callbackUrl: 'https://test.example/hook',
      shared: { name: 'Journey' },
    });
    expect((await get(url).expect(200)).body.data).toMatchObject({
      type: 'PRODUCTION',
      callbackUrl: null,
      usage: { devices: 2 },
    });

    // 12. Observe validation errors when limits are exceeded.
    const environmentId = testing.body.data.credentials.environmentId as number;
    await prisma.device.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        environmentId,
        registrationId: `journey-bulk-${i}`,
        platform: 'ANDROID' as const,
        appVersion: '1',
      })),
    });
    const rejected = await post(`${testUrl}/devices`, { platform: 'IOS', appVersion: '1' }).expect(409);
    expect(rejected.body.error.code).toBe('TESTING_DEVICE_LIMIT');
  });
});
