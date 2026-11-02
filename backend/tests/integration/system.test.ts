import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { harness, prisma, type Harness } from '../helpers.js';

describe('system endpoints', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('reports health without authentication', async () => {
    const res = await request(h.app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'up',
      worker: 'down',
      deliveryMode: 'simulated',
    });
  });

  it('shows the worker as up after a recent heartbeat', async () => {
    const now = h.deps.clock();
    await prisma.workerHeartbeat.create({
      data: { workerId: 'w1', startedAt: now, lastBeatAt: now },
    });
    expect((await request(h.app).get('/api/health')).body.worker).toBe('up');
  });

  it('serves Swagger UI and the OpenAPI document', async () => {
    const page = await request(h.app).get('/api/docs/').expect(200);
    expect(page.text).toContain('swagger');

    const { body } = await request(h.app).get('/api/docs.json').expect(200);
    expect(body.openapi).toMatch(/^3\./);
    for (const path of [
      '/api/v1/apps',
      '/api/v1/environments/{envId}/messages',
      '/api/v1/open/messages',
      '/api/v1/environments/{envId}/analytics',
      '/api/v1/environments/{envId}/schedules',
      '/api/v1/environments/{envId}/devices',
      '/api/v1/environments/{envId}/tags',
      '/api/v1/environments/{envId}/config',
      '/api/v1/client/ping',
      '/api/v1/client/devices',
      '/api/v1/client/devices/me/token',
      '/api/v1/client/events',
    ]) {
      expect(body.paths).toHaveProperty([path]);
    }
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(h.app).get('/api/v1/nowhere').expect(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('lists audit records', async () => {
    await h.api.post('/api/v1/apps', { name: 'Audited' }).expect(201);
    const res = await h.api.get('/api/v1/audit-logs').expect(200);
    expect(res.body.data[0]).toMatchObject({ action: 'app.created', actorLabel: 'admin@test.local' });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(h.app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('applies the migrations, with the expected tables and constraints', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()`;
    const tables = rows.map((r) => r.name.toLowerCase());
    for (const table of [
      'application',
      'appenvironment',
      'appcredential',
      'device',
      'tag',
      'devicetag',
      'alias',
      'pushmessage',
      'messagetarget',
      'deliveryattempt',
      'messageevent',
      'scheduledjob',
      'adminuser',
      'auditlog',
    ]) {
      expect(tables).toContain(table);
    }

    const migrations = resolve(import.meta.dirname, '../../prisma/migrations');
    const [folder] = readdirSync(migrations).filter((name) => /^\d/.test(name));
    const sql = readFileSync(resolve(migrations, folder!, 'migration.sql'), 'utf8');
    expect(sql).toContain('MessageEvent_targetId_type_key');
    expect(sql).toContain('PushMessage_environmentId_idempotencyKey_key');
    expect(sql).toContain('MessageTarget_messageId_registrationId_key');
  });

  it('enforces the one-event-per-stage rule in the database itself', async () => {
    const app = await prisma.application.create({ data: { name: 'x' } });
    const environment = await prisma.appEnvironment.create({
      data: {
        applicationId: app.id,
        type: 'PRODUCTION',
        appKey: 'constraint-test',
        ipAllowlist: [],
        enabledChannels: [],
        simulatorConfig: {},
      },
    });
    const message = await prisma.pushMessage.create({
      data: {
        msgid: 'c1',
        environmentId: environment.id,
        type: 'NOTIFICATION',
        platforms: [],
        audienceType: 'ALL',
        audience: [],
        strategy: 'mtpush',
        requestHash: 'x',
      },
    });
    const target = await prisma.messageTarget.create({
      data: { messageId: message.id, registrationId: 'r', isValid: true },
    });
    const event = {
      targetId: target.id,
      type: 'CLICKED' as const,
      source: 'MANUAL_SIMULATION' as const,
      occurredAt: new Date(),
    };
    await prisma.messageEvent.create({ data: event });
    await expect(prisma.messageEvent.create({ data: event })).rejects.toMatchObject({ code: 'P2002' });
  });
});
