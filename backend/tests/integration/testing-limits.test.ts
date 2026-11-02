import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../../src/lib/rate-limiter.js';
import {
  basic,
  createApplication,
  createTestingEnv,
  harness,
  prisma,
  registerDevice,
  type Harness,
} from '../helpers.js';

async function seedDevices(environmentId: number, count: number, prefix = 'bulk') {
  await prisma.device.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      environmentId,
      registrationId: `${prefix}-${environmentId}-${i}`,
      platform: 'ANDROID' as const,
      appVersion: '1.0.0',
    })),
  });
}

describe('testing environment limits', () => {
  let h: Harness;
  let production: Awaited<ReturnType<typeof createApplication>>;
  let testing: Awaited<ReturnType<typeof createTestingEnv>>;
  let url: string;

  beforeEach(async () => {
    h = await harness();
    production = await createApplication(h);
    testing = await createTestingEnv(h, production.appId);
    url = `/api/v1/environments/${testing.envId}`;
  });

  it('rejects device 1,001', async () => {
    await seedDevices(testing.envId, 999);
    await registerDevice(h, testing.envId, { registrationId: 'device-1000' });
    const res = await h.api
      .post(`${url}/devices`, { registrationId: 'device-1001', platform: 'IOS', appVersion: '1' })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'TESTING_DEVICE_LIMIT',
      details: { limit: 1000, current: 1000 },
    });
  });

  it('does not exceed the device limit under concurrent registrations', async () => {
    await seedDevices(testing.envId, 998);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        h.api.post(`${url}/devices`, {
          registrationId: `racing-${i}-device`,
          platform: 'IOS',
          appVersion: '1',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(6);
    expect(await prisma.device.count({ where: { environmentId: testing.envId } })).toBe(1000);
  });

  it('frees capacity when a device is deleted', async () => {
    await seedDevices(testing.envId, 1000);
    await h.api.delete(`${url}/devices/bulk-${testing.envId}-0`).expect(204);
    await registerDevice(h, testing.envId, { registrationId: 'replacement' });
  });

  it('rejects tag 51', async () => {
    await prisma.tag.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ environmentId: testing.envId, name: `t${i}` })),
    });
    const res = await h.api.post(`${url}/tags`, { name: 'one-too-many' }).expect(409);
    expect(res.body.error.code).toBe('TESTING_TAG_LIMIT');
  });

  it('applies the tag limit to tags created by assignment', async () => {
    await registerDevice(h, testing.envId, { registrationId: 'device-1' });
    await prisma.tag.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ environmentId: testing.envId, name: `t${i}` })),
    });
    const res = await h.api.put(`${url}/devices/device-1/tags`, { add: ['new-tag'] }).expect(409);
    expect(res.body.error.code).toBe('TESTING_TAG_LIMIT');
  });

  it('rejects an 11th device on a tag', async () => {
    await seedDevices(testing.envId, 11);
    await h.api.post(`${url}/tags`, { name: 'full' }).expect(201);
    const ids = Array.from({ length: 11 }, (_, i) => `bulk-${testing.envId}-${i}`);
    await h.api.post(`${url}/tags/full/devices`, { add: ids.slice(0, 10) }).expect(204);
    const res = await h.api.post(`${url}/tags/full/devices`, { add: [ids[10]] }).expect(409);
    expect(res.body.error.code).toBe('TESTING_DEVICES_PER_TAG_LIMIT');
  });

  it('rejects an 11th tag on a device and changes nothing', async () => {
    await registerDevice(h, testing.envId, { registrationId: 'device-1' });
    const tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
    await h.api.put(`${url}/devices/device-1/tags`, { add: tags.slice(0, 10) }).expect(200);
    const res = await h.api.put(`${url}/devices/device-1/tags`, { add: [tags[10]] }).expect(409);
    expect(res.body.error.code).toBe('TESTING_TAGS_PER_DEVICE_LIMIT');
    expect((await h.api.get(`${url}/devices/device-1`)).body.data.tags).toHaveLength(10);
  });

  it('rolls back a whole assignment that breaks a limit part-way', async () => {
    await registerDevice(h, testing.envId, { registrationId: 'device-1' });
    await h.api
      .put(`${url}/devices/device-1/tags`, {
        add: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
      })
      .expect(409);
    expect((await h.api.get(`${url}/devices/device-1`)).body.data.tags).toHaveLength(0);
    expect((await h.api.get(`${url}/tags`)).body.meta.total).toBe(0);
  });

  it('does not exceed devices per tag under concurrent assignments', async () => {
    await seedDevices(testing.envId, 15);
    await h.api.post(`${url}/tags`, { name: 'race' }).expect(201);
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        h.api.post(`${url}/tags/race/devices`, { add: [`bulk-${testing.envId}-${i}`] }),
      ),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(10);
    expect((await h.api.get(`${url}/tags`)).body.data[0].deviceCount).toBe(10);
  });

  it('does not apply these limits to production', async () => {
    await seedDevices(production.envId, 1000);
    await registerDevice(h, production.envId, { registrationId: 'device-1001' });
    const prodUrl = `/api/v1/environments/${production.envId}`;
    await h.api
      .put(`${prodUrl}/devices/device-1001/tags`, {
        add: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
      })
      .expect(200);
  });
});

describe('testing environment QPS limit', () => {
  let time: { now: number };
  let h: Harness;
  let production: Awaited<ReturnType<typeof createApplication>>;
  let testing: Awaited<ReturnType<typeof createTestingEnv>>;

  beforeEach(async () => {
    time = { now: 1_000_000 };
    h = await harness({
      testingLimiter: new SlidingWindowRateLimiter(10, 1000, () => time.now),
    });
    production = await createApplication(h);
    testing = await createTestingEnv(h, production.appId);
  });

  const hit = (envId: number) => h.api.get(`/api/v1/environments/${envId}/devices`);

  it('allows 10 requests in a second and rejects the 11th', async () => {
    for (let i = 0; i < 10; i += 1) await hit(testing.envId).expect(200);
    const res = await hit(testing.envId).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details.retryAfterMs).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.headers['x-ratelimit-limit']).toBe('10');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('accepts requests again after the window', async () => {
    for (let i = 0; i < 11; i += 1) await hit(testing.envId);
    time.now += 1000;
    await hit(testing.envId).expect(200);
  });

  it('applies to API clients too, sharing one budget per environment', async () => {
    for (let i = 0; i < 5; i += 1) await hit(testing.envId).expect(200);
    const auth = basic(testing.appKey, testing.masterSecret);
    for (let i = 0; i < 5; i += 1) {
      await request(h.app).get('/api/v1/open/devices').set('Authorization', auth).expect(200);
    }
    await request(h.app).get('/api/v1/open/devices').set('Authorization', auth).expect(429);
  });

  it('rejects concurrent bursts', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => hit(testing.envId)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(10);
    expect(results.filter((r) => r.status === 429)).toHaveLength(15);
  });

  it('does not limit production', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => hit(production.envId)));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it('does not spend quota on failed authentication', async () => {
    const auth = basic(testing.appKey, 'wrong');
    for (let i = 0; i < 20; i += 1) {
      await request(h.app).get('/api/v1/open/devices').set('Authorization', auth).expect(401);
    }
    await hit(testing.envId).expect(200);
  });
});
