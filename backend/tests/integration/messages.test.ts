import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  basic,
  createApplication,
  harness,
  notification,
  prisma,
  registerDevice,
  send,
  type Harness,
} from '../helpers.js';

describe('messages', () => {
  let h: Harness;
  let envId: number;
  let url: string;
  let appKey: string;
  let masterSecret: string;

  beforeEach(async () => {
    h = await harness();
    ({ envId, appKey, masterSecret } = await createApplication(h));
    url = `/api/v1/environments/${envId}`;
    await registerDevice(h, envId, { registrationId: 'device-1' });
  });

  it('creates, sends and returns a message with a unique msgid', async () => {
    const res = await send(h, envId).expect(201);
    const { data } = res.body;
    expect(data.msgid).toMatch(/^\d{19}$/);
    expect(data).toMatchObject({ status: 'COMPLETED', isSimulated: true, idempotentReplay: false });
    expect(data.simulationNotice).toMatch(/No real device/);
    expect(data.funnel).toMatchObject({ planned: 1, valid: 1, sent: 1, delivered: 1 });

    const detail = await h.api.get(`${url}/messages/${data.msgid}`).expect(200);
    expect(detail.body.data.title).toBe('Hello');
  });

  it('stores style configuration', async () => {
    const res = await send(h, envId, {
      style: 'BIG_PICTURE',
      styleConfig: { pictureUrl: 'https://x.test/a.png' },
    }).expect(201);
    expect(res.body.data).toMatchObject({
      style: 'BIG_PICTURE',
      styleConfig: { pictureUrl: 'https://x.test/a.png' },
    });
  });

  it('sends custom and in-app messages', async () => {
    const custom = await send(h, envId, {
      type: 'CUSTOM',
      title: undefined,
      body: undefined,
      customPayload: { action: 'refresh', nested: { a: 1 } },
    }).expect(201);
    expect(custom.body.data.customPayload).toEqual({ action: 'refresh', nested: { a: 1 } });
    await send(h, envId, { type: 'IN_APP' }).expect(201);
  });

  it('rejects invalid payloads and stores nothing', async () => {
    const res = await send(h, envId, { title: undefined, strategy: 'nope' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.pushMessage.count()).toBe(0);
  });

  it('rejects malformed JSON with the standard error shape', async () => {
    const res = await request(h.app)
      .post(`${url}/messages`)
      .set('Authorization', `Bearer ${h.token}`)
      .set('Content-Type', 'application/json')
      .send('{"oops"')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST_BODY');
  });

  it('lists with filters and funnel summaries', async () => {
    await send(h, envId).expect(201);
    await send(h, envId, { type: 'IN_APP', title: 'Other' }).expect(201);
    const list = await h.api.get(`${url}/messages?type=IN_APP`).expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].funnel.delivered).toBe(1);
    expect((await h.api.get(`${url}/messages?search=Other`)).body.meta.total).toBe(1);
    expect((await h.api.get(`${url}/messages?status=FAILED`)).body.meta.total).toBe(0);
  });

  it('returns 404 for a message in another environment', async () => {
    const { body } = await send(h, envId).expect(201);
    const other = await createApplication(h, 'Other');
    await h.api.get(`/api/v1/environments/${other.envId}/messages/${body.data.msgid}`).expect(404);
  });

  it('sends through the open API with Basic credentials', async () => {
    const res = await request(h.app)
      .post('/api/v1/open/messages')
      .set('Authorization', basic(appKey, masterSecret))
      .send(notification())
      .expect(201);
    expect(res.body.data.funnel.delivered).toBe(1);
    expect((await prisma.pushMessage.findFirstOrThrow()).createdById).toBeNull();
  });

  describe('audience resolution', () => {
    beforeEach(async () => {
      await registerDevice(h, envId, { registrationId: 'device-2', platform: 'IOS' });
      await registerDevice(h, envId, { registrationId: 'device-3' });
      await h.api.put(`${url}/devices/device-1/tags`, { add: ['a', 'b'] }).expect(200);
      await h.api.put(`${url}/devices/device-2/tags`, { add: ['b'] }).expect(200);
      await h.api.put(`${url}/devices/device-3/alias`, { alias: 'u3' }).expect(200);
    });

    const planned = async (audience: object) =>
      (await send(h, envId, { audience }).expect(201)).body.data.funnel;

    it('targets all devices', async () => {
      expect((await planned({ type: 'ALL' })).delivered).toBe(3);
    });

    it('targets registration IDs', async () => {
      expect((await planned({ type: 'REGISTRATION_IDS', values: ['device-2'] })).delivered).toBe(1);
    });

    it('counts a device reached through two tags once', async () => {
      expect(await planned({ type: 'TAGS', values: ['a', 'b'] })).toMatchObject({
        planned: 2,
        delivered: 2,
      });
    });

    it('targets aliases', async () => {
      expect((await planned({ type: 'ALIASES', values: ['u3'] })).delivered).toBe(1);
    });

    it('records unknown tags and aliases as invalid targets', async () => {
      expect(await planned({ type: 'TAGS', values: ['a', 'ghost'] })).toMatchObject({
        planned: 2,
        valid: 1,
      });
      expect(await planned({ type: 'ALIASES', values: ['ghost'] })).toMatchObject({
        planned: 1,
        valid: 0,
      });
    });
  });
});
