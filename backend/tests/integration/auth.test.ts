import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { SlidingWindowRateLimiter } from '../../src/lib/rate-limiter.js';
import {
  basic,
  buildDeps,
  createApplication,
  createUser,
  harness,
  PASSWORD,
  prisma,
  type Harness,
} from '../helpers.js';

describe('authentication and authorization', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('logs in and returns a usable token without any password data', async () => {
    const res = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: PASSWORD })
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    await request(h.app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.token}`)
      .expect(200);
  });

  it('gives the same error for an unknown user and a wrong password', async () => {
    const wrong = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: 'nope' })
      .expect(401);
    const unknown = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@test.local', password: 'nope' })
      .expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('rejects protected routes without a token or with a bad one', async () => {
    await request(h.app).get('/api/v1/apps').expect(401);
    const res = await request(h.app)
      .get('/api/v1/apps')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token for a user who has been disabled', async () => {
    await prisma.adminUser.update({ where: { id: h.user.id }, data: { isActive: false } });
    await h.api.get('/api/v1/apps').expect(401);
  });

  it('lets a VIEWER read but not write', async () => {
    const { envId } = await createApplication(h);
    const viewer = await createUser('VIEWER', 'viewer@test.local');
    const bearer = `Bearer ${viewer.token}`;
    await request(h.app).get('/api/v1/apps').set('Authorization', bearer).expect(200);
    await request(h.app)
      .get(`/api/v1/environments/${envId}/devices`)
      .set('Authorization', bearer)
      .expect(200);
    const res = await request(h.app)
      .post('/api/v1/apps')
      .set('Authorization', bearer)
      .send({ name: 'x' })
      .expect(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    await request(h.app)
      .post(`/api/v1/environments/${envId}/devices`)
      .set('Authorization', bearer)
      .send({ platform: 'IOS', appVersion: '1' })
      .expect(403);
  });

  it('changes a password after checking the current one', async () => {
    await h.api
      .post('/api/v1/auth/change-password', {
        currentPassword: 'wrong',
        newPassword: 'a-new-long-password',
      })
      .expect(401);
    await h.api
      .post('/api/v1/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: 'a-new-long-password',
      })
      .expect(204);
    await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: 'a-new-long-password' })
      .expect(200);
  });

  it('rate limits repeated logins', async () => {
    const app = createApp(buildDeps({ loginLimiter: new SlidingWindowRateLimiter(2, 60_000) }));
    const attempt = () =>
      request(app).post('/api/v1/auth/login').send({ email: 'x@test.local', password: 'y' });
    await attempt().expect(401);
    await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('authenticates API clients with AppKey and Master Secret', async () => {
    const { appKey, masterSecret } = await createApplication(h);
    await request(h.app)
      .get('/api/v1/open/devices')
      .set('Authorization', basic(appKey, masterSecret))
      .expect(200);
    const res = await request(h.app)
      .get('/api/v1/open/devices')
      .set('Authorization', basic(appKey, 'wrong'))
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    await request(h.app).get('/api/v1/open/devices').expect(401);
  });

  it('stops an API client reaching another environment', async () => {
    const first = await createApplication(h, 'First');
    const second = await createApplication(h, 'Second');
    const res = await request(h.app)
      .get(`/api/v1/environments/${second.envId}/devices`)
      .set('Authorization', basic(first.appKey, first.masterSecret))
      .expect(403);
    expect(res.body.error.code).toBe('ENVIRONMENT_MISMATCH');
  });

  it('enforces the IP allowlist for API clients', async () => {
    const { envId, appKey, masterSecret } = await createApplication(h);
    await h.api
      .patch(`/api/v1/environments/${envId}/config`, { ipAllowlist: ['203.0.113.7'] })
      .expect(200);
    const res = await request(h.app)
      .get('/api/v1/open/devices')
      .set('Authorization', basic(appKey, masterSecret))
      .expect(403);
    expect(res.body.error.code).toBe('IP_NOT_ALLOWED');
  });
});
