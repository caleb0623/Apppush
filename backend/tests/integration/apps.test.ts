import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  basic,
  createApplication,
  createTestingEnv,
  harness,
  notification,
  prisma,
  type Harness,
} from '../helpers.js';

describe('applications', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('creates an application and retrieves it', async () => {
    const created = await h.api
      .post('/api/v1/apps', { name: 'Shop', timezone: 'Europe/London', isVip: true })
      .expect(201);
    const { application, credentials } = created.body.data;
    expect(credentials.appKey).toMatch(/^[0-9a-f]{24}$/);
    expect(credentials.masterSecret).toBeTruthy();
    expect(credentials.notice).toMatch(/only once/);

    const fetched = await h.api.get(`/api/v1/apps/${application.id}`).expect(200);
    expect(fetched.body.data).toMatchObject({ name: 'Shop', timezone: 'Europe/London', isVip: true });
    expect(fetched.body.data.environments).toHaveLength(1);
    expect(fetched.body.data.environments[0].type).toBe('PRODUCTION');
  });

  it('never returns a stored secret or hash after creation', async () => {
    const { appId, envId, masterSecret } = await createApplication(h);
    const stored = await prisma.appCredential.findFirstOrThrow({ where: { environmentId: envId } });
    expect(stored.secretHash).not.toBe(masterSecret);

    for (const url of [`/api/v1/apps/${appId}`, `/api/v1/environments/${envId}`, '/api/v1/apps']) {
      const text = JSON.stringify((await h.api.get(url).expect(200)).body);
      expect(text).not.toContain(masterSecret);
      expect(text).not.toContain(stored.secretHash);
    }
  });

  it('lists with pagination, search and status filters', async () => {
    await createApplication(h, 'Alpha');
    await createApplication(h, 'Beta');
    await createApplication(h, 'Alphabet');

    const page = await h.api.get('/api/v1/apps?pageSize=2').expect(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ total: 3, totalPages: 2, page: 1, pageSize: 2 });

    const search = await h.api.get('/api/v1/apps?search=Alpha').expect(200);
    expect(search.body.meta.total).toBe(2);
  });

  it('rejects invalid payloads with field details', async () => {
    const res = await h.api.post('/api/v1/apps', { name: '', timezone: 'Mars/Base' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['name', 'timezone']),
    );
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('returns 404 for an unknown application', async () => {
    await h.api.get('/api/v1/apps/999999').expect(404);
  });

  it('updates metadata and records an audit entry', async () => {
    const { appId } = await createApplication(h);
    const res = await h.api.patch(`/api/v1/apps/${appId}`, { name: 'Renamed' }).expect(200);
    expect(res.body.data.name).toBe('Renamed');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'app.updated' } });
    expect(audit?.entityId).toBe(String(appId));
  });

  it('rejects writes and API access once deactivated, and restores them on activation', async () => {
    const { appId, envId, appKey, masterSecret } = await createApplication(h);
    await h.api.post(`/api/v1/apps/${appId}/deactivate`).expect(200);

    const write = await h.api
      .post(`/api/v1/environments/${envId}/messages`, notification())
      .expect(403);
    expect(write.body.error.code).toBe('APP_INACTIVE');
    await request(h.app)
      .get('/api/v1/open/devices')
      .set('Authorization', basic(appKey, masterSecret))
      .expect(403);
    await h.api.get(`/api/v1/environments/${envId}/devices`).expect(200);
    await h.api.patch(`/api/v1/apps/${appId}`, { name: 'x' }).expect(409);

    await h.api.post(`/api/v1/apps/${appId}/activate`).expect(200);
    await request(h.app)
      .get('/api/v1/open/devices')
      .set('Authorization', basic(appKey, masterSecret))
      .expect(200);
  });

  it('rejects writes after the service validity date', async () => {
    const { appId, envId } = await createApplication(h);
    await h.api
      .patch(`/api/v1/apps/${appId}`, { serviceValidUntil: '2020-01-01T00:00:00Z' })
      .expect(200);
    const res = await h.api
      .post(`/api/v1/environments/${envId}/messages`, notification())
      .expect(403);
    expect(res.body.error.code).toBe('APP_SERVICE_EXPIRED');
  });

  it('does not let an inactive application gain a testing environment', async () => {
    const { appId } = await createApplication(h);
    await h.api.post(`/api/v1/apps/${appId}/deactivate`).expect(200);
    await h.api.post(`/api/v1/apps/${appId}/testing-environment`).expect(409);
  });

  it('allows only one testing environment per application', async () => {
    const { appId } = await createApplication(h);
    await createTestingEnv(h, appId);
    const res = await h.api.post(`/api/v1/apps/${appId}/testing-environment`).expect(409);
    expect(res.body.error.code).toBe('TESTING_ENV_EXISTS');
  });
});
