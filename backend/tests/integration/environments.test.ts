import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  basic,
  createApplication,
  createTestingEnv,
  harness,
  prisma,
  registerDevice,
  type Harness,
} from '../helpers.js';

describe('environments and credentials', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('gives the testing environment its own credentials, linked to production', async () => {
    const production = await createApplication(h);
    const testing = await createTestingEnv(h, production.appId);
    expect(testing.appKey).not.toBe(production.appKey);
    expect(testing.masterSecret).not.toBe(production.masterSecret);

    const res = await h.api.get(`/api/v1/apps/${production.appId}`).expect(200);
    expect(res.body.data.environments.map((e: { type: string }) => e.type).sort()).toEqual([
      'PRODUCTION',
      'TESTING',
    ]);
  });

  it('shares name, icon, VIP and validity with the testing environment', async () => {
    const { appId } = await createApplication(h);
    const testing = await createTestingEnv(h, appId);
    await h.api
      .patch(`/api/v1/apps/${appId}`, {
        name: 'Renamed',
        iconUrl: 'https://x.test/icon.png',
        isVip: true,
        serviceValidUntil: '2030-01-01T00:00:00Z',
      })
      .expect(200);

    const { shared } = (await h.api.get(`/api/v1/environments/${testing.envId}`).expect(200)).body.data;
    expect(shared).toMatchObject({
      name: 'Renamed',
      iconUrl: 'https://x.test/icon.png',
      isVip: true,
      serviceValidUntil: '2030-01-01T00:00:00.000Z',
    });
  });

  it('keeps callback, security and integration settings independent', async () => {
    const production = await createApplication(h);
    const testing = await createTestingEnv(h, production.appId);
    await h.api
      .patch(`/api/v1/environments/${testing.envId}/config`, {
        callbackUrl: 'https://test.example/cb',
        callbackEnabled: true,
        ipAllowlist: ['127.0.0.1'],
        enabledChannels: ['mtpush'],
      })
      .expect(200);

    const prod = (await h.api.get(`/api/v1/environments/${production.envId}`).expect(200)).body.data;
    expect(prod.callbackUrl).toBeNull();
    expect(prod.ipAllowlist).toEqual([]);
    expect(prod.enabledChannels).toHaveLength(10);
  });

  it('reports limits for testing environments only', async () => {
    const production = await createApplication(h);
    const testing = await createTestingEnv(h, production.appId);
    const prod = (await h.api.get(`/api/v1/environments/${production.envId}`).expect(200)).body.data;
    const test = (await h.api.get(`/api/v1/environments/${testing.envId}`).expect(200)).body.data;
    expect(prod.limits).toBeNull();
    expect(test.limits).toMatchObject({ maxDevices: 1000, maxRequestsPerSecond: 10 });
  });

  it('keeps device data separate between environments', async () => {
    const production = await createApplication(h);
    const testing = await createTestingEnv(h, production.appId);
    await registerDevice(h, testing.envId, { registrationId: 'only-in-testing' });
    const res = await h.api.get(`/api/v1/environments/${production.envId}/devices`).expect(200);
    expect(res.body.meta.total).toBe(0);
    await h.api.get(`/api/v1/environments/${production.envId}/devices/only-in-testing`).expect(404);
  });

  it('rotates a secret: the new one works, the old one stops, and it shows once', async () => {
    const { envId, appKey, masterSecret } = await createApplication(h);
    const rotated = await h.api.post(`/api/v1/environments/${envId}/credentials/rotate`).expect(200);
    const fresh = rotated.body.data.masterSecret as string;
    expect(fresh).not.toBe(masterSecret);

    await request(h.app)
      .get('/api/v1/open/devices')
      .set('Authorization', basic(appKey, masterSecret))
      .expect(401);
    await request(h.app)
      .get('/api/v1/open/devices')
      .set('Authorization', basic(appKey, fresh))
      .expect(200);

    const body = JSON.stringify((await h.api.get(`/api/v1/environments/${envId}`).expect(200)).body);
    expect(body).not.toContain(fresh);

    const rows = await prisma.appCredential.findMany({ where: { environmentId: envId } });
    expect(rows.map((r) => r.status).sort()).toEqual(['ACTIVE', 'REVOKED']);
    expect(await prisma.auditLog.count({ where: { action: 'credentials.rotated' } })).toBe(1);
  });

  it('lets an API client rotate its own secret', async () => {
    const { appKey, masterSecret } = await createApplication(h);
    await request(h.app)
      .post('/api/v1/open/credentials/rotate')
      .set('Authorization', basic(appKey, masterSecret))
      .expect(200);
  });

  it('requires authentication to rotate', async () => {
    const { envId } = await createApplication(h);
    await request(h.app).post(`/api/v1/environments/${envId}/credentials/rotate`).expect(401);
  });

  it('validates configuration', async () => {
    const { envId } = await createApplication(h);
    await h.api
      .patch(`/api/v1/environments/${envId}/config`, { enabledChannels: ['pigeon'] })
      .expect(400);
    await h.api
      .patch(`/api/v1/environments/${envId}/config`, { ipAllowlist: ['not-an-ip'] })
      .expect(400);
    await h.api
      .patch(`/api/v1/environments/${envId}/config`, { callbackUrl: 'not a url' })
      .expect(400);
  });
});
