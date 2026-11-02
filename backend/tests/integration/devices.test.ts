import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  basic,
  createApplication,
  harness,
  prisma,
  registerDevice,
  send,
  type Harness,
} from '../helpers.js';

describe('devices, tags and aliases', () => {
  let h: Harness;
  let envId: number;
  let url: string;

  beforeEach(async () => {
    h = await harness();
    ({ envId } = await createApplication(h));
    url = `/api/v1/environments/${envId}`;
  });

  it('registers a device with a generated registration ID', async () => {
    const res = await h.api
      .post(`${url}/devices`, { platform: 'ANDROID', vendor: 'XiaoMi', appVersion: '2.0.0' })
      .expect(201);
    expect(res.body.data.registrationId).toMatch(/^rid_[0-9a-f]{24}$/);
    expect(res.body.data).toMatchObject({ vendor: 'xiaomi', status: 'ACTIVE', tags: [], alias: null });
    expect(res.body.data.lastActiveAt).toBeTruthy();
  });

  it('rejects a duplicate registration ID, across environments too', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const dup = await h.api
      .post(`${url}/devices`, { registrationId: 'device-1', platform: 'IOS', appVersion: '1' })
      .expect(409);
    expect(dup.body.error.code).toBe('DEVICE_EXISTS');

    const other = await createApplication(h, 'Other');
    await h.api
      .post(`/api/v1/environments/${other.envId}/devices`, {
        registrationId: 'device-1',
        platform: 'IOS',
        appVersion: '1',
      })
      .expect(409);
  });

  it('rejects invalid registrations', async () => {
    await h.api.post(`${url}/devices`, { platform: 'WINDOWS', appVersion: '1' }).expect(400);
    await h.api.post(`${url}/devices`, { platform: 'IOS' }).expect(400);
    await h.api
      .post(`${url}/devices`, { registrationId: 'x y', platform: 'IOS', appVersion: '1' })
      .expect(400);
  });

  it('queries devices with filters and pagination', async () => {
    await registerDevice(h, envId, { registrationId: 'android-1' });
    await registerDevice(h, envId, { registrationId: 'ios-0001', platform: 'IOS', online: false });
    await h.api.put(`${url}/devices/android-1/tags`, { add: ['vip'] }).expect(200);

    expect((await h.api.get(`${url}/devices?platform=IOS`)).body.meta.total).toBe(1);
    expect((await h.api.get(`${url}/devices?online=false`)).body.data[0].registrationId).toBe('ios-0001');
    expect((await h.api.get(`${url}/devices?tag=vip`)).body.data[0].registrationId).toBe('android-1');
    expect((await h.api.get(`${url}/devices?search=ios`)).body.meta.total).toBe(1);
    expect((await h.api.get(`${url}/devices?pageSize=1`)).body.meta.totalPages).toBe(2);
    await h.api.get(`${url}/devices?pageSize=500`).expect(400);
  });

  it('updates status, activity and version', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1', online: false });
    const res = await h.api
      .patch(`${url}/devices/device-1`, { online: true, appVersion: '3.0.0', status: 'INACTIVE' })
      .expect(200);
    expect(res.body.data).toMatchObject({ online: true, appVersion: '3.0.0', status: 'INACTIVE' });
  });

  it('deletes a device, keeping its message history', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const sent = await send(h, envId).expect(201);
    await h.api.delete(`${url}/devices/device-1`).expect(204);
    await h.api.get(`${url}/devices/device-1`).expect(404);
    await h.api.delete(`${url}/devices/device-1`).expect(404);

    const target = await prisma.messageTarget.findFirstOrThrow({
      where: { message: { msgid: sent.body.data.msgid } },
    });
    expect(target).toMatchObject({ deviceId: null, registrationId: 'device-1', status: 'DELIVERED' });
  });

  it('assigns and removes tags, creating unknown ones', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    const added = await h.api
      .put(`${url}/devices/device-1/tags`, { add: ['vip', 'beta'] })
      .expect(200);
    expect(added.body.data.tags.sort()).toEqual(['beta', 'vip']);
    const removed = await h.api
      .put(`${url}/devices/device-1/tags`, { remove: ['vip'] })
      .expect(200);
    expect(removed.body.data.tags).toEqual(['beta']);
  });

  it('manages tags and their devices', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    await h.api.post(`${url}/tags`, { name: 'promo' }).expect(201);
    const dup = await h.api.post(`${url}/tags`, { name: 'promo' }).expect(409);
    expect(dup.body.error.code).toBe('TAG_EXISTS');

    await h.api.post(`${url}/tags/promo/devices`, { add: ['device-1'] }).expect(204);
    expect((await h.api.get(`${url}/tags`)).body.data[0]).toMatchObject({
      name: 'promo',
      deviceCount: 1,
    });
    await h.api.post(`${url}/tags/promo/devices`, { remove: ['device-1'] }).expect(204);
    expect((await h.api.get(`${url}/tags`)).body.data[0].deviceCount).toBe(0);

    await h.api.delete(`${url}/tags/promo`).expect(204);
    await h.api.delete(`${url}/tags/promo`).expect(404);
    await h.api.post(`${url}/tags/promo/devices`, { add: ['device-1'] }).expect(404);
  });

  it('assigns, shares, clears and deletes aliases', async () => {
    await registerDevice(h, envId, { registrationId: 'device-1' });
    await registerDevice(h, envId, { registrationId: 'device-2' });
    await h.api.put(`${url}/devices/device-1/alias`, { alias: 'user-1' }).expect(200);
    const second = await h.api.put(`${url}/devices/device-2/alias`, { alias: 'user-1' }).expect(200);
    expect(second.body.data.alias).toBe('user-1');

    const aliases = (await h.api.get(`${url}/aliases`)).body.data;
    expect(aliases).toHaveLength(1);
    expect(aliases[0].devices).toHaveLength(2);

    const cleared = await h.api.put(`${url}/devices/device-1/alias`, { alias: null }).expect(200);
    expect(cleared.body.data.alias).toBeNull();

    await h.api.delete(`${url}/aliases/user-1`).expect(204);
    expect((await h.api.get(`${url}/devices/device-2`)).body.data.alias).toBeNull();
    await h.api.delete(`${url}/aliases/user-1`).expect(404);
  });

  it('previews and performs cleanup of stale devices', async () => {
    const now = h.deps.clock();
    await registerDevice(h, envId, { registrationId: 'fresh-01' });
    await registerDevice(h, envId, { registrationId: 'stale-01' });
    await prisma.device.update({
      where: { registrationId: 'stale-01' },
      data: { lastActiveAt: new Date(now.getTime() - 40 * 86_400_000) },
    });

    const preview = await h.api
      .post(`${url}/devices/cleanup`, { inactiveDays: 30, dryRun: true })
      .expect(200);
    expect(preview.body.data.matched).toBe(1);
    expect((await h.api.get(`${url}/devices`)).body.meta.total).toBe(2);

    const done = await h.api.post(`${url}/devices/cleanup`, { inactiveDays: 30 }).expect(200);
    expect(done.body.data.deleted).toBe(1);
    expect((await h.api.get(`${url}/devices`)).body.data[0].registrationId).toBe('fresh-01');
  });

  it('serves the same operations through the open API', async () => {
    const { appKey, masterSecret } = await createApplication(h, 'Open');
    const auth = basic(appKey, masterSecret);
    await request(h.app)
      .post('/api/v1/open/devices')
      .set('Authorization', auth)
      .send({ registrationId: 'open-device', platform: 'IOS', appVersion: '1' })
      .expect(201);
    const res = await request(h.app).get('/api/v1/open/devices').set('Authorization', auth).expect(200);
    expect(res.body.meta.total).toBe(1);
  });
});
